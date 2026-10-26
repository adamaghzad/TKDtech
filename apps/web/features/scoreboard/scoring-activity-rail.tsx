import type { CornerJudgeRole, Side, SideScoringActivity } from '@tkd/contracts';
import { cn } from '@/lib/utils';
import { HeadguardIcon, HoguIcon, PunchFistIcon } from './scoring-activity-icons';

const judgeRoles: CornerJudgeRole[] = ['J1', 'J2', 'J3'];

function JudgeInputs({ testPrefix, label, confirmedJudges }: { testPrefix: string; label: string; confirmedJudges: CornerJudgeRole[] }) {
  return <div className="flex items-center justify-center gap-[3%]">
    {judgeRoles.map(role => {
      const confirmed = confirmedJudges.includes(role);
      return <span
        key={role}
        data-testid={`${testPrefix}-${role.toLowerCase()}`}
        data-judge-role={role}
        data-confirmed={confirmed}
        aria-label={`${label} ${role} ${confirmed ? 'input registered' : 'no input'}`}
        title={`${label} ${role}: ${confirmed ? 'input registered' : 'no input'}`}
        className={cn('numeric flex aspect-square w-[29%] max-w-6 items-center justify-center rounded-full border text-[clamp(.42rem,.65vw,.72rem)] font-black leading-none', confirmed ? 'border-timer bg-timer text-black' : 'border-timer/70 bg-black/20 text-timer')}
      >{role.slice(1)}</span>;
    })}
  </div>;
}

export function ScoringActivityRail({ side, activity, gamJeom }: { side: Side; activity: SideScoringActivity; gamJeom: number }) {
  const blue = side === 'BLUE';
  const testSide = side.toLowerCase();
  const punches = activity.punches;
  const hits = activity.hits;
  const compactPunches = punches.length > 2;
  const compactHits = hits.length > 2;
  const punchStatus = punches.length ? `${punches.length} current-round ${punches.length === 1 ? 'punch' : 'punches'} recorded` : 'no punch input';

  return <aside
    aria-label={`${side} scoring activity: ${activity.headHits} head hits, ${activity.bodyHits} body hits, ${gamJeom} Gam-Jeom; ${punchStatus}`}
    data-testid={`${testSide}-scoring-activity`}
    className={cn('absolute bottom-[4%] top-[17%] z-20 flex w-[clamp(64px,16%,150px)] flex-col border-white/10 bg-black/10', blue ? 'left-0 border-r' : 'right-0 border-l')}
  >
    {punches.length > 0 && <div data-testid={`${testSide}-punches`} className="shrink-0 border-b border-white/10 px-[2%] py-[4%]">
      <div className="grid grid-cols-1 gap-[2px]">
        {punches.map((punch, index) => <div
          key={index}
          data-testid={`${testSide}-punch-${index}`}
          data-status={punch.status.toLowerCase()}
          aria-label={`Punch ${index + 1} of ${punches.length}: ${punch.confirmedJudges.length} of 3 judges registered, ${punch.status === 'CONFIRMED' ? 'confirmed' : `waiting for ${punch.requiredConfirmations} matching judges`}`}
          title={`Punch ${index + 1} · ${punch.requiredConfirmations} matching ${punch.requiredConfirmations === 1 ? 'judge' : 'judges'} required`}
          className={cn('min-w-0 border-b border-white/10 px-[2%] text-center last:border-0', compactPunches ? 'py-[2%]' : 'py-[5%]')}
        >
          <JudgeInputs testPrefix={`${testSide}-punch-${index}`} label={`Punch ${index + 1}`} confirmedJudges={punch.confirmedJudges} />
          <div className="mt-[7%] flex items-center justify-center gap-1 whitespace-nowrap text-timer">
            {!compactPunches && <span className="text-[clamp(.36rem,.52vw,.62rem)] font-black tracking-[.08em]">PUNCH{punch.status === 'CONFIRMED' ? ` +${punch.points}` : ''}</span>}
            <PunchFistIcon className={cn('shrink-0', compactPunches ? 'size-[clamp(.7rem,1.05vw,1.05rem)]' : 'size-[clamp(.8rem,1.35vw,1.35rem)]')} />
            {compactPunches && punch.status === 'CONFIRMED' && <span className="numeric text-[clamp(.36rem,.52vw,.62rem)] font-black">+{punch.points}</span>}
          </div>
          <p className={cn('mt-[4%] whitespace-nowrap text-[clamp(.3rem,.44vw,.52rem)] font-bold uppercase', punch.status === 'CONFIRMED' ? 'text-white/85' : 'text-timer/85')}>
            {punch.confirmedJudges.length}/3 {!compactPunches && (punch.status === 'CONFIRMED' ? 'confirmed' : `· need ${punch.requiredConfirmations}`)}
          </p>
        </div>)}
      </div>
    </div>}

    <div className="flex min-h-0 flex-1 flex-col px-[2%] py-[4%]">
      <p className="shrink-0 text-center text-[clamp(.36rem,.52vw,.62rem)] font-black tracking-[.16em] text-white/65">HITS</p>
      {hits.length ? <div className="mt-[3%] grid grid-cols-1 gap-[2px]">
        {hits.map((hit, index) => {
          const targetName = hit.target === 'HEAD' ? 'Head' : 'Body';
          const testTarget = hit.target.toLowerCase();
          const label = `${targetName} kick ${index + 1}`;
          return <div
            key={index}
            data-testid={`${testSide}-${testTarget}-hit`}
            data-hit-index={index}
            data-status={hit.status.toLowerCase()}
            data-source={hit.source.toLowerCase()}
            aria-label={`${label}: ${hit.source === 'OPERATOR' ? 'operator confirmed' : `${hit.confirmedJudges.length} of 3 judges registered, ${hit.status === 'CONFIRMED' ? 'confirmed' : 'pending'}`}`}
            title={`${label} · ${hit.pointType.replaceAll('_', ' ')}`}
            className={cn('min-w-0 border-b border-white/10 px-[2%] text-center last:border-0', compactHits ? 'py-[2%]' : 'py-[4%]')}
          >
            {hit.source === 'JUDGES'
              ? <JudgeInputs testPrefix={`${testSide}-hit-${index}`} label={label} confirmedJudges={hit.confirmedJudges} />
              : <p className="text-[clamp(.3rem,.44vw,.52rem)] font-black tracking-[.12em] text-white/55">OPERATOR</p>}
            <div className="mt-[4%] flex items-center justify-center gap-1">
              {hit.target === 'HEAD'
                ? <HeadguardIcon className={cn('w-full text-[#ff8fab] drop-shadow-[0_1px_2px_rgba(0,0,0,.35)]', compactHits ? 'h-[34px] max-w-[32px]' : 'h-[44px] max-w-[40px]', hit.status === 'PENDING' && 'opacity-70')} />
                : <HoguIcon className={cn('w-full text-[#4cc9f0] drop-shadow-[0_1px_2px_rgba(0,0,0,.35)]', compactHits ? 'h-[34px] max-w-[32px]' : 'h-[44px] max-w-[40px]', hit.status === 'PENDING' && 'opacity-70')} />}
              {hit.status === 'CONFIRMED' && <span className="numeric text-[clamp(.36rem,.52vw,.62rem)] font-black text-white/80">+{hit.points}</span>}
            </div>
            <p className={cn('mt-[3%] whitespace-nowrap text-[clamp(.3rem,.44vw,.52rem)] font-bold uppercase', hit.status === 'CONFIRMED' ? 'text-white/75' : 'text-timer/85')}>
              {hit.source === 'OPERATOR' ? 'confirmed' : <>{hit.confirmedJudges.length}/3 {!compactHits && (hit.status === 'CONFIRMED' ? 'confirmed' : `· need ${hit.requiredConfirmations}`)}</>}
            </p>
          </div>;
        })}
      </div> : <p data-testid={`${testSide}-zero-hits`} className="mt-2 text-center text-[clamp(.34rem,.48vw,.56rem)] font-bold text-white/40">0 HITS</p>}
    </div>

    <div
      data-testid={`${testSide}-gam-jeom`}
      title="Cumulative Gam-Jeom penalties"
      className="shrink-0 border-t border-timer/35 bg-black/15 px-[6%] py-[7%] text-center"
    >
      <p className="text-[clamp(.36rem,.52vw,.62rem)] font-black uppercase tracking-[.14em] text-timer/75">Gam-Jeom</p>
      <p data-testid={`${testSide}-gam-jeom-value`} className="numeric mt-[4%] text-center text-[clamp(1.25rem,2.4vw,2.7rem)] font-black leading-none text-white">{gamJeom}</p>
    </div>
  </aside>;
}
