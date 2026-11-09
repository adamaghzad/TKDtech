import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import type { SqliteDatabase } from '../persistence/database';
import { isoNow } from '../persistence/audit';
import { HttpError } from '../http';

interface SyncResult {
  jobId: string;
  status: 'COMPLETED' | 'CONFLICT' | 'FAILED';
  uploaded: number;
  pulled: number;
  duplicate: number;
  reason?: string;
  direction: 'PUSH' | 'PULL' | 'SYNC';
}

export class SyncService {
  private cloud: SupabaseClient | null = null;

  constructor(private readonly db: SqliteDatabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      this.cloud = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    }
  }

  configured(): boolean {
    return Boolean(this.cloud);
  }

  async push(tournamentId: string): Promise<SyncResult> {
    if (!this.cloud) throw new HttpError(409, 'CLOUD_NOT_CONFIGURED', 'Configure Supabase URL and the server-only service-role key before synchronization.');
    const jobId = randomUUID();
    this.db.prepare("INSERT INTO synchronization_jobs(id, tournament_id, direction, status, last_version, created_at, updated_at) VALUES(?, ?, 'PUSH', 'RUNNING', ?, ?, ?)").run(jobId, tournamentId, 0, isoNow(), isoNow());
    const events = this.db.prepare('SELECT * FROM match_events WHERE tournament_id=? ORDER BY match_id, sequence').all(tournamentId) as Array<{ event_id: string; match_id: string; sequence: number; event_type: string; payload_json: string; idempotency_key: string; server_timestamp: number; actor_id?: string | null; actor_session_id?: string | null }>;
    let uploaded = 0;
    let duplicate = 0;
    let maxSequence = 0;

    try {
      for (const event of events) {
        maxSequence = Math.max(maxSequence, event.sequence);
        const { data, error } = await this.cloud.rpc('ingest_local_event', {
          p_event_id: event.event_id,
          p_tournament_id: tournamentId,
          p_match_id: event.match_id,
          p_sequence: event.sequence,
          p_event_type: event.event_type,
          p_payload: JSON.parse(event.payload_json),
          p_idempotency_key: event.idempotency_key,
          p_server_timestamp: event.server_timestamp,
        });
        if (error) throw new Error(error.message);
        const result = data as { status: string; reason?: string; cloudSequence?: number };
        if (result.status === 'DUPLICATE') {
          duplicate++;
          continue;
        }
        if (result.status !== 'ACCEPTED') {
          const reason = result.reason ?? result.status;
          this.db.prepare("UPDATE synchronization_jobs SET status='CONFLICT', conflict_json=?, last_version=?, updated_at=? WHERE id=?").run(JSON.stringify(result), maxSequence, isoNow(), jobId);
          return { jobId, status: 'CONFLICT', uploaded, duplicate, pulled: 0, reason, direction: 'PUSH' };
        }
        uploaded++;
        this.db.prepare('UPDATE synchronization_jobs SET last_event_id=?, last_version=?, updated_at=? WHERE id=?').run(event.event_id, event.sequence, isoNow(), jobId);
      }
      this.db.prepare("UPDATE synchronization_jobs SET status='COMPLETED', last_version=?, updated_at=? WHERE id=?").run(maxSequence, isoNow(), jobId);
      return { jobId, status: 'COMPLETED', uploaded, duplicate, pulled: 0, direction: 'PUSH' };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown synchronization failure';
      this.db.prepare("UPDATE synchronization_jobs SET status='FAILED', conflict_json=?, updated_at=? WHERE id=?").run(JSON.stringify({ reason }), isoNow(), jobId);
      throw new HttpError(502, 'SYNC_FAILED', reason);
    }
  }

  async pull(tournamentId: string): Promise<SyncResult> {
    if (!this.cloud) throw new HttpError(409, 'CLOUD_NOT_CONFIGURED', 'Configure Supabase URL and the server-only service-role key before synchronization.');
    const jobId = randomUUID();
    this.db.prepare("INSERT INTO synchronization_jobs(id, tournament_id, direction, status, last_version, created_at, updated_at) VALUES(?, ?, 'PULL', 'RUNNING', ?, ?, ?)").run(jobId, tournamentId, 0, isoNow(), isoNow());

    const { data: cloudEvents, error } = await this.cloud
      .from('match_events')
      .select('event_id, tournament_id, match_id, sequence, event_type, actor_id, actor_session_id, payload_json, idempotency_key, server_timestamp, created_at')
      .eq('tournament_id', tournamentId)
      .order('match_id, sequence');
    if (error) throw new Error(error.message);

    const events = (cloudEvents ?? []) as Array<{ event_id: string; match_id: string; sequence: number; event_type: string; payload_json: string; idempotency_key: string; server_timestamp: number; created_at: string; actor_id?: string | null; actor_session_id?: string | null }>;
    let pulled = 0;
    let duplicate = 0;
    let maxSequence = 0;

    try {
      const eventsByMatch = new Map<string, Array<typeof events[0]>>();
      for (const event of events) {
        if (!eventsByMatch.has(event.match_id)) eventsByMatch.set(event.match_id, []);
        eventsByMatch.get(event.match_id)!.push(event);
      }

      for (const [matchId, matchEvents] of eventsByMatch) {
        const localMaxSeq = this.db.prepare('SELECT COALESCE(MAX(sequence),0) AS value FROM match_events WHERE match_id=?').get(matchId) as { value: number };
        const localSequence = localMaxSeq.value;
        const newEvents = matchEvents.filter(e => e.sequence > localSequence);

        let expectedSequence = localSequence + 1;
        for (const event of newEvents) {
          if (event.sequence !== expectedSequence) {
            const reason = `SEQUENCE_GAP: localSequence=${localSequence}, cloudSequence=${event.sequence}, expected=${expectedSequence}`;
            this.db.prepare("UPDATE synchronization_jobs SET status='CONFLICT', conflict_json=?, last_version=?, updated_at=? WHERE id=?").run(JSON.stringify({ reason }), maxSequence, isoNow(), jobId);
            return { jobId, status: 'CONFLICT', uploaded: 0, pulled, duplicate, reason, direction: 'PULL' };
          }
          expectedSequence++;
        }

        const existingIds = new Set((this.db.prepare('SELECT event_id FROM match_events WHERE event_id IN (' + newEvents.map(() => '?').join(',') + ')').all(newEvents.map(e => e.event_id)) as Array<{ event_id: string }>).map(r => r.event_id));
        const insertEvent = this.db.prepare('INSERT INTO match_events(event_id, tournament_id, match_id, sequence, event_type, actor_id, actor_session_id, payload_json, idempotency_key, server_timestamp, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');

        for (const event of newEvents) {
          if (existingIds.has(event.event_id)) {
            duplicate++;
            continue;
          }
          insertEvent.run(event.event_id, tournamentId, event.match_id, event.sequence, event.event_type, event.actor_id ?? null, event.actor_session_id ?? null, event.payload_json, event.idempotency_key, event.server_timestamp, event.created_at);
          pulled++;
          maxSequence = Math.max(maxSequence, event.sequence);
        }

        if (newEvents.length > 0) {
          const lastEvent = newEvents[newEvents.length - 1];
          if (lastEvent) {
            this.db.prepare('UPDATE matches SET sequence=?, version=version+1, updated_at=? WHERE id=?').run(lastEvent.sequence, isoNow(), matchId);
          }
        }
      }

      this.db.prepare("UPDATE synchronization_jobs SET status='COMPLETED', last_version=?, updated_at=? WHERE id=?").run(maxSequence, isoNow(), jobId);
      return { jobId, status: 'COMPLETED', uploaded: 0, pulled, duplicate, direction: 'PULL' };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown pull failure';
      this.db.prepare("UPDATE synchronization_jobs SET status='FAILED', conflict_json=?, updated_at=? WHERE id=?").run(JSON.stringify({ reason }), isoNow(), jobId);
      throw new HttpError(502, 'SYNC_FAILED', reason);
    }
  }

  async sync(tournamentId: string): Promise<SyncResult> {
    if (!this.cloud) throw new HttpError(409, 'CLOUD_NOT_CONFIGURED', 'Configure Supabase URL and the server-only service-role key before synchronization.');
    const pushResult = await this.push(tournamentId);
    if (pushResult.status !== 'COMPLETED') {
      return { jobId: pushResult.jobId, status: pushResult.status, uploaded: pushResult.uploaded, pulled: 0, duplicate: pushResult.duplicate, reason: pushResult.reason, direction: 'SYNC' };
    }
    const pullResult = await this.pull(tournamentId);
    return { jobId: pushResult.jobId, status: pullResult.status, uploaded: pushResult.uploaded, pulled: pullResult.pulled, duplicate: pushResult.duplicate + pullResult.duplicate, reason: pullResult.reason, direction: 'SYNC' };
  }
}
