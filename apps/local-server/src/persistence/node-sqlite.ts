import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncInstance, StatementSync } from 'node:sqlite';

// Vitest 2 does not yet include node:sqlite in its builtin resolver list.
// createRequire keeps the runtime import explicit without a Vite alias.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

interface DatabaseOptions {
  readonly?: boolean;
  fileMustExist?: boolean;
}

/**
 * The Android bundle substitutes this adapter for better-sqlite3. Node's
 * built-in SQLite uses the same synchronous statement shape, while this class
 * supplies the pragma and transaction helpers used by the application.
 * Windows/Linux continue to use the reviewed better-sqlite3 implementation.
 */
export default class NodeSqliteDatabase {
  private readonly database: DatabaseSyncInstance;
  private savepointSequence = 0;

  constructor(filename: string, options: DatabaseOptions = {}) {
    this.database = new DatabaseSync(filename, {
      open: true,
      readOnly: options.readonly ?? false,
      allowExtension: false,
    });
    if (options.fileMustExist && !this.database.location()) throw new Error(`SQLite database does not exist: ${filename}`);
  }

  prepare(sql: string): StatementSync {
    return this.database.prepare(sql);
  }

  exec(sql: string): this {
    this.database.exec(sql);
    return this;
  }

  close(): void {
    this.database.close();
  }

  pragma(source: string, options: { simple?: boolean } = {}): unknown {
    const statement = this.database.prepare(`PRAGMA ${source}`);
    if (options.simple) {
      const row = statement.get() as Record<string, unknown> | undefined;
      return row ? Object.values(row)[0] : undefined;
    }
    return statement.all();
  }

  transaction<Arguments extends unknown[], Result>(fn: (...args: Arguments) => Result): (...args: Arguments) => Result {
    return (...args: Arguments): Result => {
      if (this.database.isTransaction) return this.runSavepoint(fn, args);
      this.database.exec('BEGIN IMMEDIATE');
      try {
        const result = fn(...args);
        this.assertSynchronous(result);
        this.database.exec('COMMIT');
        return result;
      } catch (error) {
        if (this.database.isTransaction) this.database.exec('ROLLBACK');
        throw error;
      }
    };
  }

  private runSavepoint<Arguments extends unknown[], Result>(fn: (...args: Arguments) => Result, args: Arguments): Result {
    const name = `tkd_mobile_${++this.savepointSequence}`;
    this.database.exec(`SAVEPOINT ${name}`);
    try {
      const result = fn(...args);
      this.assertSynchronous(result);
      this.database.exec(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (error) {
      this.database.exec(`ROLLBACK TO SAVEPOINT ${name}; RELEASE SAVEPOINT ${name}`);
      throw error;
    }
  }

  private assertSynchronous(value: unknown): void {
    if (typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function') {
      throw new Error('SQLite transaction functions must be synchronous.');
    }
  }
}
