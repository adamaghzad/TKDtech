import type { CornerJudgeRole, MatchScoringActivity, PointType, Side, SideScoringActivity } from '@tkd/contracts';

export interface ScoringEventRecord {
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface PunchProposalRecord {
  side: Side;
  status: string;
  decisionId: string | null;
  judgeRole: CornerJudgeRole;
  submittedAt: number;
}

const judgeOrder: CornerJudgeRole[] = ['J1', 'J2', 'J3'];
const headPointTypes = new Set<PointType>(['HEAD_KICK', 'TURNING_HEAD_KICK']);
const bodyPointTypes = new Set<PointType>(['BODY_KICK', 'TURNING_BODY_KICK']);

function isSide(value: unknown): value is Side { return value === 'BLUE' || value === 'RED'; }
function isPointType(value: unknown): value is PointType {
  return typeof value === 'string' && ['BODY_PUNCH', 'BODY_KICK', 'HEAD_KICK', 'TURNING_BODY_KICK', 'TURNING_HEAD_KICK'].includes(value);
}
function activitySide(): SideScoringActivity { return { headHits: 0, bodyHits: 0, punches: [] }; }
function rolesFor(proposals: PunchProposalRecord[]): CornerJudgeRole[] {
  const roles = new Set(proposals.map(proposal => proposal.judgeRole));
  return judgeOrder.filter(role => roles.has(role));
}

/**
 * Builds display-only activity from effective scoring records. It does not score the match
 * and does not represent protector/PSS input. Punches stay separate from head/body kick hits.
 * Every effective judge punch remains visible for the current round with its own judge confirmations.
 * Expired/rejected pending attempts and corrected accepted punches remove only their own entries.
 */
export function buildScoringActivity(input: {
  round: number;
  roundId: string;
  events: ScoringEventRecord[];
  punchProposals: PunchProposalRecord[];
  now: number;
  consensusWindowMs: number;
  consensusThreshold: number;
  punchPoints: number;
}): MatchScoringActivity {
  const blue = activitySide();
  const red = activitySide();
  const correctedEventIds = new Set<string>();
  for (const event of input.events) {
    if (event.eventType === 'score.correction' && typeof event.payload.targetEventId === 'string') correctedEventIds.add(event.payload.targetEventId);
  }

  const acceptedPunches = new Map<string, { event: ScoringEventRecord; side: Side }>();
  for (const event of input.events) {
    if (correctedEventIds.has(event.eventId) || event.payload.roundId !== input.roundId) continue;
    if (event.eventType !== 'score.manual' && event.eventType !== 'score.accepted') continue;
    const side = event.payload.side;
    const pointType = event.payload.pointType;
    if (!isSide(side) || !isPointType(pointType)) continue;
    const target = side === 'BLUE' ? blue : red;
    if (headPointTypes.has(pointType)) target.headHits += 1;
    if (bodyPointTypes.has(pointType)) target.bodyHits += 1;
    if (event.eventType === 'score.accepted' && pointType === 'BODY_PUNCH' && typeof event.payload.decisionId === 'string') {
      acceptedPunches.set(event.payload.decisionId, { event, side });
    }
  }

  for (const [decisionId, accepted] of acceptedPunches) {
    const proposals = input.punchProposals.filter(proposal => proposal.decisionId === decisionId && proposal.status === 'ACCEPTED');
    if (!proposals.length) continue;
    const payload = accepted.event.payload;
    const target = accepted.side === 'BLUE' ? blue : red;
    target.punches.push({
      status: 'CONFIRMED',
      confirmedJudges: rolesFor(proposals),
      requiredConfirmations: typeof payload.consensusThreshold === 'number' ? payload.consensusThreshold : proposals.length,
      points: typeof payload.points === 'number' ? payload.points : input.punchPoints
    });
  }

  for (const side of ['BLUE', 'RED'] as const) {
    const pending = input.punchProposals.filter(proposal => proposal.side === side && proposal.status === 'PENDING' && proposal.submittedAt <= input.now && input.now - proposal.submittedAt <= input.consensusWindowMs);
    if (!pending.length) continue;
    const target = side === 'BLUE' ? blue : red;
    target.punches.push({
      status: 'PENDING',
      confirmedJudges: rolesFor(pending),
      requiredConfirmations: Math.min(input.consensusThreshold, 2),
      points: input.punchPoints
    });
  }

  return { round: input.round, blue, red };
}
