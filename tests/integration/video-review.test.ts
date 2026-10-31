import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

function system(filename = ':memory:') {
  const db = openDatabase(filename);
  databases.push(db);
  const seeded = seedDevelopment(db)!;
  const repository = new TournamentRepository(db);
  const profile = db.prepare('SELECT id FROM profiles LIMIT 1').get() as { id: string };
  const actor: Actor = { id: profile.id, role: 'SUPER_ADMIN', tournamentIds: [seeded.tournamentId] };
  return { db, repository, actor, service: new MatchService(db, repository), ...seeded };
}

function setReviewRound(db: SqliteDatabase, matchId: string) {
  db.prepare(`UPDATE matches SET current_round=1,state='PAUSED',blue_score=5,red_score=2,blue_gam_jeom=0,red_gam_jeom=0,winner_side=NULL,decision_method=NULL,actual_end_at=NULL,timer_json=? WHERE id=?`)
    .run(JSON.stringify({ remainingMs: 45000, running: false, authoritativeAt: 100000, kind: 'ROUND' }), matchId);
  db.prepare(`UPDATE match_rounds SET blue_score=5,red_score=2,blue_penalties=0,red_penalties=0,winner_side=NULL,decision_method=NULL,ended_at=NULL WHERE match_id=? AND number=1`).run(matchId);
}

describe('authoritative Instant Video Replay workflow', () => {
  it('persists the requesting corner and rejects without changing the score', () => {
    const { db, service, actor, matchId } = system();
    setReviewRound(db, matchId);
    vi.spyOn(Date, 'now').mockReturnValue(100000);

    const requested = service.execute(actor, matchId, { type: 'VIDEO_REVIEW', side: 'RED' });
    expect(requested).toMatchObject({
      state: 'UNDER_REVIEW',
      blueScore: 5,
      redScore: 2,
      timer: { running: false },
      videoReview: { status: 'REQUESTED', requestedBy: 'RED', requestedAt: 100000, decidedAt: null },
    });

    const rejected = service.execute(actor, matchId, {
      type: 'END_REVIEW', side: 'BLUE', outcome: 'REJECTED', reviewCorrection: 'POINTS', reviewAction: 'ADD', reviewPoints: 4,
      reason: 'The requested head kick was not confirmed',
    });
    expect(rejected).toMatchObject({
      state: 'PAUSED', blueScore: 5, redScore: 2,
      videoReview: { status: 'REJECTED', requestedBy: 'RED', requestedAt: 100000, decidedAt: 100000 },
    });
    expect(rejected.rounds[0]).toMatchObject({ blueScore: 5, redScore: 2 });
    const event = db.prepare(`SELECT payload_json FROM match_events WHERE match_id=? AND event_type='match.review_completed'`).get(matchId) as { payload_json: string };
    expect(JSON.parse(event.payload_json)).toMatchObject({ requestedBy: 'RED', outcome: 'REJECTED', correction: null });
    const audit = db.prepare(`SELECT reason FROM audit_logs WHERE entity_id=? AND action='MATCH_END_REVIEW'`).get(matchId) as { reason: string };
    expect(audit.reason).toBe('The requested head kick was not confirmed');
  });

  it('accepts an explicit point correction atomically and preserves the public outcome', () => {
    const { db, service, actor, matchId } = system();
    setReviewRound(db, matchId);
    vi.spyOn(Date, 'now').mockReturnValue(100000);
    service.execute(actor, matchId, { type: 'VIDEO_REVIEW', side: 'BLUE' });

    const accepted = service.execute(actor, matchId, {
      type: 'END_REVIEW', side: 'BLUE', outcome: 'ACCEPTED', reviewCorrection: 'POINTS', reviewAction: 'ADD', reviewPoints: 4,
      reason: 'Video confirmed four points for Blue',
    });
    expect(accepted).toMatchObject({
      state: 'PAUSED', blueScore: 9, redScore: 2,
      videoReview: { status: 'ACCEPTED', requestedBy: 'BLUE', decidedAt: 100000 },
    });
    expect(accepted.rounds[0]).toMatchObject({ blueScore: 9, redScore: 2 });
    const event = db.prepare(`SELECT payload_json FROM match_events WHERE match_id=? AND event_type='match.review_completed'`).get(matchId) as { payload_json: string };
    expect(JSON.parse(event.payload_json)).toMatchObject({
      outcome: 'ACCEPTED',
      correction: { kind: 'POINTS', side: 'BLUE', action: 'ADD', points: 4, round: 1 },
    });
  });

  it('adds and removes Gam-Jeom with the configured opponent-point adjustment', () => {
    const { db, service, actor, matchId } = system();
    setReviewRound(db, matchId);
    vi.spyOn(Date, 'now').mockReturnValue(100000);
    service.execute(actor, matchId, { type: 'VIDEO_REVIEW', side: 'RED' });
    const added = service.execute(actor, matchId, {
      type: 'END_REVIEW', side: 'BLUE', outcome: 'ACCEPTED', reviewCorrection: 'GAM_JEOM', reviewAction: 'ADD',
    });
    expect(added).toMatchObject({ blueScore: 5, redScore: 3, blueGamJeom: 1, redGamJeom: 0 });
    expect(added.rounds[0]).toMatchObject({ blueScore: 5, redScore: 3, bluePenalties: 1, redPenalties: 0 });

    service.execute(actor, matchId, { type: 'VIDEO_REVIEW', side: 'BLUE' });
    const removed = service.execute(actor, matchId, {
      type: 'END_REVIEW', side: 'BLUE', outcome: 'ACCEPTED', reviewCorrection: 'GAM_JEOM', reviewAction: 'REMOVE',
    });
    expect(removed).toMatchObject({ blueScore: 5, redScore: 2, blueGamJeom: 0, redGamJeom: 0 });
    expect(removed.rounds[0]).toMatchObject({ blueScore: 5, redScore: 2, bluePenalties: 0, redPenalties: 0 });
  });

  it('rejects impossible removals and never applies a partial correction', () => {
    const { db, service, actor, matchId } = system();
    setReviewRound(db, matchId);
    vi.spyOn(Date, 'now').mockReturnValue(100000);
    service.execute(actor, matchId, { type: 'VIDEO_REVIEW', side: 'BLUE' });
    const before = db.prepare(`SELECT COUNT(*) AS count FROM match_events WHERE match_id=?`).get(matchId) as { count: number };

    expect(() => service.execute(actor, matchId, {
      type: 'END_REVIEW', side: 'RED', outcome: 'ACCEPTED', reviewCorrection: 'POINTS', reviewAction: 'REMOVE', reviewPoints: 4,
    })).toThrow(/cannot be removed below zero/i);
    const unchanged = service.snapshot(matchId);
    expect(unchanged).toMatchObject({ state: 'UNDER_REVIEW', blueScore: 5, redScore: 2 });
    expect(unchanged.rounds[0]).toMatchObject({ blueScore: 5, redScore: 2 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM match_events WHERE match_id=?`).get(matchId)).toEqual({ count: before.count });
  });

  it('does not guess the target round for a correction during the break', () => {
    const { db, service, actor, matchId } = system();
    setReviewRound(db, matchId);
    db.prepare(`UPDATE matches SET current_round=2,state='ROUND_BREAK',timer_json=? WHERE id=?`)
      .run(JSON.stringify({ remainingMs: 30000, running: false, authoritativeAt: 100000, kind: 'BREAK' }), matchId);
    const nextRound = db.prepare(`SELECT blue_score,red_score FROM match_rounds WHERE match_id=? AND number=2`).get(matchId);
    vi.spyOn(Date, 'now').mockReturnValue(100000);
    service.execute(actor, matchId, { type: 'VIDEO_REVIEW', side: 'BLUE' });

    expect(() => service.execute(actor, matchId, {
      type: 'END_REVIEW', side: 'BLUE', outcome: 'ACCEPTED', reviewCorrection: 'POINTS', reviewAction: 'ADD', reviewPoints: 1,
    })).toThrow(/cannot be applied during the round break/i);
    expect(db.prepare(`SELECT blue_score,red_score FROM match_rounds WHERE match_id=? AND number=2`).get(matchId)).toEqual(nextRound);
    expect(service.execute(actor, matchId, { type: 'END_REVIEW', outcome: 'REJECTED' })).toMatchObject({ state: 'PAUSED', blueScore: 5, redScore: 2 });
  });

  it('keeps result management operator-only and recovers review state after restart', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'tkd-video-review-'));
    const filename = path.join(directory, 'test.db');
    try {
      const first = system(filename);
      setReviewRound(first.db, first.matchId);
      const clock = vi.spyOn(Date, 'now').mockReturnValue(100000);
      const referee: Actor = { id: 'referee-video-review', role: 'REFEREE', tournamentIds: [first.tournamentId] };
      first.service.execute(referee, first.matchId, { type: 'VIDEO_REVIEW', side: 'BLUE' });
      expect(() => first.service.execute(referee, first.matchId, { type: 'END_REVIEW', outcome: 'REJECTED' })).toThrow(/authorized review operator/i);
      first.db.close();
      databases.splice(databases.indexOf(first.db), 1);

      const db = openDatabase(filename);
      databases.push(db);
      const service = new MatchService(db, new TournamentRepository(db));
      expect(service.snapshot(first.matchId).videoReview).toMatchObject({ status: 'REQUESTED', requestedBy: 'BLUE', requestedAt: 100000 });
      clock.mockReturnValue(101000);
      const accepted = service.execute(first.actor, first.matchId, {
        type: 'END_REVIEW', side: 'RED', outcome: 'ACCEPTED', reviewCorrection: 'POINTS', reviewAction: 'ADD', reviewPoints: 2,
      });
      expect(accepted).toMatchObject({ redScore: 4, videoReview: { status: 'ACCEPTED', decidedAt: 101000 } });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
