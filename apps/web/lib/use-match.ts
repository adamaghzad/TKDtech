'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventEnvelope, MatchSnapshot } from '@tkd/contracts';
import { api } from './api';

export type ConnectionState = 'CONNECTING' | 'ONLINE' | 'RECONNECTING' | 'OFFLINE';

export function useMatch(matchId?: string, deviceToken?: string) {
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('CONNECTING');
  const [error, setError] = useState<Error | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const sequenceRef = useRef(-1);
  const receivedAtRef = useRef(0);
  const mountedRef = useRef(true);

  const apply = useCallback((next: MatchSnapshot) => {
    if (next.matchId !== matchId || next.sequence < sequenceRef.current) return;
    sequenceRef.current = next.sequence;
    receivedAtRef.current = Date.now();
    setSnapshot(next);
    setRemainingMs(next.timer.remainingMs);
    setError(null);
  }, [matchId]);

  const refresh = useCallback(async () => {
    if (!matchId) return;
    try { apply(await api<MatchSnapshot>(`/api/v1/matches/${matchId}`)); }
    catch (reason) { setError(reason as Error); }
  }, [apply, matchId]);

  useEffect(() => {
    if (!matchId) return;
    mountedRef.current = true;
    sequenceRef.current = -1;
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
            apply(data.payload);
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
      if (deviceToken) void api('/api/v1/device/heartbeat', { method: 'POST', headers: { Authorization: `Bearer ${deviceToken}` }, body: '{}' }).catch(() => setConnection('RECONNECTING'));
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
  }, [matchId, deviceToken, apply, refresh]);

  useEffect(() => {
    if (!snapshot?.timer.running || snapshot.matchId !== matchId) return;
    const timer = setInterval(() => {
      setRemainingMs(Math.max(0, snapshot.timer.remainingMs - (Date.now() - receivedAtRef.current)));
    }, 100);
    return () => clearInterval(timer);
  }, [snapshot, matchId]);

  const visibleSnapshot = snapshot?.matchId === matchId ? snapshot : null;
  return { snapshot: visibleSnapshot, connection: visibleSnapshot ? connection : 'CONNECTING' as const, error, remainingMs: visibleSnapshot ? remainingMs : 0, refresh };
}
