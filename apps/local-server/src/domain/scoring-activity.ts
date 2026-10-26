import type { CornerJudgeRole, MatchScoringActivity, PointType, PunchConfirmationSnapshot, Side } from '@tkd/contracts';

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

interface PunchCandidate extends PunchConfirmationSnapshot {
  submittedAt: number;
}

const judgeOrder: CornerJudgeRole[] = ['J1', 'J2', 'J3'];
const headPointTypes = new Set<PointType>(['HEAD_KICK', 'TURNING_HEAD_KICK']);
const bodyPointTypes = new Set<PointType>(['BODY_KICK', 'TURNING_BODY_KICK']);

function isSide(value: unknown): value is Side { return value === 'BLUE' || value === 'RED'; }
function isPointType(value: unknown): value is PointType {
  return typeof value === 'string' && ['BODY_PUNCH', 'BODY_KICK', 'HEAD_KICK', 'TURNING_BODY_KICK', 'TURNING_HEAD_KICK'].includes(value);
}
function activitySide(punch: PunchConfirmationSnapshot | null = null) { return { headHits: 0, bodyHits: 0, punch }; }
function rolesFor(proposals: PunchProposalRecord[]): CornerJudgeRole[] {
  const roles = new Set(proposals.map(proposal => proposal.judgeRole));
  return judgeOrder.filter(role => roles.has(role));
}

/**
 * Builds display-only activity from effective scoring records. It does not score the match
 * and does not represent protector/PSS input. Punches stay separate from head/body kick hits.
 * Only the latest punch attempt is displayed; expired/rejected attempts never restore an older one.
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

  const latestPunch = (side: Side) => {
    const proposals = input.punchProposals.filter(proposal => proposal.side === side);
    if (!proposals.length) return null;
    const submittedAt = Math.max(...proposals.map(proposal => proposal.submittedAt));
    const latest = proposals.filter(proposal => proposal.submittedAt === submittedAt);
    return {
      submittedAt,
      acceptedDecisionIds: new Set(latest.filter(proposal => proposal.status === 'ACCEPTED' && proposal.decisionId).map(proposal => proposal.decisionId as string)),
      hasActivePending: latest.some(proposal => proposal.status === 'PENDING' && proposal.submittedAt <= input.now && input.now - proposal.submittedAt <= input.consensusWindowMs)
    };
  };

  for (const [decisionId, accepted] of acceptedPunches) {
    const proposals = input.punchProposals.filter(proposal => proposal.decisionId === decisionId && proposal.status === 'ACCEPTED');
    if (!proposals.length) continue;
    const payload = accepted.event.payload;
    const candidate: PunchCandidate = {
      status: 'CONFIRMED',
      confirmedJudges: rolesFor(proposals),
      requiredConfirmations: typeof payload.consensusThreshold === 'number' ? payload.consensusThreshold : proposals.length,
      points: typeof payload.points === 'number' ? payload.points : input.punchPoints,
      submittedAt: Math.max(...proposals.map(proposal => proposal.submittedAt))
    };
    const latest = latestPunch(accepted.side);
    if (!latest || candidate.submittedAt !== latest.submittedAt || !latest.acceptedDecisionIds.has(decisionId)) continue;
    const target = accepted.side === 'BLUE' ? blue : red;
    const current = target.punch as PunchCandidate | null;
    if (!current || candidate.submittedAt >= current.submittedAt) target.punch = candidate;
  }

  for (const side of ['BLUE', 'RED'] as const) {
    const pending = input.punchProposals.filter(proposal => proposal.side === side && proposal.status === 'PENDING' && proposal.submittedAt <= input.now && input.now - proposal.submittedAt <= input.consensusWindowMs);
    if (!pending.length) continue;
    const candidate: PunchCandidate = {
      status: 'PENDING',
      confirmedJudges: rolesFor(pending),
      requiredConfirmations: Math.min(input.consensusThreshold, 2),
      points: input.punchPoints,
      submittedAt: Math.max(...pending.map(proposal => proposal.submittedAt))
    };
    const latest = latestPunch(side);
    if (!latest || candidate.submittedAt !== latest.submittedAt || !latest.hasActivePending) continue;
    const target = side === 'BLUE' ? blue : red;
    const current = target.punch as PunchCandidate | null;
    if (!current || candidate.submittedAt >= current.submittedAt) target.punch = candidate;
  }

  const publicSide = (side: typeof blue) => ({
    headHits: side.headHits,
    bodyHits: side.bodyHits,
    punch: side.punch ? {
      status: side.punch.status,
      confirmedJudges: side.punch.confirmedJudges,
      requiredConfirmations: side.punch.requiredConfirmations,
      points: side.punch.points
    } : null
  });
  return { round: input.round, blue: publicSide(blue), red: publicSide(red) };
}
