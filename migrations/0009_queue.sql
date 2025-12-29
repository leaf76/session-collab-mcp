-- Claim queue for waiting on blocked claims
CREATE TABLE IF NOT EXISTS claim_queue (
    id TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    intent TEXT NOT NULL,
    position INTEGER NOT NULL,
    priority INTEGER DEFAULT 50 CHECK (priority >= 0 AND priority <= 100),
    scope TEXT DEFAULT 'medium' CHECK (scope IN ('small', 'medium', 'large')),
    estimated_wait_minutes INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    UNIQUE(claim_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_queue_claim ON claim_queue(claim_id);
CREATE INDEX IF NOT EXISTS idx_queue_session ON claim_queue(session_id);
CREATE INDEX IF NOT EXISTS idx_queue_priority ON claim_queue(priority DESC, position ASC);
