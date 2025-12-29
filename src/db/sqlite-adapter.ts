// SQLite adapter: wraps better-sqlite3 to match D1-like API
// This allows the same queries.ts to work with both D1 and local SQLite

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

export interface D1Result<T> {
  results: T[];
  meta: {
    changes: number;
    last_row_id: number;
  };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result<unknown>[]>;
}

class SqlitePreparedStatement implements D1PreparedStatement {
  private bindings: unknown[] = [];

  constructor(
    private db: Database.Database,
    private sql: string
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.bindings = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    const stmt = this.db.prepare(this.sql);
    const result = stmt.get(...this.bindings) as T | undefined;
    return result ?? null;
  }

  async all<T>(): Promise<D1Result<T>> {
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

class SqliteDatabase implements D1Database {
  private db: Database.Database;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  prepare(sql: string): D1PreparedStatement {
    return new SqlitePreparedStatement(this.db, sql);
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result<unknown>[]> {
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
    return transaction();
  }

  // Initialize database schema
  initSchema(migrations: string[]): void {
    for (const migration of migrations) {
      this.db.exec(migration);
    }
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
