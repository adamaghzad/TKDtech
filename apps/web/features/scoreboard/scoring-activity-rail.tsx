import type { CornerJudgeRole, Side, SideScoringActivity } from '@tkd/contracts';
import { cn } from '@/lib/utils';
import { HeadguardIcon, HoguIcon, PunchFistIcon } from './scoring-activity-icons';

const judgeRoles: CornerJudgeRole[] = ['J1', 'J2', 'J3'];

export function ScoringActivityRail({ side, activity }: { side: Side; activity: SideScoringActivity }) {
  const blue = side === 'BLUE';
  const testSide = side.toLowerCase();
  const punch = activity.punch;
  const totalHits = activity.headHits + activity.bodyHits;
  const hits = [
    ...Array.from({ length: activity.headHits }, (_, index) => ({ target: 'head' as const, index })),
    ...Array.from({ length: activity.bodyHits }, (_, index) => ({ target: 'body' as const, index }))
  ];
  const columns = totalHits > (punch ? 3 : 5) ? 2 : 1;
  const rows = Math.max(1, Math.ceil(totalHits / columns));
  const punchStatus = punch ? `${punch.confirmedJudges.length} of 3 judges registered, ${punch.status === 'CONFIRMED' ? 'punch confirmed' : `waiting for ${punch.requiredConfirmations} matching judges`}` : 'no punch input';

  return <aside
    aria-label={`${side} scoring activity: ${activity.headHits} head hits, ${activity.bodyHits} body hits; ${punchStatus}`}
    data-testid={`${testSide}-scoring-activity`}
    className={cn('absolute bottom-[4%] top-[17%] z-20 flex w-[clamp(64px,16%,150px)] flex-col border-white/10 bg-black/10', blue ? 'left-0 border-r' : 'right-0 border-l')}
  >
    {punch && <div
      data-testid={`${testSide}-punch-confirmation`}
      data-status={punch.status.toLowerCase()}
      title={`Punch input · ${punch.requiredConfirmations} matching ${punch.requiredConfirmations === 1 ? 'judge' : 'judges'} required`}
      className="shrink-0 border-b border-white/10 px-1 py-[8%] text-center"
    >
      <div className="flex items-center justify-center gap-[3%]">
        {judgeRoles.map(role => {
          const confirmed = punch.confirmedJudges.includes(role);
          return <span
            key={role}
            data-testid={`${testSide}-punch-${role.toLowerCase()}`}
            data-confirmed={confirmed}
            aria-label={`${role} ${confirmed ? 'input registered' : 'no input for this punch'}`}
            title={`${role}: ${confirmed ? 'input registered' : 'no input'}`}
            className={cn('numeric flex aspect-square w-[29%] max-w-6 items-center justify-center rounded-full border text-[clamp(.42rem,.65vw,.72rem)] font-black leading-none', confirmed ? 'border-timer bg-timer text-black' : 'border-timer/70 bg-black/20 text-timer')}
          >{role.slice(1)}</span>;
        })}
      </div>
      <div className="mt-[7%] flex items-center justify-center gap-1 whitespace-nowrap text-timer">
        <span className="text-[clamp(.36rem,.52vw,.62rem)] font-black tracking-[.08em]">PUNCH{punch.status === 'CONFIRMED' ? ` +${punch.points}` : ''}</span>
        <PunchFistIcon className="size-[clamp(.8rem,1.35vw,1.35rem)] shrink-0" />
      </div>
      <p className={cn('mt-[4%] whitespace-nowrap text-[clamp(.3rem,.44vw,.52rem)] font-bold uppercase', punch.status === 'CONFIRMED' ? 'text-white/85' : 'text-timer/85')}>
        {punch.confirmedJudges.length}/3 {punch.status === 'CONFIRMED' ? 'confirmed' : `· need ${punch.requiredConfirmations}`}
      </p>
    </div>}

    <div className="flex min-h-0 flex-1 flex-col px-[8%] py-[6%]">
      <p className="shrink-0 text-center text-[clamp(.36rem,.52vw,.62rem)] font-black tracking-[.16em] text-white/65">HITS</p>
      {hits.length ? <div
        className="mt-[4%] grid min-h-0 w-full flex-none gap-[2px]"
        style={{ height: `min(100%, ${rows * 56}px)`, gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`, gridTemplateRows: `repeat(${rows},minmax(0,1fr))` }}
      >
        {hits.map(hit => {
          const count = hit.target === 'head' ? activity.headHits : activity.bodyHits;
          return <div
            key={`${hit.target}-${hit.index}`}
            data-testid={`${testSide}-${hit.target}-hit`}
            title={`${hit.target === 'head' ? 'Head' : 'Body'} scoring hit ${hit.index + 1} of ${count}`}
            className="flex min-h-0 min-w-0 items-center justify-center"
          >
            {hit.target === 'head'
              ? <HeadguardIcon className="h-full max-h-[54px] w-full max-w-[46px] text-[#ff8fab] drop-shadow-[0_1px_2px_rgba(0,0,0,.35)]" />
              : <HoguIcon className="h-full max-h-[54px] w-full max-w-[46px] text-[#4cc9f0] drop-shadow-[0_1px_2px_rgba(0,0,0,.35)]" />}
          </div>;
        })}
      </div> : <p data-testid={`${testSide}-zero-hits`} className="mt-2 text-center text-[clamp(.34rem,.48vw,.56rem)] font-bold text-white/40">0 HITS</p>}
    </div>
  </aside>;
}
