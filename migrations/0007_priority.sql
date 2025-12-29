-- Add priority to claims table
-- Priority: 0-100 scale
-- Levels: critical (90-100), high (70-89), normal (40-69), low (0-39)
-- Default: 50 (normal)

ALTER TABLE claims ADD COLUMN priority INTEGER DEFAULT 50 CHECK (priority >= 0 AND priority <= 100);

-- Index for priority-based queries (ORDER BY priority DESC)
CREATE INDEX IF NOT EXISTS idx_claims_priority ON claims(priority);
