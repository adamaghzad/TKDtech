import { afterEach, describe, expect, it } from 'vitest';
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
  return { db, repository, actor, service: new MatchService(db, repository), tournamentId: seeded.tournamentId };
}

interface BracketMatch { id: string; round: number; position: number; blue: string | null; red: string | null }

function bracketMatches(db: SqliteDatabase, categoryId: string): BracketMatch[] {
  return db.prepare(`
    SELECT m.id, bn.round, bn.position, m.blue_athlete_id AS blue, m.red_athlete_id AS red
    FROM matches m JOIN bracket_nodes bn ON bn.id = m.bracket_node_id
    WHERE m.category_id = ? ORDER BY bn.round, bn.position
  `).all(categoryId) as BracketMatch[];
}

/** Record a two-round win for one side and complete the match through the authoritative COMPLETE command. */
function winMatch(db: SqliteDatabase, service: MatchService, actor: Actor, matchId: string, winnerSide: 'BLUE' | 'RED') {
  const blue = winnerSide === 'BLUE' ? 5 : 0;
  const red = winnerSide === 'BLUE' ? 0 : 5;
  db.prepare("UPDATE matches SET current_round=2,state='PAUSED',blue_score=?,red_score=?,timer_json=? WHERE id=?")
    .run(blue * 2, red * 2, JSON.stringify({ remainingMs: 60_000, running: false, authoritativeAt: 100_000, kind: 'ROUND' }), matchId);
  for (const round of [1, 2]) {
    db.prepare('UPDATE match_rounds SET blue_score=?,red_score=?,winner_side=?,decision_method=?,ended_at=? WHERE match_id=? AND number=?')
      .run(blue, red, winnerSide, 'SCORE', new Date(90_000).toISOString(), matchId, round);
  }
  return service.execute(actor, matchId, { type: 'COMPLETE' });
}

function medalRows(db: SqliteDatabase, categoryId: string) {
  return db.prepare(`
    SELECT ms.place, ms.athlete_id, ms.club_id, ms.result_id, a.first_name||' '||a.last_name AS athlete_name, cl.name AS club_name
    FROM medal_standings ms JOIN athletes a ON a.id=ms.athlete_id LEFT JOIN clubs cl ON cl.id=ms.club_id
    WHERE ms.category_id=? ORDER BY ms.place, athlete_name
  `).all(categoryId) as Array<{ place: number; athlete_id: string; club_id: string | null; result_id: string; athlete_name: string; club_name: string | null }>;
}

describe('medal standings for athletes and clubs', () => {
  it('awards gold, silver, and two bronzes when the category final is resolved', () => {
    const { db, repository, actor, service, tournamentId } = system();
    const atlas = repository.createClub(actor, tournamentId, { name: 'Atlas TKD', country: 'Morocco', countryCode: 'MAR' });
    const seoul = repository.createClub(actor, tournamentId, { name: 'Seoul TKD', country: 'Korea', countryCode: 'KOR' });
    const { id: categoryId } = repository.createCategory(actor, tournamentId, {
      name: 'Medals -58 kg', division: 'MEN', ageGroup: 'SENIOR', minWeightKg: 54, maxWeightKg: 58,
      format: 'SINGLE_ELIMINATION', rounds: 2, roundDurationMs: 120_000, breakDurationMs: 60_000, goldenPointPolicy: 'GOLDEN_POINT',
    });
    const athleteIds: string[] = [];
    for (const [firstName, lastName, clubId] of [['Karim','Benali',atlas.id],['Omar','Sabri',atlas.id],['Ji','Hoon',seoul.id],['Min','Chul',seoul.id]] as const) {
      athleteIds.push(repository.createAthlete(actor, tournamentId, {
        firstName, lastName, dateOfBirth: '2001-05-04', division: 'MEN', nationality: 'Test', countryCode: 'TST',
        clubId, categoryId, weightKg: 57.4,
      }).id);
    }
    const draw = repository.generateDraw(actor, categoryId, 'SEEDED');
    repository.publishDraw(actor, draw.drawId);

    let matches = bracketMatches(db, categoryId);
    expect(matches).toHaveLength(3);
    const semifinals = matches.filter(match => match.round === 1);
    expect(medalRows(db, categoryId)).toHaveLength(0);

    // Both semifinals resolve (blue wins SF1, red wins SF2) — the final is still pending, so no medals yet.
    winMatch(db, service, actor, semifinals[0]!.id, 'BLUE');
    winMatch(db, service, actor, semifinals[1]!.id, 'RED');
    expect(medalRows(db, categoryId)).toHaveLength(0);

    matches = bracketMatches(db, categoryId);
    const finalNow = matches.find(match => match.round === 2)!;
    expect(finalNow.blue).toBeTruthy();
    expect(finalNow.red).toBeTruthy();
    const winnerSide: 'BLUE' | 'RED' = 'BLUE';
    const goldId = finalNow.blue!;
    const silverId = finalNow.red!;
    const resolved = winMatch(db, service, actor, finalNow.id, winnerSide);
    expect(resolved).toMatchObject({ state: 'COMPLETED', winner: winnerSide });

    const medals = medalRows(db, categoryId);
    expect(medals.map(medal => medal.place).sort()).toEqual([1, 2, 3, 3]);
    const gold = medals.find(medal => medal.place === 1)!;
    const silver = medals.find(medal => medal.place === 2)!;
    const bronzes = medals.filter(medal => medal.place === 3);
    expect(gold.athlete_id).toBe(goldId);
    expect(silver.athlete_id).toBe(silverId);
    const expectedBronzeIds = [semifinals[0]!.red, semifinals[1]!.blue];
    expect(bronzes.map(medal => medal.athlete_id).sort()).toEqual([...expectedBronzeIds].sort());
    for (const medal of medals) expect(medal.result_id).toBeTruthy();
    const clubOf = new Map(athleteIds.map(id => [id, id === athleteIds[0] || id === athleteIds[1] ? 'Atlas TKD' : 'Seoul TKD']));
    for (const medal of medals) expect(medal.club_name).toBe(clubOf.get(medal.athlete_id));

    // Tournament details feed the athlete & club medal tables.
    const details = repository.getTournament(tournamentId) as { medals?: Array<{ place: number; category_name: string }> };
    const categoryMedals = details.medals!.filter(medal => medal.category_name === 'Medals -58 kg');
    expect(categoryMedals).toHaveLength(4);
    expect(categoryMedals.filter(medal => medal.place === 3)).toHaveLength(2);

    // The dashboard club aggregation counts gold/silver/bronze per club.
    const clubStandings = db.prepare(`
      SELECT cl.name AS club_name, SUM(CASE WHEN ms.place=1 THEN 1 ELSE 0 END) AS gold,
             SUM(CASE WHEN ms.place=2 THEN 1 ELSE 0 END) AS silver,
             SUM(CASE WHEN ms.place=3 THEN 1 ELSE 0 END) AS bronze
      FROM medal_standings ms JOIN clubs cl ON cl.id=ms.club_id WHERE ms.category_id=? GROUP BY cl.id
    `).all(categoryId) as Array<{ club_name: string; gold: number; silver: number; bronze: number }>;
    expect(clubStandings).toHaveLength(2);
    expect(clubStandings.reduce((sum, row) => sum + row.gold + row.silver + row.bronze, 0)).toBe(4);

    // Idempotent: recomputing an unchanged bracket does not churn rows.
    expect(repository.refreshMedalStandings(categoryId, actor.id)).toEqual({ inserted: 0, removed: 0 });
    expect(medalRows(db, categoryId)).toHaveLength(4);

    const auditRow = db.prepare("SELECT action FROM audit_logs WHERE entity_id=? AND action='MEDAL_STANDINGS_REFRESHED'").get(categoryId) as { action: string } | undefined;
    expect(auditRow?.action).toBe('MEDAL_STANDINGS_REFRESHED');
  });

  it('keeps medal_standings empty for a two-athlete final-only category until it resolves', () => {
    const { db, repository, actor, service, tournamentId } = system();
    const { id: categoryId } = repository.createCategory(actor, tournamentId, {
      name: 'Medals duel', division: 'WOMEN', ageGroup: 'SENIOR', minWeightKg: 46, maxWeightKg: 49,
      format: 'SINGLE_ELIMINATION', rounds: 2, roundDurationMs: 120_000, breakDurationMs: 60_000, goldenPointPolicy: 'GOLDEN_POINT',
    });
    for (const [firstName, lastName] of [['Salma','A'],['Nora','B']] as const) {
      repository.createAthlete(actor, tournamentId, { firstName, lastName, dateOfBirth: '2002-01-01', division: 'WOMEN', nationality: 'Test', countryCode: 'TST', categoryId, weightKg: 48 });
    }
    const draw = repository.generateDraw(actor, categoryId, 'RANDOM');
    repository.publishDraw(actor, draw.drawId);
    const matches = bracketMatches(db, categoryId);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.round).toBe(1);
    winMatch(db, service, actor, matches[0]!.id, 'RED');
    const medals = medalRows(db, categoryId);
    expect(medals.map(medal => medal.place).sort()).toEqual([1, 2]);
  });

  it('updates medals when a result is corrected through a fresh recompute', () => {
    const { db, repository, actor, service, tournamentId } = system();
    const club = repository.createClub(actor, tournamentId, { name: 'Correction TKD', country: 'Morocco', countryCode: 'MAR' });
    const { id: categoryId } = repository.createCategory(actor, tournamentId, {
      name: 'Medals correction', division: 'MEN', ageGroup: 'SENIOR', minWeightKg: 68, maxWeightKg: 73,
      format: 'SINGLE_ELIMINATION', rounds: 2, roundDurationMs: 120_000, breakDurationMs: 60_000, goldenPointPolicy: 'GOLDEN_POINT',
    });
    for (const [firstName, lastName] of [['Ali','One'],['Ali','Two'],['Ali','Three'],['Ali','Four']] as const) {
      repository.createAthlete(actor, tournamentId, { firstName, lastName, dateOfBirth: '2000-01-01', division: 'MEN', nationality: 'Test', countryCode: 'TST', clubId: club.id, categoryId, weightKg: 71 });
    }
    const draw = repository.generateDraw(actor, categoryId, 'SEEDED');
    repository.publishDraw(actor, draw.drawId);
    let matches = bracketMatches(db, categoryId);
    const semifinals = matches.filter(match => match.round === 1);
    winMatch(db, service, actor, semifinals[0]!.id, 'BLUE');
    winMatch(db, service, actor, semifinals[1]!.id, 'BLUE');
    matches = bracketMatches(db, categoryId);
    const final = matches.find(match => match.round === 2)!;
    winMatch(db, service, actor, final.id, 'RED');
    let medals = medalRows(db, categoryId);
    expect(medals).toHaveLength(4);
    const goldBefore = medals.find(medal => medal.place === 1)!.athlete_id;

    // A correction flips the final to the other athlete: rewrite the authoritative
    // result and bracket winner, then the recompute swaps gold and silver.
    const finalMatchId = final.id;
    db.prepare("UPDATE matches SET winner_side='BLUE',version=version+1 WHERE id=?").run(finalMatchId);
    db.prepare("UPDATE bracket_nodes SET winner_athlete_id=blue_athlete_id WHERE id=(SELECT bracket_node_id FROM matches WHERE id=?)").run(finalMatchId);
    db.prepare('UPDATE tournament_results SET winner_athlete_id=(SELECT blue_athlete_id FROM matches WHERE id=?),loser_athlete_id=(SELECT red_athlete_id FROM matches WHERE id=?) WHERE match_id=?').run(finalMatchId, finalMatchId, finalMatchId);
    const outcome = repository.refreshMedalStandings(categoryId, actor.id);
    expect(outcome).toEqual({ inserted: 4, removed: 4 });
    medals = medalRows(db, categoryId);
    expect(medals).toHaveLength(4);
    const goldAfter = medals.find(medal => medal.place === 1)!.athlete_id;
    const silverAfter = medals.find(medal => medal.place === 2)!.athlete_id;
    expect(goldAfter).not.toBe(goldBefore);
    expect(silverAfter).toBe(goldBefore);
  });
});
