-- Symbol reference tracking for impact analysis
-- Stores which symbols are referenced by which files

CREATE TABLE IF NOT EXISTS symbol_references (
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
);

CREATE INDEX IF NOT EXISTS idx_symbol_refs_source ON symbol_references(source_file, source_symbol);
CREATE INDEX IF NOT EXISTS idx_symbol_refs_ref_file ON symbol_references(ref_file);
CREATE INDEX IF NOT EXISTS idx_symbol_refs_session ON symbol_references(session_id);
