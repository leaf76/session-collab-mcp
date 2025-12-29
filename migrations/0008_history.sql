-- Audit history for tracking important actions
-- Retention: 7 days (cleanup in application code)

CREATE TABLE IF NOT EXISTS audit_history (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    action TEXT NOT NULL CHECK (action IN (
        'session_started', 'session_ended',
        'claim_created', 'claim_released', 'conflict_detected',
        'queue_joined', 'queue_left', 'priority_changed'
    )),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('session', 'claim', 'queue')),
    entity_id TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_history_session ON audit_history(session_id);
CREATE INDEX IF NOT EXISTS idx_history_action ON audit_history(action);
CREATE INDEX IF NOT EXISTS idx_history_entity ON audit_history(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_history_created ON audit_history(created_at);
