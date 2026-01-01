// SQLite adapter: wraps better-sqlite3 with a generic database interface
// This allows the same queries.ts to work with both Cloudflare D1 and local SQLite

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

// Polyfill crypto.randomUUID for Node.js
if (typeof globalThis.crypto === 'undefined') {
  (globalThis as unknown as { crypto: { randomUUID: () => string } }).crypto = {
    randomUUID,
  };
}

export interface QueryResult<T> {
  results: T[];
  meta: {
    changes: number;
    last_row_id: number;
  };
}

export interface PreparedStatement {
  bind(...values: unknown[]): PreparedStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<QueryResult<T>>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface DatabaseAdapter {
  prepare(sql: string): PreparedStatement;
  batch(statements: PreparedStatement[]): Promise<QueryResult<unknown>[]>;
}

class SqlitePreparedStatement implements PreparedStatement {
  private bindings: unknown[] = [];

  constructor(
    private db: Database.Database,
    private sql: string
  ) {}

  bind(...values: unknown[]): PreparedStatement {
    this.bindings = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    const stmt = this.db.prepare(this.sql);
    const result = stmt.get(...this.bindings) as T | undefined;
    return result ?? null;
  }

  async all<T>(): Promise<QueryResult<T>> {
    const stmt = this.db.prepare(this.sql);
    const results = stmt.all(...this.bindings) as T[];
    return {
      results,
      meta: { changes: 0, last_row_id: 0 },
    };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const stmt = this.db.prepare(this.sql);
    const result = stmt.run(...this.bindings);
    // Note: wal_autocheckpoint handles periodic checkpoints automatically
    // No need to checkpoint after every write - reduces I/O overhead
    return {
      meta: { changes: result.changes },
    };
  }

  // Internal method for batch execution
  _run(): Database.RunResult {
    const stmt = this.db.prepare(this.sql);
    return stmt.run(...this.bindings);
  }
}

class SqliteDatabase implements DatabaseAdapter {
  private db: Database.Database;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);

    // Multi-process SQLite configuration
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');      // Wait up to 5s for locks
    this.db.pragma('synchronous = NORMAL');     // Ensure durability
    this.db.pragma('wal_autocheckpoint = 100'); // Checkpoint every 100 pages

    // Checkpoint on open to see latest data from other processes
    this.db.pragma('wal_checkpoint(PASSIVE)');
  }

  // Force checkpoint to make changes visible to other processes
  // Only called after batch operations, not after individual writes
  checkpoint(): void {
    this.db.pragma('wal_checkpoint(PASSIVE)');
  }

  prepare(sql: string): PreparedStatement {
    return new SqlitePreparedStatement(this.db, sql);
  }

  async batch(statements: PreparedStatement[]): Promise<QueryResult<unknown>[]> {
    const transaction = this.db.transaction(() => {
      return statements.map((stmt) => {
        const sqliteStmt = stmt as SqlitePreparedStatement;
        const result = sqliteStmt._run();
        return {
          results: [],
          meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) },
        };
      });
    });
    const results = transaction();
    // Checkpoint after batch write to ensure visibility to other processes
    this.checkpoint();
    return results;
  }

  // Initialize database schema
  // Handles upgrades gracefully by ignoring "already exists" and "duplicate column" errors
  initSchema(migrations: string[]): void {
    for (const migration of migrations) {
      // Split migration into individual statements for granular error handling
      const statements = migration
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith('--'));

      for (const stmt of statements) {
        try {
          this.runSql(stmt);
        } catch (error) {
          // Ignore errors for idempotent operations (upgrades)
          const message = error instanceof Error ? error.message : String(error);
          const isIgnorable =
            message.includes('already exists') ||
            message.includes('duplicate column name') ||
            message.includes('UNIQUE constraint failed');

          if (!isIgnorable) {
            throw error;
          }
        }
      }
    }
  }

  // Run a single SQL statement (used by initSchema for granular error handling)
  private runSql(sql: string): void {
    this.db.prepare(sql).run();
  }

  close(): void {
    this.db.close();
  }
}

// Get default database path
export function getDefaultDbPath(): string {
  const dataDir = join(homedir(), '.claude', 'session-collab');
  return join(dataDir, 'collab.db');
}

// Create a local SQLite database
export function createLocalDatabase(dbPath?: string): SqliteDatabase {
  const path = dbPath ?? getDefaultDbPath();
  return new SqliteDatabase(path);
}

export { SqliteDatabase };
