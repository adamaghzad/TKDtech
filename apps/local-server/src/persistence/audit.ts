import { randomUUID } from 'node:crypto';
import type { SqliteDatabase } from './database';

export function isoNow(): string { return new Date().toISOString(); }
export function audit(db: SqliteDatabase, input: { tournamentId?: string | null; actorId?: string | null; action: string; entityType: string; entityId: string; before?: unknown; after?: unknown; reason?: string }): void {
  db.prepare(`INSERT INTO audit_logs(id,tournament_id,actor_id,action,entity_type,entity_id,before_json,after_json,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
    randomUUID(), input.tournamentId ?? null, input.actorId ?? null, input.action, input.entityType, input.entityId,
    input.before === undefined ? null : JSON.stringify(input.before), input.after === undefined ? null : JSON.stringify(input.after), input.reason ?? null, isoNow()
  );
}
export function appendMatchEvent(db: SqliteDatabase, input: { tournamentId: string; matchId: string; sequence: number; type: string; actorId?: string | null; sessionId?: string | null; payload?: unknown; idempotencyKey?: string }): string {
  const id = randomUUID(); const now = Date.now();
  db.prepare(`INSERT INTO match_events(event_id,tournament_id,match_id,sequence,event_type,actor_id,actor_session_id,payload_json,idempotency_key,server_timestamp,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, input.tournamentId, input.matchId, input.sequence, input.type, input.actorId ?? null, input.sessionId ?? null,
    JSON.stringify(input.payload ?? {}), input.idempotencyKey ?? randomUUID(), now, new Date(now).toISOString()
  );
  return id;
}
