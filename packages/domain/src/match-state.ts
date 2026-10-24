import type { MatchState } from '@tkd/contracts';

export const MATCH_TRANSITIONS: Record<MatchState, readonly MatchState[]> = {
  PENDING: ['READY','CANCELLED','WITHDRAWN'],
  READY: ['CALLED','IN_PROGRESS','PENDING','CANCELLED','WALKOVER','WITHDRAWN'],
  CALLED: ['IN_PROGRESS','READY','WALKOVER','WITHDRAWN','CANCELLED'],
  IN_PROGRESS: ['PAUSED','ROUND_BREAK','GOLDEN_POINT','UNDER_REVIEW','COMPLETED','DISQUALIFIED','CANCELLED'],
  PAUSED: ['IN_PROGRESS','ROUND_BREAK','GOLDEN_POINT','UNDER_REVIEW','COMPLETED','DISQUALIFIED','CANCELLED'],
  ROUND_BREAK: ['IN_PROGRESS','PAUSED','COMPLETED','UNDER_REVIEW','CANCELLED'],
  GOLDEN_POINT: ['PAUSED','UNDER_REVIEW','COMPLETED','DISQUALIFIED','CANCELLED'],
  UNDER_REVIEW: ['IN_PROGRESS','PAUSED','ROUND_BREAK','GOLDEN_POINT','COMPLETED','DISQUALIFIED','CANCELLED'],
  COMPLETED: ['UNDER_REVIEW'],
  WALKOVER: ['UNDER_REVIEW'],
  WITHDRAWN: ['UNDER_REVIEW'],
  DISQUALIFIED: ['UNDER_REVIEW'],
  CANCELLED: []
};

export class InvalidTransitionError extends Error {
  constructor(public from: MatchState, public to: MatchState) { super(`Match transition ${from} → ${to} is not permitted.`); this.name = 'InvalidTransitionError'; }
}

export function assertTransition(from: MatchState, to: MatchState): void {
  if (from === to || !MATCH_TRANSITIONS[from].includes(to)) throw new InvalidTransitionError(from, to);
}

export function isTerminalState(state: MatchState): boolean {
  return ['COMPLETED','WALKOVER','WITHDRAWN','DISQUALIFIED','CANCELLED'].includes(state);
}
