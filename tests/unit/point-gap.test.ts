import { describe, expect, it } from 'vitest';
import { EXAMPLE_WT_STYLE_RULESET, matchPointGapLeader, roundPointGapLeader, validateRuleset } from '@tkd/domain';

const rules = EXAMPLE_WT_STYLE_RULESET;

describe('configurable point-gap policy', () => {
  it('keeps legacy omitted rules disabled and applies exact round boundaries', () => {
    const legacy = { ...rules, roundPointGapEnabled: undefined, matchPointGapEnabled: undefined };
    expect(roundPointGapLeader(legacy, 0, 100)).toBeNull();
    expect(roundPointGapLeader(rules, 0, 14)).toBeNull();
    expect(roundPointGapLeader(rules, 0, 15)).toBe('RED');
    expect(roundPointGapLeader(rules, 15, 0)).toBe('BLUE');
    expect(roundPointGapLeader(rules, 15, 15)).toBeNull();
  });

  it('distinguishes round-completion and live cumulative match timing', () => {
    expect(matchPointGapLeader(rules, 1, 0, 30, 'ROUND_END')).toBeNull();
    expect(matchPointGapLeader(rules, 2, 0, 19, 'ROUND_END')).toBeNull();
    expect(matchPointGapLeader(rules, 2, 0, 20, 'ROUND_END')).toBe('RED');
    expect(matchPointGapLeader(rules, 2, 0, 30, 'LIVE')).toBeNull();
    expect(matchPointGapLeader(rules, 3, 30, 10, 'LIVE')).toBe('BLUE');
    expect(matchPointGapLeader(rules, 3, 29, 10, 'LIVE')).toBeNull();
    expect(matchPointGapLeader({ ...rules, matchPointGapEnabled: false }, 3, 0, 99, 'LIVE')).toBeNull();
  });

  it('validates thresholds and configured rounds', () => {
    expect(validateRuleset({ ...rules, gamJeomOpponentPoints: -1 })).toContain('Gam-Jeom opponent points must be an integer between 0 and 20.');
    expect(validateRuleset({ ...rules, disqualificationThreshold: 0 })).toContain('Gam-Jeom disqualification threshold must be an integer between 1 and 100.');
    expect(validateRuleset({ ...rules, roundPointGapThreshold: 0 })).toContain('Round point-gap threshold must be an integer between 1 and 999.');
    expect(validateRuleset({ ...rules, matchPointGapThreshold: 2.5 })).toContain('Match point-gap threshold must be an integer between 1 and 999.');
    expect(validateRuleset({ ...rules, matchPointGapCompletionRound: 4 })).toContain('Match point-gap completion round must be between 1 and the configured number of rounds.');
    expect(validateRuleset({ ...rules, matchPointGapLiveFromRound: 0 })).toContain('Match point-gap live round must be between 1 and the configured number of rounds.');
  });
});
