import { randomUUID } from 'node:crypto';
import type { PointType, Ruleset, ScoreProposalInput, Side } from '@tkd/contracts';

export type ProposalStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
export interface ScoringDecision {
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
  reason: string;
  proposalIds: string[];
  decisionId: string | null;
  side?: Side;
  pointType?: PointType;
  points?: number;
}
interface ActiveGroup {
  anchor: number;
  proposals: ScoreProposalInput[];
  judgeIds: Set<string>;
}

/** Server-authoritative consensus tracker. Rebuild from persisted proposals after restart. */
export class ConsensusTracker {
  private groups = new Map<string, ActiveGroup>();
  private seenEvents = new Map<string, ScoringDecision>();
  private idempotency = new Map<string, ScoringDecision>();
  private lastSequences = new Map<string, number>();
  private acceptedGroups = new Map<string, number>();

  constructor(private readonly ruleset: Ruleset, private readonly authorizedJudgeIds: ReadonlySet<string>) {}

  submit(input: ScoreProposalInput, judgeId: string, now: number): ScoringDecision {
    // Never let unsynchronized device clocks determine expiry or consensus membership.
    input = { ...input, submittedAt: now };
    const duplicate = this.seenEvents.get(input.eventId) ?? this.idempotency.get(input.idempotencyKey);
    if (duplicate) return { ...duplicate, status: 'REJECTED', reason: 'DUPLICATE_DELIVERY', decisionId: null, points: 0 };
    let decision: ScoringDecision;
    const reject = (reason: string): ScoringDecision => ({ status: 'REJECTED', reason, proposalIds: [input.eventId], decisionId: null, points: 0 });
    if (!this.authorizedJudgeIds.has(judgeId)) decision = reject('UNAUTHORIZED_JUDGE');
    else if (input.judgeSessionId.length === 0 || input.matchId.length === 0 || input.roundId.length === 0) decision = reject('MALFORMED_PROPOSAL');
    else if ((this.lastSequences.get(input.judgeSessionId) ?? 0) >= input.sequence) decision = reject('OUT_OF_ORDER_SEQUENCE');
    else {
      this.lastSequences.set(input.judgeSessionId, input.sequence);
      decision = this.addToGroup(input, judgeId, now);
    }
    this.seenEvents.set(input.eventId, decision);
    this.idempotency.set(input.idempotencyKey, decision);
    return decision;
  }

  private addToGroup(input: ScoreProposalInput, judgeId: string, now: number): ScoringDecision {
    const key = `${input.matchId}:${input.roundId}:${input.side}:${input.pointType}`;
    const acceptedAt = this.acceptedGroups.get(key);
    if (acceptedAt != null && now - acceptedAt <= this.ruleset.consensusWindowMs) {
      return { status: 'REJECTED', reason: 'SCORING_DECISION_ALREADY_ACCEPTED', proposalIds: [input.eventId], decisionId: null, points: 0 };
    }
    let group = this.groups.get(key);
    if (group && now - group.anchor > this.ruleset.consensusWindowMs) { this.groups.delete(key); group = undefined; }
    if (!group) {
      group = { anchor: input.submittedAt, proposals: [], judgeIds: new Set<string>() };
      this.groups.set(key, group);
    }
    if (input.submittedAt < group.anchor || input.submittedAt - group.anchor > this.ruleset.consensusWindowMs) {
      return { status: 'REJECTED', reason: 'OUTSIDE_CONSENSUS_WINDOW', proposalIds: [input.eventId], decisionId: null, points: 0 };
    }
    if (group.judgeIds.has(judgeId)) return { status: 'REJECTED', reason: 'JUDGE_ALREADY_COUNTED', proposalIds: [input.eventId], decisionId: null, points: 0 };
    group.proposals.push(input); group.judgeIds.add(judgeId);
    const proposalIds = group.proposals.map(proposal => proposal.eventId);
    if (group.judgeIds.size < this.ruleset.consensusThreshold) return { status: 'PENDING', reason: 'AWAITING_DISTINCT_JUDGES', proposalIds, decisionId: null };
    const decisionId = randomUUID();
    this.groups.delete(key); this.acceptedGroups.set(key, now);
    return { status: 'ACCEPTED', reason: 'CONSENSUS_THRESHOLD_MET', proposalIds, decisionId, side: input.side, pointType: input.pointType, points: this.ruleset.points[input.pointType] };
  }

  expire(now: number): ScoringDecision[] {
    const expired: ScoringDecision[] = [];
    for (const [key, group] of this.groups) {
      if (now - group.anchor <= this.ruleset.consensusWindowMs) continue;
      expired.push({ status: 'EXPIRED', reason: 'CONSENSUS_WINDOW_ELAPSED', proposalIds: group.proposals.map(proposal => proposal.eventId), decisionId: null, points: 0 });
      this.groups.delete(key);
    }
    return expired;
  }
}

export interface ResultRound {
  number: number;
  blueScore: number;
  redScore: number;
  bluePenalties: number;
  redPenalties: number;
  goldenPointWinner?: Side | null;
}
export interface MatchResult {
  winner: Side | null;
  decisionMethod: 'ROUND_WINS' | 'TOTAL_POINTS' | 'DISQUALIFICATION' | 'GOLDEN_POINT' | 'UNRESOLVED_TIE';
  blueRoundWins: number;
  redRoundWins: number;
  reason: string;
}

export function determineMatchResult(rounds: readonly ResultRound[], ruleset: Ruleset): MatchResult {
  const blueDisqualified = rounds.reduce((sum, round) => sum + round.bluePenalties, 0) >= ruleset.disqualificationThreshold;
  const redDisqualified = rounds.reduce((sum, round) => sum + round.redPenalties, 0) >= ruleset.disqualificationThreshold;
  if (blueDisqualified || redDisqualified) {
    if (blueDisqualified && redDisqualified) return { winner: null, decisionMethod: 'UNRESOLVED_TIE', blueRoundWins: 0, redRoundWins: 0, reason: 'Both athletes reached the disqualification threshold; authorized review is required.' };
    return { winner: blueDisqualified ? 'RED' : 'BLUE', decisionMethod: 'DISQUALIFICATION', blueRoundWins: 0, redRoundWins: 0, reason: 'Configured penalty threshold reached.' };
  }
  let blueRoundWins = 0; let redRoundWins = 0;
  for (const round of rounds) {
    if (round.blueScore > round.redScore) blueRoundWins++;
    else if (round.redScore > round.blueScore) redRoundWins++;
  }
  if (blueRoundWins !== redRoundWins) {
    return { winner: blueRoundWins > redRoundWins ? 'BLUE' : 'RED', decisionMethod: ruleset.resultValidation === 'TOTAL_POINTS' ? 'TOTAL_POINTS' : 'ROUND_WINS', blueRoundWins, redRoundWins: redRoundWins, reason: 'Match-winning policy satisfied.' };
  }
  if (ruleset.resultValidation === 'TOTAL_POINTS') {
    const blue = rounds.reduce((sum, round) => sum + round.blueScore, 0);
    const red = rounds.reduce((sum, round) => sum + round.redScore, 0);
    if (blue !== red) return { winner: blue > red ? 'BLUE' : 'RED', decisionMethod: 'TOTAL_POINTS', blueRoundWins, redRoundWins, reason: 'Higher valid total score.' };
  }
  const golden = rounds.find(round => round.goldenPointWinner);
  if (ruleset.tieBreak === 'GOLDEN_POINT' && golden?.goldenPointWinner) {
    return { winner: golden.goldenPointWinner, decisionMethod: 'GOLDEN_POINT', blueRoundWins, redRoundWins, reason: 'Valid Golden Point score.' };
  }
  return { winner: null, decisionMethod: 'UNRESOLVED_TIE', blueRoundWins, redRoundWins, reason: 'The result is tied and the configured tie-break procedure has not resolved it.' };
}

export function applyGamJeom(round: ResultRound, penalizedSide: Side, ruleset: Ruleset): ResultRound {
  const updated = { ...round };
  if (penalizedSide === 'BLUE') { updated.bluePenalties += 1; updated.redScore += ruleset.gamJeomOpponentPoints; }
  else { updated.redPenalties += 1; updated.blueScore += ruleset.gamJeomOpponentPoints; }
  return updated;
}
