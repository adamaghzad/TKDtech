'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Crown,
  GitBranch,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  QrCode,
  Radio,
  RefreshCw,
  Scan,
  Trophy,
} from 'lucide-react';
import type { Bracket } from '@tkd/domain';
import { api } from '@/lib/api';
import { cn, flagEmoji } from '@/lib/utils';
import { ErrorState, Loading } from '@/components/ui/states';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  BracketView,
  type BracketEntrant,
  type BracketLayoutMode,
  type BracketNodeMatchInfo,
} from './bracket-view';

export interface PublicBracketPayload {
  draw: {
    id: string;
    method: string;
    seed: string;
    status: string;
    publishedVersion: number | null;
    createdAt: string;
  };
  categoryId?: string;
  categoryName: string;
  division?: string;
  ageGroup?: string;
  tournamentId: string;
  tournamentName?: string;
  tournamentVenue?: string;
  bracket: Bracket;
  athletes: BracketEntrant[];
  nodeMatches?: Record<string, BracketNodeMatchInfo>;
}

interface PublicTournamentBracketsPayload {
  tournament: {
    id: string;
    name: string;
    venue: string;
    country: string;
    startDate: string;
    endDate: string;
    status: string;
  };
  brackets: PublicBracketPayload[];
}

type TvDisplayStyle = 'SPLIT_FIT' | 'CLASSIC_FIT' | 'SCROLL_100';

const LIVE_STATES = new Set([
  'CALLED',
  'IN_PROGRESS',
  'PAUSED',
  'ROUND_BREAK',
  'GOLDEN_POINT',
  'UNDER_REVIEW',
]);

export function PublicBracketTv({
  categoryId,
  tournamentId,
  initialCategoryId,
}: {
  categoryId?: string;
  tournamentId?: string;
  initialCategoryId?: string | null;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [brackets, setBrackets] = useState<PublicBracketPayload[]>([]);
  const [tournamentTitle, setTournamentTitle] = useState<string>('');
  const [tournamentVenue, setTournamentVenue] = useState<string>('');
  const [resolvedTournamentId, setResolvedTournamentId] = useState<string>(
    tournamentId ?? '',
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  // TV view settings
  const [displayStyle, setDisplayStyle] = useState<TvDisplayStyle | null>(null);
  const [autoRotate, setAutoRotate] = useState<boolean>(Boolean(tournamentId));
  const [rotateSeconds, setRotateSeconds] = useState<number>(20);
  const [rotateProgress, setRotateProgress] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [clockText, setClockText] = useState<string>('');
  const [qrModal, setQrModal] = useState<{ url: string; image: string; label: string } | null>(
    null,
  );

  const initializedSelectionRef = useRef(false);

  const loadData = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        if (categoryId) {
          const single = await api<PublicBracketPayload>(
            `/api/v1/categories/${categoryId}/bracket`,
          );
          setBrackets([single]);
          setTournamentTitle(single.tournamentName ?? 'TKD Scoring Championship');
          setTournamentVenue(single.tournamentVenue ?? '');
          setResolvedTournamentId(single.tournamentId);
          setError(null);
        } else if (tournamentId) {
          const multi = await api<PublicTournamentBracketsPayload>(
            `/api/v1/public/tournaments/${tournamentId}/brackets`,
          );
          setBrackets(multi.brackets);
          setTournamentTitle(multi.tournament.name);
          setTournamentVenue(multi.tournament.venue);
          setResolvedTournamentId(multi.tournament.id);
          if (!initializedSelectionRef.current && initialCategoryId) {
            const idx = multi.brackets.findIndex(
              (b) => (b.categoryId ?? b.bracket.categoryId) === initialCategoryId,
            );
            if (idx >= 0) {
              setActiveIndex(idx);
              setAutoRotate(false);
            }
            initializedSelectionRef.current = true;
          }
          setError(null);
        }
      } catch (reason) {
        if (!silent) setError(reason as Error);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [categoryId, tournamentId, initialCategoryId],
  );

  // Initial load + 5-second silent live polling fallback
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void loadData(false);
    });
    const poll = setInterval(() => {
      void loadData(true);
    }, 5000);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(poll);
    };
  }, [loadData]);

  // Subscribe to tournament WebSocket for instant sub-second live updates
  useEffect(() => {
    if (!resolvedTournamentId || typeof window === 'undefined') return;
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 1200;

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const params = new URLSearchParams({ tournamentId: resolvedTournamentId });
      socket = new WebSocket(`${protocol}://${window.location.host}/ws?${params}`);

      socket.onopen = () => {
        retryDelay = 1200;
        setWsConnected(true);
        socket?.send(
          JSON.stringify({
            type: 'subscribe_tournament',
            tournamentId: resolvedTournamentId,
          }),
        );
      };

      socket.onmessage = () => {
        void loadData(true);
      };

      socket.onclose = () => {
        setWsConnected(false);
        if (!disposed) {
          reconnectTimer = setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 1.8, 15000);
        }
      };

      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [resolvedTournamentId, loadData]);

  // Arena digital clock
  useEffect(() => {
    const tick = () => {
      setClockText(
        new Intl.DateTimeFormat('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(new Date()),
      );
    };
    const frame = requestAnimationFrame(tick);
    const id = setInterval(tick, 1000);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(id);
    };
  }, []);

  const safeIndex =
    brackets.length > 0 && activeIndex >= brackets.length ? 0 : activeIndex;

  // Multi-category Auto-Carousel timer
  useEffect(() => {
    if (!autoRotate || brackets.length <= 1) return;
    const stepMs = 100;
    const totalMs = rotateSeconds * 1000;
    let elapsed = 0;

    const id = setInterval(() => {
      elapsed += stepMs;
      if (elapsed >= totalMs) {
        elapsed = 0;
        setActiveIndex((prev) => (prev + 1) % brackets.length);
      }
      setRotateProgress(Math.min(100, (elapsed / totalMs) * 100));
    }, stepMs);

    return () => clearInterval(id);
  }, [autoRotate, brackets.length, rotateSeconds, safeIndex]);

  // Fullscreen state tracking + keyboard shortcuts (F = fullscreen, Arrows = category)
  const toggleFullscreen = useCallback(async () => {
    if (typeof document === 'undefined') return;
    try {
      if (!document.fullscreenElement) {
        await (rootRef.current ?? document.documentElement).requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      /* Browser blocked programmatic fullscreen */
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
        return;
      }
      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        void toggleFullscreen();
      } else if (event.key === 'ArrowRight' && brackets.length > 1) {
        setAutoRotate(false);
        setActiveIndex((prev) => (prev + 1) % brackets.length);
      } else if (event.key === 'ArrowLeft' && brackets.length > 1) {
        setAutoRotate(false);
        setActiveIndex((prev) => (prev - 1 + brackets.length) % brackets.length);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [toggleFullscreen, brackets.length]);

  // Auto-dim toolbar in fullscreen when mouse is idle
  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      setControlsVisible(true);
      if (hideTimer) clearTimeout(hideTimer);
      if (isFullscreen) {
        hideTimer = setTimeout(() => setControlsVisible(false), 3500);
      }
    };
    const frame = requestAnimationFrame(wake);
    window.addEventListener('mousemove', wake);
    window.addEventListener('touchstart', wake);
    return () => {
      cancelAnimationFrame(frame);
      if (hideTimer) clearTimeout(hideTimer);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('touchstart', wake);
    };
  }, [isFullscreen]);

  const current = brackets[safeIndex] ?? null;

  // Smart default: Arena Split for 8+ slot brackets so text is twice as large on 16:9 TVs
  const effectiveStyle: TvDisplayStyle = useMemo(() => {
    if (displayStyle) return displayStyle;
    if (current && current.bracket.size >= 8) return 'SPLIT_FIT';
    return 'CLASSIC_FIT';
  }, [displayStyle, current]);

  const stats = useMemo(() => {
    if (!current) {
      return {
        realMatches: 0,
        completedMatches: 0,
        liveMatches: [] as BracketNodeMatchInfo[],
        champion: null as BracketEntrant | null,
      };
    }
    const nonByeNodes = current.bracket.nodes.filter((n) => !n.isBye);
    const completedNodes = nonByeNodes.filter(
      (n) =>
        n.status === 'COMPLETED' ||
        current.nodeMatches?.[n.id]?.state === 'COMPLETED',
    );
    const liveMatches = Object.values(current.nodeMatches ?? {}).filter((m) =>
      LIVE_STATES.has(m.state),
    );
    const maxRound = Math.max(...current.bracket.nodes.map((n) => n.round));
    const finalNode = current.bracket.nodes.find((n) => n.round === maxRound);
    const champion =
      finalNode?.winnerEntrantId &&
      (finalNode.status === 'COMPLETED' ||
        current.nodeMatches?.[finalNode.id]?.state === 'COMPLETED')
        ? current.athletes.find((a) => a.id === finalNode.winnerEntrantId) ?? null
        : null;

    return {
      realMatches: nonByeNodes.length,
      completedMatches: completedNodes.length,
      liveMatches,
      champion,
    };
  }, [current]);

  const openSpectatorQr = async () => {
    if (!current || typeof window === 'undefined') return;
    const catId = current.categoryId ?? current.bracket.categoryId;
    const url = `${window.location.origin}/public/brackets/${catId}`;
    const image = await QRCode.toDataURL(url, { width: 300, margin: 2 });
    setQrModal({ url, image, label: current.categoryName });
  };

  if (loading && brackets.length === 0) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#050811] text-white">
        <Loading label="Loading Public TV Bracket…" />
      </div>
    );
  }

  if (error && brackets.length === 0) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#050811] p-8 text-white">
        <div className="w-full max-w-lg">
          <ErrorState error={error} retry={() => void loadData(false)} />
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-[#050811] p-8 text-center text-white">
        <GitBranch className="size-12 text-slate-500" />
        <h1 className="text-2xl font-black">No Brackets Generated Yet</h1>
        <p className="max-w-md text-sm text-slate-400">
          Generate a draw in the Tournament Control Desk and this Public TV screen will
          display the full bracket automatically.
        </p>
      </div>
    );
  }

  const layoutMode: BracketLayoutMode =
    effectiveStyle === 'SPLIT_FIT' ? 'SPLIT' : 'CLASSIC';
  const fitToScreen = effectiveStyle !== 'SCROLL_100';

  return (
    <div
      ref={rootRef}
      className="relative flex h-screen w-screen flex-col overflow-hidden bg-[#050811] text-slate-100 select-none"
    >
      {/* Carousel Auto-Rotation Progress Line */}
      {autoRotate && brackets.length > 1 && (
        <div className="h-[3px] w-full bg-slate-900">
          <div
            className="h-full bg-gradient-to-r from-blue-500 via-violet-500 to-yellow-400 transition-[width] duration-100 ease-linear"
            style={{ width: `${rotateProgress}%` }}
          />
        </div>
      )}

      {/* ── Broadcast TV Top Bar ── */}
      <header className="z-30 flex h-[60px] shrink-0 items-center justify-between gap-4 border-b border-slate-800/90 bg-[#080d1a]/95 px-5 backdrop-blur-md">
        {/* Left: Tournament + Active Category Identity */}
        <div className="flex min-w-0 items-center gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-500/40 bg-violet-500/15 shadow-[0_0_16px_rgba(139,92,246,0.25)]">
            <Trophy className="size-5 text-violet-300" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
              <span className="truncate">{tournamentTitle}</span>
              {tournamentVenue && (
                <>
                  <span className="text-slate-600">•</span>
                  <span className="truncate">{tournamentVenue}</span>
                </>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2.5">
              <h1 className="truncate text-lg font-black tracking-tight text-white sm:text-xl">
                {current.categoryName}
              </h1>
              <span className="rounded-md border border-blue-500/40 bg-blue-500/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-blue-300">
                {current.bracket.size} Slots
              </span>
              <span className="rounded-md border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-[10px] font-bold text-slate-300">
                {current.athletes.filter((a) =>
                  current.bracket.orderedEntrantIds.includes(a.id),
                ).length}{' '}
                Athletes
              </span>
              <span className="hidden rounded-md border border-slate-700/80 bg-slate-900/90 px-2 py-0.5 text-[10px] font-bold text-slate-400 md:inline-block">
                {stats.completedMatches}/{stats.realMatches} Matches Done
              </span>
              {stats.liveMatches.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/60 bg-rose-500/20 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-rose-200 shadow-[0_0_12px_rgba(244,63,94,0.35)]">
                  <Radio className="size-3 animate-pulse text-rose-400" />
                  Live{' '}
                  {stats.liveMatches[0]?.matName
                    ? `· ${stats.liveMatches[0].matName}`
                    : `(${stats.liveMatches.length})`}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Center: Champion Banner (if Final Completed) OR Multi-Category Switcher */}
        {stats.champion ? (
          <div className="hidden items-center gap-2.5 rounded-xl border border-yellow-400/60 bg-gradient-to-r from-yellow-500/20 via-amber-500/10 to-yellow-500/20 px-4 py-1.5 shadow-[0_0_20px_rgba(234,179,8,0.2)] xl:flex">
            <Crown className="size-4 text-yellow-400" />
            <span className="text-[10px] font-black uppercase tracking-widest text-yellow-300">
              Champion
            </span>
            <span className="text-sm font-black text-white">
              {flagEmoji(stats.champion.countryCode)} {stats.champion.name}
            </span>
          </div>
        ) : brackets.length > 1 ? (
          <div className="hidden items-center gap-1.5 xl:flex">
            <button
              type="button"
              onClick={() => {
                setAutoRotate(false);
                setActiveIndex((prev) => (prev - 1 + brackets.length) % brackets.length);
              }}
              className="rounded-lg border border-slate-800 bg-slate-900/80 p-1.5 text-slate-300 hover:border-slate-600 hover:text-white"
              aria-label="Previous category"
            >
              <ChevronLeft className="size-4" />
            </button>
            <div className="flex max-w-[420px] items-center gap-1 overflow-x-auto px-1">
              {brackets.map((item, idx) => (
                <button
                  type="button"
                  key={item.draw.id}
                  onClick={() => {
                    setAutoRotate(false);
                    setActiveIndex(idx);
                  }}
                  className={cn(
                    'shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition-colors',
                    idx === safeIndex
                      ? 'border-violet-400/70 bg-violet-500/25 text-white'
                      : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200',
                  )}
                >
                  {item.categoryName}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setAutoRotate(false);
                setActiveIndex((prev) => (prev + 1) % brackets.length);
              }}
              className="rounded-lg border border-slate-800 bg-slate-900/80 p-1.5 text-slate-300 hover:border-slate-600 hover:text-white"
              aria-label="Next category"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        ) : null}

        {/* Right: TV Controls + Live Status + Arena Clock */}
        <div className="flex shrink-0 items-center gap-2">
          <div
            className={cn(
              'flex items-center gap-1.5 transition-opacity duration-300',
              controlsVisible ? 'opacity-100' : 'opacity-20 hover:opacity-100',
            )}
          >
            {/* Multi-category Carousel Play/Pause */}
            {brackets.length > 1 && (
              <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900/90 p-0.5">
                <button
                  type="button"
                  onClick={() => setAutoRotate((v) => !v)}
                  className={cn(
                    'flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors',
                    autoRotate
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'text-slate-400 hover:text-white',
                  )}
                  title="Auto-rotate across tournament categories"
                >
                  {autoRotate ? <Pause className="size-3" /> : <Play className="size-3" />}
                  {autoRotate ? 'Rotate' : 'Paused'}
                </button>
                {autoRotate && (
                  <select
                    aria-label="Rotation interval"
                    value={rotateSeconds}
                    onChange={(e) => setRotateSeconds(Number(e.target.value))}
                    className="bg-transparent px-1 text-[10px] font-bold text-slate-300 focus:outline-none"
                  >
                    <option value={15} className="bg-slate-900">
                      15s
                    </option>
                    <option value={20} className="bg-slate-900">
                      20s
                    </option>
                    <option value={35} className="bg-slate-900">
                      35s
                    </option>
                  </select>
                )}
              </div>
            )}

            {/* Layout Mode Toggle: Arena Split vs Classic Fit vs 100% */}
            <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900/90 p-0.5">
              <button
                type="button"
                onClick={() => setDisplayStyle('SPLIT_FIT')}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors',
                  effectiveStyle === 'SPLIT_FIT'
                    ? 'bg-blue-500/25 text-blue-200'
                    : 'text-slate-400 hover:text-white',
                )}
                title="Two-sided Arena TV Split (fits 16 & 32 slots large on 16:9 TV)"
              >
                <Columns2 className="size-3" />
                <span className="hidden sm:inline">Arena Split</span>
              </button>
              <button
                type="button"
                onClick={() => setDisplayStyle('CLASSIC_FIT')}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors',
                  effectiveStyle === 'CLASSIC_FIT'
                    ? 'bg-blue-500/25 text-blue-200'
                    : 'text-slate-400 hover:text-white',
                )}
                title="Classic Left-to-Right bracket scaled to fit TV"
              >
                <Scan className="size-3" />
                <span className="hidden sm:inline">Classic Fit</span>
              </button>
              <button
                type="button"
                onClick={() => setDisplayStyle('SCROLL_100')}
                className={cn(
                  'rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors',
                  effectiveStyle === 'SCROLL_100'
                    ? 'bg-blue-500/25 text-blue-200'
                    : 'text-slate-400 hover:text-white',
                )}
                title="100% Zoom (scrollable)"
              >
                100%
              </button>
            </div>

            <button
              type="button"
              onClick={() => void openSpectatorQr()}
              className="rounded-lg border border-slate-800 bg-slate-900/90 p-2 text-slate-300 hover:border-slate-600 hover:text-white"
              title="Show Spectator QR Code"
              aria-label="Show Spectator QR Code"
            >
              <QrCode className="size-3.5" />
            </button>

            <button
              type="button"
              onClick={() => void loadData(true)}
              className="rounded-lg border border-slate-800 bg-slate-900/90 p-2 text-slate-300 hover:border-slate-600 hover:text-white"
              title="Refresh bracket now"
              aria-label="Refresh bracket"
            >
              <RefreshCw className="size-3.5" />
            </button>

            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              className="flex items-center gap-1.5 rounded-lg border border-violet-500/50 bg-violet-500/20 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-violet-200 hover:bg-violet-500/30"
              title="Toggle Fullscreen TV (Press F)"
            >
              {isFullscreen ? (
                <Minimize2 className="size-3.5" />
              ) : (
                <Maximize2 className="size-3.5" />
              )}
              <span className="hidden md:inline">
                {isFullscreen ? 'Exit' : 'Fullscreen'}
              </span>
            </button>
          </div>

          {/* Live Telemetry Pill + Clock */}
          <div className="hidden items-center gap-2 border-l border-slate-800 pl-3 sm:flex">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {wsConnected ? 'LIVE · TV' : 'AUTO · TV'}
            </span>
            {clockText && (
              <span className="numeric text-xs font-bold text-slate-300">
                {clockText}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* ── Main Full-Viewport Bracket Stage ── */}
      <main className="relative min-h-0 flex-1 overflow-hidden">
        <BracketView
          bracket={current.bracket}
          entrants={current.athletes}
          nodeMatches={current.nodeMatches}
          layoutMode={layoutMode}
          fitToScreen={fitToScreen}
          interactive={!isFullscreen}
          className={
            fitToScreen
              ? 'h-full w-full rounded-none'
              : 'h-full max-h-none w-full rounded-none'
          }
        />
      </main>

      {/* Spectator QR Code Dialog */}
      <Dialog open={Boolean(qrModal)} onOpenChange={() => setQrModal(null)}>
        <DialogContent
          title={`${qrModal?.label ?? 'Bracket'} · Spectator Mobile Link`}
          description="Scan with any phone camera to view this live bracket."
        >
          <div className="text-center">
            {qrModal && (
              <img
                src={qrModal.image}
                alt="Bracket QR code"
                className="mx-auto max-w-64 rounded-xl bg-white p-2"
              />
            )}
            <p className="mt-4 break-all text-xs text-muted">{qrModal?.url}</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
