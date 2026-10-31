'use client';

import { useState } from 'react';
import { Check, Video, X } from 'lucide-react';
import type { MatchSnapshot, Side } from '@tkd/contracts';
import type { MatchCommand, ReviewCorrectionKind, ReviewOutcome } from '../../../local-server/src/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface VideoReviewManagerProps {
  snapshot: MatchSnapshot;
  pending: boolean;
  onCommand: (command: MatchCommand) => Promise<void>;
}

function ChoiceButton({ selected, children, onClick, disabled, className, label }: {
  selected: boolean;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  label?: string;
}) {
  return <button
    type="button"
    aria-label={label}
    aria-pressed={selected}
    disabled={disabled}
    onClick={onClick}
    className={cn(
      'min-h-10 rounded-lg border px-3 py-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-35',
      selected ? 'border-primary bg-primary text-white shadow-sm' : 'border-line bg-background text-foreground hover:border-primary/50 hover:bg-primary/5',
      className,
    )}
  >{children}</button>;
}

function ReviewResultForm({ snapshot, pending, onCommand, onClose }: VideoReviewManagerProps & { onClose: () => void }) {
  const review = snapshot.videoReview;
  const [athlete, setAthlete] = useState<Side>(review?.requestedBy ?? 'BLUE');
  const [correction, setCorrection] = useState<ReviewCorrectionKind>('GAM_JEOM');
  const [points, setPoints] = useState<1 | 2 | 3 | 4>(1);
  const [action, setAction] = useState<'ADD' | 'REMOVE'>('ADD');
  const [outcome, setOutcome] = useState<ReviewOutcome>('ACCEPTED');
  const accepted = outcome === 'ACCEPTED';

  const apply = async () => {
    await onCommand({
      type: 'END_REVIEW',
      side: athlete,
      outcome,
      reviewAction: accepted ? action : undefined,
      reviewCorrection: accepted ? correction : undefined,
      reviewPoints: accepted && correction === 'POINTS' ? points : undefined,
      reason: accepted
        ? `IVR accepted; ${action.toLowerCase()} ${correction === 'GAM_JEOM' ? 'Gam-Jeom' : `${points} point${points === 1 ? '' : 's'}`} for ${athlete}`
        : `IVR rejected; no score correction for ${review?.requestedBy ?? 'the requesting corner'}`,
    });
  };

  return <div className="rounded-xl border border-line/70 bg-background/60 p-3 sm:p-4" data-testid="video-review-manager">
    <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
      <div>
        <p className="text-sm font-black">Managing Video Replay Result</p>
        <p className="mt-1 text-[10px] text-muted">
          Requested by {review?.requestedBy ?? 'official review'} · select a result, then Apply
        </p>
      </div>
      <span className={cn('rounded-full px-3 py-1 text-[10px] font-black', review?.requestedBy === 'RED' ? 'bg-red/15 text-[#ff8b96]' : 'bg-blue/15 text-[#8baeff]')}>
        {review?.requestedBy === 'RED' ? 'HONG / RED' : review?.requestedBy === 'BLUE' ? 'CHUNG / BLUE' : 'OFFICIAL REVIEW'}
      </span>
    </div>

    <fieldset disabled={pending || !accepted} className="mt-4 space-y-4 disabled:opacity-45">
      <div>
        <p className="mb-2 text-[10px] font-black uppercase tracking-[.14em] text-muted">Player · correction recipient</p>
        <div className="grid grid-cols-2 gap-2">
          <ChoiceButton selected={athlete === 'BLUE'} onClick={() => setAthlete('BLUE')} className={athlete === 'BLUE' ? 'border-blue bg-blue' : ''}>Blue · {snapshot.blue.name}</ChoiceButton>
          <ChoiceButton selected={athlete === 'RED'} onClick={() => setAthlete('RED')} className={athlete === 'RED' ? 'border-red bg-red' : ''}>Red · {snapshot.red.name}</ChoiceButton>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-[.14em] text-muted">Points</p>
          <div className="grid grid-cols-5 gap-1.5">
            <ChoiceButton selected={correction === 'GAM_JEOM'} onClick={() => setCorrection('GAM_JEOM')} label="Gam-Jeom">Gam-<br />Jeom</ChoiceButton>
            {([1, 2, 3, 4] as const).map(value => <ChoiceButton key={value} selected={correction === 'POINTS' && points === value} onClick={() => { setCorrection('POINTS'); setPoints(value); }}>{value}</ChoiceButton>)}
          </div>
        </div>
        <div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-[.14em] text-muted">Action</p>
          <div className="grid grid-cols-2 gap-1.5">
            <ChoiceButton selected={action === 'ADD'} onClick={() => setAction('ADD')}>Add</ChoiceButton>
            <ChoiceButton selected={action === 'REMOVE'} onClick={() => setAction('REMOVE')}>Remove</ChoiceButton>
          </div>
        </div>
      </div>
    </fieldset>

    <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
      <div>
        <p className="mb-2 text-[10px] font-black uppercase tracking-[.14em] text-muted">Result</p>
        <div className="grid grid-cols-2 gap-2">
          <ChoiceButton selected={accepted} disabled={pending} onClick={() => setOutcome('ACCEPTED')} className={accepted ? 'border-success bg-success text-black' : ''}><Check className="mr-1 inline size-4" />Accept</ChoiceButton>
          <ChoiceButton selected={!accepted} disabled={pending} onClick={() => setOutcome('REJECTED')} className={!accepted ? 'border-red bg-red' : ''}><X className="mr-1 inline size-4" />Reject</ChoiceButton>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:min-w-44">
        <Button variant="secondary" disabled={pending} onClick={onClose}>Close</Button>
        <Button variant={accepted ? 'success' : 'danger'} disabled={pending} onClick={() => void apply()}>Apply</Button>
      </div>
    </div>
    <p className="mt-3 text-[10px] leading-5 text-muted">
      {accepted
        ? correction === 'GAM_JEOM'
          ? `Apply will ${action.toLowerCase()} one Gam-Jeom for ${athlete}; the opponent’s points are adjusted by the configured ruleset.`
          : `Apply will ${action.toLowerCase()} ${points} point${points === 1 ? '' : 's'} for ${athlete} in the current round.`
        : 'Reject records the IVR result without changing points or Gam-Jeom.'}
      {' '}Close only hides this panel; it does not end the review.
    </p>
  </div>;
}

export function VideoReviewManager(props: VideoReviewManagerProps) {
  const { snapshot, pending, onCommand } = props;
  const reviewKey = snapshot.videoReview ? `${snapshot.videoReview.requestedAt}:${snapshot.videoReview.requestedBy}` : null;
  const [closedKey, setClosedKey] = useState<string | null>(null);
  const available = ['IN_PROGRESS', 'PAUSED', 'GOLDEN_POINT', 'ROUND_BREAK'].includes(snapshot.state);

  if (snapshot.state === 'UNDER_REVIEW' && reviewKey) {
    if (closedKey === reviewKey) {
      return <div className="rounded-xl border border-timer/30 bg-timer/5 p-4 text-center">
        <p className="text-xs font-bold text-timer">Video review is still open</p>
        <p className="mt-1 text-[10px] text-muted">The public request display remains visible. Reopen the manager to record the result.</p>
        <Button className="mt-3" variant="secondary" disabled={pending} onClick={() => setClosedKey(null)}><Video />Manage review</Button>
      </div>;
    }
    return <ReviewResultForm key={reviewKey} {...props} onClose={() => setClosedKey(reviewKey)} />;
  }

  return <div className="rounded-xl border border-line/70 bg-background/60 p-3 sm:p-4">
    <div className="flex items-center gap-2">
      <Video className="size-4 text-primary" />
      <div>
        <p className="text-xs font-black">Instant Video Replay request</p>
        <p className="mt-1 text-[10px] text-muted">Select the corner requesting review. The authoritative timer pauses immediately.</p>
      </div>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2">
      <Button variant="secondary" className="border-blue/40 bg-blue/10 text-[#8baeff] hover:bg-blue/20" disabled={pending || !available} onClick={() => void onCommand({ type: 'VIDEO_REVIEW', side: 'BLUE' })}><Video />Chung · Blue</Button>
      <Button variant="secondary" className="border-red/40 bg-red/10 text-[#ff8b96] hover:bg-red/20" disabled={pending || !available} onClick={() => void onCommand({ type: 'VIDEO_REVIEW', side: 'RED' })}><Video />Hong · Red</Button>
    </div>
  </div>;
}
