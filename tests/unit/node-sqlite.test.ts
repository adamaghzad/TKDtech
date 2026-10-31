import { describe, expect, it } from 'vitest';
import NodeSqliteDatabase from '../../apps/local-server/src/persistence/node-sqlite';
import { migrate, type SqliteDatabase } from '../../apps/local-server/src/persistence/database';

function database(): NodeSqliteDatabase {
  const db = new NodeSqliteDatabase(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  return db;
}

describe('Android node:sqlite compatibility', () => {
  it('runs the real migrations and pragma checks', () => {
    const db = database();
    try {
      migrate(db as unknown as SqliteDatabase);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
      expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining(['matches', 'match_events', 'judge_sessions', 'schema_migrations']));
      expect(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toMatchObject({ version: 3 });
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('supports nested transactions with full and savepoint-only rollback', () => {
    const db = database();
    try {
      db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
      const insert = db.prepare('INSERT INTO items(value) VALUES (?)');
      expect(() => db.transaction(() => {
        insert.run('outer');
        db.transaction(() => insert.run('inner'))();
        throw new Error('rollback all');
      })()).toThrow('rollback all');
      expect(db.prepare('SELECT COUNT(*) AS count FROM items').get()).toMatchObject({ count: 0 });

      db.transaction(() => {
        insert.run('before');
        try {
          db.transaction(() => {
            insert.run('discard');
            throw new Error('rollback savepoint');
          })();
        } catch {
          // The outer transaction deliberately continues.
        }
        insert.run('after');
      })();
      expect(db.prepare('SELECT value FROM items ORDER BY id').all().map((row) => (row as { value: string }).value)).toEqual(['before', 'after']);
    } finally {
      db.close();
    }
  });
});
