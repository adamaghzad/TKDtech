import { z } from 'zod';

export const ROLES = ['SUPER_ADMIN','TOURNAMENT_ADMIN','REGISTRATION_MANAGER','MAT_OPERATOR','REFEREE','CORNER_JUDGE','PUBLIC_VIEWER'] as const;
export type Role = typeof ROLES[number];
export const MATCH_STATES = ['PENDING','READY','CALLED','IN_PROGRESS','PAUSED','ROUND_BREAK','GOLDEN_POINT','UNDER_REVIEW','COMPLETED','WALKOVER','WITHDRAWN','DISQUALIFIED','CANCELLED'] as const;
export type MatchState = typeof MATCH_STATES[number];
export type Side = 'BLUE' | 'RED';
export type PointType = 'BODY_PUNCH' | 'BODY_KICK' | 'HEAD_KICK' | 'TURNING_BODY_KICK' | 'TURNING_HEAD_KICK';

export interface Ruleset {
  id: string;
  version: string;
  name: string;
  effectiveDate: string;
  rounds: number;
  roundDurationMs: number;
  breakDurationMs: number;
  goldenPointDurationMs: number | null;
  medicalTimeoutMs: number;
  points: Record<PointType, number>;
  gamJeomOpponentPoints: number;
  disqualificationThreshold: number;
  consensusThreshold: number;
  consensusWindowMs: number;
  proposalExpiryMs: number;
  tieBreak: 'GOLDEN_POINT' | 'SUPERIORITY' | 'NONE';
  resultValidation: 'ROUND_WINS' | 'TOTAL_POINTS';
}

export interface TimerState {
  remainingMs: number;
  running: boolean;
  authoritativeAt: number;
  kind: 'ROUND' | 'BREAK' | 'MEDICAL' | 'GOLDEN_POINT';
}

export interface MatchAthlete {
  id: string | null;
  name: string;
  country: string;
  countryCode: string;
  club?: string;
  seed?: number | null;
}

export interface RoundSnapshot {
  id: string;
  number: number;
  blueScore: number;
  redScore: number;
  bluePenalties: number;
  redPenalties: number;
  winner: Side | null;
  decisionMethod?: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface MatchSnapshot {
  schemaVersion: 1;
  matchId: string;
  tournamentId: string;
  categoryId: string;
  matchNumber: string;
  matId: string | null;
  matName: string;
  phase: string;
  categoryName: string;
  tournamentName: string;
  state: MatchState;
  sequence: number;
  version: number;
  currentRound: number;
  totalRounds: number;
  blue: MatchAthlete;
  red: MatchAthlete;
  blueScore: number;
  redScore: number;
  blueGamJeom: number;
  redGamJeom: number;
  rounds: RoundSnapshot[];
  timer: TimerState;
  winner: Side | null;
  decisionMethod: string | null;
  judges: Array<{ role: 'J1'|'J2'|'J3'|'REFEREE'; status: 'ONLINE'|'RECONNECTING'|'OFFLINE'; lastSeenAt: string | null }>;
  updatedAt: string;
  serverTime: number;
}

export const eventEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().uuid(),
  tournamentId: z.string().uuid(),
  matchId: z.string().uuid().nullable(),
  serverTimestamp: z.number().int(),
  sequence: z.number().int().nonnegative(),
  actorId: z.string().nullable(),
  type: z.string().min(1),
  payload: z.unknown()
});
export type EventEnvelope<T = unknown> = Omit<z.infer<typeof eventEnvelopeSchema>, 'type'|'payload'> & { type: RealtimeEventType; payload: T };
export type RealtimeEventType =
  | 'match.snapshot' | 'match.started' | 'match.paused' | 'match.resumed'
  | 'match.round_changed' | 'match.completed' | 'score.proposed' | 'score.accepted'
  | 'score.rejected' | 'penalty.proposed' | 'penalty.accepted' | 'timer.updated'
  | 'judge.connected' | 'judge.disconnected' | 'bracket.updated' | 'athlete.advanced'
  | 'network.sync_status_changed';

export interface ApiError { error: { code: string; message: string; details?: unknown } }
export interface AuthUser { id: string; email: string; name: string; role: Role; tournamentIds: string[] }
export interface SessionResponse { user: AuthUser; mode: 'LOCAL' | 'CLOUD' | 'SYNCING' }

export const scoreProposalSchema = z.object({
  eventId: z.string().uuid(),
  matchId: z.string().uuid(),
  roundId: z.string().uuid(),
  judgeSessionId: z.string().uuid(),
  side: z.enum(['BLUE','RED']),
  pointType: z.enum(['BODY_PUNCH','BODY_KICK','HEAD_KICK','TURNING_BODY_KICK','TURNING_HEAD_KICK']),
  submittedAt: z.number().int().positive(),
  sequence: z.number().int().positive(),
  idempotencyKey: z.string().min(12).max(160)
});
export type ScoreProposalInput = z.infer<typeof scoreProposalSchema>;

export const pairingSchema = z.object({
  matchId: z.string().uuid(),
  role: z.enum(['J1','J2','J3','REFEREE']),
  expiresInSeconds: z.number().int().min(30).max(900).default(300)
});
