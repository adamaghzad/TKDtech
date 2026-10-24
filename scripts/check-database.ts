import Database from 'better-sqlite3';
import path from 'node:path';

const file = process.argv[2];
if (!file) throw new Error('Usage: npm run check:database -- /path/to/database.db');
const database = new Database(path.resolve(file), { readonly: true, fileMustExist: true });
try {
  const integrity = database.pragma('integrity_check', { simple: true }) as string;
  const foreignKeys = database.pragma('foreign_key_check') as unknown[];
  const migration = database.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get() as { version: number };
  if (integrity !== 'ok' || foreignKeys.length) throw new Error(`Database validation failed: integrity=${integrity}, foreignKeyViolations=${foreignKeys.length}`);
  console.log(`SQLite database valid · migration ${migration.version} · integrity ok · foreign keys ok · ${path.resolve(file)}`);
} finally {
  database.close();
}
