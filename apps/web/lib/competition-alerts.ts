import type { MatchSnapshot, Side } from '@tkd/contracts';

export type ScoreTier = 'BODY' | 'HEAD' | 'TURNING';

export type CompetitionSoundCue =
  | { type: 'SCORE'; points: number; tier: ScoreTier }
  | { type: 'GAM_JEOM'; side: Side }
  | { type: 'ROUND_START'; round: number; goldenPoint: boolean }
  | { type: 'MATCH_RESUME' }
  | { type: 'MATCH_PAUSE' }
  | { type: 'MEDICAL_START' }
  | { type: 'VIDEO_REVIEW_REQUESTED' }
  | { type: 'VIDEO_REVIEW_DECIDED'; accepted: boolean }
  | { type: 'MATCH_VICTORY'; disqualification: boolean };

interface TrackedMatchState {
  matchId: string;
  state: MatchSnapshot['state'];
  currentRound: number;
  blueScore: number;
  redScore: number;
  blueGamJeom: number;
  redGamJeom: number;
  timerKind: MatchSnapshot['timer']['kind'];
  reviewStatus: NonNullable<MatchSnapshot['videoReview']>['status'] | null;
  reviewRequestedAt: number | null;
}

export function classifyScoreTier(delta: number): ScoreTier {
  if (delta >= 4) return 'TURNING';
  if (delta === 3) return 'HEAD';
  return 'BODY';
}

/**
 * Tracks live authoritative MatchSnapshot transitions for competitive arena sound effects.
 * Never emits cues on initial load, reconnect after null, or switching to a different matchId.
 */
export class CompetitionAlertTracker {
  private prev: TrackedMatchState | null = null;

  observe(snapshot: MatchSnapshot | null): CompetitionSoundCue[] {
    if (!snapshot) {
      this.prev = null;
      return [];
    }

    const next: TrackedMatchState = {
      matchId: snapshot.matchId,
      state: snapshot.state,
      currentRound: snapshot.currentRound,
      blueScore: snapshot.blueScore,
      redScore: snapshot.redScore,
      blueGamJeom: snapshot.blueGamJeom,
      redGamJeom: snapshot.redGamJeom,
      timerKind: snapshot.timer.kind,
      reviewStatus: snapshot.videoReview?.status ?? null,
      reviewRequestedAt: snapshot.videoReview?.requestedAt ?? null,
    };

    const prev = this.prev;
    this.prev = next;

    if (!prev || prev.matchId !== next.matchId) {
      return [];
    }

    const cues: CompetitionSoundCue[] = [];

    // 1. Gam-Jeom penalty increase
    const blueGjDelta = next.blueGamJeom - prev.blueGamJeom;
    const redGjDelta = next.redGamJeom - prev.redGamJeom;
    if (blueGjDelta > 0) {
      cues.push({ type: 'GAM_JEOM', side: 'BLUE' });
    } else if (redGjDelta > 0) {
      cues.push({ type: 'GAM_JEOM', side: 'RED' });
    }

    // 2. Authoritative score increase (BODY +1/+2, HEAD +3, TURNING +4/+6)
    const blueDelta = next.blueScore - prev.blueScore;
    const redDelta = next.redScore - prev.redScore;
    const maxDelta = Math.max(blueDelta, redDelta);
    if (maxDelta > 0) {
      cues.push({
        type: 'SCORE',
        points: maxDelta,
        tier: classifyScoreTier(maxDelta),
      });
    }

    // 3. Instant Video Replay transitions
    if (
      next.reviewStatus === 'REQUESTED' &&
      (prev.reviewStatus !== 'REQUESTED' || prev.reviewRequestedAt !== next.reviewRequestedAt)
    ) {
      cues.push({ type: 'VIDEO_REVIEW_REQUESTED' });
    } else if (
      prev.reviewStatus === 'REQUESTED' &&
      (next.reviewStatus === 'ACCEPTED' || next.reviewStatus === 'REJECTED')
    ) {
      cues.push({ type: 'VIDEO_REVIEW_DECIDED', accepted: next.reviewStatus === 'ACCEPTED' });
    }

    // 4. Medical / Doctor Call start
    if (next.timerKind === 'MEDICAL' && prev.timerKind !== 'MEDICAL') {
      cues.push({ type: 'MEDICAL_START' });
    }

    // 5. Match & Round state transitions
    if (next.state !== prev.state) {
      if (next.state === 'COMPLETED' || next.state === 'DISQUALIFIED') {
        cues.push({ type: 'MATCH_VICTORY', disqualification: next.state === 'DISQUALIFIED' });
      } else if (next.state === 'IN_PROGRESS' || next.state === 'GOLDEN_POINT') {
        if (prev.state === 'PAUSED' && prev.currentRound === next.currentRound && next.state === 'IN_PROGRESS') {
          cues.push({ type: 'MATCH_RESUME' });
        } else {
          cues.push({
            type: 'ROUND_START',
            round: next.currentRound,
            goldenPoint: next.state === 'GOLDEN_POINT',
          });
        }
      } else if (
        next.state === 'PAUSED' &&
        (prev.state === 'IN_PROGRESS' || prev.state === 'GOLDEN_POINT') &&
        next.timerKind !== 'MEDICAL'
      ) {
        cues.push({ type: 'MATCH_PAUSE' });
      }
    }

    return cues;
  }
}
