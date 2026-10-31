import type { MatchSnapshot } from '@tkd/contracts';
import { BrandMark } from '@/components/brand';
import { cn } from '@/lib/utils';
import { HeadguardIcon, HoguIcon } from './scoring-activity-icons';

interface WaitingViewProps {
  snapshot?: MatchSnapshot;
}

function WaitingPanel({ side }: { side: 'BLUE' | 'RED' }) {
  const blue = side === 'BLUE';
  return <section
    aria-label={`${side} waiting panel`}
    className={cn(
      'relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden',
      blue
        ? 'bg-[radial-gradient(circle_at_center,#1247db_0%,#08266f_52%,#020817_100%)]'
        : 'bg-[radial-gradient(circle_at_center,#df2335_0%,#7d101d_52%,#180308_100%)]'
    )}
  >
    <div aria-hidden="true" className="aspect-square w-[54%] rounded-sm bg-white/[.055] shadow-[inset_0_0_70px_rgba(255,255,255,.06),0_0_70px_rgba(0,0,0,.15)]" />
    <p className={cn('absolute bottom-[5%] text-[clamp(.45rem,.72vw,.8rem)] font-semibold tracking-[.12em] text-white/70', blue ? 'left-[5%]' : 'right-[5%]')}>GAM-JEOM</p>
  </section>;
}

export function WaitingView({ snapshot }: WaitingViewProps) {
  const waitingForStart = Boolean(snapshot);
  const label = snapshot ? `Match ${snapshot.matchNumber} waiting to start` : 'Mat waiting for the next match';
  return <div
    role="status"
    aria-live="polite"
    aria-label={label}
    data-testid="waiting-view"
    data-waiting-reason={waitingForStart ? 'MATCH_START' : 'NEXT_MATCH'}
    className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-black text-white"
  >
    <header className="relative z-20 flex h-[9%] min-h-[62px] items-center justify-between gap-3 border-b border-white/10 bg-[#070a10] px-[2.5%]">
      <div className="flex min-w-0 items-center gap-2">
        <BrandMark className="size-[clamp(1.8rem,3vw,3rem)]" />
        <div className="hidden sm:block">
          <p className="text-[clamp(.6rem,.85vw,1rem)] font-black italic">TKD <span className="text-[#6c9cff]">SCORING</span></p>
          <p className="text-[clamp(.4rem,.5vw,.6rem)] uppercase tracking-wider text-white/50">TKDTech Sports</p>
        </div>
      </div>
      <div className="min-w-0 text-center">
        <h1 className="truncate text-[clamp(.65rem,1.25vw,1.4rem)] font-bold uppercase tracking-wide">{snapshot?.tournamentName ?? 'TOURNAMENT DISPLAY'}</h1>
        <p className="mt-0.5 truncate text-[clamp(.5rem,.7vw,.8rem)] font-medium uppercase text-white/60">
          {snapshot ? `${snapshot.matName} · ${snapshot.categoryName}` : 'Public mat display · automatic assignment'}
        </p>
      </div>
      <div className="hidden items-center gap-2 text-white/55 lg:flex" aria-hidden="true">
        <HeadguardIcon className="h-[clamp(1.8rem,3vw,3rem)] w-[clamp(1.6rem,2.5vw,2.6rem)]" />
        <HoguIcon className="h-[clamp(1.8rem,3vw,3rem)] w-[clamp(1.6rem,2.5vw,2.6rem)]" />
      </div>
    </header>

    <main className="grid min-h-0 flex-1 grid-cols-[1fr_minmax(88px,22%)_1fr]">
      <WaitingPanel side="BLUE" />
      <aside className="relative z-10 flex min-h-0 min-w-0 flex-col bg-black text-center shadow-[0_0_35px_rgba(0,0,0,.5)]">
        <div className="flex min-h-[29%] flex-col items-center justify-center border-b border-white/10 px-2 py-[5%]">
          <p className="text-[clamp(.6rem,1.15vw,1.3rem)] font-black tracking-[.08em] text-white/85">MATCH</p>
          {snapshot && <p data-testid="waiting-match-number" className="numeric mt-1 text-[clamp(1.5rem,3vw,3.4rem)] font-black leading-none">{snapshot.matchNumber}</p>}
        </div>
        <div className="flex min-h-[92px] items-center justify-center bg-timer px-2 py-[8%] text-black">
          <p className="text-[clamp(.85rem,1.85vw,2.1rem)] font-black uppercase leading-none tracking-[.08em]">WAITING</p>
        </div>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-2 py-3 [@media(max-height:500px)]:py-1">
          <p className="text-[clamp(.6rem,1.15vw,1.3rem)] font-black tracking-[.08em] text-white/85">ROUND</p>
          {snapshot && <p data-testid="waiting-round-number" className="numeric mt-1 text-[clamp(1.8rem,4vw,4.5rem)] font-black leading-none">{snapshot.currentRound}</p>}
        </div>
      </aside>
      <WaitingPanel side="RED" />
    </main>

    <footer className="relative z-20 grid min-h-[38px] grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-white/10 bg-[#070a10] px-[2.5%] py-2 text-[clamp(.42rem,.62vw,.7rem)] font-semibold uppercase tracking-wider text-white/55">
      <span>Public mat display</span>
      <span data-testid="waiting-status-detail" className="text-center text-timer/85">‹ {waitingForStart ? 'WAITING FOR ROUND 1' : 'WAITING FOR NEXT MATCH'} ›</span>
      <span className="text-right">TKD Scoring by ADAM AGHZAF</span>
    </footer>
  </div>;
}
