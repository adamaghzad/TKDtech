'use client';

import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Maximize2, Medal, RefreshCw, Trophy } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { Brand } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { CountryFlag } from '@/components/ui/country-flag';
import { EmptyState, ErrorState, Loading } from '@/components/ui/states';
import { cn } from '@/lib/utils';

export interface PodiumPlacement {
  place: number;
  athleteId: string;
  athleteName: string;
  clubName: string | null;
  countryCode: string | null;
}

export interface CategoryPodiumPayload {
  categoryId: string;
  categoryName: string;
  division: string;
  ageGroup: string;
  tournamentId: string;
  tournamentName: string;
  tournamentVenue: string;
  placements: PodiumPlacement[];
}

export interface ClubPodiumEntry {
  rank: number;
  clubId: string;
  clubName: string;
  countryCode: string;
  gold: number;
  silver: number;
  bronze: number;
  total: number;
}

export interface ClubPodiumPayload {
  tournamentId: string;
  tournamentName: string;
  tournamentVenue: string;
  clubs: ClubPodiumEntry[];
}

const PLACE_COLORS: Record<number, string> = { 1: '#f0ff00', 2: '#c3cfdf', 3: '#d8935e' };
const PLACE_LABELS: Record<number, string> = { 1: 'Gold', 2: 'Silver', 3: 'Bronze' };

function useTvFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const toggleFullscreen = useCallback(async () => {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  }, []);
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'f' || event.key === 'F') void toggleFullscreen();
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('keydown', onKey);
    onFsChange();
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('keydown', onKey);
    };
  }, [toggleFullscreen]);
  return { isFullscreen, toggleFullscreen };
}

function CeremonyShell({
  eyebrow,
  title,
  subtitle,
  isFullscreen,
  onToggleFullscreen,
  onRefresh,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onRefresh: () => void;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col bg-background">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(32,104,255,.14),transparent_55%)]" />
      <header className="flex items-center justify-between gap-4 border-b border-line/60 px-4 py-3 sm:px-6 sm:py-4">
        <Brand />
        <div className="min-w-0 flex-1 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[.28em] text-primary">{eyebrow}</p>
          <h1 className="mt-1 truncate text-xl font-black sm:text-3xl">{title}</h1>
          {subtitle ? <p className="mt-0.5 truncate text-xs text-muted">{subtitle}</p> : null}
        </div>
        {isFullscreen ? null : (
          <div data-testid="public-display-controls" className="flex shrink-0 items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onRefresh}>
              <RefreshCw />
              Refresh
            </Button>
            <Button variant="secondary" size="sm" onClick={onToggleFullscreen}>
              <Maximize2 />
              Fullscreen
            </Button>
          </div>
        )}
      </header>
      <div className="flex flex-1 items-center justify-center overflow-hidden p-4 sm:p-8">{children}</div>
    </main>
  );
}

function PodiumStep({
  place,
  stepClassName,
  children,
}: {
  place: number;
  stepClassName: string;
  children: ReactNode;
}) {
  const color = PLACE_COLORS[place] ?? '#ffffff';
  return (
    <div className="flex min-w-0 flex-col items-center justify-end gap-4 sm:gap-5">
      {children}
      <div className={cn('flex w-full flex-col rounded-t-lg border border-line/60 bg-panel/80 shadow-2xl', stepClassName)}>
        <div className="h-2.5 w-full rounded-t-lg" style={{ background: color, boxShadow: `0 0 28px ${color}59` }} />
        <div className="flex flex-1 items-center justify-center pb-2">
          <span className="numeric text-6xl font-black sm:text-7xl" style={{ color }}>
            {place}
          </span>
        </div>
      </div>
    </div>
  );
}

function PodiumAthlete({ placement, highlight }: { placement: PodiumPlacement; highlight?: boolean }) {
  const color = PLACE_COLORS[placement.place] ?? '#ffffff';
  return (
    <div className="flex w-48 flex-col items-center gap-2 text-center sm:w-60">
      <CountryFlag code={placement.countryCode} className={highlight ? 'w-20' : 'w-16'} />
      <p className={cn('font-black leading-tight', highlight ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl')}>{placement.athleteName}</p>
      <p className="text-xs text-muted sm:text-sm">{placement.clubName ?? 'Independent athlete'}</p>
      <span
        className="mt-1 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest"
        style={{ borderColor: `${color}55`, color, background: `${color}14` }}
      >
        <Medal className="size-3.5" style={{ color }} />
        {PLACE_LABELS[placement.place] ?? `Place ${placement.place}`}
      </span>
    </div>
  );
}

function MedalChip({ place, value }: { place: 1 | 2 | 3; value: number }) {
  const color = PLACE_COLORS[place]!;
  return (
    <span
      className={cn('numeric inline-flex min-w-8 items-center justify-center rounded-md border px-2 py-0.5 text-sm font-bold', value === 0 && 'opacity-40')}
      style={{ borderColor: `${color}55`, color, background: `${color}14` }}
    >
      {value}
    </span>
  );
}

function PodiumClub({ club }: { club: ClubPodiumEntry }) {
  const color = PLACE_COLORS[club.rank] ?? '#ffffff';
  const highlight = club.rank === 1;
  return (
    <div className="flex w-52 flex-col items-center gap-2 text-center sm:w-72">
      <CountryFlag code={club.countryCode} className={highlight ? 'w-20' : 'w-16'} />
      <p className={cn('font-black leading-tight', highlight ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl')}>{club.clubName}</p>
      <div className="mt-1 flex items-center gap-2">
        <MedalChip place={1} value={club.gold} />
        <MedalChip place={2} value={club.silver} />
        <MedalChip place={3} value={club.bronze} />
      </div>
      <p className="text-xs text-muted">
        {club.total} medal{club.total === 1 ? '' : 's'}
      </p>
      <span
        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest"
        style={{ borderColor: `${color}55`, color, background: `${color}14` }}
      >
        <Trophy className="size-3.5" style={{ color }} />
        {club.rank === 1 ? 'Champion club' : `Rank ${club.rank}`}
      </span>
    </div>
  );
}

export function PodiumTv({ categoryId }: { categoryId: string }) {
  const { data, error, loading, refresh } = useApi<CategoryPodiumPayload>(`/api/v1/categories/${categoryId}/podium`);
  const { isFullscreen, toggleFullscreen } = useTvFullscreen();

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} retry={refresh} />;
  if (!data) return null;

  const gold = data.placements.find((placement) => placement.place === 1);
  const silvers = data.placements.filter((placement) => placement.place === 2);
  const bronzes = data.placements.filter((placement) => placement.place === 3);

  return (
    <CeremonyShell
      eyebrow="Medal ceremony"
      title={data.categoryName}
      subtitle={`${data.tournamentName} · ${data.tournamentVenue}`}
      isFullscreen={isFullscreen}
      onToggleFullscreen={() => void toggleFullscreen()}
      onRefresh={() => void refresh()}
    >
      {data.placements.length === 0 ? (
        <EmptyState
          title="Podium not decided yet"
          description="Medals are awarded automatically when the category final resolves. This podium updates the moment the official result is recorded."
        />
      ) : (
        <div className="flex w-full max-w-5xl items-end justify-center gap-3 sm:gap-6">
          {silvers.map((placement) => (
            <PodiumStep key={placement.athleteId} place={2} stepClassName="h-24 sm:h-36">
              <PodiumAthlete placement={placement} />
            </PodiumStep>
          ))}
          {gold ? (
            <PodiumStep place={1} stepClassName="h-40 sm:h-56">
              <PodiumAthlete placement={gold} highlight />
            </PodiumStep>
          ) : null}
          {bronzes.length > 0 ? (
            <div className="flex items-end gap-3 sm:gap-6">
              {bronzes.map((placement) => (
                <PodiumStep key={placement.athleteId} place={3} stepClassName="h-16 sm:h-28">
                  <PodiumAthlete placement={placement} />
                </PodiumStep>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </CeremonyShell>
  );
}

export function ClubPodiumTv({ tournamentId }: { tournamentId: string }) {
  const { data, error, loading, refresh } = useApi<ClubPodiumPayload>(`/api/v1/public/tournaments/${tournamentId}/club-podium`);
  const { isFullscreen, toggleFullscreen } = useTvFullscreen();

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} retry={refresh} />;
  if (!data) return null;

  const top = data.clubs.slice(0, 3);
  const rest = data.clubs.slice(3);
  const first = top.find((club) => club.rank === 1);
  const second = top.find((club) => club.rank === 2);
  const third = top.find((club) => club.rank === 3);

  return (
    <CeremonyShell
      eyebrow="Club / Team ceremony"
      title={data.tournamentName}
      subtitle={`Club medal standings · ${data.tournamentVenue}`}
      isFullscreen={isFullscreen}
      onToggleFullscreen={() => void toggleFullscreen()}
      onRefresh={() => void refresh()}
    >
      {data.clubs.length === 0 ? (
        <EmptyState
          title="No club medals yet"
          description="Club standings build up as category finals resolve. Open this display during the closing ceremony to show the ranked clubs."
        />
      ) : (
        <div className="w-full max-w-5xl space-y-8">
          <div className="flex items-end justify-center gap-3 sm:gap-6">
            {second ? (
              <PodiumStep place={2} stepClassName="h-24 sm:h-36">
                <PodiumClub club={second} />
              </PodiumStep>
            ) : null}
            {first ? (
              <PodiumStep place={1} stepClassName="h-40 sm:h-56">
                <PodiumClub club={first} />
              </PodiumStep>
            ) : null}
            {third ? (
              <PodiumStep place={3} stepClassName="h-16 sm:h-28">
                <PodiumClub club={third} />
              </PodiumStep>
            ) : null}
          </div>
          {rest.length > 0 ? (
            <div className="mx-auto max-w-2xl overflow-hidden rounded-xl border border-line/60">
              <table className="w-full text-left text-sm">
                <thead className="text-[10px] uppercase tracking-wider text-muted">
                  <tr className="border-b border-line/60">
                    <th className="px-4 py-2.5 font-medium">#</th>
                    <th className="px-4 py-2.5 font-medium">Club / Team</th>
                    <th className="px-3 py-2.5 text-center font-medium">Gold</th>
                    <th className="px-3 py-2.5 text-center font-medium">Silver</th>
                    <th className="px-3 py-2.5 text-center font-medium">Bronze</th>
                    <th className="px-4 py-2.5 text-center font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/50">
                  {rest.map((club) => (
                    <tr key={club.clubId}>
                      <td className="numeric px-4 py-3 font-black text-muted">{club.rank}</td>
                      <td className="px-4 py-3 font-semibold">{club.clubName}</td>
                      <td className="px-3 py-3 text-center"><MedalChip place={1} value={club.gold} /></td>
                      <td className="px-3 py-3 text-center"><MedalChip place={2} value={club.silver} /></td>
                      <td className="px-3 py-3 text-center"><MedalChip place={3} value={club.bronze} /></td>
                      <td className="numeric px-4 py-3 text-center text-base font-black">{club.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}
    </CeremonyShell>
  );
}
