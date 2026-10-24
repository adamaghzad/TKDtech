import type { Ruleset } from '@tkd/contracts';

/** Example configuration only. Verify against the rules adopted by your event. */
export const EXAMPLE_WT_STYLE_RULESET: Ruleset = {
  id: 'example-wt-style', version: '2025.1-example', name: 'Example WT-style three round rules',
  effectiveDate: '2025-01-01', rounds: 3, roundDurationMs: 120_000, breakDurationMs: 60_000,
  goldenPointDurationMs: 60_000, medicalTimeoutMs: 60_000,
  points: { BODY_PUNCH: 1, BODY_KICK: 2, HEAD_KICK: 3, TURNING_BODY_KICK: 4, TURNING_HEAD_KICK: 6 },
  gamJeomOpponentPoints: 1, disqualificationThreshold: 5, consensusThreshold: 2,
  consensusWindowMs: 1_000, proposalExpiryMs: 2_000, tieBreak: 'GOLDEN_POINT', resultValidation: 'ROUND_WINS'
};

export function validateRuleset(ruleset: Ruleset): string[] {
  const errors: string[] = [];
  if (ruleset.rounds < 1 || ruleset.rounds > 9) errors.push('Rounds must be between 1 and 9.');
  if (ruleset.roundDurationMs < 1_000) errors.push('Round duration must be at least one second.');
  if (ruleset.consensusThreshold < 1 || ruleset.consensusThreshold > 3) errors.push('Consensus threshold must be 1–3.');
  if (ruleset.consensusWindowMs < 100) errors.push('Consensus window must be at least 100ms.');
  if (Object.values(ruleset.points).some(value => !Number.isInteger(value) || value < 0)) errors.push('Point values must be non-negative integers.');
  if (ruleset.tieBreak === 'NONE' && ruleset.resultValidation === 'ROUND_WINS') errors.push('A tie policy is required for round-based results.');
  return errors;
}
