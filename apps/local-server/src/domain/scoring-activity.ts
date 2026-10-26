import type { CornerJudgeRole, HitConfirmationSnapshot, MatchScoringActivity, PointType, Side, SideScoringActivity } from '@tkd/contracts';

export interface ScoringEventRecord {
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface JudgeProposalRecord {
  side: Side;
  pointType: PointType;
  status: string;
  decisionId: string | null;
  judgeRole: CornerJudgeRole;
  submittedAt: number;
}

type HitPointType = HitConfirmationSnapshot['pointType'];

const judgeOrder: CornerJudgeRole[] = ['J1', 'J2', 'J3'];
const headPointTypes = new Set<PointType>(['HEAD_KICK', 'TURNING_HEAD_KICK']);
const bodyPointTypes = new Set<PointType>(['BODY_KICK', 'TURNING_BODY_KICK']);

function isSide(value: unknown): value is Side { return value === 'BLUE' || value === 'RED'; }
function isPointType(value: unknown): value is PointType {
  return typeof value === 'string' && ['BODY_PUNCH', 'BODY_KICK', 'HEAD_KICK', 'TURNING_BODY_KICK', 'TURNING_HEAD_KICK'].includes(value);
}
function isHitPointType(pointType: PointType): pointType is HitPointType { return headPointTypes.has(pointType) || bodyPointTypes.has(pointType); }
function activitySide(): SideScoringActivity { return { headHits: 0, bodyHits: 0, hits: [], punches: [] }; }
function rolesFor(proposals: JudgeProposalRecord[]): CornerJudgeRole[] {
  const roles = new Set(proposals.map(proposal => proposal.judgeRole));
  return judgeOrder.filter(role => roles.has(role));
}

/**
 * Builds display-only current-round activity from effective scoring records and active judge input.
 * It does not score the match or represent protector/PSS input. Every judge-accepted technique keeps
 * its own J1-J3 confirmation state; operator-added kicks are identified instead of inventing judges.
 */
export function buildScoringActivity(input: {
  round: number;
  roundId: string;
  events: ScoringEventRecord[];
  judgeProposals: JudgeProposalRecord[];
  now: number;
  consensusWindowMs: number;
  consensusThreshold: number;
  points: Record<PointType, number>;
}): MatchScoringActivity {
  const blue = activitySide();
  const red = activitySide();
  const correctedEventIds = new Set<string>();
  for (const event of input.events) {
    if (event.eventType === 'score.correction' && typeof event.payload.targetEventId === 'string') correctedEventIds.add(event.payload.targetEventId);
  }

  for (const event of input.events) {
    if (correctedEventIds.has(event.eventId) || event.payload.roundId !== input.roundId) continue;
    if (event.eventType !== 'score.manual' && event.eventType !== 'score.accepted') continue;
    const side = event.payload.side;
    const pointType = event.payload.pointType;
    if (!isSide(side) || !isPointType(pointType)) continue;
    const target = side === 'BLUE' ? blue : red;
    const points = typeof event.payload.points === 'number' ? event.payload.points : input.points[pointType];

    if (isHitPointType(pointType)) {
      const hitTarget = headPointTypes.has(pointType) ? 'HEAD' : 'BODY';
      if (hitTarget === 'HEAD') target.headHits += 1;
      else target.bodyHits += 1;
      if (event.eventType === 'score.manual') {
        target.hits.push({ target: hitTarget, pointType, source: 'OPERATOR', status: 'CONFIRMED', confirmedJudges: [], requiredConfirmations: 0, points });
      } else {
        const decisionId = typeof event.payload.decisionId === 'string' ? event.payload.decisionId : null;
        const proposals = decisionId ? input.judgeProposals.filter(proposal => proposal.decisionId === decisionId && proposal.status === 'ACCEPTED') : [];
        target.hits.push({
          target: hitTarget,
          pointType,
          source: 'JUDGES',
          status: 'CONFIRMED',
          confirmedJudges: rolesFor(proposals),
          requiredConfirmations: typeof event.payload.consensusThreshold === 'number' ? event.payload.consensusThreshold : proposals.length,
          points
        });
      }
    }

    if (event.eventType === 'score.accepted' && pointType === 'BODY_PUNCH' && typeof event.payload.decisionId === 'string') {
      const proposals = input.judgeProposals.filter(proposal => proposal.decisionId === event.payload.decisionId && proposal.status === 'ACCEPTED');
      target.punches.push({
        status: 'CONFIRMED',
        confirmedJudges: rolesFor(proposals),
        requiredConfirmations: typeof event.payload.consensusThreshold === 'number' ? event.payload.consensusThreshold : proposals.length,
        points
      });
    }
  }

  const pendingGroups = new Map<string, JudgeProposalRecord[]>();
  for (const proposal of input.judgeProposals) {
    if (proposal.status !== 'PENDING' || proposal.submittedAt > input.now || input.now - proposal.submittedAt > input.consensusWindowMs) continue;
    const key = `${proposal.side}:${proposal.pointType}`;
    const group = pendingGroups.get(key) ?? [];
    group.push(proposal);
    pendingGroups.set(key, group);
  }
  for (const proposals of pendingGroups.values()) {
    const first = proposals[0]!;
    const target = first.side === 'BLUE' ? blue : red;
    const confirmedJudges = rolesFor(proposals);
    const requiredConfirmations = Math.min(input.consensusThreshold, 2);
    if (isHitPointType(first.pointType)) {
      target.hits.push({
        target: headPointTypes.has(first.pointType) ? 'HEAD' : 'BODY',
        pointType: first.pointType,
        source: 'JUDGES',
        status: 'PENDING',
        confirmedJudges,
        requiredConfirmations,
        points: input.points[first.pointType]
      });
    } else if (first.pointType === 'BODY_PUNCH') {
      target.punches.push({ status: 'PENDING', confirmedJudges, requiredConfirmations, points: input.points.BODY_PUNCH });
    }
  }

  return { round: input.round, blue, red };
}
