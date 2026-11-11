'use client';

import { useState } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import {
  Columns2,
  ExternalLink,
  GitBranch,
  Maximize2,
  MonitorPlay,
  QrCode,
} from 'lucide-react';
import type { Bracket } from '@tkd/domain';
import type { TournamentDetails } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { openPublicTv } from '@/lib/public-tv';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { Loading, ErrorState, EmptyState } from '@/components/ui/states';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  BracketView,
  type BracketEntrant,
  type BracketLayoutMode,
  type BracketNodeMatchInfo,
} from './bracket-view';

interface BracketResponse {
  draw: {
    id: string;
    method: string;
    seed: string;
    status: string;
    publishedVersion: number | null;
    createdAt: string;
  };
  categoryId?: string;
  categoryName: string;
  division?: string;
  ageGroup?: string;
  tournamentId: string;
  tournamentName?: string;
  tournamentVenue?: string;
  bracket: Bracket;
  athletes: BracketEntrant[];
  nodeMatches?: Record<string, BracketNodeMatchInfo>;
}

export function BracketManager({ data }: { data: TournamentDetails }) {
  const available = data.categories.filter((category) =>
    data.draws.some((draw) => draw.category_id === category.id),
  );
  const [categoryId, setCategoryId] = useState(available[0]?.id ?? '');
  const [layoutMode, setLayoutMode] = useState<BracketLayoutMode>('CLASSIC');
  const [qr, setQr] = useState<{ url: string; image: string; title: string } | null>(
    null,
  );

  const { data: response, error, loading, refresh } = useApi<BracketResponse>(
    categoryId ? `/api/v1/categories/${categoryId}/bracket` : null,
  );

  if (!available.length) {
    return (
      <Card>
        <EmptyState
          title="No brackets generated"
          description="Generate a random or seeded draw before opening the bracket view."
          action={
            <Button asChild>
              <Link href={`/tournaments/${data.tournament.id}/draws`}>Open draws</Link>
            </Button>
          }
        />
      </Card>
    );
  }

  const singleTvPath = `/display/bracket/${categoryId}`;
  const allBracketsTvPath = `/display/brackets/${data.tournament.id}`;

  const showTvQr = async (path: string, title: string) => {
    const url = `${window.location.origin}${path}`;
    const image = await QRCode.toDataURL(url, { width: 300, margin: 2 });
    setQr({ url, image, title });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
        <div>
          <h3 className="font-semibold">Tournament brackets</h3>
          <p className="mt-1 text-xs text-muted">
            Explicit match graph, byes, live progression, and full-screen Public TV display
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            className="w-52"
          >
            {available.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              setLayoutMode((prev) => (prev === 'CLASSIC' ? 'SPLIT' : 'CLASSIC'))
            }
            title="Switch between Classic left-to-right tree and Two-Sided Arena Split"
          >
            <Columns2 />
            {layoutMode === 'SPLIT' ? 'Arena Split' : 'Classic View'}
          </Button>

          {categoryId && (
            <>
              <Button asChild size="sm">
                <Link
                  href={singleTvPath}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => {
                    if (openPublicTv(singleTvPath)) event.preventDefault();
                  }}
                >
                  <Maximize2 />
                  Bracket TV
                </Link>
              </Button>

              {available.length > 1 && (
                <Button asChild variant="secondary" size="sm">
                  <Link
                    href={allBracketsTvPath}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => {
                      if (openPublicTv(allBracketsTvPath)) event.preventDefault();
                    }}
                  >
                    <MonitorPlay />
                    All Brackets TV
                  </Link>
                </Button>
              )}

              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label="Bracket TV QR code"
                title="Display QR code for Smart TV or spectators"
                onClick={() =>
                  void showTvQr(
                    singleTvPath,
                    `${response?.categoryName ?? 'Bracket'} Public TV`,
                  )
                }
              >
                <QrCode />
              </Button>

              <Button
                asChild
                variant="secondary"
                size="icon"
                aria-label="Open public bracket page"
                title="Open public web page"
              >
                <Link href={`/public/brackets/${categoryId}`} target="_blank">
                  <ExternalLink />
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>

      {loading && !response ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} retry={refresh} />
      ) : response ? (
        <Card>
          <div className="flex flex-col justify-between gap-3 border-b border-line/60 px-5 py-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <GitBranch className="size-4 text-primary" />
              <span className="text-sm font-semibold">{response.categoryName}</span>
              <Badge tone="blue">{response.bracket.size} slots</Badge>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted">
              <Badge tone={response.draw.status === 'PUBLISHED' ? 'green' : 'yellow'}>
                {response.draw.status}
              </Badge>
              <span>{response.draw.method}</span>
              <span>Seed {response.draw.seed.slice(0, 10)}…</span>
            </div>
          </div>
          <BracketView
            bracket={response.bracket}
            entrants={response.athletes}
            nodeMatches={response.nodeMatches}
            layoutMode={layoutMode}
          />
        </Card>
      ) : null}

      <Dialog open={Boolean(qr)} onOpenChange={() => setQr(null)}>
        <DialogContent
          title={qr?.title ?? 'Public Bracket TV'}
          description="Open this read-only URL on any Smart TV, HDMI display PC, or tablet. It scales the full bracket automatically and updates live."
        >
          <div className="text-center">
            {qr && (
              <img
                src={qr.image}
                alt="Bracket TV QR code"
                className="mx-auto max-w-64 rounded-xl bg-white p-2"
              />
            )}
            <p className="mt-4 break-all text-xs text-muted">{qr?.url}</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export type { BracketResponse };
