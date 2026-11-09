'use client';
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
    from { opacity: 0; transform: translateY(14px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes bracketAdvance {
    0%   { background: rgba(34, 197, 94, 0.12); transform: scale(1); }
    50%  { background: rgba(34, 197, 94, 0.28); transform: scale(1.03); }
    100% { background: rgba(34, 197, 94, 0.12); transform: scale(1); }
  }
  @keyframes bracketPulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.5); }
    50%      { box-shadow: 0 0 0 8px rgba(59, 130, 246, 0); }
  }
  .tkd-bracket-slot {
    animation: bracketSlideIn 0.55s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .tkd-bracket-advanced {
    animation: bracketAdvance 1.4s ease-out both;
  }
  .tkd-bracket-connector {
    animation: bracketPulse 3s ease-in-out infinite;
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
        'tkd-bracket-slot flex min-h-[42px] items-center gap-2 px-3 py-2 text-sm transition-all duration-300',
        isWinner
          ? 'tkd-bracket-advanced bg-success/20 border border-success/40 text-success'
          : id && !winner
          ? 'bg-white/[.02] border border-transparent hover:border-primary/50 hover:bg-white/[.04] cursor-pointer'
          : !id && 'border-line/50',
        isBye && 'opacity-50',
      )}
      style={{ animationDelay: `${delay ?? 0}s` }}
    >
      <span className="text-xs">{athlete ? flagEmoji(athlete.countryCode) : '·'}</span>
      <span className={cn('min-w-0 flex-1 truncate', !id && 'italic text-muted')}>
        {athlete?.name ?? (isBye ? 'Bye' : 'To be determined')}
      </span>
      {id && winner === id && (
        <span className="text-[8px] font-bold uppercase tracking-wider text-success">
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
}: {
  bracket: Bracket;
  rounds: number[];
  roundX: Map<number, number>;
  slotHeight: number;
  matchCenters: Map<string, { x: number; y: number }>;
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

    const currentX = roundX.get(round)! + 280;
    const nextRoundX = roundX.get(rounds[roundIndex + 1] as number)! + 140;

    nodes.forEach((node) => {
      const winnerId = node.winnerEntrantId;
      if (!winnerId) return;

      const targetNode = nextNodes.find(
        (n) => n.blueEntrantId === winnerId || n.redEntrantId === winnerId,
      );
      if (!targetNode) return;

      const from = matchCenters.get(node.id);
      const to = matchCenters.get(targetNode.id);
      if (!from || !to) return;

      const midY = (from.y + to.y) / 2;

      paths.push({
        d: `M ${currentX} ${from.y} L ${currentX + 24} ${from.y} L ${currentX + 24} ${midY} L ${nextRoundX - 24} ${midY} L ${nextRoundX - 24} ${to.y} L ${nextRoundX} ${to.y}`,
        active: true,
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

  const slotHeight = 76;
  const gapBetweenRounds = 110;
  const cardWidth = 280;
  const cardLeftStart = 20;

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
      const y = centerOffset + nodeIndex * slotHeight + slotHeight / 2 + 40; // +40 for header
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
  });

  return (
    <div className="relative overflow-x-auto overflow-y-auto min-h-[64vh] pb-8">
      {/* ── SVG connector layer ─────────────────────────────────────── */}
      <svg
        className="absolute inset-0 z-0 pointer-events-none w-full h-full"
        style={{ width: '100%', height: '100%' }}
      >
        {connectorPaths.map((path, i) => (
          <path
            key={`conn-${i}`}
            d={path.d}
            stroke={path.active ? '#3b82f6' : '#475569'}
            strokeWidth="1.5"
            strokeDasharray={path.active ? '5 5' : '3 3'}
            fill="none"
            className={cn(
              'tkd-bracket-connector',
              path.active && 'text-primary',
            )}
          />
        ))}
      </svg>

      {/* ── rounds ──────────────────────────────────────────────────── */}
      <div className="relative z-10 flex min-w-max p-5 gap-[calc(110px+2rem)]">
        {rounds.map((round, roundIndex) => {
          const nodes = bracket.nodes
            .filter((node) => node.round === round)
            .sort((a, b) => a.position - b.position);
          const centerOffset =
            ((maxMatches - nodes.length) * slotHeight) / 2;

          return (
            <section
              key={round}
              className="relative w-[280px] flex flex-col"
              aria-label={nodes[0]?.roundName}
              style={{
                zIndex: rounds.length - roundIndex,
                animationDelay: `${roundIndex * 0.1}s`,
              }}
            >
              <div className="mb-4 flex items-center justify-between px-2">
                <h3 className="text-xs font-bold uppercase tracking-[.12em] text-primary/90">
                  {nodes[0]?.roundName}
                </h3>
                <Badge tone="neutral" className="text-[9px]">
                  {nodes.length} match{nodes.length > 1 ? 'es' : ''}
                </Badge>
              </div>

              <div className="relative space-y-4">
                {/* round spine */}
                {rounds.length > 1 && roundIndex < rounds.length - 1 && (
                  <div
                    className="absolute left-[139px] top-[52px] bottom-[-24px] w-[2px] bg-gradient-to-b from-transparent via-primary/40 to-transparent"
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
                  const isActive = Boolean(winnerId && advancesTo);

                  const slotDelay = (roundIndex * 0.12 + nodeIndex * 0.06);

                  return (
                    <article
                      key={node.id}
                      className={cn(
                        'relative z-10 overflow-hidden rounded-xl border p-3 transition-all duration-300 tkd-bracket-slot',
                        node.status === 'COMPLETED'
                          ? 'border-success/30 bg-success/5'
                          : node.status === 'BYE'
                          ? 'border-line/50 opacity-60'
                          : 'border-border/50 bg-[#0c1320]/60 hover:border-primary/60 hover:bg-[#101a2b]/80',
                      )}
                      style={{ animationDelay: `${slotDelay}s` }}
                    >
                      <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-muted">
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
                          className="text-[9px]"
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

                      <div className="h-[1px] bg-border/40 my-1" />

                      <AthleteSlot
                        id={node.redEntrantId}
                        entrants={entrantMap}
                        winner={winnerId}
                        isBye={isBye}
                        delay={slotDelay}
                      />

                      {winnerId && advancesTo && (
                        <div
                          className="absolute right-[-10px] top-[20px] w-2 h-2 rounded-full bg-success animate-pulse"
                          title="Advances to next round"
                        />
                      )}
                    </article>
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
