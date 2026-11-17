'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Expand, Loader2, Shrink, Volume2, VolumeX } from 'lucide-react';
import type { MatchSnapshot } from '@tkd/contracts';
import { useMatchCloud } from '@/lib/use-match-cloud';
import { useTimerAudio } from '@/lib/use-timer-audio';
import { ScoreboardView } from './scoreboard-view';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/states';
import { Badge } from '@/components/ui/badge';
import { WaitingView } from './waiting-view';
import { applyTvFullscreen, readTvFullscreenPref, TV_FULLSCREEN_PREF_KEY, writeTvFullscreenPref } from '@/lib/tv-fullscreen';

const RESULT_STATES = new Set(['COMPLETED', 'DISQUALIFIED', 'WALKOVER']);
const UNSTARTED_STATES = new Set(['PENDING', 'READY', 'CALLED']);

interface PublicDisplayProps {
  matchId: string;
  queuedSnapshot?: MatchSnapshot | null;
  onLiveOrResolved?: (matchId: string) => void;
}

export function PublicDisplay({ matchId, queuedSnapshot, onLiveOrResolved }: PublicDisplayProps) {
  const { snapshot, remainingMs, connection, error, refresh, cloudConfigured } = useMatchCloud(matchId);
  const audio = useTimerAudio(snapshot, remainingMs);
  const [flipped, setFlipped] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const automaticWaiting = Boolean(snapshot && UNSTARTED_STATES.has(snapshot.state));
  const operatorWaiting = Boolean(snapshot?.publicWaiting);
  const toggleAudio = audio.toggle;

  useEffect(() => {
    if (snapshot && snapshot.matchId === matchId && !UNSTARTED_STATES.has(snapshot.state)) {
      onLiveOrResolved?.(matchId);
    }
  }, [matchId, onLiveOrResolved, snapshot]);

  // Fullscreen is requested on <html> (which never unmounts) so changing the displayed
  // match — e.g. starting a new Hong vs Chung match — keeps the Public TV fullscreen.
  const toggleFullscreen = useCallback(async () => {
    const next = !document.fullscreenElement;
    writeTvFullscreenPref(next);
    await applyTvFullscreen(next);
  }, []);

  // If the sticky fullscreen choice was lost (browser reload, crash), re-enter on the
  // first interaction with the TV screen. Exiting through the TV's own controls clears
  // the preference, so an intentional exit is always respected.
  const restoreFullscreen = useCallback(async () => {
    if (!document.fullscreenElement && readTvFullscreenPref()) await applyTvFullscreen(true);
  }, []);

  useEffect(() => {
    // Sync with fullscreen that is already active (e.g. after the displayed match changed):
    // no fullscreenchange event fires for an already-fullscreen document.
    const frame = requestAnimationFrame(() => {
      setFlipped(localStorage.getItem(`tkd_flip_${matchId}`) === '1');
      setFullscreen(Boolean(document.fullscreenElement));
    });
    // Re-apply the sticky fullscreen choice after the TV page (re)loads — kiosk TVs stay pinned.
    void restoreFullscreen();
    const handler = () => {
      const active = Boolean(document.fullscreenElement);
      setFullscreen(active);
      if (active) writeTvFullscreenPref(true);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('fullscreenchange', handler);
    };
  }, [matchId, restoreFullscreen]);

  // Remote control from the operator scoreboard: the operator writes the shared
  // preference, which fires a storage event in this window (same origin).
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== TV_FULLSCREEN_PREF_KEY) return;
      void applyTvFullscreen(event.newValue === '1');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    const onGesture = () => void restoreFullscreen();
    document.addEventListener('click', onGesture);
    document.addEventListener('keydown', onGesture);
    return () => {
      document.removeEventListener('click', onGesture);
      document.removeEventListener('keydown', onGesture);
    };
  }, [restoreFullscreen]);

  const flip = useCallback(() => {
    const next = !flipped;
    setFlipped(next);
    localStorage.setItem(`tkd_flip_${matchId}`, next ? '1' : '0');
  }, [flipped, matchId]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;

      const key = event.key.toLowerCase();
      if (key === 'm') {
        event.preventDefault();
        void toggleAudio();
      } else if (key === 'f') {
        event.preventDefault();
        flip();
      } else if (key === 'f11') {
        event.preventDefault();
        void toggleFullscreen();
      } else if (key === 'escape' && document.fullscreenElement) {
        event.preventDefault();
        void toggleFullscreen();
      }
    };

    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [flip, toggleAudio, toggleFullscreen]);

  const waitingTargetSnapshot =
    queuedSnapshot && UNSTARTED_STATES.has(queuedSnapshot.state)
      ? queuedSnapshot
      : snapshot && !RESULT_STATES.has(snapshot.state)
        ? snapshot
        : undefined;

  return (
    <div
      ref={container}
      data-testid="public-display"
      data-flipped={flipped ? 'true' : 'false'}
      className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-black"
    >
      {!fullscreen && (
        <div data-testid="public-display-controls" className="relative z-50 flex shrink-0 items-center justify-end gap-1 border-b border-white/10 bg-[#070a10] px-2 sm:gap-2 sm:px-3">
          <Badge tone={connection === 'ONLINE' ? 'green' : 'yellow'}>
            {connection}{cloudConfigured ? ' · Cloud' : ' · Local'}
          </Badge>
          <Button
            size="sm"
            variant={audio.ready ? 'success' : 'yellow'}
            aria-label={audio.ready ? 'Mute match sounds' : 'Enable match sounds'}
            aria-keyshortcuts="m"
            aria-pressed={audio.ready}
            title="Score confirmation, final-five-second beeps, and round/rest end buzzer (M)"
            onClick={() => void audio.toggle()}
          >
            {audio.ready ? <Volume2 /> : <VolumeX />}
            <span className="hidden sm:inline">{audio.ready ? 'Sound on' : audio.enabled ? 'Enable sound' : 'Sound off'}</span>
          </Button>
          <Button size="sm" variant="secondary" aria-keyshortcuts="f" title="Flip Blue and Red display sides (F)" onClick={flip}>
            <ArrowLeftRight /><span className="hidden sm:inline">Flip</span>
          </Button>
          <Button size="sm" variant="secondary" aria-keyshortcuts="F11" title="Toggle fullscreen (F11); exit with Escape" onClick={() => void toggleFullscreen()}>
            {fullscreen ? <Shrink /> : <Expand />}<span className="hidden sm:inline">{fullscreen ? 'Exit' : 'Fullscreen'}</span>
          </Button>
        </div>
      )}

      {snapshot ? (
        operatorWaiting ? (
          <WaitingView snapshot={waitingTargetSnapshot} />
        ) : automaticWaiting ? (
          <WaitingView snapshot={snapshot} />
        ) : (
          <ScoreboardView snapshot={snapshot} remainingMs={remainingMs} flipped={flipped} viewport />
        )
      ) : error ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <ErrorState error={error} retry={refresh} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-3 text-sm text-white/60">
          <Loader2 className="size-6 animate-spin text-timer" /> Connecting to authoritative match state…
        </div>
      )}
    </div>
  );
}
