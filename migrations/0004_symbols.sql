-- Symbol-level claim tracking for fine-grained conflict detection
-- Allows claiming specific functions/classes instead of entire files

CREATE TABLE IF NOT EXISTS claim_symbols (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    symbol_name TEXT NOT NULL,
    symbol_type TEXT DEFAULT 'function' CHECK (symbol_type IN ('function', 'class', 'method', 'variable', 'block', 'other')),
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE,
    UNIQUE(claim_id, file_path, symbol_name)
);

CREATE INDEX IF NOT EXISTS idx_claim_symbols_path ON claim_symbols(file_path);
CREATE INDEX IF NOT EXISTS idx_claim_symbols_name ON claim_symbols(symbol_name);
CREATE INDEX IF NOT EXISTS idx_claim_symbols_claim ON claim_symbols(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_symbols_lookup ON claim_symbols(file_path, symbol_name);
