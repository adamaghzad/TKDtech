import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../../apps/local-server/src/persistence/database';
import { seedDevelopment } from '../../apps/local-server/src/persistence/seed';
import { TournamentRepository } from '../../apps/local-server/src/persistence/repository';
import { MatchService } from '../../apps/local-server/src/domain/match-service';
import type { Actor } from '../../apps/local-server/src/types';

const databases: SqliteDatabase[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) if (db.open) db.close();
});

function createFixture() {
  const db = openDatabase(':memory:');
  databases.push(db);
  seedDevelopment(db);
  const repository = new TournamentRepository(db);
  const matches = new MatchService(db, repository);
  const profile = db.prepare('SELECT id FROM profiles LIMIT 1').get() as { id: string };
  const actor: Actor = {
    id: profile.id,
    role: 'SUPER_ADMIN',
    tournamentIds: [],
  };
  const tournament = repository.createTournament(actor, {
    name: 'Club Sparring Day',
    startDate: '2026-11-01',
    endDate: '2026-11-01',
    matCount: 2,
    mode: 'LOCAL',
  });
  return { db, repository, matches, actor, tournamentId: tournament.id };
}

describe('general match (Chung vs Hong)', () => {
  it('creates a standalone CHUNG vs HONG match ready to start without polluting official athlete or category lists', () => {
    const { repository, matches, actor, tournamentId } = createFixture();
    const created = repository.createGeneralMatch(actor, tournamentId, {});

    expect(created.matId).toBeTruthy();
    const snap = matches.snapshot(created.matchId);
    expect(snap.blue.name).toBe('CHUNG');
    expect(snap.red.name).toBe('HONG');
    expect(snap.phase).toBe('GENERAL');
    expect(snap.categoryName).toBe('General Match');
    expect(snap.state).toBe('READY');
    expect(snap.totalRounds).toBe(3);
    expect(snap.timer.remainingMs).toBe(120_000);

    // Can start, score, and complete immediately
    matches.execute(actor, created.matchId, { type: 'START' });
    const afterScore = matches.execute(actor, created.matchId, {
      type: 'SCORE',
      side: 'BLUE',
      pointType: 'HEAD_KICK',
    });
    expect(afterScore.blueScore).toBe(3);

    // Official roster & categories remain empty (unpolluted by general-bout corner placeholders)
    const details = repository.getTournament(tournamentId) as {
      athletes: unknown[];
      categories: unknown[];
      matches: unknown[];
    };
    expect(details.athletes).toHaveLength(0);
    expect(details.categories).toHaveLength(0);
    expect(details.matches).toHaveLength(1);
  });

  it('allows simultaneous CHUNG vs HONG general matches on Mat 1 and Mat 2 without athlete conflicts', () => {
    const { repository, matches, actor, tournamentId } = createFixture();
    const details = repository.getTournament(tournamentId) as { mats: Array<{ id: string }> };
    const [mat1, mat2] = details.mats;

    const m1 = repository.createGeneralMatch(actor, tournamentId, { matId: mat1!.id });
    const m2 = repository.createGeneralMatch(actor, tournamentId, { matId: mat2!.id });

    const s1 = matches.execute(actor, m1.matchId, { type: 'START' });
    const s2 = matches.execute(actor, m2.matchId, { type: 'START' });
    expect(s1.state).toBe('IN_PROGRESS');
    expect(s2.state).toBe('IN_PROGRESS');
  });

  it('carries over active judge sessions to the next Chung vs Hong bout without sequence errors', () => {
    const { repository, matches, actor, tournamentId } = createFixture();
    const first = repository.createGeneralMatch(actor, tournamentId, {
      rounds: 2,
      roundDurationMs: 60_000,
      breakDurationMs: 30_000,
    });

    const p1 = matches.createPairing(actor, { matchId: first.matchId, role: 'J1' });
    const j1 = matches.exchangePairing(p1.token, 'Judge 1 Phone');
    matches.heartbeat(j1.sessionToken);

    matches.execute(actor, first.matchId, { type: 'START' });
    const round1Id = matches.snapshot(first.matchId).rounds[0]!.id;
    const firstProp = matches.submitProposal(j1.sessionToken, {
      eventId: randomUUID(),
      idempotencyKey: randomUUID(),
      matchId: first.matchId,
      roundId: round1Id,
      judgeSessionId: j1.session.id,
      side: 'BLUE',
      pointType: 'BODY_KICK',
      submittedAt: Date.now(),
      sequence: 1,
    });
    expect(firstProp.status).toBe('ACCEPTED');

    // Finish bout 1 by winning Round 1 & Round 2, then start Next Chung vs Hong carrying over J1
    matches.execute(actor, first.matchId, { type: 'PAUSE' });
    matches.execute(actor, first.matchId, { type: 'NEXT_ROUND' });
    matches.execute(actor, first.matchId, { type: 'RESUME' });
    matches.execute(actor, first.matchId, { type: 'SCORE', side: 'BLUE', pointType: 'BODY_KICK' });
    const completed = matches.execute(actor, first.matchId, { type: 'COMPLETE' });
    expect(completed.state).toBe('COMPLETED');
    expect(completed.winner).toBe('BLUE');

    const second = repository.createGeneralMatch(actor, tournamentId, {
      previousMatchId: first.matchId,
      carryOverDevices: true,
    });
    expect(second.matId).toBe(first.matId);

    const hb = matches.heartbeat(j1.sessionToken);
    expect(hb.match_id).toBe(second.matchId);

    const secondSnap = matches.execute(actor, second.matchId, { type: 'START' });
    expect(secondSnap.totalRounds).toBe(2);
    expect(secondSnap.blueScore).toBe(0);
    expect(secondSnap.redScore).toBe(0);

    const secondProp = matches.submitProposal(j1.sessionToken, {
      eventId: randomUUID(),
      idempotencyKey: randomUUID(),
      matchId: second.matchId,
      roundId: secondSnap.rounds[0]!.id,
      judgeSessionId: j1.session.id,
      side: 'RED',
      pointType: 'HEAD_KICK',
      submittedAt: Date.now(),
      sequence: 2,
    });
    expect(secondProp.status).toBe('ACCEPTED');
    expect(matches.snapshot(second.matchId).redScore).toBe(3);
  });

  it('locks PAUSE and RESUME to the exact millisecond captured on operator click across network RTT', () => {
    const { repository, matches, actor, tournamentId } = createFixture();
    const created = repository.createGeneralMatch(actor, tournamentId, {
      rounds: 3,
      roundDurationMs: 10_000,
      breakDurationMs: 30_000,
    });

    let fakeNow = 500_000;
    vi.spyOn(Date, 'now').mockImplementation(() => fakeNow);

    matches.execute(actor, created.matchId, { type: 'START' });

    // Scoring while running never double-subtracts elapsed time (10,000 - 2,000 = 8,000 ms)
    fakeNow = 500_000 + 2_000;
    const afterScore = matches.execute(actor, created.matchId, {
      type: 'SCORE',
      side: 'BLUE',
      pointType: 'BODY_KICK',
    });
    expect(afterScore.timer.remainingMs).toBe(8_000);

    // Operator clicks Pause at 6.51 (6,510 ms), request arrives on server 320 ms later (at 6,190 ms server-side)
    fakeNow = 500_000 + 3_810;
    const paused = matches.execute(actor, created.matchId, {
      type: 'PAUSE',
      clientRemainingMs: 6_510,
    });
    expect(paused.state).toBe('PAUSED');
    expect(paused.timer.running).toBe(false);
    expect(paused.timer.remainingMs).toBe(6_510);

    // Resuming 5 seconds later starts cleanly from the exact paused 6,510 ms
    fakeNow += 5_000;
    const resumed = matches.execute(actor, created.matchId, { type: 'RESUME' });
    expect(resumed.state).toBe('IN_PROGRESS');
    expect(resumed.timer.running).toBe(true);
    expect(resumed.timer.remainingMs).toBe(6_510);

    // Out-of-bounds spoofed clientRemainingMs (> 2.5s drift) is ignored in favor of authoritative server time
    fakeNow += 1_000; // true remaining = 5,510 ms
    const spoofPaused = matches.execute(actor, created.matchId, {
      type: 'PAUSE',
      clientRemainingMs: 9_999,
    });
    expect(spoofPaused.timer.remainingMs).toBe(5_510);

    // Operator Control PUBLIC_WAITING toggles Public TV waiting state and auto-clears on RESUME
    const waitingOn = matches.execute(actor, created.matchId, { type: 'PUBLIC_WAITING' });
    expect(waitingOn.publicWaiting).toBe(true);
    const waitingOff = matches.execute(actor, created.matchId, { type: 'PUBLIC_WAITING' });
    expect(waitingOff.publicWaiting).toBe(false);
    matches.execute(actor, created.matchId, { type: 'PUBLIC_WAITING', publicWaiting: true });
    expect(matches.snapshot(created.matchId).publicWaiting).toBe(true);
    const resumedClearsWaiting = matches.execute(actor, created.matchId, { type: 'RESUME' });
    expect(resumedClearsWaiting.publicWaiting).toBe(false);
  });

  it('toggles PUBLIC_WAITING cleanly on a COMPLETED match without duplicate tournament_results conflicts', () => {
    const { repository, matches, actor, tournamentId } = createFixture();
    const created = repository.createGeneralMatch(actor, tournamentId, { rounds: 2 });

    matches.execute(actor, created.matchId, { type: 'START' });
    matches.execute(actor, created.matchId, { type: 'SCORE', side: 'RED', pointType: 'HEAD_KICK' });
    matches.execute(actor, created.matchId, { type: 'PAUSE' });
    matches.execute(actor, created.matchId, { type: 'NEXT_ROUND' });
    matches.execute(actor, created.matchId, { type: 'RESUME' });
    matches.execute(actor, created.matchId, { type: 'SCORE', side: 'RED', pointType: 'HEAD_KICK' });
    const completed = matches.execute(actor, created.matchId, { type: 'COMPLETE' });
    expect(completed.state).toBe('COMPLETED');
    expect(completed.winner).toBe('RED');

    // Toggling TV Waiting ON and OFF on a COMPLETED match must succeed without UNIQUE constraint error
    const waitingOn = matches.execute(actor, created.matchId, {
      type: 'PUBLIC_WAITING',
      expectedVersion: completed.version,
    });
    expect(waitingOn.state).toBe('COMPLETED');
    expect(waitingOn.winner).toBe('RED');
    expect(waitingOn.publicWaiting).toBe(true);

    const waitingOff = matches.execute(actor, created.matchId, {
      type: 'PUBLIC_WAITING',
      expectedVersion: waitingOn.version,
    });
    expect(waitingOff.state).toBe('COMPLETED');
    expect(waitingOff.winner).toBe('RED');
    expect(waitingOff.publicWaiting).toBe(false);
  });

  it('enforces WT Best-of-3 Gam-Jeom rules: +1 opponent point, 5 Gam-Jeom per round = PUN round loss (resets next round), and Annulation des points + Gam-Jeom', () => {
    const { repository, matches, actor, tournamentId } = createFixture();
    const created = repository.createGeneralMatch(actor, tournamentId, { rounds: 3 });

    matches.execute(actor, created.matchId, { type: 'START' });

    // 1. Annulation des points: Blue scores +3 Head Kick while fouling -> cancelled (-3 Blue) + Gam-Jeom on Blue (+1 Red)
    const afterKick = matches.execute(actor, created.matchId, { type: 'SCORE', side: 'BLUE', pointType: 'HEAD_KICK' });
    expect(afterKick.rounds[0]).toMatchObject({ blueScore: 3, redScore: 0, bluePenalties: 0 });
    expect(afterKick.scoringActivity.blue.headHits).toBe(1);

    const afterFoulCancel = matches.execute(actor, created.matchId, {
      type: 'CANCEL_SCORE_WITH_GAM_JEOM',
      side: 'BLUE',
    });
    expect(afterFoulCancel.rounds[0]).toMatchObject({ blueScore: 0, redScore: 1, bluePenalties: 1 });
    expect(afterFoulCancel.blueScore).toBe(0);
    expect(afterFoulCancel.redScore).toBe(1);
    expect(afterFoulCancel.scoringActivity.blue.headHits).toBe(0);

    // Rejects cancelling when Red has no scored points in this round
    expect(() =>
      matches.execute(actor, created.matchId, { type: 'CANCEL_SCORE_WITH_GAM_JEOM', side: 'RED' }),
    ).toThrow(/no active scored point/i);

    // 2. Blue leads 6-4 on points in Round 1, then commits 5th Gam-Jeom in Round 1 -> loses ONLY Round 1 by PUN!
    matches.execute(actor, created.matchId, { type: 'SCORE', side: 'BLUE', pointType: 'TURNING_HEAD_KICK' });
    matches.execute(actor, created.matchId, { type: 'GAM_JEOM', side: 'BLUE' }); // GJ 2
    matches.execute(actor, created.matchId, { type: 'GAM_JEOM', side: 'BLUE' }); // GJ 3
    matches.execute(actor, created.matchId, { type: 'GAM_JEOM', side: 'BLUE' }); // GJ 4
    const endR1ByPun = matches.execute(actor, created.matchId, { type: 'GAM_JEOM', side: 'BLUE' }); // GJ 5 in R1!
    expect(endR1ByPun.state).toBe('ROUND_BREAK');
    expect(endR1ByPun.currentRound).toBe(2);
    expect(endR1ByPun.winner).toBeNull();
    expect(endR1ByPun.rounds[0]).toMatchObject({
      blueScore: 6,
      redScore: 5,
      bluePenalties: 5,
      winner: 'RED',
      decisionMethod: 'PUN',
    });

    // 3. Round 2 starts at 0-0 penalties: 4 Gam-Jeom in Round 2 (9 cumulative) does NOT end Round 2 or disqualify Blue
    const r2Live = matches.execute(actor, created.matchId, { type: 'RESUME' });
    expect(r2Live.rounds[1]).toMatchObject({ blueScore: 0, redScore: 0, bluePenalties: 0, redPenalties: 0 });
    for (let i = 1; i <= 4; i++) {
      const s = matches.execute(actor, created.matchId, { type: 'GAM_JEOM', side: 'BLUE' });
      expect(s.state).toBe('IN_PROGRESS');
      expect(s.rounds[1]?.bluePenalties).toBe(i);
    }

    // 5th Gam-Jeom in Round 2 ends Round 2 by PUN -> Red reaches 2 round wins (0-2) and wins the match!
    const matchWon = matches.execute(actor, created.matchId, { type: 'GAM_JEOM', side: 'BLUE' });
    expect(matchWon.state).toBe('COMPLETED');
    expect(matchWon.winner).toBe('RED');
    expect(matchWon.decisionMethod).toBe('ROUND_WINS');
    expect(matchWon.rounds[1]).toMatchObject({
      blueScore: 0,
      redScore: 5,
      bluePenalties: 5,
      winner: 'RED',
      decisionMethod: 'PUN',
    });
  });
});
