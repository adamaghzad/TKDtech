import type { MatchSnapshot, RoundSnapshot } from '@tkd/contracts';
import type { MatchJoinedRow, MatchRow } from '../types';
import type { SqliteDatabase } from './database';

export const MATCH_SELECT = `
SELECT m.*, t.name AS tournament_name, c.name AS category_name, m.phase AS phase_name,
  mat.name AS mat_name, c.rounds AS total_rounds, tr.config_json AS ruleset_json,
  ba.first_name || ' ' || ba.last_name AS blue_name, ba.nationality AS blue_country, ba.country_code AS blue_code, bc.name AS blue_club,
  ra.first_name || ' ' || ra.last_name AS red_name, ra.nationality AS red_country, ra.country_code AS red_code, rc.name AS red_club
FROM matches m
JOIN tournaments t ON t.id=m.tournament_id
JOIN categories c ON c.id=m.category_id
JOIN tournament_rulesets tr ON tr.tournament_id=t.id AND tr.version=(SELECT version FROM tournament_rulesets WHERE tournament_id=t.id ORDER BY created_at LIMIT 1)
LEFT JOIN mats mat ON mat.id=m.mat_id
LEFT JOIN athletes ba ON ba.id=m.blue_athlete_id LEFT JOIN clubs bc ON bc.id=ba.club_id
LEFT JOIN athletes ra ON ra.id=m.red_athlete_id LEFT JOIN clubs rc ON rc.id=ra.club_id`;

export function getJoinedMatch(db: SqliteDatabase, matchId: string): MatchJoinedRow {
  const row = db.prepare(`${MATCH_SELECT} WHERE m.id=?`).get(matchId) as MatchJoinedRow | undefined;
  if (!row) throw new Error('Match not found.');
  return row;
}

export function snapshotFromRow(db: SqliteDatabase, row: MatchJoinedRow, now = Date.now()): MatchSnapshot {
  const rounds = db.prepare('SELECT * FROM match_rounds WHERE match_id=? ORDER BY number').all(row.id) as Array<{id:string;number:number;blue_score:number;red_score:number;blue_penalties:number;red_penalties:number;winner_side:'BLUE'|'RED'|null;started_at:string|null;ended_at:string|null}>;
  const presence = db.prepare(`SELECT role,status,last_seen_at FROM device_presence WHERE match_id=?`).all(row.id) as Array<{role:'J1'|'J2'|'J3'|'REFEREE';status:'ONLINE'|'RECONNECTING'|'OFFLINE';last_seen_at:number}>;
  const presenceCutoff=now-Number(process.env.PRESENCE_EXPIRY_SECONDS||15)*1000;
  const timer = JSON.parse(row.timer_json) as MatchSnapshot['timer'];
  const displayTimer = timer.running ? { ...timer, remainingMs: Math.max(0, timer.remainingMs - (now - timer.authoritativeAt)) } : timer;
  const roundSnapshots: RoundSnapshot[] = rounds.map(round => ({ id: round.id, number: round.number, blueScore: round.blue_score, redScore: round.red_score, bluePenalties: round.blue_penalties, redPenalties: round.red_penalties, winner: round.winner_side, startedAt: round.started_at, endedAt: round.ended_at }));
  const athlete = (side: 'blue'|'red') => ({
    id: row[`${side}_athlete_id`], name: row[`${side}_name`] ?? 'To be determined', country: row[`${side}_country`] ?? '', countryCode: row[`${side}_code`] ?? 'TBD', club: row[`${side}_club`] ?? undefined
  });
  return {
    schemaVersion: 1, matchId: row.id, tournamentId: row.tournament_id, categoryId: row.category_id,
    matchNumber: row.match_number, matId: row.mat_id, matName: row.mat_name ?? 'Unassigned',
    phase: row.phase_name ?? row.phase, categoryName: row.category_name, tournamentName: row.tournament_name,
    state: row.state, sequence: row.sequence, version: row.version, currentRound: row.current_round,
    totalRounds: row.total_rounds, blue: athlete('blue'), red: athlete('red'), blueScore: row.blue_score,
    redScore: row.red_score, blueGamJeom: row.blue_gam_jeom, redGamJeom: row.red_gam_jeom,
    rounds: roundSnapshots, timer: displayTimer, winner: row.winner_side, decisionMethod: row.decision_method,
    judges: presence.map(item => ({ role: item.role, status: item.status==='ONLINE'&&item.last_seen_at<=presenceCutoff?'OFFLINE':item.status, lastSeenAt: new Date(item.last_seen_at).toISOString() })),
    updatedAt: row.updated_at, serverTime: now
  };
}

export function getMatchRow(db: SqliteDatabase, id: string): MatchRow {
  const row = db.prepare('SELECT * FROM matches WHERE id=?').get(id) as MatchRow | undefined;
  if (!row) throw new Error('Match not found.');
  return row;
}
