import { describe, expect, it } from 'vitest';
import type { MatchSnapshot } from '@tkd/contracts';
import { CompetitionAlertTracker, classifyScoreTier } from '../../apps/web/lib/competition-alerts';
import { ProArenaSynth } from '../../apps/web/lib/pro-arena-synth';

function makeSnapshot(overrides: Partial<MatchSnapshot> = {}): MatchSnapshot {
  return {
    matchId: 'match-1',
    state: 'READY',
    currentRound: 1,
    blueScore: 0,
    redScore: 0,
    blueGamJeom: 0,
    redGamJeom: 0,
    timer: { kind: 'ROUND', running: false, remainingMs: 120000, authoritativeAt: 1000 },
    videoReview: null,
    ...overrides,
  } as MatchSnapshot;
}

function createMockAudioContext() {
  const frequencies: number[] = [];
  const noopParam = () => ({
    value: 0,
    setValueAtTime: () => {},
    exponentialRampToValueAtTime: () => {},
  });
  const nodeBase = () => ({
    connect: () => {},
    disconnect: () => {},
  });
  const ctx = {
    state: 'running',
    currentTime: 0,
    sampleRate: 44100,
    destination: {},
    createGain: () => ({ ...nodeBase(), gain: noopParam() }),
    createDynamicsCompressor: () => ({
      ...nodeBase(),
      threshold: noopParam(),
      knee: noopParam(),
      ratio: noopParam(),
      attack: noopParam(),
      release: noopParam(),
    }),
    createBiquadFilter: () => ({
      ...nodeBase(),
      type: 'lowpass',
      frequency: noopParam(),
      Q: noopParam(),
    }),
    createWaveShaper: () => ({ ...nodeBase(), curve: null, oversample: 'none' }),
    createConvolver: () => ({ ...nodeBase(), buffer: null }),
    createBuffer: (_ch: number, len: number) => ({
      getChannelData: () => new Float32Array(len),
    }),
    createBufferSource: () => ({
      ...nodeBase(),
      buffer: null,
      start: () => {},
      stop: () => {},
      onended: null,
    }),
    createOscillator: () => ({
      ...nodeBase(),
      type: 'sine',
      frequency: {
        setValueAtTime: (val: number) => {
          frequencies.push(val);
        },
        exponentialRampToValueAtTime: () => {},
      },
      start: () => {},
      stop: () => {},
      onended: null,
    }),
  } as unknown as AudioContext;

  return { ctx, frequencies };
}

describe('competitive pro sound alerts & synthesizer', () => {
  it('classifies +1/+2 body, +3 head, and +4/+6 turning score tiers without replaying initial load', () => {
    expect(classifyScoreTier(1)).toBe('BODY');
    expect(classifyScoreTier(2)).toBe('BODY');
    expect(classifyScoreTier(3)).toBe('HEAD');
    expect(classifyScoreTier(4)).toBe('TURNING');
    expect(classifyScoreTier(6)).toBe('TURNING');

    const tracker = new CompetitionAlertTracker();
    expect(tracker.observe(makeSnapshot({ state: 'IN_PROGRESS', blueScore: 5 }))).toEqual([]);
    expect(tracker.observe(makeSnapshot({ state: 'IN_PROGRESS', blueScore: 8 }))).toEqual([
      { type: 'SCORE', points: 3, tier: 'HEAD' },
    ]);
    expect(tracker.observe(makeSnapshot({ state: 'IN_PROGRESS', blueScore: 8, redScore: 6 }))).toEqual([
      { type: 'SCORE', points: 6, tier: 'TURNING' },
    ]);
    // Undo does not emit a score alert
    expect(tracker.observe(makeSnapshot({ state: 'IN_PROGRESS', blueScore: 8, redScore: 0 }))).toEqual([]);
  });

  it('tracks round start, pause, resume, Gam-Jeom, medical, IVR, and match victory transitions', () => {
    const tracker = new CompetitionAlertTracker();
    tracker.observe(makeSnapshot({ state: 'READY' }));

    expect(tracker.observe(makeSnapshot({ state: 'IN_PROGRESS' }))).toEqual([
      { type: 'ROUND_START', round: 1, goldenPoint: false },
    ]);
    expect(tracker.observe(makeSnapshot({ state: 'PAUSED' }))).toEqual([{ type: 'MATCH_PAUSE' }]);
    expect(tracker.observe(makeSnapshot({ state: 'IN_PROGRESS' }))).toEqual([{ type: 'MATCH_RESUME' }]);

    // Gam-Jeom awards +1 to opponent in the same snapshot
    expect(
      tracker.observe(makeSnapshot({ state: 'IN_PROGRESS', blueGamJeom: 1, redScore: 1 })),
    ).toEqual([
      { type: 'GAM_JEOM', side: 'BLUE' },
      { type: 'SCORE', points: 1, tier: 'BODY' },
    ]);

    // Medical timeout emits MEDICAL_START without duplicate MATCH_PAUSE
    expect(
      tracker.observe(
        makeSnapshot({
          state: 'PAUSED',
          blueGamJeom: 1,
          redScore: 1,
          timer: { kind: 'MEDICAL', running: true, remainingMs: 60000, authoritativeAt: 2000 },
        }),
      ),
    ).toEqual([{ type: 'MEDICAL_START' }]);

    // Video review requested -> accepted -> match victory
    expect(
      tracker.observe(
        makeSnapshot({
          state: 'UNDER_REVIEW',
          blueGamJeom: 1,
          redScore: 1,
          videoReview: { status: 'REQUESTED', requestedBy: 'BLUE', requestedAt: 3000, decidedAt: null },
        }),
      ),
    ).toEqual([{ type: 'VIDEO_REVIEW_REQUESTED' }]);

    expect(
      tracker.observe(
        makeSnapshot({
          state: 'PAUSED',
          blueGamJeom: 1,
          blueScore: 3,
          redScore: 1,
          videoReview: { status: 'ACCEPTED', requestedBy: 'BLUE', requestedAt: 3000, decidedAt: 4000 },
        }),
      ),
    ).toEqual([
      { type: 'SCORE', points: 3, tier: 'HEAD' },
      { type: 'VIDEO_REVIEW_DECIDED', accepted: true },
    ]);

    expect(
      tracker.observe(
        makeSnapshot({
          state: 'COMPLETED',
          blueGamJeom: 1,
          blueScore: 3,
          redScore: 1,
        }),
      ),
    ).toEqual([{ type: 'MATCH_VICTORY', disqualification: false }]);
  });

  it('preserves exact WebAudio probe frequencies (660, 1320, 880, 180, 240) across all pro voices', () => {
    const { ctx, frequencies } = createMockAudioContext();
    const synth = new ProArenaSynth(ctx);

    synth.playUnlockReady();
    expect(frequencies[0]).toBe(660);

    for (const tier of ['BODY', 'HEAD', 'TURNING'] as const) {
      frequencies.length = 0;
      synth.playScoreHit(tier);
      expect(frequencies.filter((f) => f === 1320)).toHaveLength(1);
      expect(frequencies.filter((f) => [880, 180, 240].includes(f))).toHaveLength(0);
    }

    frequencies.length = 0;
    for (const sec of [5, 4, 3, 2, 1]) synth.playCountdownTick(sec);
    expect(frequencies.filter((f) => f === 880)).toHaveLength(5);

    for (const kind of ['ROUND', 'BREAK'] as const) {
      frequencies.length = 0;
      synth.playArenaHorn(kind);
      expect(frequencies.filter((f) => f === 180)).toHaveLength(1);
      expect(frequencies.filter((f) => f === 240)).toHaveLength(1);
    }

    // Auxiliary pro cues must never pollute reserved probe frequencies
    frequencies.length = 0;
    synth.playGamJeom();
    synth.playRoundStart(false);
    synth.playMatchResume();
    synth.playMatchPause();
    synth.playMedicalAlert();
    synth.playVideoReviewRequest();
    synth.playVideoReviewDecision(true);
    synth.playVideoReviewDecision(false);
    synth.playMatchVictory();
    expect(frequencies.filter((f) => [660, 1320, 880, 180, 240].includes(f))).toHaveLength(0);
  });
});
