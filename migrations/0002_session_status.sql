-- Add work status tracking to sessions
-- Enables real-time visibility into what each session is working on

-- Add new columns to sessions table
ALTER TABLE sessions ADD COLUMN current_task TEXT;
ALTER TABLE sessions ADD COLUMN progress TEXT; -- JSON: {"completed": 3, "total": 5, "percentage": 60}
ALTER TABLE sessions ADD COLUMN todos TEXT; -- JSON array of todo items

-- Create index for faster queries on active sessions with tasks
CREATE INDEX IF NOT EXISTS idx_sessions_active_task ON sessions(status, current_task) WHERE status = 'active';
