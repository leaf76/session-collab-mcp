-- Working Memory: Persist important context within a session
-- Prevents loss of critical information during Claude's automatic compact/summarization

CREATE TABLE IF NOT EXISTS working_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  category TEXT NOT NULL,  -- 'finding', 'decision', 'state', 'todo', 'important', 'context'
  key TEXT NOT NULL,       -- Unique identifier within session+category
  content TEXT NOT NULL,   -- The actual memory content
  priority INTEGER DEFAULT 50,  -- 0-100, higher = more important
  pinned INTEGER DEFAULT 0,     -- 1 = always load, 0 = normal
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,     -- Optional expiration time
  related_claim_id TEXT,   -- Optional link to a claim
  related_decision_id TEXT, -- Optional link to a decision
  metadata TEXT,           -- JSON for additional structured data
  UNIQUE(session_id, category, key),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (related_claim_id) REFERENCES claims(id) ON DELETE SET NULL,
  FOREIGN KEY (related_decision_id) REFERENCES decisions(id) ON DELETE SET NULL
);

-- Index for fast session-based queries
CREATE INDEX IF NOT EXISTS idx_working_memory_session
  ON working_memory(session_id, priority DESC);

-- Index for pinned items (frequently accessed)
CREATE INDEX IF NOT EXISTS idx_working_memory_pinned
  ON working_memory(session_id, pinned DESC, priority DESC);

-- Index for category-based queries
CREATE INDEX IF NOT EXISTS idx_working_memory_category
  ON working_memory(session_id, category, priority DESC);

-- Index for expiration cleanup
CREATE INDEX IF NOT EXISTS idx_working_memory_expires
  ON working_memory(expires_at) WHERE expires_at IS NOT NULL;
