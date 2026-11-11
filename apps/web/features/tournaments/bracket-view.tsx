'use client';

import Link from 'next/link';
import { Trophy, Crown, Award, Check } from 'lucide-react';
import type { Bracket, BracketNode } from '@tkd/domain';
import { cn, flagEmoji } from '@/lib/utils';

interface Entrant {
  id: string;
  name: string;
  countryCode: string;
  seed?: number | null;
}

/* ── Shared layout constants (single source of truth for DOM + SVG) ── */
const CARD_WIDTH = 252;
const CARD_HEIGHT = 136;
const COL_GAP_X = 96;
const ROW_GAP_Y = 24;
const UNIT_Y = CARD_HEIGHT + ROW_GAP_Y;
const PAD_LEFT = 28;
const PAD_RIGHT = 52;
const BODY_PAD_TOP = 32;
const BODY_PAD_BOTTOM = 32;
const HEADER_HEIGHT = 56;

interface NodeBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerY: number;
  roundIndex: number;
}

interface ConnectorBranch {
  id: string;
  d: string;
  active: boolean;
  side: 'BLUE' | 'RED';
  toFinal: boolean;
  startX: number;
  startY: number;
}

interface ConnectorStem {
  id: string;
  d: string;
  active: boolean;
  bothActive: boolean;
  activeSide: 'BLUE' | 'RED' | null;
  toFinal: boolean;
  midX: number;
  endX: number;
  endY: number;
}

function roundLabel(matchCount: number): string {
  if (matchCount === 1) return 'Final';
  if (matchCount === 2) return 'Semi Finals';
  if (matchCount === 4) return 'Quarter Finals';
  if (matchCount === 8) return 'Round of 16';
  if (matchCount === 16) return 'Round of 32';
  return `Round of ${matchCount * 2}`;
}

function statusPillStyle(status: BracketNode['status'], isFinal: boolean): string {
  switch (status) {
    case 'COMPLETED':
      return 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300';
    case 'IN_PROGRESS':
      return 'border-amber-400/60 bg-amber-500/20 text-amber-200 animate-pulse';
    case 'READY':
      return isFinal
        ? 'border-yellow-400/60 bg-yellow-500/20 text-yellow-200'
        : 'border-sky-400/50 bg-sky-500/15 text-sky-300';
    case 'BYE':
      return 'border-slate-600/60 bg-slate-800/70 text-slate-400';
    default:
      return 'border-slate-700/70 bg-slate-800/50 text-slate-400';
  }
}

/** Single athlete row inside a match card */
function AthleteSlot({
  id,
  corner,
  entrants,
  winnerId,
  isFirstRound,
  isByeMatch,
}: {
  id: string | null;
  corner: 'BLUE' | 'RED';
  entrants: Map<string, Entrant>;
  winnerId: string | null;
  isFirstRound: boolean;
  isByeMatch: boolean;
}) {
  const athlete = id ? entrants.get(id) : undefined;
  const isWinner = Boolean(id && winnerId === id);

  if (!id) {
    return (
      <div className="flex h-[40px] items-center gap-2.5 rounded-lg border border-dashed border-slate-800/90 bg-slate-900/35 px-2.5 text-xs text-slate-500">
        <span className="flex h-5 w-6 shrink-0 items-center justify-center rounded bg-slate-800/70 text-[10px] font-bold text-slate-500">
          –
        </span>
        <span className="min-w-0 flex-1 truncate italic tracking-wide text-slate-500">
          {isFirstRound ? '— Bye —' : '— TBD —'}
        </span>
      </div>
    );
  }

  const seed = athlete?.seed;
  const cornerChip =
    corner === 'BLUE'
      ? 'bg-blue-600/90 text-white shadow-[0_0_8px_rgba(37,99,235,0.35)]'
      : 'bg-red-600/90 text-white shadow-[0_0_8px_rgba(220,38,38,0.35)]';

  return (
    <div
      className={cn(
        'flex h-[40px] items-center gap-2.5 rounded-lg border px-2.5 text-xs transition-colors',
        isWinner
          ? isByeMatch
            ? 'border-sky-500/40 bg-sky-500/10 text-slate-100'
            : 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.18)]'
          : corner === 'BLUE'
            ? 'border-slate-800/90 border-l-2 border-l-blue-500/80 bg-slate-900/75 text-slate-100 group-hover:bg-slate-800/80'
            : 'border-slate-800/90 border-l-2 border-l-red-500/80 bg-slate-900/75 text-slate-100 group-hover:bg-slate-800/80',
      )}
    >
      <span
        className={cn(
          'flex h-5 min-w-[24px] shrink-0 items-center justify-center rounded px-1 text-[10px] font-black',
          seed != null ? cornerChip : 'bg-slate-800 text-slate-400',
        )}
      >
        {seed != null ? seed : corner === 'BLUE' ? 'B' : 'R'}
      </span>
      <span className="shrink-0 text-xs leading-none opacity-90">
        {athlete ? flagEmoji(athlete.countryCode) : '·'}
      </span>
      <span className="min-w-0 flex-1 truncate font-semibold">
        {athlete?.name ?? 'Unknown Athlete'}
      </span>
      {isWinner && !isByeMatch && (
        <Check className="size-3.5 shrink-0 text-emerald-400" />
      )}
    </div>
  );
}

/** Compute deterministic binary-tree pixel boxes + connector geometry */
function computeBracketLayout(bracket: Bracket) {
  const rounds = Array.from(new Set(bracket.nodes.map((node) => node.round))).sort(
    (a, b) => a - b,
  );
  const nodeById = new Map(bracket.nodes.map((node) => [node.id, node]));
  const boxes = new Map<string, NodeBox>();

  const colLeft = (roundIndex: number) =>
    PAD_LEFT + roundIndex * (CARD_WIDTH + COL_GAP_X);

  rounds.forEach((round, roundIndex) => {
    const nodes = bracket.nodes
      .filter((node) => node.round === round)
      .sort((a, b) => a.position - b.position);

    const left = colLeft(roundIndex);
    const right = left + CARD_WIDTH;

    nodes.forEach((node, nodeIndex) => {
      let centerY: number;

      if (roundIndex === 0) {
        centerY = BODY_PAD_TOP + nodeIndex * UNIT_Y + CARD_HEIGHT / 2;
      } else {
        // Resolve feeders from sourceNodeIds (or destinationNodeId fallback)
        const feeders =
          node.sourceNodeIds.length > 0
            ? node.sourceNodeIds
                .map((id) => boxes.get(id))
                .filter((box): box is NodeBox => Boolean(box))
            : bracket.nodes
                .filter((candidate) => candidate.destinationNodeId === node.id)
                .map((candidate) => boxes.get(candidate.id))
                .filter((box): box is NodeBox => Boolean(box));

        if (feeders.length > 0) {
          const sumY = feeders.reduce((acc, box) => acc + box.centerY, 0);
          centerY = sumY / feeders.length;
        } else {
          const step = 2 ** roundIndex;
          centerY =
            BODY_PAD_TOP +
            (nodeIndex * step + (step - 1) / 2) * UNIT_Y +
            CARD_HEIGHT / 2;
        }
      }

      const top = Math.round(centerY - CARD_HEIGHT / 2);
      boxes.set(node.id, {
        left,
        right,
        top,
        bottom: top + CARD_HEIGHT,
        centerY: top + CARD_HEIGHT / 2,
        roundIndex,
      });
    });
  });

  let maxBottom = CARD_HEIGHT + BODY_PAD_TOP;
  boxes.forEach((box) => {
    if (box.bottom > maxBottom) maxBottom = box.bottom;
  });

  const canvasWidth =
    PAD_LEFT +
    rounds.length * CARD_WIDTH +
    Math.max(0, rounds.length - 1) * COL_GAP_X +
    PAD_RIGHT;
  const bodyHeight = Math.max(maxBottom + BODY_PAD_BOTTOM, 260);

  // Build clean T-fork connector branches & horizontal entry stems
  const branches: ConnectorBranch[] = [];
  const stems: ConnectorStem[] = [];

  rounds.forEach((round, roundIndex) => {
    if (roundIndex === 0) return;
    const isFinalRound = roundIndex === rounds.length - 1;

    const targetNodes = bracket.nodes
      .filter((node) => node.round === round)
      .sort((a, b) => a.position - b.position);

    targetNodes.forEach((targetNode) => {
      const targetBox = boxes.get(targetNode.id);
      if (!targetBox) return;

      const sourceNodes =
        targetNode.sourceNodeIds.length > 0
          ? targetNode.sourceNodeIds
              .map((id) => nodeById.get(id))
              .filter((n): n is BracketNode => Boolean(n))
          : bracket.nodes
              .filter((candidate) => candidate.destinationNodeId === targetNode.id)
              .sort((a, b) => a.position - b.position);

      if (sourceNodes.length === 0) return;

      const endX = targetBox.left;
      const endY = targetBox.centerY;
      // Anchor junction X cleanly halfway across the column gap
      const firstSourceBox = boxes.get(sourceNodes[0]!.id);
      if (!firstSourceBox) return;
      const midX = Math.round((firstSourceBox.right + endX) / 2);

      let activeCount = 0;
      let lastActiveSide: 'BLUE' | 'RED' | null = null;

      sourceNodes.forEach((sourceNode, idx) => {
        const sourceBox = boxes.get(sourceNode.id);
        if (!sourceBox) return;

        const startX = sourceBox.right;
        const startY = sourceBox.centerY;
        const dy = endY - startY;
        const sign = dy >= 0 ? 1 : -1;
        const radius = Math.min(8, Math.abs(dy) / 2, (midX - startX) / 2);

        const d =
          Math.abs(dy) < 1
            ? `M ${startX} ${startY} L ${midX} ${endY}`
            : `M ${startX} ${startY} L ${midX - radius} ${startY} Q ${midX} ${startY} ${midX} ${startY + sign * radius} L ${midX} ${endY}`;

        const side: 'BLUE' | 'RED' =
          sourceNode.destinationSide ?? (idx === 0 ? 'BLUE' : 'RED');
        const active = Boolean(sourceNode.winnerEntrantId);

        if (active) {
          activeCount += 1;
          lastActiveSide = side;
        }

        branches.push({
          id: `branch-${sourceNode.id}-${targetNode.id}`,
          d,
          active,
          side,
          toFinal: isFinalRound,
          startX,
          startY,
        });
      });

      stems.push({
        id: `stem-${targetNode.id}`,
        d: `M ${midX} ${endY} L ${endX} ${endY}`,
        active: activeCount > 0,
        bothActive: activeCount >= 2,
        activeSide: lastActiveSide,
        toFinal: isFinalRound,
        midX,
        endX,
        endY,
      });
    });
  });

  return {
    rounds,
    boxes,
    branches,
    stems,
    canvasWidth,
    bodyHeight,
    colLeft,
  };
}

export function BracketView({
  bracket,
  entrants,
}: {
  bracket: Bracket;
  entrants: Entrant[];
}) {
  const entrantMap = new Map(entrants.map((item) => [item.id, item]));
  const { rounds, boxes, branches, stems, canvasWidth, bodyHeight, colLeft } =
    computeBracketLayout(bracket);

  const inactiveBranches = branches.filter((b) => !b.active);
  const activeBranches = branches.filter((b) => b.active);
  const inactiveStems = stems.filter((s) => !s.active);
  const activeStems = stems.filter((s) => s.active);

  return (
    <div className="relative max-h-[80vh] overflow-auto rounded-b-2xl bg-[#070b14] shadow-inner">
      {/* ── Sticky Round Header Strip (tracks horizontal scroll, pinned on vertical scroll) ── */}
      <div
        className="sticky top-0 z-20 border-b border-slate-800/80 bg-[#070b14]/95 backdrop-blur-md"
        style={{ width: `${canvasWidth}px`, height: `${HEADER_HEIGHT}px` }}
      >
        {rounds.map((round, roundIndex) => {
          const matchCount = bracket.nodes.filter((n) => n.round === round).length;
          const label = roundLabel(matchCount);
          const isLastRound = roundIndex === rounds.length - 1;

          return (
            <div
              key={`hdr-${round}`}
              className="flex items-center justify-between rounded-xl border border-slate-800/80 bg-slate-900/70 px-3.5 py-2"
              style={{
                position: 'absolute',
                left: `${colLeft(roundIndex)}px`,
                top: '10px',
                width: `${CARD_WIDTH}px`,
                height: '38px',
              }}
            >
              <div className="flex items-center gap-2">
                {isLastRound ? (
                  <Trophy className="size-3.5 text-yellow-400" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.8)]" />
                )}
                <h3
                  className={cn(
                    'text-[11px] font-black uppercase tracking-[0.12em]',
                    isLastRound ? 'text-yellow-400' : 'text-slate-100',
                  )}
                >
                  {label}
                </h3>
              </div>
              <span className="text-[10px] font-medium text-slate-400">
                {matchCount * 2} Athletes
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Unified Bracket Canvas (SVG + Cards share exact 1:1 pixel space) ── */}
      <div
        className="relative"
        style={{ width: `${canvasWidth}px`, height: `${bodyHeight}px` }}
      >
        {/* Subtle ambient championship glow behind Final */}
        {rounds.length > 0 && (
          <div
            className="pointer-events-none absolute rounded-full bg-yellow-500/5 blur-3xl"
            style={{
              left: `${colLeft(rounds.length - 1) - 40}px`,
              top: `${Math.max(0, bodyHeight / 2 - 160)}px`,
              width: `${CARD_WIDTH + 80}px`,
              height: '320px',
            }}
          />
        )}

        {/* 1. SVG Connector Layer */}
        <svg
          width={canvasWidth}
          height={bodyHeight}
          viewBox={`0 0 ${canvasWidth} ${bodyHeight}`}
          className="pointer-events-none absolute left-0 top-0 z-0"
        >
          <defs>
            <filter id="tkdLineGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Pass 1: Inactive structural skeleton (crisp, solid, always aligned) */}
          {inactiveBranches.map((branch) => (
            <path
              key={branch.id}
              d={branch.d}
              stroke="#475569"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ))}
          {inactiveStems.map((stem) => (
            <path
              key={stem.id}
              d={stem.d}
              stroke="#475569"
              strokeWidth="2"
              strokeLinecap="round"
              fill="none"
            />
          ))}

          {/* Pass 2: Active advancement paths (Blue top feeder, Red bottom feeder, Gold/Ice merge) */}
          {activeBranches.map((branch) => {
            const strokeColor =
              branch.side === 'BLUE' ? '#3b82f6' : '#ef4444';
            return (
              <g key={branch.id}>
                <path
                  d={branch.d}
                  stroke={strokeColor}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  filter="url(#tkdLineGlow)"
                />
                <circle
                  cx={branch.startX}
                  cy={branch.startY}
                  r="3"
                  fill={strokeColor}
                />
              </g>
            );
          })}

          {activeStems.map((stem) => {
            const strokeColor = stem.toFinal
              ? '#eab308'
              : stem.bothActive
                ? '#93c5fd'
                : stem.activeSide === 'RED'
                  ? '#ef4444'
                  : '#3b82f6';
            return (
              <g key={stem.id}>
                <path
                  d={stem.d}
                  stroke={strokeColor}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  fill="none"
                  filter="url(#tkdLineGlow)"
                />
                <circle
                  cx={stem.midX}
                  cy={stem.endY}
                  r="3"
                  fill={strokeColor}
                />
                <circle
                  cx={stem.endX}
                  cy={stem.endY}
                  r="3"
                  fill={strokeColor}
                />
              </g>
            );
          })}
        </svg>

        {/* 2. Match Cards (positioned on the exact same pixel grid) */}
        {rounds.map((round, roundIndex) => {
          const isFirstRound = roundIndex === 0;
          const isLastRound = roundIndex === rounds.length - 1;
          const nodes = bracket.nodes
            .filter((node) => node.round === round)
            .sort((a, b) => a.position - b.position);

          return nodes.map((node) => {
            const box = boxes.get(node.id);
            if (!box) return null;

            return (
              <Link
                href={`/display/${node.id}`}
                key={node.id}
                aria-label={`${roundLabel(nodes.length)} Match ${node.matchNumber}`}
                className="group absolute z-10 block focus:outline-none"
                style={{
                  left: `${box.left}px`,
                  top: `${box.top}px`,
                  width: `${CARD_WIDTH}px`,
                  height: `${CARD_HEIGHT}px`,
                }}
              >
                {/* Final crown header above card (outside card overflow so it never clips) */}
                {isLastRound && (
                  <div className="pointer-events-none absolute -top-6 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap">
                    <Crown className="size-4 text-yellow-400 drop-shadow-[0_0_8px_rgba(234,179,8,0.85)]" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-yellow-400">
                      {node.status === 'COMPLETED' && node.winnerEntrantId
                        ? 'Champion'
                        : 'Championship Final'}
                    </span>
                  </div>
                )}

                {isLastRound && (
                  <div className="pointer-events-none absolute -right-7 top-1/2 -translate-y-1/2">
                    <Award className="size-5 text-yellow-400/75 drop-shadow-[0_0_8px_rgba(234,179,8,0.5)]" />
                  </div>
                )}

                <article
                  className={cn(
                    'flex h-full w-full flex-col justify-between rounded-xl border px-3 py-2 transition-all duration-200',
                    isLastRound
                      ? node.status === 'COMPLETED'
                        ? 'border-yellow-400/80 bg-gradient-to-b from-yellow-500/15 via-[#0e1424] to-[#0b101d] shadow-[0_0_24px_rgba(234,179,8,0.22)]'
                        : 'border-yellow-500/60 bg-gradient-to-b from-yellow-500/10 via-[#0e1424] to-[#0b101d] shadow-[0_0_18px_rgba(234,179,8,0.14)] group-hover:border-yellow-400'
                      : node.status === 'COMPLETED'
                        ? 'border-emerald-500/45 bg-[#0c1422] group-hover:border-emerald-400/75'
                        : node.status === 'READY' || node.status === 'IN_PROGRESS'
                          ? 'border-slate-600/80 bg-[#0d1424] shadow-md group-hover:border-sky-400/70'
                          : node.status === 'BYE'
                            ? 'border-slate-800/90 bg-[#0a0f1c]/90 group-hover:border-slate-700'
                            : 'border-slate-800/90 bg-[#0b101d] group-hover:border-slate-600',
                  )}
                >
                  {/* Card Header */}
                  <div className="flex h-[22px] items-center justify-between border-b border-slate-800/90 pb-1">
                    <span
                      className={cn(
                        'text-[10px] font-extrabold uppercase tracking-wider',
                        isLastRound ? 'text-yellow-400' : 'text-slate-300',
                      )}
                    >
                      Match {node.matchNumber}
                    </span>
                    <span
                      className={cn(
                        'rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wider',
                        statusPillStyle(node.status, isLastRound),
                      )}
                    >
                      {node.status.replace('_', ' ')}
                    </span>
                  </div>

                  {/* Blue + Red Athlete Slots */}
                  <div className="flex flex-col gap-1.5">
                    <AthleteSlot
                      id={node.blueEntrantId}
                      corner="BLUE"
                      entrants={entrantMap}
                      winnerId={node.winnerEntrantId}
                      isFirstRound={isFirstRound}
                      isByeMatch={node.isBye}
                    />
                    <AthleteSlot
                      id={node.redEntrantId}
                      corner="RED"
                      entrants={entrantMap}
                      winnerId={node.winnerEntrantId}
                      isFirstRound={isFirstRound}
                      isByeMatch={node.isBye}
                    />
                  </div>
                </article>
              </Link>
            );
          });
        })}
      </div>
    </div>
  );
}
