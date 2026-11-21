import type { MatchSnapshot } from '@tkd/contracts';

/** Shared between the landscape scoreboard and the compact portrait scoreboard. */
export function stateLabel(snapshot: MatchSnapshot, remainingMs: number): string {
  if (snapshot.state === 'UNDER_REVIEW') return 'VIDEO REVIEW';
  if (snapshot.timer.kind === 'MEDICAL') return 'DOCTOR CALL';
  if (snapshot.timer.kind === 'BREAK') {
    if (snapshot.currentRound > snapshot.totalRounds) return 'GOLDEN POINT REST';
    if (snapshot.timer.holdReason === 'SUPERIORITY') return 'AWAITING SUPERIORITY';
    if (!snapshot.timer.running && remainingMs <= 0) return 'REST ENDED';
    if (!snapshot.timer.running) return 'REST PAUSED';
    return 'REST TIME';
  }
  if (snapshot.state === 'PAUSED') return 'TIME OUT';
  if (snapshot.state === 'IN_PROGRESS') return 'ROUND';
  if (snapshot.state === 'COMPLETED') return 'MATCH OVER';
  return snapshot.state.replaceAll('_', ' ');
}
