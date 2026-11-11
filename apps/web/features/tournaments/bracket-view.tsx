'use client';
import Link from 'next/link';
import type { Bracket } from '@tkd/domain';
import { Badge } from '@/components/ui/badge';
import { cn, flagEmoji } from '@/lib/utils';
interface Entrant {
  id: string;
  name: string;
  countryCode: string;
}

/* ── animation keyframes ───────────────────────────────────────────── */
const style = document.createElement('style');
style.textContent = `
  @keyframes bracketSlideIn {
    from { opacity: 0; transform: translateX(-12px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  @keyframes bracketAdvance {
    0%   { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); border-color: rgba(34, 197, 94, 0.4); }
    50%  { box-shadow: 0 0 20px 8px rgba(34, 197, 94, 0.35); border-color: rgba(34, 197, 94, 0.9); }
    100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); border-color: rgba(34, 197, 94, 0.4); }
  }
  @keyframes bracketPulse {
    0%, 100% { opacity: 0.6; stroke-dashoffset: 0; }
    50%      { opacity: 1; stroke-dashoffset: -10; }
    100%     { opacity: 0.6; stroke-dashoffset: -20; }
  }
  @keyframes winnerGlow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
    50%      { box-shadow: 0 0 24px 12px rgba(34, 197, 94, 0.55); }
  }
  @keyframes slotPop {
    0% { opacity: 0; transform: scale(0.9) translateY(6px); }
    100% { opacity: 1; transform: scale(1) translateY(0); }
  }
  .tkd-bracket-slot {
    animation: bracketSlideIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .tkd-bracket-advanced {
    animation: bracketAdvance 2s ease-in-out infinite;
  }
  .tkd-bracket-connector {
    animation: bracketPulse 2.5s ease-in-out infinite;
  }
  .tkd-winner-glow {
    animation: winnerGlow 2s ease-in-out infinite;
  }
  .tkd-slot-pop {
    animation: slotPop 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
`;
if (typeof document !== 'undefined') document.head.appendChild(style);

/** Single athlete slot inside a match */
function AthleteSlot({
  id,
  entrants,
  winner,
  isBye,
  delay,
}: {
  id: string | null;
  entrants: Map<string, Entrant>;
  winner: string | null;
  isBye: boolean;
  delay?: number;
}) {
  const athlete = id ? entrants.get(id) : undefined;
  const isWinner = id && winner === id;

  return (
    <div
      className={cn(
        'tkd-slot-pop flex min-h-[56px] items-center gap-3 px-3 py-2.5 text-sm transition-all duration-300',
        isWinner
          ? 'tkd-winner-glow bg-success/15 border border-success/50 text-success'
          : id && !winner
          ? 'bg-white/[.03] border border-transparent hover:border-red/50 hover:bg-white/[.05] cursor-pointer'
          : !id && 'border-line/40',
        isBye && 'opacity-40',
      )}
      style={{ animationDelay: `${delay ?? 0}s` }}
    >
      <span className={`w-6 text-xs font-black ${isWinner ? 'text-success' : 'text-muted'}`}>
        {isWinner ? '1' : '–'}
      </span>
      <span className="text-xs">{athlete ? flagEmoji(athlete.countryCode) : '·'}</span>
      <span className={cn('min-w-0 flex-1 truncate', !id && 'italic text-muted')}>
        {athlete?.name ?? (isBye ? 'Bye' : 'To be determined')}
      </span>
      {id && winner === id && (
        <span className="text-[8px] font-black uppercase tracking-wider text-success bg-success/20 px-1.5 py-0.5 rounded">
          Advances
        </span>
      )}
    </div>
  );
}

/** Computed connector path data */
function buildConnectorPaths({
  bracket,
  rounds,
  roundX,
  slotHeight,
  matchCenters,
  cardWidth,
}: {
  bracket: Bracket;
  rounds: number[];
  roundX: Map<number, number>;
  slotHeight: number;
  matchCenters: Map<string, { x: number; y: number }>;
  cardWidth: number;
}) {
  const paths: Array<{
    d: string;
    active: boolean;
    fromMatchId: string;
    toMatchId: string;
  }> = [];

  rounds.forEach((round, roundIndex) => {
    if (roundIndex === rounds.length - 1) return;

    const nodes = bracket.nodes
      .filter((node) => node.round === round)
      .sort((a, b) => a.position - b.position);
    const nextNodes =
      rounds[roundIndex + 1] &&
      bracket.nodes
        .filter((node) => node.round === rounds[roundIndex + 1])
        .sort((a, b) => a.position - b.position);
    if (!nextNodes) return;

    const currentRightX = roundX.get(round)! + cardWidth; // right edge of current card
    const nextLeftX = roundX.get(rounds[roundIndex + 1] as number)!; // left edge of next card
    const elbowX = currentRightX + 30; // horizontal offset before vertical drop

    nodes.forEach((node) => {
      // Draw structural connection to destination match (like football bracket)
      if (!node.destinationNodeId) return;

      const targetNode = nextNodes.find((n) => n.id === node.destinationNodeId);
      if (!targetNode) return;

      const from = matchCenters.get(node.id);
      const to = matchCenters.get(targetNode.id);
      if (!from || !to) return;

      const midY = (from.y + to.y) / 2;
      const hasWinner = Boolean(node.winnerEntrantId);

      paths.push({
        d: `M ${currentRightX} ${from.y} L ${elbowX} ${from.y} L ${elbowX} ${midY} L ${nextLeftX - 30} ${midY} L ${nextLeftX - 30} ${to.y} L ${nextLeftX} ${to.y}`,
        active: hasWinner,
        fromMatchId: node.id,
        toMatchId: targetNode.id,
      });
    });
  });

  return paths;
}

export function BracketView({ bracket, entrants }: { bracket: Bracket; entrants: Entrant[] }) {
  const entrantMap = new Map(entrants.map((item) => [item.id, item]));
  const rounds = Array.from(new Set(bracket.nodes.map((node) => node.round))).sort(
    (a, b) => a - b,
  );

  const slotHeight = 68;
  const gapBetweenRounds = 120;
  const cardWidth = 260;
  const cardLeftStart = 16;

  // compute per-round match counts for vertical centering
  const matchCounts = rounds.map((r) =>
    bracket.nodes.filter((n) => n.round === r).length,
  );
  const maxMatches = Math.max(...matchCounts);

  // compute X positions per round
  const roundX = new Map<number, number>();
  rounds.forEach((_, i) => {
    roundX.set(i, cardLeftStart + i * (cardWidth + gapBetweenRounds));
  });

  // compute Y center for each match
  const matchCenters = new Map<string, { x: number; y: number }>();
  rounds.forEach((round, roundIndex) => {
    const nodes = bracket.nodes
      .filter((node) => node.round === round)
      .sort((a, b) => a.position - b.position);
    const roundMatchCount = nodes.length;
    const centerOffset = ((maxMatches - roundMatchCount) * slotHeight) / 2;

    nodes.forEach((node, nodeIndex) => {
      const y = centerOffset + nodeIndex * slotHeight + slotHeight / 2 + 44; // +44 for header
      matchCenters.set(node.id, {
        x: roundX.get(round)! + cardWidth / 2,
        y,
      });
    });
  });

  // build connector paths
  const connectorPaths = buildConnectorPaths({
    bracket,
    rounds,
    roundX,
    slotHeight,
    matchCenters,
    cardWidth,
  });

  return (
    <div className="relative overflow-x-auto overflow-y-auto min-h-[64vh] pb-8 bg-[#0a0a0a]/40 rounded-2xl border border-[#1a1a1a]/60 p-6">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[#0f0f0f]/80 to-transparent pointer-events-none" />

      {/* ── SVG connector layer ─────────────────────────────────────── */}
      <svg className="absolute inset-0 z-0 pointer-events-none w-full h-full">
        <defs>
          <linearGradient id="connGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="50%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
        </defs>
        {connectorPaths.map((path, i) => (
          <path
            key={`conn-${i}`}
            d={path.d}
            stroke={path.active ? 'url(#connGrad)' : '#333333'}
            strokeWidth="2.5"
            strokeDasharray={path.active ? '0' : '4 4'}
            fill="none"
            className={cn('tkd-bracket-connector', path.active && 'text-primary')}
          />
        ))}
      </svg>

      {/* ── rounds ──────────────────────────────────────────────────── */}
      <div className="relative z-10 flex min-w-max p-4 gap-[calc(120px+1.5rem)]">
        {rounds.map((round, roundIndex) => {
          const nodes = bracket.nodes
            .filter((node) => node.round === round)
            .sort((a, b) => a.position - b.position);
          const centerOffset =
            ((maxMatches - nodes.length) * slotHeight) / 2;

          const isFinal = roundIndex === rounds.length - 1;

          return (
            <section
              key={round}
              className="relative w-[260px] flex flex-col"
              aria-label={nodes[0]?.roundName}
              style={{
                zIndex: rounds.length - roundIndex,
                animationDelay: `${roundIndex * 0.08}s`,
              }}
            >
              <div className="mb-3 flex items-center justify-between px-1">
                <h3 className="text-[10px] font-black uppercase tracking-[.14em] text-red-500/90 drop-shadow-[0_0_8px_rgba(239,68,68,0.3)]">
                  {nodes[0]?.roundName}
                </h3>
                <Badge tone="neutral" className="text-[8px] border-border/30">
                  {nodes.length}
                </Badge>
              </div>

              <div className="relative space-y-3">
                {/* round spine */}
                {rounds.length > 1 && roundIndex < rounds.length - 1 && (
                  <div
                    className="absolute left-[124px] top-[56px] bottom-[-20px] w-[1px] bg-gradient-to-b from-transparent via-red-500/30 to-transparent"
                  />
                )}

                {nodes.map((node, nodeIndex) => {
                  const slotTop = centerOffset + nodeIndex * slotHeight;
                  const winnerId = node.winnerEntrantId;
                  const isBye = node.isBye;

                  // find next match this winner advances to
                  const nextRoundIndex = roundIndex + 1;
                  const nextRound = rounds[nextRoundIndex];
                  const nextNodes = nextRound
                    ? bracket.nodes
                        .filter((n) => n.round === nextRound)
                        .sort((a, b) => a.position - b.position)
                    : [];
                  const advancesTo = nextNodes.find(
                    (n) =>
                      n.blueEntrantId === winnerId ||
                      n.redEntrantId === winnerId,
                  );

                  const slotDelay = roundIndex * 0.1 + nodeIndex * 0.04;

                  return (
                    <Link href={`/display/${node.id}`} key={node.id} passHref>
                      <article
                        className={cn(
                          'relative z-10 overflow-hidden rounded-xl border p-2.5 transition-all duration-300 tkd-bracket-slot',
                          node.status === 'COMPLETED'
                            ? isFinal
                              ? 'tkd-winner-glow border-green-500 bg-green-500/10'
                              : 'border-success/30 bg-success/5'
                            : node.status === 'BYE'
                            ? 'border-line/40 opacity-50'
                            : 'border-border/40 bg-[#0a0a0a]/60 hover:border-red-500/50 hover:bg-[#111]/80',
                        )}
                        style={{ animationDelay: `${slotDelay}s` }}
                      >
                      <div className="flex items-center justify-between border-b border-border/30 pb-1 mb-1">
                        <span className="text-[9px] font-black uppercase tracking-wider text-red-500/70">
                          Match {node.matchNumber}
                        </span>
                        <Badge
                          tone={
                            node.status === 'COMPLETED'
                              ? 'green'
                              : node.status === 'BYE'
                              ? 'neutral'
                              : 'blue'
                          }
                          className="text-[8px] border-border/30"
                        >
                          {node.status}
                        </Badge>
                      </div>

                      <AthleteSlot
                        id={node.blueEntrantId}
                        entrants={entrantMap}
                        winner={winnerId}
                        isBye={isBye}
                        delay={slotDelay}
                      />

                      <div className="h-[1px] bg-border/30 my-1" />

                      <AthleteSlot
                        id={node.redEntrantId}
                        entrants={entrantMap}
                        winner={winnerId}
                        isBye={isBye}
                        delay={slotDelay}
                      />

                      {winnerId && advancesTo && (
                        <div
                          className="absolute right-[-10px] top-[22px] w-2 h-2 rounded-full bg-green-500 tkd-winner-glow"
                          title="Advances to next round"
                        />
                      )}
                    </article>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
