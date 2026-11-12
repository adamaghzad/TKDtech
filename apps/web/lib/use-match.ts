'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventEnvelope, MatchSnapshot, TimerState } from '@tkd/contracts';
import { api } from './api';

export type ConnectionState = 'CONNECTING' | 'ONLINE' | 'RECONNECTING' | 'OFFLINE';

interface LocalStopwatch {
  running: boolean;
  kind: TimerState['kind'];
  baseRemainingMs: number;
  basePerfMs: number;
}

function nowPerf(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function useMatch(matchId?: string, deviceToken?: string, onSessionMatchChange?: (nextMatchId: string) => void) {
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('CONNECTING');
  const [error, setError] = useState<Error | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const sequenceRef = useRef(-1);
  const mountedRef = useRef(true);
  const stopwatchRef = useRef<LocalStopwatch>({
    running: false,
    kind: 'ROUND',
    baseRemainingMs: 0,
    basePerfMs: 0,
  });

  const getExactRemainingMs = useCallback((): number => {
    const sw = stopwatchRef.current;
    if (!sw.running) return Math.max(0, Math.round(sw.baseRemainingMs));
    return Math.max(0, Math.round(sw.baseRemainingMs - Math.max(0, nowPerf() - sw.basePerfMs)));
  }, []);

  const apply = useCallback((next: MatchSnapshot, transitMs = 0) => {
    if (next.matchId !== matchId || next.sequence < sequenceRef.current) return;
    sequenceRef.current = next.sequence;
    const perf = nowPerf();
    const prevSw = stopwatchRef.current;

    if (next.timer.running) {
      const incomingRemaining = Math.max(0, next.timer.remainingMs - Math.max(0, transitMs));
      const localNow = prevSw.running
        ? Math.max(0, prevSw.baseRemainingMs - Math.max(0, perf - prevSw.basePerfMs))
        : incomingRemaining;
      // Preserve smooth monotonic cadence when already running the same timer phase within network-jitter bounds
      const keepLocalRun =
        prevSw.running &&
        prevSw.kind === next.timer.kind &&
        Math.abs(localNow - incomingRemaining) <= 800;

      if (!keepLocalRun) {
        stopwatchRef.current = {
          running: true,
          kind: next.timer.kind,
          baseRemainingMs: incomingRemaining,
          basePerfMs: perf,
        };
        setRemainingMs(Math.round(incomingRemaining));
      }
    } else {
      stopwatchRef.current = {
        running: false,
        kind: next.timer.kind,
        baseRemainingMs: next.timer.remainingMs,
        basePerfMs: perf,
      };
      setRemainingMs(next.timer.remainingMs);
    }

    setSnapshot(next);
    setError(null);
  }, [matchId]);

  const optimisticPause = useCallback((): number => {
    const frozenMs = getExactRemainingMs();
    const perf = nowPerf();
    stopwatchRef.current = {
      ...stopwatchRef.current,
      running: false,
      baseRemainingMs: frozenMs,
      basePerfMs: perf,
    };
    setRemainingMs(frozenMs);
    setSnapshot(prev =>
      prev && prev.matchId === matchId
        ? {
            ...prev,
            state: 'PAUSED',
            timer: { ...prev.timer, running: false, remainingMs: frozenMs },
          }
        : prev,
    );
    return frozenMs;
  }, [getExactRemainingMs, matchId]);

  const optimisticStartOrResume = useCallback(() => {
    const startMs = getExactRemainingMs();
    if (startMs <= 0) return;
    const perf = nowPerf();
    stopwatchRef.current = {
      ...stopwatchRef.current,
      running: true,
      baseRemainingMs: startMs,
      basePerfMs: perf,
    };
    setRemainingMs(startMs);
    setSnapshot(prev => {
      if (!prev || prev.matchId !== matchId) return prev;
      const nextState =
        prev.timer.kind === 'BREAK'
          ? 'ROUND_BREAK'
          : prev.timer.kind === 'MEDICAL'
            ? prev.state
            : prev.timer.kind === 'GOLDEN_POINT'
              ? 'GOLDEN_POINT'
              : 'IN_PROGRESS';
      return {
        ...prev,
        state: nextState,
        timer: { ...prev.timer, running: true, remainingMs: startMs },
      };
    });
  }, [getExactRemainingMs, matchId]);

  const refresh = useCallback(async () => {
    if (!matchId) return;
    try {
      const startedPerf = nowPerf();
      const fetched = await api<MatchSnapshot>(`/api/v1/matches/${matchId}`);
      const transitMs = Math.min(500, Math.max(0, (nowPerf() - startedPerf) / 2));
      apply(fetched, transitMs);
    } catch (reason) {
      setError(reason as Error);
    }
  }, [apply, matchId]);

  useEffect(() => {
    if (!matchId) return;
    mountedRef.current = true;
    sequenceRef.current = -1;
    stopwatchRef.current = { running: false, kind: 'ROUND', baseRemainingMs: 0, basePerfMs: nowPerf() };
    let retry = 1000;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (!mountedRef.current) return;
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      const params = new URLSearchParams({ matchId });
      if (deviceToken) params.set('token', deviceToken);
      const socket = new WebSocket(`${protocol}://${location.host}/ws?${params}`);
      socketRef.current = socket;
      socket.onopen = () => { retry = 1000; setConnection('ONLINE'); socket.send(JSON.stringify({ type: 'subscribe', matchId })); };
      socket.onmessage = message => {
        try {
          const data = JSON.parse(String(message.data)) as EventEnvelope<MatchSnapshot> | { type: string };
          if (data.type === 'sequence.gap') { socket.send(JSON.stringify({ type: 'request_snapshot' })); return; }
          if ('payload' in data && data.payload && 'matchId' in data.payload) {
            if (sequenceRef.current >= 0 && data.sequence > sequenceRef.current + 1) socket.send(JSON.stringify({ type: 'request_snapshot' }));
            apply(data.payload, 0);
          }
        } catch { /* Ignore malformed packets; authoritative polling remains available. */ }
      };
      socket.onclose = () => {
        if (!mountedRef.current) return;
        setConnection(navigator.onLine ? 'RECONNECTING' : 'OFFLINE');
        reconnectTimer = setTimeout(connect, retry);
        retry = Math.min(retry * 1.8, 15000);
      };
      socket.onerror = () => socket.close();
    };
    connect();
    const initialRefresh = requestAnimationFrame(() => void refresh());
    const poll = setInterval(() => void refresh(), 20000);
    const heartbeat = setInterval(() => {
      if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: 'heartbeat' }));
      if (deviceToken) void api<{ matchId?: string }>('/api/v1/device/heartbeat', { method: 'POST', headers: { Authorization: `Bearer ${deviceToken}` }, body: '{}' }).then(res => {
        if (res?.matchId && res.matchId !== matchId && onSessionMatchChange) onSessionMatchChange(res.matchId);
      }).catch(() => setConnection('RECONNECTING'));
    }, 5000);
    const online = () => { setConnection('RECONNECTING'); void refresh(); };
    const offline = () => setConnection('OFFLINE');
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      mountedRef.current = false;
      cancelAnimationFrame(initialRefresh);
      clearTimeout(reconnectTimer);
      clearInterval(poll);
      clearInterval(heartbeat);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      socketRef.current?.close();
    };
  }, [matchId, deviceToken, apply, refresh, onSessionMatchChange]);

  useEffect(() => {
    if (!snapshot?.timer.running || snapshot.matchId !== matchId) return;
    const timer = setInterval(() => {
      const sw = stopwatchRef.current;
      if (!sw.running) return;
      setRemainingMs(Math.max(0, Math.round(sw.baseRemainingMs - Math.max(0, nowPerf() - sw.basePerfMs))));
    }, 30);
    return () => clearInterval(timer);
  }, [snapshot?.timer.running, snapshot?.matchId, matchId]);

  const visibleSnapshot = snapshot?.matchId === matchId ? snapshot : null;
  return {
    snapshot: visibleSnapshot,
    connection: visibleSnapshot ? connection : ('CONNECTING' as const),
    error,
    remainingMs: visibleSnapshot ? remainingMs : 0,
    refresh,
    applySnapshot: apply,
    getExactRemainingMs,
    optimisticPause,
    optimisticStartOrResume,
  };
}
