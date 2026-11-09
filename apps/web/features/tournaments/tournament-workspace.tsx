'use client';
import Link from 'next/link';
import { CalendarDays, ChevronRight, Download, MapPin, RefreshCw, Settings2, Upload } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import type { TournamentDetails } from '@/lib/types';
import { Loading, ErrorState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/badge';
import { formatDate, cn } from '@/lib/utils';
import { TournamentOverview } from './overview';
import { AthleteManager } from './athlete-manager';
import { ClubManager } from './club-manager';
import { CategoryManager, DrawManager } from './category-manager';
import { BracketManager } from './bracket-manager';
import { MatchManager } from './match-manager';
import { ResultsManager, MedalManager, ReportsManager, TournamentSettings } from './results-reports';
import { post } from '@/lib/api';
import { useState } from 'react';

const tabs = [
  ['overview', 'Overview'],
  ['athletes', 'Athletes'],
  ['clubs', 'Clubs'],
  ['categories', 'Categories'],
  ['draws', 'Draws'],
  ['brackets', 'Brackets'],
  ['schedule', 'Schedule'],
  ['matches', 'Matches'],
  ['results', 'Results'],
  ['medals', 'Medals'],
  ['reports', 'Reports'],
  ['settings', 'Settings'],
];

interface SyncResult {
  jobId: string;
  status: 'COMPLETED' | 'CONFLICT' | 'FAILED';
  uploaded?: number;
  pulled?: number;
  duplicate?: number;
  reason?: string;
  direction: 'PUSH' | 'PULL' | 'SYNC';
}

export function TournamentWorkspace({ tournamentId, section }: { tournamentId: string; section: string }) {
  const { data, error, loading, refresh } = useApi<TournamentDetails>(`/api/v1/tournaments/${tournamentId}`);
  const { toast } = useToast();
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [syncing, setSyncing] = useState(false);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} retry={refresh} />;
  if (!data) return null;

  const current = tabs.some(([id]) => id === section) ? section : 'overview';

  const handlePush = async () => {
    setPushing(true);
    try {
      const result = await post<SyncResult>(`/api/v1/sync/push`, { tournamentId });
      toast(`Push to cloud: ${result.uploaded} uploaded, ${result.duplicate} duplicates`);
      void refresh();
    } catch (error: any) {
      toast(`Push failed: ${error.message}`, 'error');
    } finally {
      setPushing(false);
    }
  };

  const handlePull = async () => {
    setPulling(true);
    try {
      const result = await post<SyncResult>(`/api/v1/sync/pull`, { tournamentId });
      toast(`Pull from cloud: ${result.pulled} pulled, ${result.duplicate} duplicates`);
      void refresh();
    } catch (error: any) {
      toast(`Pull failed: ${error.message}`, 'error');
    } finally {
      setPulling(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await post<SyncResult>(`/api/v1/sync/sync`, { tournamentId });
      toast(`Bidirectional sync: ${result.uploaded} uploaded, ${result.pulled} pulled`);
      void refresh();
    } catch (error: any) {
      toast(`Sync failed: ${error.message}`, 'error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 animate-enter">
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted">
            <Link href="/tournaments" className="hover:text-primary">Tournaments</Link>
            <ChevronRight className="size-3" />
            <span>{current}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-bold">{data.tournament.name}</h2>
            <StatusBadge status={data.tournament.status} />
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5" /> {formatDate(data.tournament.start_date)} – {formatDate(data.tournament.end_date)}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="size-3.5" /> {data.tournament.venue}
            </span>
          </div>
        </div>
        <div className="flex items-end gap-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <Button onClick={handlePush} disabled={pushing} className="w-full" variant="default">
              <Upload className="mr-2 size-4" /> Push
            </Button>
            <Button onClick={handlePull} disabled={pulling} className="w-full" variant="default">
              <Download className="mr-2 size-4" /> Pull
            </Button>
            <Button onClick={handleSync} disabled={syncing} className="w-full" variant="default">
              <RefreshCw className="mr-2 size-4" /> Sync
            </Button>
          </div>
        </div>
        <Link href={`/tournaments/${tournamentId}/settings`} className="flex items-center gap-2 text-xs text-muted hover:text-white">
          <Settings2 className="size-4" /> Rules & status
        </Link>
      </div>
      <div className="overflow-x-auto border-b border-line/60">
        <div className="flex min-w-max gap-1">
          {tabs.map(([id, label]) => (
            <Link
              key={id}
              href={`/tournaments/${tournamentId}${id === 'overview' ? '' : `/${id}`}`}
              className={cn(
                'relative px-3.5 py-3 text-xs font-medium transition',
                current === id ? 'text-white' : 'text-muted hover:text-white',
              )}
            >
              {label}
              {current === id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-t bg-primary" />}
            </Link>
          ))}
        </div>
      </div>
      {current === 'overview' && <TournamentOverview data={data} refresh={refresh} />}
      {current === 'athletes' && <AthleteManager data={data} refresh={refresh} />}
      {current === 'clubs' && <ClubManager data={data} refresh={refresh} />}
      {current === 'categories' && <CategoryManager data={data} refresh={refresh} />}
      {current === 'draws' && <DrawManager data={data} refresh={refresh} />}
      {current === 'brackets' && <BracketManager data={data} />}
      {(current === 'schedule' || current === 'matches') && (
        <MatchManager data={data} refresh={refresh} scheduleOnly={current === 'schedule'} />
      )}
      {current === 'results' && <ResultsManager data={data} />}
      {current === 'medals' && <MedalManager data={data} />}
      {current === 'reports' && <ReportsManager data={data} />}
      {current === 'settings' && <TournamentSettings data={data} refresh={refresh} />}
    </div>
  );
}