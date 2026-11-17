'use client';

import { useParams } from 'next/navigation';
import { PodiumTv } from '@/features/tournaments/podium-tv';

export default function CategoryPodiumTvPage() {
  const { categoryId } = useParams<{ categoryId: string }>();
  return <PodiumTv categoryId={categoryId} />;
}
