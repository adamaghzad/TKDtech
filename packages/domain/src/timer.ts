import type { TimerState } from '@tkd/contracts';

export function remainingAt(timer: TimerState, now: number): number {
  if (!timer.running) return Math.max(0, timer.remainingMs);
  return Math.max(0, timer.remainingMs - Math.max(0, now - timer.authoritativeAt));
}

export function startTimer(timer: TimerState, now: number): TimerState {
  if (timer.running || timer.remainingMs <= 0) return { ...timer, authoritativeAt: now };
  return { ...timer, running: true, authoritativeAt: now };
}

export function pauseTimer(timer: TimerState, now: number): TimerState {
  return { ...timer, remainingMs: remainingAt(timer, now), running: false, authoritativeAt: now };
}

export function resetTimer(timer: TimerState, durationMs: number, now: number): TimerState {
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('Timer duration must be positive.');
  return { ...timer, remainingMs: Math.floor(durationMs), running: false, authoritativeAt: now };
}

export function reconcileTimer(persisted: TimerState, now: number): { timer: TimerState; expired: boolean; uncertain: boolean } {
  const remainingMs = remainingAt(persisted, now);
  const expired = persisted.running && remainingMs === 0;
  // A running timer recovered by a process is paused explicitly. The operator must confirm resume.
  return {
    timer: { ...persisted, remainingMs, running: false, authoritativeAt: now },
    expired,
    uncertain: persisted.running
  };
}
