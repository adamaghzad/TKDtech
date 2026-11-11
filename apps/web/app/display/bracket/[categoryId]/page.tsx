'use client';

import { useParams } from 'next/navigation';
import { PublicBracketTv } from '@/features/tournaments/public-bracket-tv';

export default function CategoryBracketTvPage() {
  const { categoryId } = useParams<{ categoryId: string }>();
  return <PublicBracketTv categoryId={categoryId} />;
}
