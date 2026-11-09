'use client';
import { useEffect, useRef } from 'react';
import { useMatch } from './use-match';
import { getSupabaseBrowserClient, isCloudConfigured } from './supabase/client';
import { subscribeCloudMatch, CloudRealtimeHandlers } from './supabase/cloud-realtime';

export function useMatchCloud(matchId?: string, deviceToken?: string) {
  const result = useMatch(matchId, deviceToken);
  const cloudRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!matchId || !isCloudConfigured()) return;

    let client: ReturnType<typeof getSupabaseBrowserClient>;
    try {
      client = getSupabaseBrowserClient();
    } catch {
      return;
    }

    const handlers: CloudRealtimeHandlers = {
      onInvalidated: (sequence: number) => {
        void result.refresh();
      },
      onGap: () => {
        void result.refresh();
      },
      onStatus: (_status: string) => {
        // Connection status changes handled by local WebSocket
      },
    };

    cloudRef.current = subscribeCloudMatch(
      client,
      matchId,
      result.snapshot?.sequence ?? 0,
      handlers,
    );

    return () => {
      cloudRef.current?.();
      cloudRef.current = null;
    };
  }, [matchId, result.refresh, result.snapshot?.sequence, isCloudConfigured()]);

  return {
    ...result,
    cloudConfigured: isCloudConfigured(),
  };
}
