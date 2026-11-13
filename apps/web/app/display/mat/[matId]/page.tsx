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
  // screen stays visible until the next match actually starts or the Operator toggles TV Waiting.
  const [pinnedMatchId, setPinnedMatchId] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => void refresh(), ASSIGNMENT_POLL_MS);
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('tkd-mat-display');
      channel.onmessage = (event: MessageEvent<{ matId?: string; matchId?: string; publicWaiting?: boolean }>) => {
        if (!event.data?.matId || event.data.matId === matId) {
          if (event.data?.publicWaiting && event.data.matchId && event.data.matchId !== pinnedMatchId) {
            setPinnedMatchId(null);
          }
          void refresh();
        }
      };
    }
    return () => {
      clearInterval(interval);
      channel?.close();
    };
  }, [matId, pinnedMatchId, refresh]);

  const activeStartedMatchId = data && !UNSTARTED_STATES.has(data.state) ? data.matchId : null;
  const queuedForceWaiting = Boolean(data && UNSTARTED_STATES.has(data.state) && data.publicWaiting);

  const heldMatchId =
    activeStartedMatchId ??
    (!queuedForceWaiting && pinnedMatchId ? pinnedMatchId : null);

  const handleLiveOrResolved = useCallback((liveMatchId: string) => {
    setPinnedMatchId((current) => (current === liveMatchId ? current : liveMatchId));
  }, []);

  if (heldMatchId) {
    return (
      <PublicDisplay
        key={heldMatchId}
        matchId={heldMatchId}
        queuedSnapshot={data && data.matchId !== heldMatchId ? data : null}
        onLiveOrResolved={handleLiveOrResolved}
      />
    );
  }

  if (loading && !data && !error) return <Loading label="Finding active mat assignment…" />;
  if (error instanceof ApiRequestError && error.code === 'NO_ACTIVE_MATCH') {
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
    />
  ) : null;
}
