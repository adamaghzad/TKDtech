'use client';

import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Loading } from '@/components/ui/states';
import { PublicBracketTv } from '@/features/tournaments/public-bracket-tv';

function TournamentBracketsTvInner() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const searchParams = useSearchParams();
  const initialCategoryId = searchParams.get('category');

  return (
    <PublicBracketTv
      tournamentId={tournamentId}
      initialCategoryId={initialCategoryId}
    />
  );
}

export default function TournamentBracketsTvPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-screen items-center justify-center bg-[#050811] text-white">
          <Loading label="Loading Public TV Brackets…" />
        </div>
      }
    >
      <TournamentBracketsTvInner />
    </Suspense>
  );
}
