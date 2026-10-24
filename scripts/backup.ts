import Database from 'better-sqlite3';
import { mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../apps/local-server/src/persistence/database';

const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const target = path.resolve(process.argv[2] ?? path.join('data', `tkd-backup-${stamp}.db`));
const temporary = `${target}.tmp`;
mkdirSync(path.dirname(target), { recursive: true });
const database = openDatabase();
try {
  await database.backup(temporary);
  const check = new Database(temporary, { readonly: true, fileMustExist: true });
  const result = check.pragma('integrity_check', { simple: true }) as string;
  check.close();
  if (result !== 'ok') throw new Error(`Backup integrity check failed: ${result}`);
  renameSync(temporary, target);
  console.log(`SQLite backup complete and integrity-checked: ${target}`);
} finally {
  database.close();
}
