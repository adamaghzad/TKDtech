'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, GitBranch, Maximize2 } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { openPublicTv } from '@/lib/public-tv';
import type { BracketResponse } from '@/features/tournaments/bracket-manager';
import { BracketView } from '@/features/tournaments/bracket-view';
import { Loading, ErrorState } from '@/components/ui/states';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export default function PublicBracket() {
  const { categoryId } = useParams<{ categoryId: string }>();
  const { data, error, loading, refresh } = useApi<BracketResponse>(
    `/api/v1/categories/${categoryId}/bracket`,
  );

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} retry={refresh} />;
  if (!data) return null;

  const tvPath = `/display/bracket/${categoryId}`;

  return (
    <main className="mx-auto max-w-[1600px] space-y-5 p-6 sm:p-10">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/public/tournaments/${data.tournamentId}`}>
          <ArrowLeft />
          Tournament
        </Link>
      </Button>

      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">
            Published draw
          </p>
          <h1 className="mt-1 text-3xl font-black">{data.categoryName}</h1>
          <p className="mt-2 text-xs text-muted">
            {data.draw.method} · Bracket size {data.bracket.size} · Version{' '}
            {data.draw.publishedVersion ?? 'Draft'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge tone={data.draw.status === 'PUBLISHED' ? 'green' : 'yellow'}>
            {data.draw.status}
          </Badge>
          <Button asChild size="sm">
            <Link
              href={tvPath}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                if (openPublicTv(tvPath)) event.preventDefault();
              }}
            >
              <Maximize2 />
              Full TV Display
            </Link>
          </Button>
        </div>
      </div>

      <Card>
        <div className="flex items-center gap-2 border-b border-line/60 p-4">
          <GitBranch className="size-4 text-primary" />
          <p className="text-xs text-muted">
            Byes advance without counting as scored victories. Published snapshots are
            immutable.
          </p>
        </div>
        <BracketView
          bracket={data.bracket}
          entrants={data.athletes}
          nodeMatches={data.nodeMatches}
        />
      </Card>
    </main>
  );
}
