'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Trophy, Crown, Award, Check, Radio } from 'lucide-react';
import type { Bracket, BracketNode } from '@tkd/domain';
import { CountryFlag } from '@/components/ui/country-flag';
import { cn } from '@/lib/utils';

export interface BracketEntrant {
  id: string;
  name: string;
  countryCode: string;
  clubName?: string | null;
  seed?: number | null;
}

export interface BracketNodeMatchInfo {
  matchId: string;
  matchNumber: string;
  state: string;
  currentRound?: number;
  blueScore: number;
  redScore: number;
  winnerId: string | null;
  matName: string | null;
}

export type BracketLayoutMode = 'CLASSIC' | 'SPLIT';

/* ── Shared layout constants (single source of truth for DOM + SVG) ── */
const CARD_WIDTH = 252;
const CARD_HEIGHT = 136;
const CLASSIC_GAP_X = 96;
const SPLIT_GAP_X = 72;
const ROW_GAP_Y = 24;
const UNIT_Y = CARD_HEIGHT + ROW_GAP_Y;
const PAD_LEFT = 28;
const PAD_RIGHT = 52;
const BODY_PAD_TOP = 34;
const BODY_PAD_BOTTOM = 34;
const HEADER_HEIGHT = 54;

const LIVE_MATCH_STATES = new Set([
  'CALLED',
  'IN_PROGRESS',
  'PAUSED',
  'ROUND_BREAK',
  'GOLDEN_POINT',
  'UNDER_REVIEW',
]);

interface NodeBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerY: number;
  colIndex: number;
}

interface ColumnHeaderSpec {
  key: string;
  left: number;
  label: string;
  subLabel: string;
  isFinal: boolean;
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

function statusPillStyle(status: string, isFinal: boolean): string {
  if (LIVE_MATCH_STATES.has(status)) {
    return 'border-rose-400/80 bg-rose-500/25 text-rose-200 shadow-[0_0_10px_rgba(244,63,94,0.4)]';
  }
  switch (status) {
    case 'COMPLETED':
      return 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300';
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
  score,
  showScore,
}: {
  id: string | null;
  corner: 'BLUE' | 'RED';
  entrants: Map<string, BracketEntrant>;
  winnerId: string | null;
  isFirstRound: boolean;
  isByeMatch: boolean;
  score?: number;
  showScore: boolean;
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
        'flex h-[40px] items-center gap-2 rounded-lg border px-2.5 text-xs transition-colors',
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
          'flex h-5 min-w-[22px] shrink-0 items-center justify-center rounded px-1 text-[10px] font-black',
          seed != null ? cornerChip : 'bg-slate-800 text-slate-400',
        )}
      >
        {seed != null ? seed : corner === 'BLUE' ? 'B' : 'R'}
      </span>
      <span className="flex shrink-0 items-center">
        {athlete ? <CountryFlag code={athlete.countryCode} className="w-[18px] rounded-[2px] ring-1 ring-white/25" /> : <span className="text-xs leading-none opacity-60">·</span>}
      </span>
      <span className="min-w-0 flex-1 truncate font-semibold">
        {athlete?.name ?? 'Unknown Athlete'}
      </span>
      {showScore && score != null && (
        <span
          className={cn(
            'numeric shrink-0 rounded px-1.5 py-0.5 text-xs font-black',
            isWinner
              ? 'bg-emerald-500/25 text-emerald-200'
              : corner === 'BLUE'
                ? 'bg-blue-500/15 text-blue-300'
                : 'bg-red-500/15 text-red-300',
          )}
        >
          {score}
        </span>
      )}
      {isWinner && !isByeMatch && (
        <Check className="size-3.5 shrink-0 text-emerald-400" />
      )}
    </div>
  );
}

/** Build directional connector branches & stems from any positioned NodeBox map */
function buildConnectors(
  bracket: Bracket,
  rounds: number[],
  boxes: Map<string, NodeBox>,
) {
  const nodeById = new Map(bracket.nodes.map((node) => [node.id, node]));
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

      // Group feeders by horizontal flow direction (+1 = left-to-right, -1 = right-to-left)
      const groups = new Map<1 | -1, BracketNode[]>();
      sourceNodes.forEach((src) => {
        const sBox = boxes.get(src.id);
        if (!sBox) return;
        const dir: 1 | -1 = targetBox.left >= sBox.right ? 1 : -1;
        const list = groups.get(dir) ?? [];
        list.push(src);
        groups.set(dir, list);
      });

      groups.forEach((dirSources, dir) => {
        const firstSourceBox = boxes.get(dirSources[0]!.id);
        if (!firstSourceBox) return;

        const firstStartX = dir === 1 ? firstSourceBox.right : firstSourceBox.left;
        const endX = dir === 1 ? targetBox.left : targetBox.right;
        const endY = targetBox.centerY;
        const midX = Math.round((firstStartX + endX) / 2);

        let activeCount = 0;
        let lastActiveSide: 'BLUE' | 'RED' | null = null;

        dirSources.forEach((sourceNode) => {
          const sourceBox = boxes.get(sourceNode.id);
          if (!sourceBox) return;

          const startX = dir === 1 ? sourceBox.right : sourceBox.left;
          const startY = sourceBox.centerY;
          const dy = endY - startY;
          const sign = dy >= 0 ? 1 : -1;
          const horizSpan = Math.abs(midX - startX);
          const radius = Math.min(8, Math.abs(dy) / 2, horizSpan / 2);

          const d =
            Math.abs(dy) < 1
              ? `M ${startX} ${startY} L ${midX} ${endY}`
              : `M ${startX} ${startY} L ${midX - dir * radius} ${startY} Q ${midX} ${startY} ${midX} ${startY + sign * radius} L ${midX} ${endY}`;

          const origIndex = sourceNodes.indexOf(sourceNode);
          const side: 'BLUE' | 'RED' =
            sourceNode.destinationSide ?? (origIndex === 0 ? 'BLUE' : 'RED');
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
          id: `stem-${targetNode.id}-${dir}`,
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
  });

  return { branches, stems };
}

/** Compute deterministic pixel boxes + headers + connectors for CLASSIC or SPLIT mode */
export function computeBracketLayout(
  bracket: Bracket,
  requestedMode: BracketLayoutMode = 'CLASSIC',
) {
  const rounds = Array.from(new Set(bracket.nodes.map((node) => node.round))).sort(
    (a, b) => a - b,
  );
  // SPLIT requires at least 2 rounds (4+ slots); otherwise fall back cleanly to CLASSIC
  const effectiveMode: BracketLayoutMode =
    requestedMode === 'SPLIT' && rounds.length >= 2 ? 'SPLIT' : 'CLASSIC';

  const boxes = new Map<string, NodeBox>();
  const headers: ColumnHeaderSpec[] = [];

  if (effectiveMode === 'CLASSIC') {
    const colLeft = (colIndex: number) =>
      PAD_LEFT + colIndex * (CARD_WIDTH + CLASSIC_GAP_X);

    rounds.forEach((round, roundIndex) => {
      const nodes = bracket.nodes
        .filter((node) => node.round === round)
        .sort((a, b) => a.position - b.position);

      const left = colLeft(roundIndex);
      const right = left + CARD_WIDTH;
      const isLastRound = roundIndex === rounds.length - 1;

      headers.push({
        key: `hdr-${round}`,
        left,
        label: roundLabel(nodes.length),
        subLabel: `${nodes.length * 2} Athletes`,
        isFinal: isLastRound,
      });

      nodes.forEach((node, nodeIndex) => {
        let centerY: number;
        if (roundIndex === 0) {
          centerY = BODY_PAD_TOP + nodeIndex * UNIT_Y + CARD_HEIGHT / 2;
        } else {
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
            centerY =
              feeders.reduce((acc, box) => acc + box.centerY, 0) / feeders.length;
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
          colIndex: roundIndex,
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
      Math.max(0, rounds.length - 1) * CLASSIC_GAP_X +
      PAD_RIGHT;
    const bodyHeight = Math.max(maxBottom + BODY_PAD_BOTTOM, 260);
    const { branches, stems } = buildConnectors(bracket, rounds, boxes);

    return {
      effectiveMode,
      rounds,
      boxes,
      headers,
      branches,
      stems,
      canvasWidth,
      bodyHeight,
      finalCenterX: colLeft(rounds.length - 1) + CARD_WIDTH / 2,
    };
  }

  /* ── SPLIT ARENA MODE (Left Pool → CENTER FINAL ← Right Pool) ── */
  const totalRounds = rounds.length;
  const totalCols = 2 * totalRounds - 1;
  const centerCol = totalRounds - 1;
  const colLeft = (colIndex: number) =>
    PAD_LEFT + colIndex * (CARD_WIDTH + SPLIT_GAP_X);

  const placeNode = (
    node: BracketNode,
    colIndex: number,
    roundIndex: number,
    localIndex: number,
  ) => {
    const left = colLeft(colIndex);
    const right = left + CARD_WIDTH;
    let centerY: number;

    if (roundIndex === 0) {
      centerY = BODY_PAD_TOP + localIndex * UNIT_Y + CARD_HEIGHT / 2;
    } else {
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
        centerY =
          feeders.reduce((acc, box) => acc + box.centerY, 0) / feeders.length;
      } else {
        const step = 2 ** roundIndex;
        centerY =
          BODY_PAD_TOP +
          (localIndex * step + (step - 1) / 2) * UNIT_Y +
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
      colIndex,
    });
  };

  rounds.forEach((round, roundIndex) => {
    const nodes = bracket.nodes
      .filter((node) => node.round === round)
      .sort((a, b) => a.position - b.position);
    const baseLabel = roundLabel(nodes.length);

    if (roundIndex === totalRounds - 1) {
      // Center Final column
      headers.push({
        key: `hdr-final-${round}`,
        left: colLeft(centerCol),
        label: 'Final',
        subLabel: '2 Finalists',
        isFinal: true,
      });
      nodes.forEach((node, idx) => placeNode(node, centerCol, roundIndex, idx));
      return;
    }

    const half = Math.ceil(nodes.length / 2);
    const leftNodes = nodes.slice(0, half);
    const rightNodes = nodes.slice(half);
    const leftCol = roundIndex;
    const rightCol = totalCols - 1 - roundIndex;

    headers.push({
      key: `hdr-L-${round}`,
      left: colLeft(leftCol),
      label: baseLabel === 'Semi Finals' ? 'Semi Final · A' : `${baseLabel} · A`,
      subLabel: `${leftNodes.length * 2} Slots`,
      isFinal: false,
    });

    headers.push({
      key: `hdr-R-${round}`,
      left: colLeft(rightCol),
      label: baseLabel === 'Semi Finals' ? 'Semi Final · B' : `${baseLabel} · B`,
      subLabel: `${rightNodes.length * 2} Slots`,
      isFinal: false,
    });

    leftNodes.forEach((node, idx) => placeNode(node, leftCol, roundIndex, idx));
    rightNodes.forEach((node, idx) => placeNode(node, rightCol, roundIndex, idx));
  });

  headers.sort((a, b) => a.left - b.left);

  let maxBottom = CARD_HEIGHT + BODY_PAD_TOP;
  boxes.forEach((box) => {
    if (box.bottom > maxBottom) maxBottom = box.bottom;
  });

  const canvasWidth =
    PAD_LEFT +
    totalCols * CARD_WIDTH +
    Math.max(0, totalCols - 1) * SPLIT_GAP_X +
    PAD_LEFT;
  const bodyHeight = Math.max(maxBottom + BODY_PAD_BOTTOM, 260);
  const { branches, stems } = buildConnectors(bracket, rounds, boxes);

  return {
    effectiveMode,
    rounds,
    boxes,
    headers,
    branches,
    stems,
    canvasWidth,
    bodyHeight,
    finalCenterX: colLeft(centerCol) + CARD_WIDTH / 2,
  };
}

export function BracketView({
  bracket,
  entrants,
  nodeMatches,
  layoutMode = 'CLASSIC',
  fitToScreen = false,
  interactive = true,
  className,
}: {
  bracket: Bracket;
  entrants: BracketEntrant[];
  nodeMatches?: Record<string, BracketNodeMatchInfo>;
  layoutMode?: BracketLayoutMode;
  fitToScreen?: boolean;
  interactive?: boolean;
  className?: string;
}) {
  const entrantMap = new Map(entrants.map((item) => [item.id, item]));
  const {
    effectiveMode,
    rounds,
    boxes,
    headers,
    branches,
    stems,
    canvasWidth,
    bodyHeight,
    finalCenterX,
  } = computeBracketLayout(bracket, layoutMode);

  const totalNaturalHeight = HEADER_HEIGHT + bodyHeight;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [fitScale, setFitScale] = useState(1);

  useEffect(() => {
    if (!fitToScreen) return;
    const el = viewportRef.current;
    if (!el) return;

    const recompute = () => {
      const pad = 16;
      const availW = Math.max(200, el.clientWidth - pad);
      const availH = Math.max(160, el.clientHeight - pad);
      const next = Math.min(availW / canvasWidth, availH / totalNaturalHeight, 1.25);
      setFitScale(Number.isFinite(next) && next > 0 ? next : 1);
    };

    const frame = requestAnimationFrame(recompute);
    const observer = new ResizeObserver(recompute);
    observer.observe(el);
    window.addEventListener('resize', recompute);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', recompute);
    };
  }, [fitToScreen, canvasWidth, totalNaturalHeight]);

  const inactiveBranches = branches.filter((b) => !b.active);
  const activeBranches = branches.filter((b) => b.active);
  const inactiveStems = stems.filter((s) => !s.active);
  const activeStems = stems.filter((s) => s.active);

  const renderCanvasContent = () => (
    <>
      {/* ── Round Header Strip ── */}
      <div
        className={cn(
          'z-20 border-b border-slate-800/80 bg-[#070b14]/95 backdrop-blur-md',
          !fitToScreen && 'sticky top-0',
        )}
        style={{ width: `${canvasWidth}px`, height: `${HEADER_HEIGHT}px` }}
      >
        {headers.map((hdr) => (
          <div
            key={hdr.key}
            className={cn(
              'flex items-center justify-between rounded-xl border px-3 py-1.5',
              hdr.isFinal
                ? 'border-yellow-500/50 bg-yellow-500/10'
                : 'border-slate-800/80 bg-slate-900/70',
            )}
            style={{
              position: 'absolute',
              left: `${hdr.left}px`,
              top: '8px',
              width: `${CARD_WIDTH}px`,
              height: '38px',
            }}
          >
            <div className="flex min-w-0 items-center gap-2">
              {hdr.isFinal ? (
                <Trophy className="size-3.5 shrink-0 text-yellow-400" />
              ) : (
                <span className="h-2 w-2 shrink-0 rounded-full bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.8)]" />
              )}
              <h3
                className={cn(
                  'truncate text-[11px] font-black uppercase tracking-[0.11em]',
                  hdr.isFinal ? 'text-yellow-400' : 'text-slate-100',
                )}
              >
                {hdr.label}
              </h3>
            </div>
            <span className="shrink-0 text-[10px] font-medium text-slate-400">
              {hdr.subLabel}
            </span>
          </div>
        ))}
      </div>

      {/* ── Unified Bracket Canvas (SVG + Cards share exact 1:1 pixel space) ── */}
      <div
        className="relative"
        style={{ width: `${canvasWidth}px`, height: `${bodyHeight}px` }}
      >
        {/* Ambient championship glow behind Final */}
        {rounds.length > 0 && (
          <div
            className="pointer-events-none absolute rounded-full bg-yellow-500/6 blur-3xl"
            style={{
              left: `${finalCenterX - (CARD_WIDTH + 80) / 2}px`,
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
            <filter
              id="tkdLineGlow"
              filterUnits="userSpaceOnUse"
              x="0"
              y="0"
              width={canvasWidth}
              height={bodyHeight}
            >
              <feGaussianBlur stdDeviation="2.2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Pass 1: Inactive structural skeleton */}
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

          {/* Pass 2: Active advancement paths */}
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

        {/* 2. Match Cards */}
        {rounds.map((round, roundIndex) => {
          const isFirstRound = roundIndex === 0;
          const isLastRound = roundIndex === rounds.length - 1;
          const nodes = bracket.nodes
            .filter((node) => node.round === round)
            .sort((a, b) => a.position - b.position);

          return nodes.map((node) => {
            const box = boxes.get(node.id);
            if (!box) return null;

            const liveInfo = nodeMatches?.[node.id];
            const effectiveStatus = liveInfo?.state ?? node.status;
            const isLive = LIVE_MATCH_STATES.has(effectiveStatus);
            const showScores = Boolean(
              liveInfo &&
                (isLive ||
                  effectiveStatus === 'COMPLETED' ||
                  liveInfo.blueScore > 0 ||
                  liveInfo.redScore > 0),
            );
            const displayMatchNo = liveInfo
              ? `M${liveInfo.matchNumber.replace(/^M/i, '')}`
              : node.matchNumber;
            const targetHref =
              interactive && liveInfo?.matchId
                ? `/display/${liveInfo.matchId}`
                : null;

            const cardInner = (
              <>
                {/* Final crown header above card */}
                {isLastRound && (
                  <div className="pointer-events-none absolute -top-6 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap">
                    <Crown className="size-4 text-yellow-400 drop-shadow-[0_0_8px_rgba(234,179,8,0.85)]" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-yellow-400">
                      {effectiveStatus === 'COMPLETED' && node.winnerEntrantId
                        ? 'Champion'
                        : 'Championship Final'}
                    </span>
                  </div>
                )}

                {isLastRound && effectiveMode === 'CLASSIC' && (
                  <div className="pointer-events-none absolute -right-7 top-1/2 -translate-y-1/2">
                    <Award className="size-5 text-yellow-400/75 drop-shadow-[0_0_8px_rgba(234,179,8,0.5)]" />
                  </div>
                )}

                <article
                  className={cn(
                    'flex h-full w-full flex-col justify-between rounded-xl border px-3 py-2 transition-all duration-200',
                    isLive
                      ? 'border-rose-500/80 bg-gradient-to-b from-rose-500/15 via-[#101628] to-[#0b101d] shadow-[0_0_22px_rgba(244,63,94,0.28)]'
                      : isLastRound
                        ? effectiveStatus === 'COMPLETED'
                          ? 'border-yellow-400/80 bg-gradient-to-b from-yellow-500/15 via-[#0e1424] to-[#0b101d] shadow-[0_0_24px_rgba(234,179,8,0.22)]'
                          : 'border-yellow-500/60 bg-gradient-to-b from-yellow-500/10 via-[#0e1424] to-[#0b101d] shadow-[0_0_18px_rgba(234,179,8,0.14)] group-hover:border-yellow-400'
                        : effectiveStatus === 'COMPLETED'
                          ? 'border-emerald-500/45 bg-[#0c1422] group-hover:border-emerald-400/75'
                          : effectiveStatus === 'READY'
                            ? 'border-slate-600/80 bg-[#0d1424] shadow-md group-hover:border-sky-400/70'
                            : effectiveStatus === 'BYE'
                              ? 'border-slate-800/90 bg-[#0a0f1c]/90'
                              : 'border-slate-800/90 bg-[#0b101d] group-hover:border-slate-600',
                  )}
                >
                  {/* Card Header */}
                  <div className="flex h-[22px] items-center justify-between gap-1.5 border-b border-slate-800/90 pb-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={cn(
                          'text-[10px] font-extrabold uppercase tracking-wider',
                          isLastRound ? 'text-yellow-400' : 'text-slate-300',
                        )}
                      >
                        Match {displayMatchNo}
                      </span>
                      {liveInfo?.matName && (
                        <span className="truncate rounded bg-slate-800/90 px-1.5 py-0.5 text-[9px] font-bold text-slate-300">
                          {liveInfo.matName}
                        </span>
                      )}
                    </div>
                    <span
                      className={cn(
                        'inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wider',
                        statusPillStyle(effectiveStatus, isLastRound),
                      )}
                    >
                      {isLive && <Radio className="size-2.5 animate-pulse" />}
                      {isLive ? 'LIVE' : effectiveStatus.replaceAll('_', ' ')}
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
                      score={liveInfo?.blueScore}
                      showScore={showScores}
                    />
                    <AthleteSlot
                      id={node.redEntrantId}
                      corner="RED"
                      entrants={entrantMap}
                      winnerId={node.winnerEntrantId}
                      isFirstRound={isFirstRound}
                      isByeMatch={node.isBye}
                      score={liveInfo?.redScore}
                      showScore={showScores}
                    />
                  </div>
                </article>
              </>
            );

            const boxStyle = {
              left: `${box.left}px`,
              top: `${box.top}px`,
              width: `${CARD_WIDTH}px`,
              height: `${CARD_HEIGHT}px`,
            };

            if (targetHref) {
              return (
                <Link
                  href={targetHref}
                  key={node.id}
                  aria-label={`${roundLabel(nodes.length)} Match ${displayMatchNo}`}
                  className="group absolute z-10 block focus:outline-none"
                  style={boxStyle}
                >
                  {cardInner}
                </Link>
              );
            }

            return (
              <div
                key={node.id}
                aria-label={`${roundLabel(nodes.length)} Match ${displayMatchNo}`}
                className="group absolute z-10 block"
                style={boxStyle}
              >
                {cardInner}
              </div>
            );
          });
        })}
      </div>
    </>
  );

  if (fitToScreen) {
    const scaledWidth = Math.round(canvasWidth * fitScale);
    const scaledHeight = Math.round(totalNaturalHeight * fitScale);
    return (
      <div
        ref={viewportRef}
        className={cn(
          'relative flex h-full w-full items-center justify-center overflow-hidden bg-[#050811]',
          className,
        )}
      >
        <div
          className="relative shrink-0"
          style={{ width: `${scaledWidth}px`, height: `${scaledHeight}px` }}
        >
          <div
            style={{
              width: `${canvasWidth}px`,
              height: `${totalNaturalHeight}px`,
              transform: `scale(${fitScale})`,
              transformOrigin: 'top left',
            }}
          >
            {renderCanvasContent()}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative max-h-[80vh] overflow-auto rounded-b-2xl bg-[#070b14] shadow-inner',
        className,
      )}
    >
      {renderCanvasContent()}
    </div>
  );
}
