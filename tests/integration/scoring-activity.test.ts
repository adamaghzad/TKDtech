import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { PointType, ScoreProposalInput } from '@tkd/contracts';
import { openDatabase, type SqliteDatabase } from '../../apps/local-server/src/persistence/database';
import { seedDevelopment } from '../../apps/local-server/src/persistence/seed';
import { TournamentRepository } from '../../apps/local-server/src/persistence/repository';
import { MatchService } from '../../apps/local-server/src/domain/match-service';
import type { Actor } from '../../apps/local-server/src/types';

const databases: SqliteDatabase[] = [];
afterEach(() => { for (const db of databases.splice(0)) if (db.open) db.close(); });

function system() {
  const db = openDatabase(':memory:'); databases.push(db);
  const seeded = seedDevelopment(db)!;
  const repository = new TournamentRepository(db);
  const profile = db.prepare('SELECT id FROM profiles LIMIT 1').get() as { id: string };
  const actor: Actor = { id: profile.id, role: 'SUPER_ADMIN', tournamentIds: [seeded.tournamentId] };
  return { db, actor, service: new MatchService(db, repository), ...seeded };
}
function input(session: { id: string; match_id: string }, roundId: string, pointType: PointType, sequence: number): ScoreProposalInput {
  return { eventId: randomUUID(), matchId: session.match_id, roundId, judgeSessionId: session.id, side: 'BLUE', pointType, submittedAt: Date.now(), sequence, idempotencyKey: randomUUID() };
}

describe('persisted scoreboard activity', () => {
  it('derives protector hits and every judge punch state from authoritative records', () => {
    const { service, actor, matchId } = system();
    service.execute(actor, matchId, { type: 'RESUME' });
    const before = service.snapshot(matchId);
    expect(before.scoringActivity).toEqual({ round: before.currentRound, blue: { headHits: 0, bodyHits: 1, punches: [] }, red: { headHits: 0, bodyHits: 0, punches: [] } });
    const roundId = before.rounds.find(round => round.number === before.currentRound)!.id;
    const j1 = service.exchangePairing(service.createPairing(actor, { matchId, role: 'J1', replace: true }).token, 'Activity J1');
    const j2 = service.exchangePairing(service.createPairing(actor, { matchId, role: 'J2', replace: true }).token, 'Activity J2');

    expect(service.submitProposal(j1.sessionToken, input(j1.session, roundId, 'HEAD_KICK', 1)).status).toBe('PENDING');
    expect(service.snapshot(matchId).scoringActivity.blue.headHits).toBe(0);
    expect(service.submitProposal(j2.sessionToken, input(j2.session, roundId, 'HEAD_KICK', 1)).status).toBe('ACCEPTED');
    expect(service.snapshot(matchId).scoringActivity.blue).toMatchObject({ headHits: 1, bodyHits: 1, punches: [] });

    service.execute(actor, matchId, { type: 'SCORE', side: 'RED', pointType: 'TURNING_BODY_KICK' });
    expect(service.submitProposal(j1.sessionToken, input(j1.session, roundId, 'BODY_PUNCH', 2)).status).toBe('PENDING');
    expect(service.snapshot(matchId).scoringActivity).toMatchObject({
      blue: { headHits: 1, bodyHits: 1, punches: [{ status: 'PENDING', confirmedJudges: ['J1'], requiredConfirmations: 2 }] },
      red: { headHits: 0, bodyHits: 1, punches: [] }
    });

    expect(service.submitProposal(j2.sessionToken, input(j2.session, roundId, 'BODY_PUNCH', 2)).status).toBe('ACCEPTED');
    const confirmed = service.snapshot(matchId);
    expect(confirmed.scoringActivity.blue).toMatchObject({ headHits: 1, bodyHits: 1, punches: [{ status: 'CONFIRMED', confirmedJudges: ['J1', 'J2'], requiredConfirmations: 2, points: 1 }] });
    expect(JSON.stringify(confirmed.scoringActivity)).not.toContain(j1.session.id);

    const j3 = service.exchangePairing(service.createPairing(actor, { matchId, role: 'J3', replace: true }).token, 'Second punch J3');
    expect(service.submitProposal(j3.sessionToken, input(j3.session, roundId, 'BODY_PUNCH', 1)).status).toBe('PENDING');
    const secondPending = service.snapshot(matchId).scoringActivity.blue.punches;
    expect(secondPending).toHaveLength(2);
    expect(secondPending[0]).toMatchObject({ status: 'CONFIRMED', confirmedJudges: ['J1', 'J2'] });
    expect(secondPending[1]).toMatchObject({ status: 'PENDING', confirmedJudges: ['J3'] });

    expect(service.submitProposal(j2.sessionToken, input(j2.session, roundId, 'BODY_PUNCH', 3)).status).toBe('ACCEPTED');
    const secondConfirmed = service.snapshot(matchId).scoringActivity.blue.punches;
    expect(secondConfirmed).toHaveLength(2);
    expect(secondConfirmed[0]).toMatchObject({ status: 'CONFIRMED', confirmedJudges: ['J1', 'J2'] });
    expect(secondConfirmed[1]).toMatchObject({ status: 'CONFIRMED', confirmedJudges: ['J2', 'J3'] });

    service.execute(actor, matchId, { type: 'UNDO', reason: 'Correct only the second punch and preserve the first' });
    const afterCorrection = service.snapshot(matchId).scoringActivity.blue;
    expect(afterCorrection).toMatchObject({ headHits: 1, bodyHits: 1 });
    expect(afterCorrection.punches).toHaveLength(1);
    expect(afterCorrection.punches[0]).toMatchObject({ status: 'CONFIRMED', confirmedJudges: ['J1', 'J2'] });
    service.execute(actor, matchId, { type: 'UNDO', reason: 'Correct the remaining first punch' });
    expect(service.snapshot(matchId).scoringActivity.blue.punches).toEqual([]);
  });

  it('persists pending-punch expiry before a refreshed snapshot', () => {
    const { db, service, actor, matchId } = system();
    service.execute(actor, matchId, { type: 'RESUME' });
    const before = service.snapshot(matchId);
    const roundId = before.rounds.find(round => round.number === before.currentRound)!.id;
    const j1 = service.exchangePairing(service.createPairing(actor, { matchId, role: 'J1', replace: true }).token, 'Expiring punch J1');
    expect(service.submitProposal(j1.sessionToken, input(j1.session, roundId, 'BODY_PUNCH', 1)).status).toBe('PENDING');
    expect(service.snapshot(matchId).scoringActivity.blue.punches[0]).toMatchObject({ status: 'PENDING', confirmedJudges: ['J1'] });
    expect(service.expireProposals(Date.now() + 1_001)).toEqual([matchId]);
    expect(service.snapshot(matchId).scoringActivity.blue.punches).toEqual([]);
    expect((db.prepare('SELECT status FROM scoring_proposals WHERE match_id=? AND point_type=?').get(matchId, 'BODY_PUNCH') as { status: string }).status).toBe('EXPIRED');
    expect(service.expireProposals(Date.now() + 1_002)).toEqual([]);
  });
});
