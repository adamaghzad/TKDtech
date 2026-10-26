import { describe, expect, it } from 'vitest';
import type { PointType, Side } from '@tkd/contracts';
import { buildScoringActivity, type PunchProposalRecord, type ScoringEventRecord } from '../../apps/local-server/src/domain/scoring-activity';

let nextEvent = 0;
function score(pointType: PointType, options: { side?: Side; roundId?: string; accepted?: boolean; decisionId?: string } = {}): ScoringEventRecord {
  nextEvent += 1;
  return {
    eventId: `score-${nextEvent}`,
    eventType: options.accepted ? 'score.accepted' : 'score.manual',
    payload: {
      side: options.side ?? 'BLUE',
      pointType,
      roundId: options.roundId ?? 'round-1',
      points: pointType === 'BODY_PUNCH' ? 1 : 3,
      ...(options.decisionId ? { decisionId: options.decisionId, consensusThreshold: 2 } : {})
    }
  };
}
function correction(targetEventId: string): ScoringEventRecord {
  nextEvent += 1;
  return { eventId: `correction-${nextEvent}`, eventType: 'score.correction', payload: { targetEventId } };
}
function proposal(side: Side, judgeRole: 'J1'|'J2'|'J3', status: string, submittedAt: number, decisionId: string | null = null): PunchProposalRecord {
  return { side, judgeRole, status, submittedAt, decisionId };
}
function build(events: ScoringEventRecord[] = [], punchProposals: PunchProposalRecord[] = [], now = 10_000) {
  return buildScoringActivity({ round: 1, roundId: 'round-1', events, punchProposals, now, consensusWindowMs: 1_000, consensusThreshold: 2, punchPoints: 1 });
}

describe('scoreboard scoring activity', () => {
  it('counts effective current-round head and body kick records separately', () => {
    const corrected = score('HEAD_KICK');
    const activity = build([
      corrected,
      score('TURNING_HEAD_KICK'),
      score('BODY_KICK'),
      score('TURNING_BODY_KICK', { side: 'RED' }),
      score('BODY_PUNCH'),
      score('HEAD_KICK', { roundId: 'round-2' }),
      correction(corrected.eventId)
    ]);
    expect(activity.blue).toMatchObject({ headHits: 1, bodyHits: 1, punch: null });
    expect(activity.red).toMatchObject({ headHits: 0, bodyHits: 1, punch: null });
  });

  it('shows a pending punch with only the judges whose inputs are registered', () => {
    const activity = build([], [proposal('BLUE', 'J2', 'PENDING', 9_500)]);
    expect(activity.blue.headHits).toBe(0);
    expect(activity.blue.bodyHits).toBe(0);
    expect(activity.blue.punch).toEqual({ status: 'PENDING', confirmedJudges: ['J2'], requiredConfirmations: 2, points: 1 });
    expect(activity.red.punch).toBeNull();
  });

  it('shows accepted punch consensus and removes a corrected punch', () => {
    const accepted = score('BODY_PUNCH', { accepted: true, decisionId: 'decision-1' });
    const proposals = [proposal('BLUE', 'J1', 'ACCEPTED', 9_400, 'decision-1'), proposal('BLUE', 'J2', 'ACCEPTED', 9_500, 'decision-1')];
    expect(build([accepted], proposals).blue.punch).toEqual({ status: 'CONFIRMED', confirmedJudges: ['J1', 'J2'], requiredConfirmations: 2, points: 1 });
    expect(build([accepted, correction(accepted.eventId)], proposals).blue.punch).toBeNull();
  });

  it('uses the recorded one-judge acceptance threshold', () => {
    const accepted = score('BODY_PUNCH', { side: 'RED', accepted: true, decisionId: 'decision-one' });
    accepted.payload.consensusThreshold = 1;
    const activity = build([accepted], [proposal('RED', 'J3', 'ACCEPTED', 9_500, 'decision-one')]);
    expect(activity.red.punch).toEqual({ status: 'CONFIRMED', confirmedJudges: ['J3'], requiredConfirmations: 1, points: 1 });
  });

  it('shows a newer pending attempt and ignores expired or rejected proposals', () => {
    const accepted = score('BODY_PUNCH', { accepted: true, decisionId: 'decision-1' });
    const confirmed = [proposal('BLUE', 'J1', 'ACCEPTED', 8_000, 'decision-1'), proposal('BLUE', 'J2', 'ACCEPTED', 8_100, 'decision-1')];
    const pending = proposal('BLUE', 'J3', 'PENDING', 9_500);
    expect(build([accepted], [...confirmed, pending]).blue.punch).toMatchObject({ status: 'PENDING', confirmedJudges: ['J3'] });
    expect(build([accepted], [...confirmed, { ...pending, submittedAt: 8_500 }]).blue.punch).toMatchObject({ status: 'CONFIRMED', confirmedJudges: ['J1', 'J2'] });
    expect(build([], [{ ...pending, status: 'REJECTED' }]).blue.punch).toBeNull();
  });
});
