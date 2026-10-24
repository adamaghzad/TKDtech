import type { AuthUser, MatchState, Role, Ruleset, Side } from '@tkd/contracts';

export interface Actor { id: string; role: Role; tournamentIds: string[]; sessionId?: string }
export interface TournamentRow {
  id: string; organization_id: string; name: string; slug: string; description: string;
  organizer: string; venue: string; country: string; start_date: string; end_date: string;
  timezone: string; registration_opens: string | null; registration_closes: string | null;
  status: string; mode: 'LOCAL'|'CLOUD'; mat_count: number; ruleset_id: string;
  is_development_seed: number; version: number; created_at: string; updated_at: string;
}
export interface MatchRow {
  id: string; tournament_id: string; category_id: string; bracket_node_id: string | null;
  match_number: string; phase: string; mat_id: string | null; blue_athlete_id: string | null;
  red_athlete_id: string | null; state: MatchState; current_round: number;
  blue_score: number; red_score: number; blue_gam_jeom: number; red_gam_jeom: number;
  winner_side: Side | null; decision_method: string | null; timer_json: string;
  sequence: number; version: number; queue_position: number | null; scheduled_at: string | null;
  actual_start_at: string | null; actual_end_at: string | null; created_at: string; updated_at: string;
}
export interface MatchJoinedRow extends MatchRow {
  tournament_name: string; category_name: string; phase_name: string; mat_name: string | null;
  blue_name: string | null; blue_country: string | null; blue_code: string | null; blue_club: string | null;
  red_name: string | null; red_country: string | null; red_code: string | null; red_club: string | null;
  total_rounds: number; ruleset_json: string;
}
export interface SessionContext { user: AuthUser; token?: string }
export interface CommandContext { actor: Actor; expectedVersion?: number; reason?: string; idempotencyKey?: string }
export type TimerCommand = 'START'|'PAUSE'|'RESUME'|'RESET_TIMER'|'NEXT_ROUND'|'PREVIOUS_ROUND'|'SCORE'|'GAM_JEOM'|'MEDICAL_TIMEOUT'|'VIDEO_REVIEW'|'END_REVIEW'|'COMPLETE'|'WALKOVER'|'UNDO';
export interface MatchCommand { type: TimerCommand; side?: Side; pointType?: keyof Ruleset['points']; points?: number; expectedVersion?: number; reason?: string }
