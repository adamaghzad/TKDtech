'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { MatchSnapshot } from '@tkd/contracts';
import { ApiRequestError } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { PublicDisplay } from '@/features/scoreboard/public-display';
import { ErrorState, Loading } from '@/components/ui/states';
import { WaitingView } from '@/features/scoreboard/waiting-view';

const ASSIGNMENT_POLL_MS = 1_000;
const UNSTARTED_STATES = new Set(['PENDING', 'READY', 'CALLED']);

export default function MatDisplay() {
  const { matId } = useParams<{ matId: string }>();
  const { data, error, loading, refresh } = useApi<MatchSnapshot>(`/api/v1/mats/${matId}/active-match`);
  // Holds the most recent started/completed match on this mat so the official MATCH RESULT
  // screen stays visible until the next match actually starts (or the operator presses W).
  const [pinnedMatchId, setPinnedMatchId] = useState<string | null>(null);
  const [releasedMatchId, setReleasedMatchId] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => void refresh(), ASSIGNMENT_POLL_MS);
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('tkd-mat-display');
      channel.onmessage = (event: MessageEvent<{ matId?: string }>) => {
        if (!event.data?.matId || event.data.matId === matId) void refresh();
      };
    }
    return () => {
      clearInterval(interval);
      channel?.close();
    };
  }, [matId, refresh]);

  const activeStartedMatchId =
    data && !UNSTARTED_STATES.has(data.state) && data.matchId !== releasedMatchId ? data.matchId : null;

  const heldMatchId =
    activeStartedMatchId ??
    (pinnedMatchId && pinnedMatchId !== releasedMatchId ? pinnedMatchId : null);

  const handleLiveOrResolved = useCallback((liveMatchId: string) => {
    setPinnedMatchId((current) => {
      if (current === liveMatchId) return current;
      return liveMatchId;
    });
  }, []);

  const handleReleaseResult = useCallback(() => {
    if (heldMatchId) {
      setReleasedMatchId(heldMatchId);
      setPinnedMatchId(null);
      void refresh();
    }
  }, [heldMatchId, refresh]);

  if (heldMatchId) {
    return (
      <PublicDisplay
        key={heldMatchId}
        matchId={heldMatchId}
        onLiveOrResolved={handleLiveOrResolved}
        onReleaseResult={handleReleaseResult}
      />
    );
  }

  if (loading && !data && !error) return <Loading label="Finding active mat assignment…" />;
  if (
    (error instanceof ApiRequestError && error.code === 'NO_ACTIVE_MATCH') ||
    (data && data.matchId === releasedMatchId)
  ) {
    return (
      <div className="h-[100dvh]">
        <WaitingView />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <ErrorState error={error} retry={refresh} />
      </div>
    );
  }
  return data ? (
    <PublicDisplay
      key={data.matchId}
      matchId={data.matchId}
      onLiveOrResolved={handleLiveOrResolved}
      onReleaseResult={handleReleaseResult}
    />
  ) : null;
}
