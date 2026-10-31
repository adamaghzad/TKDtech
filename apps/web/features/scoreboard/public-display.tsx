'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Expand, Loader2, Shrink, Volume2, VolumeX } from 'lucide-react';
import { useMatch } from '@/lib/use-match';
import { useTimerAudio } from '@/lib/use-timer-audio';
import { ScoreboardView } from './scoreboard-view';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/states';
import { Badge } from '@/components/ui/badge';
import { WaitingView } from './waiting-view';

const RESULT_STATES = new Set(['COMPLETED', 'DISQUALIFIED']);

export function PublicDisplay({ matchId }: { matchId: string }) {
  const { snapshot, remainingMs, connection, error, refresh } = useMatch(matchId);
  const audio = useTimerAudio(snapshot, remainingMs);
  const [flipped, setFlipped] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [waitingOverride, setWaitingOverride] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const state = snapshot?.state;
  const resultKey = snapshot && state && RESULT_STATES.has(state) ? `${matchId}:${state}:${snapshot.sequence}` : null;
  const result = resultKey !== null;
  const automaticWaiting = Boolean(snapshot && ['PENDING', 'READY', 'CALLED'].includes(snapshot.state));
  const manualWaiting = result && waitingOverride === resultKey;
  const toggleAudio = audio.toggle;

  useEffect(() => {
    const frame = requestAnimationFrame(() => setFlipped(localStorage.getItem(`tkd_flip_${matchId}`) === '1'));
    const handler = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handler);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('fullscreenchange', handler);
    };
  }, [matchId]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await container.current?.requestFullscreen();
    } catch {
      // A browser may deny fullscreen outside a user gesture; the display remains usable.
    }
  }, []);

  const flip = useCallback(() => {
    const next = !flipped;
    setFlipped(next);
    localStorage.setItem(`tkd_flip_${matchId}`, next ? '1' : '0');
  }, [flipped, matchId]);

  const toggleWaiting = useCallback(() => {
    if (resultKey) setWaitingOverride(current => current === resultKey ? null : resultKey);
  }, [resultKey]);

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
      } else if (key === 'w' && result) {
        event.preventDefault();
        toggleWaiting();
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
  }, [flip, result, toggleAudio, toggleFullscreen, toggleWaiting]);

  return <div
    ref={container}
    data-testid="public-display"
    data-flipped={flipped ? 'true' : 'false'}
    className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-black"
  >
    {!fullscreen && <div data-testid="public-display-controls" className="relative z-50 flex shrink-0 items-center justify-end gap-1 border-b border-white/10 bg-[#070a10] px-2 sm:gap-2 sm:px-3">
      <Badge tone={connection === 'ONLINE' ? 'green' : 'yellow'}>{connection}</Badge>
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
    </div>}

    {snapshot ? (
      manualWaiting
        ? <WaitingView />
        : automaticWaiting
          ? <WaitingView snapshot={snapshot} />
          : <ScoreboardView snapshot={snapshot} remainingMs={remainingMs} flipped={flipped} viewport />
    ) : error ? <div className="flex min-h-0 flex-1 items-center justify-center">
      <ErrorState error={error} retry={refresh} />
    </div> : <div className="flex min-h-0 flex-1 items-center justify-center gap-3 text-sm text-white/60">
      <Loader2 className="size-6 animate-spin text-timer" />Connecting to authoritative match state…
    </div>}
  </div>;
}
