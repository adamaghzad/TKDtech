'use client';
import Link from 'next/link';
import { Trophy, Crown, Award } from 'lucide-react';
import type { Bracket } from '@tkd/domain';
import { Badge } from '@/components/ui/badge';
import { cn, flagEmoji } from '@/lib/utils';
interface Entrant {
  id: string;
  name: string;
  countryCode: string;
  seed?: number | null;
}

/* ── animation keyframes ───────────────────────────────────────────── */
const style = document.createElement('style');
style.textContent = `
  @keyframes bracketSlideIn {
    from { opacity: 0; transform: translateX(-14px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  @keyframes bracketAdvance {
    0%   { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); border-color: rgba(34, 197, 94, 0.4); }
    50%  { box-shadow: 0 0 24px 10px rgba(34, 197, 94, 0.45); border-color: rgba(34, 197, 94, 0.95); }
    100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); border-color: rgba(34, 197, 94, 0.4); }
  }
  @keyframes bracketPulse {
    0%, 100% { opacity: 0.5; stroke-dashoffset: 0; }
    50%      { opacity: 1; stroke-dashoffset: -12; }
    100%     { opacity: 0.5; stroke-dashoffset: -24; }
  }
  @keyframes winnerGlow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
    50%      { box-shadow: 0 0 30px 14px rgba(34, 197, 94, 0.55); }
  }
  @keyframes slotPop {
    0% { opacity: 0; transform: scale(0.92) translateY(8px); }
    100% { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes roundReveal {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes crownPulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%      { opacity: 0.7; transform: scale(1.05); }
  }
  .tkd-bracket-slot {
    animation: bracketSlideIn 0.55s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .tkd-bracket-advanced {
    animation: bracketAdvance 2s ease-in-out infinite;
  }
  .tkd-bracket-connector {
    animation: bracketPulse 3s ease-in-out infinite;
  }
  .tkd-winner-glow {
    animation: winnerGlow 2.5s ease-in-out infinite;
  }
  .tkd-slot-pop {
    animation: slotPop 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .tkd-round-reveal {
    animation: roundReveal 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .tkd-crown-pulse {
    animation: crownPulse 3s ease-in-out infinite;
  }
`;
if (typeof document !== 'undefined') document.head.appendChild(style);

/** Seed chip color by rank */
function seedChip(seed: number | null | undefined): string {
  if (!seed) return 'bg-gray-700 text-gray-400';
  if (seed === 1) return 'bg-red-600 text-white';
  if (seed === 2) return 'bg-red-600 text-white';
  if (seed <= 4) return 'bg-red-600 text-white';
  if (seed <= 8) return 'bg-gray-700 text-gray-400';
  return 'bg-gray-700 text-gray-400';
}

/** Round label config */
const ROUND_CONFIG: Record<string, { label: string; icon?: React.ReactNode }> = {
  'Quarter-finals': { label: 'Quarter Finals' },
  'Semi-finals': { label: 'Semi Finals' },
  Final: { label: 'Final', icon: <Trophy className="size-4 text-yellow-400" /> },
};

/** Single athlete slot inside a match */
function AthleteSlot({
  id,
  entrants,
  winner,
  isBye,
  delay,
  seed,
}: {
  id: string | null;
  entrants: Map<string, Entrant>;
  winner: string | null;
  isBye: boolean;
  delay?: number;
  seed?: number | null;
}) {
  const athlete = id ? entrants.get(id) : undefined;
  const isWinner = id && winner === id;

  if (isBye || !id) {
    return (
      <div
        className={cn(
          'tkd-slot-pop flex min-h-[44px] items-center gap-3 px-3 py-2 text-sm border-line/30 opacity-50',
        )}
        style={{ animationDelay: `${delay ?? 0}s` }}
      >
        <span className="w-7 text-xs font-black text-gray-500">–</span>
        <span className="text-gray-400 text-xs">—</span>
        <span className="min-w-0 flex-1 truncate italic text-gray-500 text-xs">
          Bye
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'tkd-slot-pop flex min-h-[44px] items-center gap-3 px-3 py-2 text-sm transition-all duration-300',
        isWinner
          ? 'tkd-winner-glow bg-green-500/20 border border-green-500/60 text-green-400'
          : 'bg-white/5 border border-transparent hover:border-red-500/60 hover:bg-white/10 cursor-pointer',
      )}
      style={{ animationDelay: `${delay ?? 0}s` }}
    >
      <span className={`w-7 text-[10px] font-black ${seedChip(seed)} rounded px-1 py-0.5`}>
        #{seed}
      </span>
      <span className="text-xs">{athlete ? flagEmoji(athlete.countryCode) : '·'}</span>
      <span className="min-w-0 flex-1 truncate">{athlete?.name}</span>
    </div>
  );
}

/** Computed connector path data - structural pairing by position */
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
    if (!nextNodes || nodes.length === 0) return;

    const currentRightX = roundX.get(round)! + cardWidth;
    const nextLeftX = roundX.get(rounds[roundIndex + 1] as number)!;
    const elbowX = currentRightX + 28;

    nodes.forEach((node) => {
      const targetPosition = Math.floor(node.position / 2);
      const targetNode = nextNodes.find((n) => n.position === targetPosition);
      if (!targetNode) return;

      const from = matchCenters.get(node.id);
      const to = matchCenters.get(targetNode.id);
      if (!from || !to) return;

      const midY = (from.y + to.y) / 2;
      const hasWinner = Boolean(node.winnerEntrantId);

      paths.push({
        d: `M ${currentRightX} ${from.y} L ${elbowX} ${from.y} L ${elbowX} ${midY} L ${nextLeftX - 28} ${midY} L ${nextLeftX - 28} ${to.y} L ${nextLeftX} ${to.y}`,
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

  const slotHeight = 52;
  const gapBetweenRounds = 150;
  const cardWidth = 240;
  const cardLeftStart = 12;

  const matchCounts = rounds.map((r) =>
    bracket.nodes.filter((n) => n.round === r).length,
  );
  const maxMatches = Math.max(...matchCounts);

  const roundX = new Map<number, number>();
  rounds.forEach((_, i) => {
    roundX.set(i, cardLeftStart + i * (cardWidth + gapBetweenRounds));
  });

  const matchCenters = new Map<string, { x: number; y: number }>();
  rounds.forEach((round, roundIndex) => {
    const nodes = bracket.nodes
      .filter((node) => node.round === round)
      .sort((a, b) => a.position - b.position);
    const roundMatchCount = nodes.length;
    const centerOffset = ((maxMatches - roundMatchCount) * slotHeight) / 2;

    nodes.forEach((node, nodeIndex) => {
      const y = centerOffset + nodeIndex * slotHeight + slotHeight / 2 + 44;
      matchCenters.set(node.id, {
        x: roundX.get(round)! + cardWidth / 2,
        y,
      });
    });
  });

  const connectorPaths = buildConnectorPaths({
    bracket,
    rounds,
    roundX,
    slotHeight,
    matchCenters,
    cardWidth,
  });

  const isFinal = rounds.length > 0;

  return (
    <div className="relative overflow-x-auto overflow-y-auto min-h-[70vh] pb-12 bg-[#0a0a0a]/40 rounded-3xl border border-[#1a1a1a]/80 p-8 shadow-2xl">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[#0f0f0f]/90 to-transparent pointer-events-none" />

      {/* ── SVG connector layer ─────────────────────────────────────── */}
      <svg className="absolute inset-0 z-0 pointer-events-none w-full h-full">
        <defs>
          <linearGradient id="connGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="40%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
        </defs>
        {connectorPaths.map((path, i) => (
          <path
            key={`conn-${i}`}
            d={path.d}
            stroke={path.active ? 'url(#connGrad)' : '#1f1f1f'}
            strokeWidth="3"
            strokeDasharray={path.active ? '0' : '5 5'}
            fill="none"
            className={cn('tkd-bracket-connector', path.active && 'text-primary')}
          />
        ))}
      </svg>

      {/* ── rounds ──────────────────────────────────────────────────── */}
      <div className="relative z-10 flex min-w-max p-2 gap-[calc(150px+1rem)]">
        {rounds.map((round, roundIndex) => {
          const nodes = bracket.nodes
            .filter((node) => node.round === round)
            .sort((a, b) => a.position - b.position);
          const centerOffset =
            ((maxMatches - nodes.length) * slotHeight) / 2;

          const roundConfig = ROUND_CONFIG[nodes[0]?.roundName ?? 'Final'] ?? { label: 'Final' };
          const isLastRound = roundIndex === rounds.length - 1;

          return (
            <section
              key={round}
              className="relative w-[240px] flex flex-col tkd-round-reveal"
              aria-label={nodes[0]?.roundName}
              style={{
                zIndex: rounds.length - roundIndex,
                animationDelay: `${roundIndex * 0.1}s`,
              }}
            >
              {/* Round header pill */}
              <div className="mb-3 flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-purple-500" />
                  <h3 className="text-xs font-black uppercase tracking-[.14em] text-purple-400">
                    {roundConfig.label}
                  </h3>
                  <span className="text-[10px] text-gray-500">
                    {nodes.length} Athletes
                  </span>
                </div>
                {isLastRound && roundConfig?.icon && (
                  <span className="flex items-center gap-1">
                    {roundConfig.icon}
                    <span className="text-[10px] font-black text-yellow-400">FINAL</span>
                  </span>
                )}
              </div>

              <div className="relative space-y-3">
                {/* round spine */}
                {rounds.length > 1 && roundIndex < rounds.length - 1 && (
                  <div
                    className="absolute left-[114px] top-[52px] bottom-[-20px] w-[1px] bg-gradient-to-b from-transparent via-purple-500/30 to-transparent"
                  />
                )}

                {nodes.map((node, nodeIndex) => {
                  const slotTop = centerOffset + nodeIndex * slotHeight;
                  const winnerId = node.winnerEntrantId;
                  const isBye = node.isBye;

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

                  const slotDelay = roundIndex * 0.12 + nodeIndex * 0.05;
                  const showAdvancement = isLastRound ? false : Boolean(winnerId && advancesTo);

                  return (
                    <Link href={`/display/${node.id}`} key={node.id} passHref>
                      <article
                        className={cn(
                          'relative z-10 overflow-hidden rounded-xl border p-2.5 transition-all duration-300 tkd-bracket-slot',
                          isLastRound
                            ? node.status === 'COMPLETED'
                              ? 'tkd-winner-glow border-yellow-500/70 bg-yellow-500/15'
                              : 'border-yellow-500/50 bg-yellow-500/5 hover:border-yellow-500/70 hover:bg-yellow-500/10'
                            : node.status === 'COMPLETED'
                            ? 'border-success/40 bg-success/10'
                            : node.status === 'BYE'
                            ? 'border-line/40 opacity-50'
                            : 'border-border/50 bg-[#0a0a0a]/70 hover:border-red-500/60 hover:bg-[#111]/85',
                        )}
                        style={{ animationDelay: `${slotDelay}s` }}
                      >
                        <div className="flex items-center justify-between border-b border-border/40 pb-1 mb-2">
                          <span className={`text-[9px] font-black uppercase tracking-wider ${isLastRound ? 'text-yellow-500/80' : 'text-red-500/80'}`}>
                            Match {node.matchNumber}
                          </span>
                          <Badge
                            tone={
                              node.status === 'COMPLETED'
                                ? isLastRound
                                  ? 'green'
                                  : 'green'
                                : node.status === 'BYE'
                                ? 'neutral'
                                : isLastRound
                                ? 'blue'
                                : 'blue'
                            }
                            className={`text-[9px] border-${isLastRound ? 'yellow-500/40' : 'border-border/40'}`}
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
                          seed={
                            node.blueEntrantId
                              ? entrantMap.get(node.blueEntrantId)?.seed
                              : null
                          }
                        />

                        <div className="h-[1px] bg-border/40 my-2" />

                        <AthleteSlot
                          id={node.redEntrantId}
                          entrants={entrantMap}
                          winner={winnerId}
                          isBye={isBye}
                          delay={slotDelay}
                          seed={
                            node.redEntrantId
                              ? entrantMap.get(node.redEntrantId)?.seed
                              : null
                          }
                        />

                        {showAdvancement && (
                          <div
                            className="absolute right-[-10px] top-[22px] w-2 h-2 rounded-full bg-green-500 tkd-winner-glow shadow-[0_0_8px_rgba(34,197,94,0.8)]"
                            title="Advances to next round"
                          />
                        )}

                        {/* Final match crown + laurel decorations */}
                        {isLastRound && (
                          <>
                            <div className="absolute -top-4 left-1/2 -translate-x-1/2 tkd-crown-pulse flex flex-col items-center">
                              <Crown className="size-5 text-yellow-400 drop-shadow-[0_0_10px_rgba(234,179,8,0.9)]" />
                              <span className="text-[10px] font-black text-yellow-400 mt-0.5">
                                {node.status === 'COMPLETED' && winnerId ? 'Champion' : 'Final'}
                              </span>
                            </div>
                            <div className="absolute -right-5 top-1/2 -translate-y-1/2">
                              <div className="flex items-end gap-1">
                                <Award className="size-6 text-yellow-400/70 drop-shadow-[0_0_8px_rgba(234,179,8,0.6)]" />
                                <Award className="size-6 text-yellow-400/50 drop-shadow-[0_0_8px_rgba(234,179,8,0.4)]" />
                              </div>
                            </div>
                          </>
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
