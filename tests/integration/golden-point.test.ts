import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScoreProposalInput } from '@tkd/contracts';
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

/** Convert the seeded 3-round match into a 2-round match tied 1-1 (R1 Red, R2 Blue). */
function tiedTwoRoundMatch(db: SqliteDatabase, matchId: string) {
  db.prepare('UPDATE categories SET rounds=2 WHERE id=(SELECT category_id FROM matches WHERE id=?)').run(matchId);
  db.prepare('DELETE FROM match_rounds WHERE match_id=? AND number=3').run(matchId);
  resetMatch(db, matchId, 2);
  setRound(db, matchId, 1, 0, 5, true, 'RED');
  setRound(db, matchId, 2, 7, 0, true, 'BLUE');
  db.prepare('UPDATE matches SET blue_score=7,red_score=5 WHERE id=?').run(matchId);
}

function proposal(session: { id: string; match_id: string }, roundId: string, sequence: number, side: 'BLUE' | 'RED'): ScoreProposalInput {
  return { eventId: randomUUID(), matchId: session.match_id, roundId, judgeSessionId: session.id, side, pointType: 'HEAD_KICK', submittedAt: Date.now(), sequence, idempotencyKey: randomUUID() };
}

describe('Golden Point sudden death after tied rounds', () => {
  it('rejects completion of a 1-1 tied match and requires Golden Point', () => {
    const { db, service, actor, matchId } = system();
    tiedTwoRoundMatch(db, matchId);
    expect(service.snapshot(matchId)).toMatchObject({ state: 'PAUSED', currentRound: 2, totalRounds: 2 });
    expect(() => service.execute(actor, matchId, { type: 'COMPLETE' })).toThrow(/tied/i);
  });

  it('starts Golden Point and completes the match on the first judge-consensus score', () => {
    const { db, service, actor, matchId } = system();
    tiedTwoRoundMatch(db, matchId);
    const started = service.execute(actor, matchId, { type: 'START_GOLDEN_POINT' });
    expect(started).toMatchObject({ state: 'GOLDEN_POINT', currentRound: 3, totalRounds: 2 });
    expect(started.timer.kind).toBe('GOLDEN_POINT');
    expect(started.timer.running).toBe(true);

    const pair1 = service.createPairing(actor, { matchId, role: 'J1', replace: true });
    const pair2 = service.createPairing(actor, { matchId, role: 'J2', replace: true });
    const j1 = service.exchangePairing(pair1.token, 'Golden J1');
    const j2 = service.exchangePairing(pair2.token, 'Golden J2');
    const goldenRound = started.rounds.find(item => item.number === 3)!;
    expect(service.submitProposal(j1.sessionToken, proposal(j1.session, goldenRound.id, 1, 'BLUE')).status).toBe('PENDING');
    const accepted = service.submitProposal(j2.sessionToken, proposal(j2.session, goldenRound.id, 1, 'BLUE'));
    expect(accepted.status).toBe('ACCEPTED');

    const completed = service.snapshot(matchId);
    expect(completed).toMatchObject({ state: 'COMPLETED', winner: 'BLUE', decisionMethod: 'GOLDEN_POINT' });
    expect(completed.rounds.find(item => item.number === 3)).toMatchObject({ winner: 'BLUE', decisionMethod: 'GOLDEN_POINT' });
    const result = db.prepare('SELECT winner_athlete_id,decision_method FROM tournament_results WHERE match_id=?').get(matchId) as { winner_athlete_id: string; decision_method: string };
    expect(result).toMatchObject({ winner_athlete_id: completed.blue.id, decision_method: 'GOLDEN_POINT' });
  });

  it('completes Golden Point immediately on a manual operator score', () => {
    const { db, service, actor, matchId } = system();
    tiedTwoRoundMatch(db, matchId);
    service.execute(actor, matchId, { type: 'START_GOLDEN_POINT' });
    const completed = service.execute(actor, matchId, { type: 'SCORE', side: 'RED', pointType: 'BODY_KICK' });
    expect(completed).toMatchObject({ state: 'COMPLETED', winner: 'RED', decisionMethod: 'GOLDEN_POINT' });
    expect(completed.rounds.find(item => item.number === 3)).toMatchObject({ winner: 'RED', decisionMethod: 'GOLDEN_POINT' });
  });

  it('pauses on Golden Point timer expiry and restarts the same Golden Point round', () => {
    const { db, service, actor, matchId } = system();
    tiedTwoRoundMatch(db, matchId);
    service.execute(actor, matchId, { type: 'START_GOLDEN_POINT' });
    vi.spyOn(Date, 'now').mockReturnValue(100_000 + 61_000);
    const paused = service.execute(actor, matchId, { type: 'TIMER_EXPIRED' });
    expect(paused).toMatchObject({ state: 'PAUSED' });
    expect(paused.timer.kind).toBe('GOLDEN_POINT');
    const restarted = service.execute(actor, matchId, { type: 'START_GOLDEN_POINT' });
    expect(restarted).toMatchObject({ state: 'GOLDEN_POINT', currentRound: 3 });
    expect(restarted.rounds.filter(item => item.number > 2)).toHaveLength(1);
  });

  it('rejects Golden Point before the final round and when round wins are not tied', () => {
    const { db, service, actor, matchId } = system();
    resetMatch(db, matchId, 1);
    expect(() => service.execute(actor, matchId, { type: 'START_GOLDEN_POINT' })).toThrow(/final round/i);
    tiedTwoRoundMatch(db, matchId);
    setRound(db, matchId, 2, 0, 7, true, 'RED');
    expect(() => service.execute(actor, matchId, { type: 'START_GOLDEN_POINT' })).toThrow(/tied round wins/i);
  });
});
