// Test helper: In-memory SQLite database for testing
import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { DatabaseAdapter, PreparedStatement, QueryResult } from '../sqlite-adapter.js';
import { loadMigrationsFromDir, splitMigrationStatements } from '../migrations.js';

class TestPreparedStatement implements PreparedStatement {
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
    return {
      meta: { changes: result.changes },
    };
  }

  _run(): Database.RunResult {
    const stmt = this.db.prepare(this.sql);
    return stmt.run(...this.bindings);
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'migrations');
const SCHEMA_STATEMENTS = loadMigrationsFromDir(MIGRATIONS_DIR);

const CLEANUP_STATEMENTS = [
  'DELETE FROM working_memory',
  'DELETE FROM notifications',
  'DELETE FROM claim_queue',
  'DELETE FROM audit_history',
  'DELETE FROM symbol_references',
  'DELETE FROM claim_symbols',
  'DELETE FROM claim_files',
  'DELETE FROM claims',
  'DELETE FROM messages',
  'DELETE FROM decisions',
  'DELETE FROM sessions',
];

export class TestDatabase implements DatabaseAdapter {
  private db: Database.Database;

  constructor() {
    // Use in-memory database for tests
    this.db = new Database(':memory:');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  private initSchema(): void {
    for (const migration of SCHEMA_STATEMENTS) {
      const statements = splitMigrationStatements(migration);

      for (const statement of statements) {
        this.db.prepare(statement).run();
      }
    }
  }

  prepare(sql: string): PreparedStatement {
    return new TestPreparedStatement(this.db, sql);
  }

  async batch(statements: PreparedStatement[]): Promise<QueryResult<unknown>[]> {
    const transaction = this.db.transaction(() => {
      return statements.map((stmt) => {
        const testStmt = stmt as TestPreparedStatement;
        const result = testStmt._run();
        return {
          results: [],
          meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) },
        };
      });
    });
    return transaction();
  }

  close(): void {
    this.db.close();
  }

  // Helper to reset database between tests
  reset(): void {
    for (const sql of CLEANUP_STATEMENTS) {
      this.db.prepare(sql).run();
    }
  }
}

export function createTestDatabase(): TestDatabase {
  return new TestDatabase();
}
