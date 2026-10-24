import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../../apps/local-server/src/persistence/database';
import { seedDevelopment } from '../../apps/local-server/src/persistence/seed';
import { TournamentRepository } from '../../apps/local-server/src/persistence/repository';
import type { Actor } from '../../apps/local-server/src/types';

let database: SqliteDatabase | undefined;
afterEach(() => { if (database?.open) database.close(); database = undefined; });

describe('draw persistence and broadcast identity', () => {
  it('creates eligible entries, returns the real tournament ID, and freezes a published version', () => {
    database = openDatabase(':memory:');
    const seeded = seedDevelopment(database)!;
    const repository = new TournamentRepository(database);
    const profile = database.prepare('SELECT id FROM profiles LIMIT 1').get() as { id: string };
    const actor: Actor = { id: profile.id, role: 'SUPER_ADMIN', tournamentIds: [seeded.tournamentId] };
    const { id: categoryId } = repository.createCategory(actor, seeded.tournamentId, {
      name: 'Integration -60 kg', division: 'MEN', ageGroup: 'SENIOR', minWeightKg: 54, maxWeightKg: 60,
      format: 'SINGLE_ELIMINATION', rounds: 3, roundDurationMs: 120000, breakDurationMs: 60000, goldenPointPolicy: 'GOLDEN_POINT'
    });
    for (const [firstName, lastName] of [['Nora', 'Bennani'], ['Salma', 'Idrissi']] as const) {
      repository.createAthlete(actor, seeded.tournamentId, {
        firstName, lastName, dateOfBirth: '2000-01-01', division: 'MEN', nationality: 'Morocco', countryCode: 'MAR',
        categoryId, weightKg: 59.2
      });
    }
    const generated = repository.generateDraw(actor, categoryId, 'RANDOM');
    expect(generated.tournamentId).toBe(seeded.tournamentId);
    expect(generated.bracket.categoryId).toBe(categoryId);
    expect(generated.bracket.orderedEntrantIds).toHaveLength(2);
    repository.publishDraw(actor, generated.drawId);
    const draw = database.prepare('SELECT status,published_version FROM draws WHERE id=?').get(generated.drawId) as { status: string; published_version: number };
    expect(draw).toEqual({ status: 'PUBLISHED', published_version: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM draw_versions WHERE draw_id=?').get(generated.drawId)).toEqual({ count: 1 });
  });
});
