import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ruleset, ScoreProposalInput } from '@tkd/contracts';
import { openDatabase, type SqliteDatabase } from '../../apps/local-server/src/persistence/database';
import { seedDevelopment } from '../../apps/local-server/src/persistence/seed';
import { TournamentRepository } from '../../apps/local-server/src/persistence/repository';
import { MatchService } from '../../apps/local-server/src/domain/match-service';
import type { Actor } from '../../apps/local-server/src/types';

const databases: SqliteDatabase[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of databases.splice(0)) if (db.open) db.close(); });

function system() {
  const db = openDatabase(':memory:'); databases.push(db);
  const seeded = seedDevelopment(db)!; const repository = new TournamentRepository(db);
  const profile = db.prepare('SELECT id FROM profiles LIMIT 1').get() as { id: string };
  const actor: Actor = { id: profile.id, role: 'SUPER_ADMIN', tournamentIds: [seeded.tournamentId] };
  return { db, repository, actor, service: new MatchService(db, repository), ...seeded };
}

function policy(db: SqliteDatabase, tournamentId: string, values: Partial<Ruleset>) {
  const row = db.prepare('SELECT config_json FROM tournament_rulesets WHERE tournament_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(tournamentId) as { config_json: string };
  const current = JSON.parse(row.config_json) as Ruleset;
  db.prepare('UPDATE tournament_rulesets SET config_json=? WHERE tournament_id=?').run(JSON.stringify({ ...current, ...values }), tournamentId);
}

function resetMatch(db: SqliteDatabase, matchId: string, round = 1, state: 'IN_PROGRESS' | 'PAUSED' | 'READY' = 'PAUSED') {
  const now = 100_000;
  db.prepare(`UPDATE matches SET state=?,current_round=?,blue_score=0,red_score=0,blue_gam_jeom=0,red_gam_jeom=0,winner_side=NULL,decision_method=NULL,actual_end_at=NULL,timer_json=? WHERE id=?`)
    .run(state, round, JSON.stringify({ remainingMs: 120_000, running: state === 'IN_PROGRESS', authoritativeAt: now, kind: 'ROUND' }), matchId);
  db.prepare(`UPDATE match_rounds SET blue_score=0,red_score=0,blue_penalties=0,red_penalties=0,winner_side=NULL,decision_method=NULL,started_at=NULL,ended_at=NULL WHERE match_id=?`).run(matchId);
  vi.spyOn(Date, 'now').mockReturnValue(now);
}

function setRound(db: SqliteDatabase, matchId: string, round: number, blue: number, red: number, ended = false, winner: 'BLUE' | 'RED' | null = null) {
  db.prepare('UPDATE match_rounds SET blue_score=?,red_score=?,winner_side=?,decision_method=?,ended_at=? WHERE match_id=? AND number=?')
    .run(blue, red, winner, winner ? 'SCORE' : null, ended ? new Date(90_000).toISOString() : null, matchId, round);
}

function proposal(session: { id: string; match_id: string }, roundId: string, sequence: number): ScoreProposalInput {
  return { eventId: randomUUID(), matchId: session.match_id, roundId, judgeSessionId: session.id, side: 'RED', pointType: 'HEAD_KICK', submittedAt: Date.now(), sequence, idempotencyKey: randomUUID() };
}

describe('authoritative point-gap scoring', () => {
  it('allows Red 14–0 with a 15-point rule, then ends the round at exactly 15–0 with separate scoring and decision events', () => {
    const { db, service, actor, matchId, tournamentId } = system();
    policy(db, tournamentId, { roundPointGapEnabled: true, roundPointGapThreshold: 15, matchPointGapEnabled: false });
    resetMatch(db, matchId); setRound(db, matchId, 1, 0, 13); db.prepare('UPDATE matches SET red_score=13 WHERE id=?').run(matchId); const baseline = service.snapshot(matchId).sequence;
    const at14 = service.execute(actor, matchId, { type: 'SCORE', side: 'RED', pointType: 'BODY_PUNCH' });
    expect(at14).toMatchObject({ state: 'PAUSED', currentRound: 1, redScore: 14, winner: null });
    expect(at14.rounds[0]).toMatchObject({ redScore: 14, winner: null, endedAt: null });
    expect(at14.sequence).toBe(baseline + 1);
    const key = randomUUID(); const at15 = service.execute(actor, matchId, { type: 'SCORE', side: 'RED', pointType: 'BODY_PUNCH' }, key);
    expect(at15).toMatchObject({ state: 'ROUND_BREAK', currentRound: 2, redScore: 15, winner: null });
    expect(at15.rounds[0]).toMatchObject({ redScore: 15, winner: 'RED', decisionMethod: 'POINT_GAP' });
    expect(at15.rounds[1]).toMatchObject({ blueScore: 0, redScore: 0 });
    expect(service.execute(actor, matchId, { type: 'SCORE', side: 'RED', pointType: 'BODY_PUNCH' }, key).sequence).toBe(at15.sequence);
    const events = db.prepare(`SELECT event_type,sequence,payload_json FROM match_events WHERE match_id=? AND event_type IN ('score.manual','match.round_changed') AND sequence>? ORDER BY sequence`).all(matchId, baseline) as Array<{ event_type: string; sequence: number; payload_json: string }>;
    expect(events.map(event => event.event_type)).toEqual(['score.manual', 'score.manual', 'match.round_changed']);
    expect(JSON.parse(events[2]!.payload_json)).toMatchObject({ pointGap: { scope: 'ROUND', winner: 'RED', threshold: 15, difference: 15 }, roundResult: { decisionMethod: 'POINT_GAP' } });
  });

  it('uses a second-round point gap to complete the match by normal round wins', () => {
    const { db, service, actor, matchId, tournamentId } = system();
    policy(db, tournamentId, { roundPointGapEnabled: true, roundPointGapThreshold: 15, matchPointGapEnabled: false });
    resetMatch(db, matchId, 2); setRound(db, matchId, 1, 0, 15, true, 'RED'); setRound(db, matchId, 2, 0, 14);
    db.prepare('UPDATE matches SET red_score=29 WHERE id=?').run(matchId);
    const result = service.execute(actor, matchId, { type: 'SCORE', side: 'RED', pointType: 'BODY_PUNCH' });
    expect(result).toMatchObject({ state: 'COMPLETED', currentRound: 2, winner: 'RED', decisionMethod: 'ROUND_WINS' });
    expect(result.rounds[1]).toMatchObject({ winner: 'RED', decisionMethod: 'POINT_GAP' });
    expect(db.prepare('SELECT decision_method FROM tournament_results WHERE match_id=?').get(matchId)).toMatchObject({ decision_method: 'ROUND_WINS' });
  });

  it('honors a persisted round gap during authoritative timer-expiry recovery', () => {
    const { db, service, matchId, tournamentId } = system();
    policy(db, tournamentId, { roundPointGapEnabled: true, roundPointGapThreshold: 15, matchPointGapEnabled: false });
    resetMatch(db, matchId, 1, 'IN_PROGRESS'); setRound(db, matchId, 1, 0, 15);
    db.prepare('UPDATE matches SET red_score=15,timer_json=? WHERE id=?').run(JSON.stringify({ remainingMs: 1000, running: true, authoritativeAt: 100_000, kind: 'ROUND' }), matchId);
    expect(service.expireTimers(100_000)).toEqual([]);
    vi.spyOn(Date, 'now').mockReturnValue(101_000);
    expect(service.expireTimers(101_000)).toEqual([matchId]);
    const result = service.snapshot(matchId);
    expect(result).toMatchObject({ state: 'ROUND_BREAK', currentRound: 2 });
    expect(result.rounds[0]).toMatchObject({ winner: 'RED', decisionMethod: 'POINT_GAP' });
  });

  it('preserves legacy behavior when both rules are disabled', () => {
    const { db, service, actor, matchId, tournamentId } = system();
    policy(db, tournamentId, { roundPointGapEnabled: false, matchPointGapEnabled: false });
    resetMatch(db, matchId); setRound(db, matchId, 1, 0, 14); db.prepare('UPDATE matches SET red_score=14 WHERE id=?').run(matchId);
    const scored = service.execute(actor, matchId, { type: 'SCORE', side: 'RED', pointType: 'BODY_PUNCH' });
    expect(scored).toMatchObject({ state: 'PAUSED', currentRound: 1, redScore: 15 });
    const ended = service.execute(actor, matchId, { type: 'NEXT_ROUND' });
    expect(ended).toMatchObject({ state: 'ROUND_BREAK', currentRound: 2 });
    expect(ended.rounds[0]).toMatchObject({ winner: 'RED', decisionMethod: 'SCORE' });
  });

  it('uses cumulative points at completion of round 2 and gives match gap priority over two round wins', () => {
    const { db, service, actor, matchId, tournamentId } = system();
    policy(db, tournamentId, { roundPointGapEnabled: false, matchPointGapEnabled: true, matchPointGapThreshold: 20, matchPointGapCompletionRound: 2, matchPointGapLiveFromRound: 3 });
    resetMatch(db, matchId, 2); setRound(db, matchId, 1, 15, 0, true, 'BLUE'); setRound(db, matchId, 2, 5, 0);
    db.prepare('UPDATE matches SET blue_score=20,red_score=0 WHERE id=?').run(matchId);
    const result = service.execute(actor, matchId, { type: 'NEXT_ROUND' });
    expect(result).toMatchObject({ state: 'COMPLETED', currentRound: 2, winner: 'BLUE', decisionMethod: 'POINT_GAP' });
    expect(result.rounds[1]).toMatchObject({ winner: 'BLUE', decisionMethod: 'SCORE' });
    expect(db.prepare('SELECT decision_method FROM tournament_results WHERE match_id=?').get(matchId)).toMatchObject({ decision_method: 'POINT_GAP' });
    const event = db.prepare(`SELECT payload_json FROM match_events WHERE match_id=? AND event_type='match.completed' ORDER BY sequence DESC LIMIT 1`).get(matchId) as { payload_json: string };
    expect(JSON.parse(event.payload_json)).toMatchObject({ matchResult: { winner: 'BLUE', decisionMethod: 'POINT_GAP', pointGap: { scope: 'MATCH', difference: 20, round: 2 } } });
  });

  it('completes a live third-round cumulative match gap without inventing a completed third round', () => {
    const { db, service, actor, matchId, tournamentId } = system();
    policy(db, tournamentId, { roundPointGapEnabled: false, matchPointGapEnabled: true, matchPointGapThreshold: 20, matchPointGapCompletionRound: 2, matchPointGapLiveFromRound: 3 });
    resetMatch(db, matchId, 3); setRound(db, matchId, 1, 10, 0, true, 'BLUE'); setRound(db, matchId, 2, 0, 10, true, 'RED'); setRound(db, matchId, 3, 19, 0);
    db.prepare('UPDATE matches SET blue_score=29,red_score=10 WHERE id=?').run(matchId);
    const result = service.execute(actor, matchId, { type: 'SCORE', side: 'BLUE', pointType: 'BODY_PUNCH' });
    expect(result).toMatchObject({ state: 'COMPLETED', currentRound: 3, winner: 'BLUE', decisionMethod: 'POINT_GAP', blueScore: 30, redScore: 10 });
    expect(result.rounds[2]).toMatchObject({ blueScore: 20, winner: null, endedAt: null });
    expect(db.prepare('SELECT blue_score,red_score,decision_method FROM tournament_results WHERE match_id=?').get(matchId)).toMatchObject({ blue_score: 30, red_score: 10, decision_method: 'POINT_GAP' });
  });

  it('uses configured Gam-Jeom opponent points for round-gap evaluation', () => {
    const { db, service, actor, matchId, tournamentId } = system();
    policy(db, tournamentId, { roundPointGapEnabled: true, roundPointGapThreshold: 4, matchPointGapEnabled: false, gamJeomOpponentPoints: 2 });
    resetMatch(db, matchId); setRound(db, matchId, 1, 0, 2); db.prepare('UPDATE matches SET red_score=2 WHERE id=?').run(matchId); const baseline = service.snapshot(matchId).sequence;
    const result = service.execute(actor, matchId, { type: 'GAM_JEOM', side: 'BLUE' });
    expect(result).toMatchObject({ state: 'ROUND_BREAK', currentRound: 2, redScore: 4, blueGamJeom: 1 });
    expect(result.rounds[0]).toMatchObject({ winner: 'RED', decisionMethod: 'POINT_GAP' });
    const types = (db.prepare(`SELECT event_type FROM match_events WHERE match_id=? AND event_type IN ('penalty.accepted','match.round_changed') AND sequence>? ORDER BY sequence`).all(matchId, baseline) as Array<{ event_type: string }>).map(row => row.event_type);
    expect(types).toEqual(['penalty.accepted', 'match.round_changed']);
  });

  it('honors configured Gam-Jeom points and automatic disqualification threshold', () => {
    const { db, service, actor, matchId, tournamentId } = system();
    policy(db, tournamentId, { roundPointGapEnabled: false, matchPointGapEnabled: false, gamJeomOpponentPoints: 2, disqualificationThreshold: 2 });
    resetMatch(db, matchId); db.prepare('UPDATE match_rounds SET blue_penalties=1 WHERE match_id=? AND number=1').run(matchId);
    db.prepare('UPDATE matches SET blue_gam_jeom=1 WHERE id=?').run(matchId);
    const result = service.execute(actor, matchId, { type: 'GAM_JEOM', side: 'BLUE' });
    expect(result).toMatchObject({ state: 'DISQUALIFIED', winner: 'RED', decisionMethod: 'DISQUALIFICATION', redScore: 2, blueGamJeom: 2 });
    expect(db.prepare('SELECT red_score,decision_method FROM tournament_results WHERE match_id=?').get(matchId)).toMatchObject({ red_score: 2, decision_method: 'DISQUALIFICATION' });
  });

  it('keeps disqualification ahead of a gap reached by the same penalty', () => {
    const { db, service, actor, matchId, tournamentId } = system();
    policy(db, tournamentId, { roundPointGapEnabled: true, roundPointGapThreshold: 3, matchPointGapEnabled: true, matchPointGapThreshold: 3, matchPointGapLiveFromRound: 1 });
    resetMatch(db, matchId); setRound(db, matchId, 1, 0, 2); db.prepare('UPDATE match_rounds SET blue_penalties=4 WHERE match_id=? AND number=1').run(matchId);
    db.prepare('UPDATE matches SET red_score=2,blue_gam_jeom=4 WHERE id=?').run(matchId);
    const result = service.execute(actor, matchId, { type: 'GAM_JEOM', side: 'BLUE' });
    expect(result).toMatchObject({ state: 'DISQUALIFIED', winner: 'RED', decisionMethod: 'DISQUALIFICATION', blueGamJeom: 5 });
    expect(result.rounds[0]).toMatchObject({ winner: null, decisionMethod: null, endedAt: null });
    expect(db.prepare('SELECT decision_method FROM tournament_results WHERE match_id=?').get(matchId)).toMatchObject({ decision_method: 'DISQUALIFICATION' });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM match_events WHERE match_id=? AND json_extract(payload_json,'$.pointGap.scope') IS NOT NULL`).get(matchId)).toMatchObject({ count: 0 });
  });

  it('evaluates an accepted judge-consensus score after persisting that score', () => {
    const { db, service, actor, matchId, tournamentId } = system();
    policy(db, tournamentId, { roundPointGapEnabled: true, roundPointGapThreshold: 3, matchPointGapEnabled: false });
    resetMatch(db, matchId, 1, 'IN_PROGRESS');
    const j1 = service.exchangePairing(service.createPairing(actor, { matchId, role: 'J1', replace: true }).token, 'Point gap J1');
    const j2 = service.exchangePairing(service.createPairing(actor, { matchId, role: 'J2', replace: true }).token, 'Point gap J2');
    const roundId = service.snapshot(matchId).rounds[0]!.id; const baseline = service.snapshot(matchId).sequence;
    expect(service.submitProposal(j1.sessionToken, proposal(j1.session, roundId, 1)).status).toBe('PENDING');
    expect(service.submitProposal(j2.sessionToken, proposal(j2.session, roundId, 1)).status).toBe('ACCEPTED');
    const result = service.snapshot(matchId);
    expect(result).toMatchObject({ state: 'ROUND_BREAK', currentRound: 2, redScore: 3 });
    expect(result.rounds[0]).toMatchObject({ winner: 'RED', decisionMethod: 'POINT_GAP' });
    const types = (db.prepare(`SELECT event_type FROM match_events WHERE match_id=? AND event_type IN ('score.accepted','match.round_changed') AND sequence>? ORDER BY sequence`).all(matchId, baseline) as Array<{ event_type: string }>).map(row => row.event_type);
    expect(types).toEqual(['score.accepted', 'match.round_changed']);
  });
});

describe('versioned point-gap configuration', () => {
  const input = { roundPointGapEnabled: true, roundPointGapThreshold: 12, matchPointGapEnabled: true, matchPointGapThreshold: 18, matchPointGapCompletionRound: 2, matchPointGapLiveFromRound: 3, gamJeomOpponentPoints: 1, disqualificationThreshold: 5 };

  it('creates audited revisions, rejects stale versions, and locks active matches', () => {
    const { db, repository, actor, matchId, tournamentId } = system(); resetMatch(db, matchId, 1, 'READY');
    const current = repository.getTournament(tournamentId).ruleset as Ruleset;
    const saved = repository.updateRuleset(actor, tournamentId, { ...input, expectedVersion: current.version });
    expect(saved).toMatchObject({ ...input, version: `${current.version}-r2` });
    expect((repository.getTournament(tournamentId).ruleset as Ruleset).roundPointGapThreshold).toBe(12);
    expect(() => repository.updateRuleset(actor, tournamentId, { ...input, expectedVersion: current.version })).toThrow(/changed in another session/i);
    const savedAgain = repository.updateRuleset(actor, tournamentId, { ...input, roundPointGapThreshold: 14, expectedVersion: saved.version });
    expect(savedAgain.version).toBe(`${current.version}-r3`);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM audit_logs WHERE tournament_id=? AND action='RULESET_UPDATED'`).get(tournamentId)).toMatchObject({ count: 2 });
    db.prepare("UPDATE matches SET state='IN_PROGRESS' WHERE id=?").run(matchId);
    expect(() => repository.updateRuleset(actor, tournamentId, { ...input, expectedVersion: savedAgain.version })).toThrow(/cannot change while a match is active/i);
  });

  it('validates round numbers and restricts configuration to tournament administrators', () => {
    const { db, repository, actor, matchId, tournamentId } = system(); resetMatch(db, matchId, 1, 'READY');
    const current = repository.getTournament(tournamentId).ruleset as Ruleset;
    expect(() => repository.updateRuleset(actor, tournamentId, { ...input, matchPointGapCompletionRound: 4, expectedVersion: current.version })).toThrow(/validation failed/i);
    expect(() => repository.updateRuleset({ id: 'registration-manager', role: 'REGISTRATION_MANAGER', tournamentIds: [tournamentId] }, tournamentId, input)).toThrow(/administrator/i);
  });
});
