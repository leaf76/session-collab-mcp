// Test helper: In-memory SQLite database for testing
import Database from 'better-sqlite3';
import type { DatabaseAdapter, PreparedStatement, QueryResult } from '../sqlite-adapter.js';

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

// Schema statements split for initialization
const SCHEMA_STATEMENTS = [
  // Sessions table
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT,
    project_root TEXT NOT NULL,
    machine_id TEXT,
    user_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    last_heartbeat TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'terminated')),
    current_task TEXT,
    progress TEXT,
    todos TEXT,
    config TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_root)`,

  // Claims table
  `CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    intent TEXT NOT NULL,
    scope TEXT DEFAULT 'medium' CHECK (scope IN ('small', 'medium', 'large')),
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    completed_summary TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_claims_session ON claims(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status)`,

  // Claim files
  `CREATE TABLE IF NOT EXISTS claim_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    is_pattern INTEGER DEFAULT 0,
    FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE,
    UNIQUE(claim_id, file_path)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_claim_files_path ON claim_files(file_path)`,
  `CREATE INDEX IF NOT EXISTS idx_claim_files_claim ON claim_files(claim_id)`,

  // Claim symbols
  `CREATE TABLE IF NOT EXISTS claim_symbols (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    symbol_name TEXT NOT NULL,
    symbol_type TEXT DEFAULT 'function' CHECK (symbol_type IN ('function', 'class', 'method', 'variable', 'block', 'other')),
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE,
    UNIQUE(claim_id, file_path, symbol_name)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_claim_symbols_path ON claim_symbols(file_path)`,
  `CREATE INDEX IF NOT EXISTS idx_claim_symbols_name ON claim_symbols(symbol_name)`,
  `CREATE INDEX IF NOT EXISTS idx_claim_symbols_claim ON claim_symbols(claim_id)`,
  `CREATE INDEX IF NOT EXISTS idx_claim_symbols_lookup ON claim_symbols(file_path, symbol_name)`,

  // Messages table
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    from_session_id TEXT NOT NULL,
    to_session_id TEXT,
    content TEXT NOT NULL,
    read_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (from_session_id) REFERENCES sessions(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(to_session_id, read_at)`,

  // Decisions table
  `CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    category TEXT CHECK (category IN ('architecture', 'naming', 'api', 'database', 'ui', 'other')),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_decisions_category ON decisions(category)`,

  // Symbol references
  `CREATE TABLE IF NOT EXISTS symbol_references (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_file TEXT NOT NULL,
    source_symbol TEXT NOT NULL,
    ref_file TEXT NOT NULL,
    ref_line INTEGER,
    ref_context TEXT,
    session_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    UNIQUE(source_file, source_symbol, ref_file, ref_line)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_symbol_refs_source ON symbol_references(source_file, source_symbol)`,
  `CREATE INDEX IF NOT EXISTS idx_symbol_refs_ref_file ON symbol_references(ref_file)`,
  `CREATE INDEX IF NOT EXISTS idx_symbol_refs_session ON symbol_references(session_id)`,

  // Composite indexes for common query patterns
  `CREATE INDEX IF NOT EXISTS idx_sessions_status_heartbeat ON sessions(status, last_heartbeat)`,
  `CREATE INDEX IF NOT EXISTS idx_claims_status_session ON claims(status, session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_claim_files_path_claim ON claim_files(file_path, claim_id)`,
];

const CLEANUP_STATEMENTS = [
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
    for (const sql of SCHEMA_STATEMENTS) {
      this.db.prepare(sql).run();
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
