'use client';

import { useParams } from 'next/navigation';
import { ClubPodiumTv } from '@/features/tournaments/podium-tv';

export default function ClubPodiumTvPage() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  return <ClubPodiumTv tournamentId={tournamentId} />;
}
