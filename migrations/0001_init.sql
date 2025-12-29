-- Session Collaboration MCP - Initial Schema
-- Database: Cloudflare D1 (SQLite-compatible)

-- Sessions table: track active Claude Code sessions
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT,
    project_root TEXT NOT NULL,
    machine_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    last_heartbeat TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'terminated'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_root);

-- Claims table: WIP declarations
CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    intent TEXT NOT NULL,
    scope TEXT DEFAULT 'medium' CHECK (scope IN ('small', 'medium', 'large')),
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    completed_summary TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_claims_session ON claims(session_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);

-- Claim files: normalized file paths for efficient querying
CREATE TABLE IF NOT EXISTS claim_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    is_pattern INTEGER DEFAULT 0,
    FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE,
    UNIQUE(claim_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_claim_files_path ON claim_files(file_path);
CREATE INDEX IF NOT EXISTS idx_claim_files_claim ON claim_files(claim_id);

-- Messages table: inter-session communication
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    from_session_id TEXT NOT NULL,
    to_session_id TEXT,
    content TEXT NOT NULL,
    read_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (from_session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_session_id);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(to_session_id, read_at);

-- Decisions table: architectural decisions log (optional feature)
CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    category TEXT CHECK (category IN ('architecture', 'naming', 'api', 'database', 'ui', 'other')),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decisions_category ON decisions(category);
