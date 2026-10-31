'use client';

import { useEffect, useState } from 'react';
import { Camera, Check, Clock3, Stethoscope, Video, X } from 'lucide-react';
import type { MatchSnapshot, Side } from '@tkd/contracts';
import { cn, formatTime } from '@/lib/utils';

const RESULT_DURATION_MS = 6000;

function cornerLabel(side: Side | null) {
  if (side === 'BLUE') return 'CHUNG · BLUE';
  if (side === 'RED') return 'HONG · RED';
  return 'OFFICIAL REVIEW';
}

function OverlayShell({ children, testId, label }: { children: React.ReactNode; testId: string; label: string }) {
  return <div
    data-testid={testId}
    role="alert"
    aria-label={label}
    className="absolute inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/80 p-[3%] backdrop-blur-sm"
  >
    {children}
  </div>;
}

export function CompetitionStatusOverlay({ snapshot, remainingMs }: { snapshot: MatchSnapshot; remainingMs: number }) {
  const review = snapshot.videoReview;
  const resultKey = review?.decidedAt && review.status !== 'REQUESTED'
    ? `${review.status}:${review.requestedAt}:${review.decidedAt}`
    : null;
  const [dismissedResult, setDismissedResult] = useState<string | null>(null);
  const decidedAt = review?.decidedAt ?? null;
  const serverTime = snapshot.serverTime;

  useEffect(() => {
    if (!resultKey || !decidedAt) return;
    const age = Math.max(0, serverTime - decidedAt);
    if (age >= RESULT_DURATION_MS) return;
    const timeout = setTimeout(() => setDismissedResult(resultKey), RESULT_DURATION_MS - age);
    return () => clearTimeout(timeout);
  }, [decidedAt, resultKey, serverTime]);

  if (snapshot.timer.kind === 'MEDICAL' && !['COMPLETED', 'DISQUALIFIED', 'WALKOVER', 'WITHDRAWN'].includes(snapshot.state)) {
    return <OverlayShell testId="doctor-call-overlay" label="Doctor Call — emergency situation">
      <div className="relative w-full max-w-5xl overflow-hidden rounded-[clamp(1rem,2vw,2rem)] border-[clamp(2px,.35vw,5px)] border-timer bg-[#090b09] px-[6%] py-[5%] text-center shadow-[0_0_80px_rgba(240,255,0,.2)]">
        <div className="mx-auto flex size-[clamp(4rem,9vw,9rem)] items-center justify-center rounded-full bg-timer text-black">
          <Stethoscope className="size-[58%]" strokeWidth={2.4} />
        </div>
        <p className="mt-[3%] text-[clamp(.7rem,1.4vw,1.4rem)] font-black uppercase tracking-[.35em] text-white/65">Doctor Call</p>
        <h2 className="mt-1 text-[clamp(3.2rem,10vw,10rem)] font-black uppercase leading-[.9] tracking-[-.055em] text-timer">Doctor</h2>
        <p className="mt-[3%] text-[clamp(.85rem,2vw,2rem)] font-bold text-white">Emergency situation</p>
        <div className="mx-auto mt-[4%] inline-flex items-center gap-3 rounded-xl bg-timer px-[5%] py-2 text-black">
          <Clock3 className="size-[clamp(1rem,2vw,2rem)]" />
          <span className="numeric text-[clamp(1.5rem,4vw,4rem)] font-black leading-none">{formatTime(remainingMs)}</span>
        </div>
        <p className="mt-3 text-[clamp(.5rem,.8vw,.85rem)] font-bold uppercase tracking-[.2em] text-white/45">Medical timeout · match clock paused</p>
      </div>
    </OverlayShell>;
  }

  if (snapshot.state === 'UNDER_REVIEW') {
    const side = review?.requestedBy ?? null;
    return <OverlayShell testId="ivr-request-overlay" label={`Instant Video Replay requested by ${cornerLabel(side)}`}>
      <div className="w-full max-w-4xl overflow-hidden rounded-[clamp(.8rem,1.5vw,1.5rem)] bg-[#f4f6fa] text-[#111827] shadow-2xl">
        <div className="flex items-center justify-center gap-3 bg-timer px-5 py-[2.5%] text-black">
          <Video className="size-[clamp(1.2rem,2.4vw,2.4rem)]" />
          <p className="text-[clamp(.75rem,1.7vw,1.7rem)] font-black uppercase tracking-[.16em]">Video review</p>
        </div>
        <div className="grid items-center gap-[5%] px-[7%] py-[6%] sm:grid-cols-[auto_1fr] sm:text-left">
          <div className={cn(
            'mx-auto flex aspect-square w-[clamp(6rem,16vw,15rem)] items-center justify-center rounded-[12%] text-white shadow-lg',
            side === 'RED' ? 'bg-red' : side === 'BLUE' ? 'bg-blue' : 'bg-slate-700',
          )}>
            <Camera className="size-[55%]" strokeWidth={1.7} />
          </div>
          <div className="mt-5 text-center sm:mt-0">
            <p className={cn(
              'text-[clamp(.65rem,1.25vw,1.25rem)] font-black uppercase tracking-[.22em]',
              side === 'RED' ? 'text-red' : side === 'BLUE' ? 'text-blue' : 'text-slate-600',
            )}>{cornerLabel(side)}</p>
            <h2 className="mt-2 text-[clamp(1.7rem,4.2vw,4.2rem)] font-black leading-[1.02] tracking-[-.04em]">Instant Video<br className="hidden sm:block" /> Replay</h2>
            <p className="mt-4 text-[clamp(.65rem,1.1vw,1.1rem)] font-semibold text-slate-500">Review in progress · match clock paused</p>
          </div>
        </div>
      </div>
    </OverlayShell>;
  }

  const resultAge = decidedAt ? Math.max(0, serverTime - decidedAt) : RESULT_DURATION_MS;
  if (resultKey && dismissedResult !== resultKey && resultAge < RESULT_DURATION_MS && review) {
    const accepted = review.status === 'ACCEPTED';
    return <OverlayShell testId={accepted ? 'ivr-accepted-overlay' : 'ivr-rejected-overlay'} label={`IVR ${accepted ? 'Accepted' : 'Rejected'}`}>
      <div className="w-full max-w-4xl overflow-hidden rounded-[clamp(.8rem,1.5vw,1.5rem)] bg-[#f4f6fa] text-[#111827] shadow-2xl">
        <div className="bg-[#111827] px-5 py-[2.5%] text-center text-white">
          <p className="text-[clamp(.85rem,2vw,2rem)] font-black tracking-[.06em]">IVR Result</p>
        </div>
        <div className="grid items-center gap-[4%] px-[7%] py-[5%] sm:grid-cols-[auto_1fr]">
          <div className={cn(
            'mx-auto flex aspect-square w-[clamp(6rem,15vw,14rem)] items-center justify-center rounded-full border-[clamp(5px,.8vw,10px)] font-black leading-none',
            accepted ? 'border-success text-success' : 'border-red text-red',
          )} aria-hidden="true">
            <span className="text-[clamp(4rem,10vw,9rem)]">{accepted ? 'O' : 'X'}</span>
          </div>
          <div className="text-center sm:text-left">
            <div className={cn('inline-flex items-center gap-2 text-[clamp(.65rem,1.1vw,1.1rem)] font-black uppercase tracking-[.18em]', accepted ? 'text-success' : 'text-red')}>
              {accepted ? <Check className="size-5" /> : <X className="size-5" />}
              {cornerLabel(review.requestedBy)}
            </div>
            <h2 className={cn('mt-2 text-[clamp(2.4rem,6vw,6rem)] font-black leading-none tracking-[-.045em]', accepted ? 'text-success' : 'text-red')}>
              {accepted ? 'Accepted' : 'Rejected'}
            </h2>
            <p className="mt-4 text-[clamp(.65rem,1.1vw,1.1rem)] font-semibold text-slate-500">Instant Video Replay decision</p>
          </div>
        </div>
      </div>
    </OverlayShell>;
  }

  return null;
}
