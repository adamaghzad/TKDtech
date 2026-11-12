'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MatchSnapshot } from '@tkd/contracts';
import { TimerAlertTracker } from './timer-alerts';
import { CompetitionAlertTracker } from './competition-alerts';
import { ProArenaSynth, type PreviewableProSound } from './pro-arena-synth';

const STORAGE_KEY = 'tkd_timer_sound_enabled';

export function useTimerAudio(snapshot: MatchSnapshot | null, remainingMs: number) {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const contextRef = useRef<AudioContext | null>(null);
  const synthRef = useRef<ProArenaSynth | null>(null);
  const trackerRef = useRef(new TimerAlertTracker());
  const competitionRef = useRef(new CompetitionAlertTracker());
  const enabledRef = useRef(false);
  const readyRef = useRef(false);

  const ensureSynth = useCallback(async (): Promise<ProArenaSynth | null> => {
    try {
      if (!contextRef.current) {
        const AudioCtx =
          window.AudioContext ??
          (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        contextRef.current = new AudioCtx();
      }
      if (!synthRef.current) {
        synthRef.current = new ProArenaSynth(contextRef.current);
      }
      if (contextRef.current.state !== 'running') {
        await contextRef.current.resume();
      }
      enabledRef.current = true;
      readyRef.current = true;
      setEnabled(true);
      setReady(true);
      localStorage.setItem(STORAGE_KEY, '1');
      return synthRef.current;
    } catch {
      readyRef.current = false;
      setReady(false);
      return null;
    }
  }, []);

  const unlock = useCallback(async () => {
    const synth = await ensureSynth();
    synth?.playUnlockReady();
  }, [ensureSynth]);

  const toggle = useCallback(async () => {
    const context = contextRef.current;
    if (enabledRef.current && readyRef.current && context?.state === 'running') {
      enabledRef.current = false;
      readyRef.current = false;
      setEnabled(false);
      setReady(false);
      localStorage.setItem(STORAGE_KEY, '0');
      await context.suspend();
    } else {
      await unlock();
    }
  }, [unlock]);

  const preview = useCallback(
    async (sound: PreviewableProSound) => {
      const synth = await ensureSynth();
      synth?.preview(sound);
    },
    [ensureSynth],
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (localStorage.getItem(STORAGE_KEY) === '1') {
        enabledRef.current = true;
        setEnabled(true);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(
    () => () => {
      synthRef.current = null;
      if (contextRef.current) void contextRef.current.close();
    },
    [],
  );

  useEffect(() => {
    const timerAlerts = trackerRef.current.observe(snapshot, remainingMs);
    const cues = competitionRef.current.observe(snapshot);
    if (!enabled || !ready) return;
    const synth = synthRef.current;
    if (!synth) return;

    for (const cue of cues) {
      switch (cue.type) {
        case 'SCORE':
          synth.playScoreHit(cue.tier);
          break;
        case 'GAM_JEOM':
          synth.playGamJeom();
          break;
        case 'ROUND_START':
          synth.playRoundStart(cue.goldenPoint);
          break;
        case 'MATCH_RESUME':
          synth.playMatchResume();
          break;
        case 'MATCH_PAUSE':
          synth.playMatchPause();
          break;
        case 'MEDICAL_START':
          synth.playMedicalAlert();
          break;
        case 'VIDEO_REVIEW_REQUESTED':
          synth.playVideoReviewRequest();
          break;
        case 'VIDEO_REVIEW_DECIDED':
          synth.playVideoReviewDecision(cue.accepted);
          break;
        case 'MATCH_VICTORY':
          synth.playMatchVictory();
          break;
      }
    }

    for (const alert of timerAlerts) {
      if (alert.type === 'WARNING') {
        synth.playCountdownTick(alert.second);
      } else {
        synth.playArenaHorn(alert.timerKind);
      }
    }
  }, [snapshot, remainingMs, enabled, ready]);

  return { enabled, ready, toggle, preview };
}
