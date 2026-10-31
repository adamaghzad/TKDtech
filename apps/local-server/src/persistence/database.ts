import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type SqliteDatabase = Database.Database;
const here = path.dirname(fileURLToPath(import.meta.url));

export function openDatabase(filename?: string): SqliteDatabase {
  const target = filename ?? process.env.TKD_DATABASE_PATH ?? path.resolve(process.cwd(), 'data/tkd-scoring.db');
  if (target !== ':memory:') mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  const db = new Database(target);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function migrate(db: SqliteDatabase): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
  const migrationDir = path.join(here, 'migrations');
  const files = ['001_initial.sql', '002_license_deliveries.sql', '003_video_review.sql'];
  for (const file of files) {
    const version = Number(file.split('_')[0]);
    const applied = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(version);
    if (applied) continue;
    const sql = readFileSync(path.join(migrationDir, file), 'utf8');
    db.transaction(() => { db.exec(sql); db.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run(version); })();
  }
}
