'use client';

import { Camera, Check, MapPin, Radio, ShieldAlert, Wifi, WifiOff } from 'lucide-react';
import type { MatchSnapshot, Side, SideScoringActivity } from '@tkd/contracts';
import { BrandMark } from '@/components/brand';
import { CountryFlag } from '@/components/ui/country-flag';
import { HeadguardIcon, HoguIcon, PunchFistIcon } from './scoring-activity-icons';
import { liveScoreboardScores } from '@/lib/match-result';
import { stateLabel } from './scoreboard-state';
import { cn, formatTime, isRoundClosingSeconds } from '@/lib/utils';

const judgeRoles = ['J1', 'J2', 'J3'] as const;

function JudgeDots({ testPrefix, label, confirmedJudges }: { testPrefix: string; label: string; confirmedJudges: Array<(typeof judgeRoles)[number]> }) {
  return (
    <span className="flex items-center gap-0.5">
      {judgeRoles.map(role => {
        const confirmed = confirmedJudges.includes(role);
        return (
          <span
            key={role}
            data-testid={`${testPrefix}-${role.toLowerCase()}`}
            data-judge-role={role}
            data-confirmed={confirmed}
            aria-label={`${label} ${role} ${confirmed ? 'input registered' : 'no input'}`}
            title={`${label} ${role}: ${confirmed ? 'input registered' : 'no input'}`}
            className={cn(
              'flex size-3 items-center justify-center rounded-full border text-[7px] font-black leading-none',
              confirmed ? 'border-timer bg-timer text-black' : 'border-timer/70 bg-black/20 text-timer',
            )}
          >
            {role.slice(1)}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Horizontal variant of the scoring activity rail for portrait phones: punches,
 * hits and the Gam-Jeom counter sit in one touch-friendly strip at the bottom of
 * each athlete row. Same data-testids as the landscape rail.
 */
function CompactActivityStrip({ side, activity, gamJeom }: { side: Side; activity: SideScoringActivity; gamJeom: number }) {
  const testSide = side.toLowerCase();
  const punches = activity.punches;
  const hits = activity.hits;
  const punchStatus = punches.length
    ? `${punches.length} current-round ${punches.length === 1 ? 'punch' : 'punches'} recorded`
    : 'no punch input';

  return (
    <aside
      aria-label={`${side} scoring activity: ${activity.headHits} head hits, ${activity.bodyHits} body hits, ${gamJeom} Gam-Jeom; ${punchStatus}`}
      data-testid={`${testSide}-scoring-activity`}
      className="absolute inset-x-0 bottom-0 z-20 flex h-11 shrink-0 items-stretch gap-2 overflow-hidden border-t border-white/15 bg-black/40"
    >
      {punches.length > 0 && (
        <div data-testid={`${testSide}-punches`} className="flex shrink-0 items-center gap-2 overflow-x-auto border-r border-white/15 px-2">
          {punches.map((punch, index) => (
            <span
              key={index}
              data-testid={`${testSide}-punch-${index}`}
              data-status={punch.status.toLowerCase()}
              aria-label={`Punch ${index + 1} of ${punches.length}: ${punch.confirmedJudges.length} of 3 judges registered, ${punch.status === 'CONFIRMED' ? 'confirmed' : `waiting for ${punch.requiredConfirmations} matching judges`}`}
              title={`Punch ${index + 1} · ${punch.requiredConfirmations} matching ${punch.requiredConfirmations === 1 ? 'judge' : 'judges'} required`}
              className="flex shrink-0 items-center gap-1"
            >
              <PunchFistIcon className="size-3.5 text-timer" />
              <JudgeDots testPrefix={`${testSide}-punch-${index}`} label={`Punch ${index + 1}`} confirmedJudges={punch.confirmedJudges} />
              {punch.status === 'CONFIRMED' && <span className="numeric text-[9px] font-black text-timer">+{punch.points}</span>}
            </span>
          ))}
        </div>
      )}
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2.5 overflow-x-auto px-2">
        <p className="shrink-0 text-[8px] font-black tracking-[.16em] text-white/60">HITS</p>
        {hits.length ? (
          hits.map((hit, index) => {
            const targetName = hit.target === 'HEAD' ? 'Head' : 'Body';
            const testTarget = hit.target.toLowerCase();
            const label = `${targetName} kick ${index + 1}`;
            return (
              <span
                key={index}
                data-testid={`${testSide}-${testTarget}-hit`}
                data-hit-index={index}
                data-status={hit.status.toLowerCase()}
                data-source={hit.source.toLowerCase()}
                aria-label={`${label}: ${hit.source === 'OPERATOR' ? 'operator confirmed' : `${hit.confirmedJudges.length} of 3 judges registered, ${hit.status === 'CONFIRMED' ? 'confirmed' : 'pending'}`}`}
                title={`${label} · ${hit.pointType.replaceAll('_', ' ')}`}
                className="flex shrink-0 items-center gap-1"
              >
                {hit.target === 'HEAD'
                  ? <HeadguardIcon className={cn('h-5 w-5 text-[#ff8fab] drop-shadow-[0_1px_2px_rgba(0,0,0,.35)]', hit.status === 'PENDING' && 'opacity-70')} />
                  : <HoguIcon className={cn('h-5 w-5 text-[#4cc9f0] drop-shadow-[0_1px_2px_rgba(0,0,0,.35)]', hit.status === 'PENDING' && 'opacity-70')} />}
                {hit.source === 'JUDGES' && <JudgeDots testPrefix={`${testSide}-hit-${index}`} label={label} confirmedJudges={hit.confirmedJudges} />}
                {hit.status === 'CONFIRMED' && <span className="numeric text-[9px] font-black text-white/85">+{hit.points}</span>}
              </span>
            );
          })
        ) : (
          <p data-testid={`${testSide}-zero-hits`} className="shrink-0 text-[8px] font-bold text-white/40">0 HITS</p>
        )}
      </div>
      <div
        data-testid={`${testSide}-gam-jeom`}
        title="Round Gam-Jeom penalties (5 in one round = PUN round loss)"
        className="flex w-12 shrink-0 flex-col items-center justify-center border-l border-timer/35 bg-black/30 px-1"
      >
        <p className="text-[7px] font-black uppercase tracking-[.14em] text-timer/80">GJ</p>
        <p data-testid={`${testSide}-gam-jeom-value`} className="numeric text-sm font-black leading-none text-white">{gamJeom}</p>
      </div>
    </aside>
  );
}

function CompactAthletePanel({
  side,
  name,
  countryCode,
  score,
  gamJeom,
  rounds,
  winner,
  currentRound,
  resting,
  activity,
}: {
  side: Side;
  name: string;
  countryCode: string;
  score: number;
  gamJeom: number;
  rounds: MatchSnapshot['rounds'];
  winner: boolean;
  currentRound: number;
  resting: boolean;
  activity: SideScoringActivity;
}) {
  const blue = side === 'BLUE';
  return (
    <section aria-label={`${side} athlete ${name}`} className={cn('relative flex min-h-0 flex-1 overflow-hidden', blue ? 'bg-blue' : 'bg-red')}>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className={cn('flex min-w-0 items-center gap-2.5 px-3 pt-3', !blue && 'flex-row-reverse text-right')}>
          <CountryFlag code={countryCode} className="w-10 shrink-0 rounded-[4px] ring-2 ring-white/90 shadow-[0_4px_14px_rgba(0,0,0,.42)]" />
          {winner && <span className="shrink-0 rounded-full bg-white p-1 text-black"><Check className="size-3.5" /></span>}
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-black uppercase leading-tight tracking-tight">{name}</h2>
            <p className="text-[9px] font-bold tracking-[.16em] text-white/70">{countryCode} · {side}</p>
          </div>
        </div>
        {resting && (
          <div className={cn('mt-2 flex flex-wrap gap-1.5 px-3', !blue && 'justify-end')} aria-label={`${side} round points`}>
            {[1, 2, 3].map(round => {
              const record = rounds.find(item => item.number === round);
              const won = record?.endedAt !== null && round <= currentRound && record?.winner === side;
              const points = record ? (blue ? record.blueScore : record.redScore) : null;
              return (
                <div key={round} className={cn('flex items-center gap-1 rounded border px-1.5 py-0.5', currentRound === round ? 'border-white/45 bg-white/10' : 'border-white/15')}>
                  <span className="text-[8px] font-bold text-white/65">R{round}</span>
                  <span className="numeric text-[11px] font-black leading-none">{points ?? '–'}</span>
                  {won && <span aria-label={`${side} won round ${round}`} title={`${side} won round ${round}`} className="size-1.5 shrink-0 rounded-full bg-timer shadow-[0_0_8px_rgba(240,255,0,.45)]" />}
                </div>
              );
            })}
          </div>
        )}
        <div className={cn('flex items-center gap-1 pb-12 pl-3 pt-1.5 text-white/45', !blue && 'flex-row-reverse pl-0 pr-3')}>
          <Camera className="size-3 shrink-0" />
          <span className="text-[7px] uppercase tracking-wider">Video review ready</span>
        </div>
      </div>
      <div className="flex w-[36%] max-w-[190px] shrink-0 flex-col items-center justify-center pb-11 text-center">
        <div>
          <span data-testid={`${side.toLowerCase()}-${resting ? 'round-wins' : 'points'}`} className="numeric scoreboard-shadow block text-[clamp(3rem,15vw,6rem)] font-black leading-none">{score}</span>
          <p className="mt-1 text-[7px] font-black uppercase tracking-[.18em] text-white/50">{resting ? 'Round wins' : 'Round points'}</p>
        </div>
      </div>
      <CompactActivityStrip side={side} activity={activity} gamJeom={gamJeom} />
    </section>
  );
}

function CompactCenterStrip({ snapshot, remainingMs }: { snapshot: MatchSnapshot; remainingMs: number }) {
  const closingSeconds = isRoundClosingSeconds(snapshot.timer.kind, remainingMs);
  const resting = snapshot.timer.kind === 'BREAK';
  const breakRound = resting ? snapshot.rounds.find(round => round.number === snapshot.currentRound - 1 && round.endedAt !== null) ?? null : null;
  const breakWinner: Side | null = breakRound?.winner ?? null;
  const decisionSuffix = breakRound?.decisionMethod === 'SUPERIORITY'
    ? ' · SUPERIORITY'
    : breakRound?.decisionMethod === 'POINT_GAP'
      ? ' · POINT GAP'
      : breakRound?.decisionMethod === 'PUN'
        ? ' · PUN'
        : '';

  return (
    <aside className="relative z-10 shrink-0 border-y border-white/15 bg-black text-center shadow-[0_0_35px_rgba(0,0,0,.5)]">
      <div
        data-testid="scoreboard-timer"
        data-urgent={closingSeconds ? 'true' : 'false'}
        className={cn('flex items-stretch transition-colors duration-200', closingSeconds ? 'bg-[#e60019] text-white' : 'bg-timer text-black')}
      >
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center py-2">
          <p className="numeric text-[clamp(2.4rem,12vw,4.2rem)] font-black leading-none tracking-[-.06em]">{formatTime(remainingMs)}</p>
          <p className="mt-0.5 text-[10px] font-black uppercase leading-tight">{stateLabel(snapshot, remainingMs)}</p>
        </div>
        <div className={cn('flex w-[86px] shrink-0 flex-col items-center justify-center gap-1 border-l py-2', closingSeconds ? 'border-white/25' : 'border-black/25')}>
          <p className="text-[8px] font-black tracking-[.14em] opacity-75">{snapshot.timer.kind === 'GOLDEN_POINT' ? 'GOLDEN PT' : 'ROUND'}</p>
          <p className="numeric text-[clamp(1.6rem,8vw,2.6rem)] font-black leading-none">{snapshot.currentRound}</p>
          <div className="flex gap-1">
            {Array.from({ length: snapshot.totalRounds }, (_, index) => (
              <span
                key={index}
                className={cn(
                  'size-1.5 rounded-full border',
                  index + 1 < snapshot.currentRound ? 'border-success bg-success' : index + 1 === snapshot.currentRound ? 'border-timer bg-timer' : 'border-white/30',
                )}
              />
            ))}
          </div>
        </div>
      </div>
      {breakRound && (
        <div className="flex items-center justify-between gap-2 bg-[#070a10] px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider">
          <span className="shrink-0 text-white/65">
            R{breakRound.number} <span className="numeric text-[#9abaff]">{breakRound.blueScore}</span>–<span className="numeric text-[#ff9ba5]">{breakRound.redScore}</span>
          </span>
          <span className={cn('truncate', breakWinner ? 'rounded bg-timer px-1.5 py-0.5 text-black' : 'text-timer')}>
            {breakWinner ? `${breakWinner} WINS${decisionSuffix}` : breakRound.blueScore === breakRound.redScore ? 'SUPERIORITY REQUIRED' : 'ROUND RESULT PENDING'}
          </span>
          <span className="shrink-0 text-white/45">NEXT · {snapshot.currentRound > snapshot.totalRounds ? 'GP' : `R${snapshot.currentRound}`}</span>
        </div>
      )}
      <div className="flex items-center justify-center gap-1.5 border-t border-white/10 bg-[#070a10] px-3 py-1">
        {judgeRoles.map(role => {
          const judge = snapshot.judges.find(item => item.role === role);
          return (
            <span
              key={role}
              className={cn('flex items-center gap-1 rounded px-1 py-0.5 text-[8px] font-bold', judge?.status === 'ONLINE' ? 'bg-success/10 text-success' : 'bg-white/5 text-white/35')}
              title={`${role}: ${judge?.status ?? 'NOT ASSIGNED'}`}
            >
              {judge?.status === 'ONLINE' ? <Wifi className="size-2.5" /> : <WifiOff className="size-2.5" />}{role}
            </span>
          );
        })}
        {snapshot.winner && <span className="ml-2 rounded bg-success px-1.5 py-0.5 text-[8px] font-black text-black">{snapshot.winner} WINS</span>}
      </div>
    </aside>
  );
}

/**
 * Portrait / phone content of the live scoreboard: Blue row on top, timer strip
 * in the middle, Red row at the bottom. Rendered by ScoreboardView inside a
 * stable wrapper on compact viewports, so overlays and the root element keep
 * their identity when the breakpoint changes; the landscape TV layout stays
 * untouched.
 */
export function ScoreboardCompactContent({
  snapshot,
  remainingMs,
  flipped = false,
}: {
  snapshot: MatchSnapshot;
  remainingMs: number;
  flipped?: boolean;
}) {
  const blue = flipped ? snapshot.red : snapshot.blue;
  const red = flipped ? snapshot.blue : snapshot.red;
  const resting = snapshot.timer.kind === 'BREAK';
  const liveScores = liveScoreboardScores(snapshot);
  const blueScore = flipped ? liveScores.red : liveScores.blue;
  const redScore = flipped ? liveScores.blue : liveScores.red;
  const blueActivity = flipped ? snapshot.scoringActivity.red : snapshot.scoringActivity.blue;
  const redActivity = flipped ? snapshot.scoringActivity.blue : snapshot.scoringActivity.red;
  const breakRound = resting ? snapshot.rounds.find(round => round.number === snapshot.currentRound - 1 && round.endedAt !== null) ?? null : null;
  const currentRoundRecord = snapshot.rounds.find(round => round.number === snapshot.currentRound);
  const rawBlueGam = currentRoundRecord ? currentRoundRecord.bluePenalties : snapshot.blueGamJeom;
  const rawRedGam = currentRoundRecord ? currentRoundRecord.redPenalties : snapshot.redGamJeom;
  const blueGam = flipped ? rawRedGam : rawBlueGam;
  const redGam = flipped ? rawBlueGam : rawRedGam;
  const blueWinner = snapshot.winner === (flipped ? 'RED' : 'BLUE');
  const redWinner = snapshot.winner === (flipped ? 'BLUE' : 'RED');
  const displayRounds = flipped
    ? snapshot.rounds.map(round => ({
        ...round,
        blueScore: round.redScore,
        redScore: round.blueScore,
        bluePenalties: round.redPenalties,
        redPenalties: round.bluePenalties,
        winner: (round.winner === 'BLUE' ? 'RED' : round.winner === 'RED' ? 'BLUE' : null) as Side | null,
      }))
    : snapshot.rounds;
  const panelRound = breakRound?.number ?? snapshot.currentRound;

  return (
    <>
      <header className="relative z-20 flex min-h-[46px] shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-[#070a10] px-3 py-1.5">
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <BrandMark className="size-6" />
          <div>
            <p className="text-[10px] font-black italic leading-none">TKD <span className="text-[#6c9cff]">SCORING</span></p>
            <p className="mt-0.5 text-[7px] uppercase tracking-wider text-white/50">TKDTech Sports</p>
          </div>
        </div>
        <div className="min-w-0 text-center">
          <h1 className="truncate text-[11px] font-bold uppercase tracking-wide">{snapshot.tournamentName}</h1>
          <p className="mt-0.5 truncate text-[8px] font-medium text-white/60">{snapshot.phase} · {snapshot.categoryName}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="hidden rounded border border-white/15 px-1.5 py-0.5 text-[8px] font-bold text-white/70 sm:block">{snapshot.matName}</span>
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-bold">MATCH {snapshot.matchNumber}</span>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        <CompactAthletePanel
          side="BLUE"
          name={blue.name}
          countryCode={blue.countryCode}
          score={blueScore}
          gamJeom={blueGam}
          rounds={displayRounds}
          winner={blueWinner}
          currentRound={panelRound}
          resting={resting}
          activity={blueActivity}
        />
        <CompactCenterStrip snapshot={snapshot} remainingMs={remainingMs} />
        <CompactAthletePanel
          side="RED"
          name={red.name}
          countryCode={red.countryCode}
          score={redScore}
          gamJeom={redGam}
          rounds={displayRounds}
          winner={redWinner}
          currentRound={panelRound}
          resting={resting}
          activity={redActivity}
        />
      </div>
      <footer className="relative z-20 flex min-h-[28px] shrink-0 items-center justify-between gap-2 border-t border-white/10 bg-[#070a10] px-3 text-[8px] font-semibold uppercase tracking-wider text-white/55">
        <span className="flex items-center gap-1"><Radio className="size-2.5 text-success" />Live authoritative score</span>
        <span className="flex items-center gap-1"><MapPin className="size-2.5" />{snapshot.matName} · {snapshot.timer.kind === 'GOLDEN_POINT' ? 'GOLDEN POINT' : `Round ${snapshot.currentRound}/${snapshot.totalRounds}`}</span>
        <span className="flex items-center gap-1"><ShieldAlert className="size-2.5" />{flipped ? 'Display flipped · identities unchanged' : 'TKD Scoring by ADAM AGHZAF'}</span>
      </footer>
    </>
  );
}
