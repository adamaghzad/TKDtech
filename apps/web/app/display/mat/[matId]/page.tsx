'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import type { MatchSnapshot } from '@tkd/contracts';
import { ApiRequestError } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { PublicDisplay } from '@/features/scoreboard/public-display';
import { EmptyState, ErrorState, Loading } from '@/components/ui/states';

const ASSIGNMENT_POLL_MS = 3_000;

export default function MatDisplay() {
  const { matId } = useParams<{ matId: string }>();
  const { data, error, loading, refresh } = useApi<MatchSnapshot>(`/api/v1/mats/${matId}/active-match`);

  useEffect(() => {
    const interval = setInterval(() => void refresh(), ASSIGNMENT_POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  if (loading && !data && !error) return <Loading label="Finding active mat assignment…" />;
  if (error instanceof ApiRequestError && error.code === 'NO_ACTIVE_MATCH') {
    return <div className="flex min-h-screen items-center justify-center bg-black"><EmptyState title="Mat available" description="No active match is assigned. This display checks for the next queued match automatically." /></div>;
  }
  if (error) return <div className="flex min-h-screen items-center justify-center bg-black"><ErrorState error={error} retry={refresh} /></div>;
  return data ? <PublicDisplay key={data.matchId} matchId={data.matchId} /> : null;
}
