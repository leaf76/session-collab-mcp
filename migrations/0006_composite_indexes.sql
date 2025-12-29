-- Add composite indexes for common query patterns
-- These indexes optimize queries that filter on multiple columns

-- Sessions: frequently query active sessions with heartbeat check
-- Used in cleanupStaleSessions and session list queries
CREATE INDEX IF NOT EXISTS idx_sessions_status_heartbeat ON sessions(status, last_heartbeat);

-- Claims: frequently query active claims for a session
-- Used in checkConflicts and listClaims
CREATE INDEX IF NOT EXISTS idx_claims_status_session ON claims(status, session_id);

-- Claim files: composite for efficient conflict checking
-- Used in checkConflicts with JOIN on claims
CREATE INDEX IF NOT EXISTS idx_claim_files_path_claim ON claim_files(file_path, claim_id);
