import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../../apps/local-server/src/persistence/database';
import { seedDevelopment } from '../../apps/local-server/src/persistence/seed';
import { SyncService } from '../../apps/local-server/src/sync/sync-service';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));

describe('cloud synchronization boundary', () => {
  let db: SqliteDatabase;
  let tournamentId: string;
  let matchId: string;
  let service: SyncService;
  let eventCount: number;
  const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-only-test-key';
    db = openDatabase(':memory:');
    seedDevelopment(db);
    tournamentId = (db.prepare('SELECT id FROM tournaments LIMIT 1').get() as { id: string }).id;
    matchId = (db.prepare('SELECT id FROM matches LIMIT 1').get() as { id: string }).id;
    const sequenceStart = (db.prepare('SELECT COALESCE(MAX(sequence),0) AS value FROM match_events WHERE match_id=?').get(matchId) as { value: number }).value;
    for (let index = 1; index <= 2; index++) {
      db.prepare('INSERT INTO match_events(event_id,tournament_id,match_id,sequence,event_type,payload_json,idempotency_key,server_timestamp,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(randomUUID(), tournamentId, matchId, sequenceStart + index, 'test.event', '{}', `test-${randomUUID()}`, index, new Date().toISOString());
    }
    eventCount = (db.prepare('SELECT COUNT(*) AS count FROM match_events WHERE tournament_id=?').get(tournamentId) as { count: number }).count;
    service = new SyncService(db);
    mocks.rpc.mockReset();
  });

  afterEach(() => {
    db.close();
    if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  });

  it('replays the complete log safely and records server acknowledgements', async () => {
    mocks.rpc.mockResolvedValue({ data: { status: 'ACCEPTED' }, error: null });
    const first = await service.push(tournamentId);
    expect(first).toMatchObject({ status: 'COMPLETED', uploaded: eventCount, duplicate: 0 });
    mocks.rpc.mockResolvedValue({ data: { status: 'DUPLICATE' }, error: null });
    const retry = await service.push(tournamentId);
    expect(retry).toMatchObject({ status: 'COMPLETED', uploaded: 0, duplicate: eventCount });
    expect(mocks.rpc).toHaveBeenCalledTimes(eventCount * 2);
  });

  it('never marks a conflicting cloud delivery complete', async () => {
    mocks.rpc.mockResolvedValue({ data: { status: 'CONFLICT', reason: 'SEQUENCE_GAP', cloudSequence: 7 }, error: null });
    const result = await service.push(tournamentId);
    expect(result.status).toBe('CONFLICT');
    expect(result.reason).toBe('SEQUENCE_GAP');
    const job = db.prepare('SELECT status,conflict_json FROM synchronization_jobs WHERE id=?').get(result.jobId) as { status: string; conflict_json: string };
    expect(job.status).toBe('CONFLICT');
    expect(job.conflict_json).toContain('SEQUENCE_GAP');
  });
});
