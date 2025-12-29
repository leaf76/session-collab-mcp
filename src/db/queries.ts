// Database queries for Session Collaboration MCP

import type { DatabaseAdapter } from './sqlite-adapter.js';
import type {
  Session,
  Claim,
  ClaimStatus,
  ClaimScope,
  ClaimWithFiles,
  ConflictInfo,
  Message,
  Decision,
  DecisionCategory,
  TodoItem,
  SessionProgress,
  SessionConfig,
  SymbolClaim,
  SymbolType,
} from './types';

// Helper to generate UUID v4
function generateId(): string {
  return crypto.randomUUID();
}

// ============ Session Queries ============

export async function createSession(
  db: DatabaseAdapter,
  params: {
    name?: string;
    project_root: string;
    machine_id?: string;
    user_id?: string;
  }
): Promise<Session> {
  const id = generateId();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO sessions (id, name, project_root, machine_id, user_id, created_at, last_heartbeat, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`
    )
    .bind(id, params.name ?? null, params.project_root, params.machine_id ?? null, params.user_id ?? null, now, now)
    .run();

  return {
    id,
    name: params.name ?? null,
    project_root: params.project_root,
    machine_id: params.machine_id ?? null,
    user_id: params.user_id ?? null,
    created_at: now,
    last_heartbeat: now,
    status: 'active',
    current_task: null,
    progress: null,
    todos: null,
    config: null,
  };
}

export async function getSession(db: DatabaseAdapter, id: string): Promise<Session | null> {
  const result = await db.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first<Session>();
  return result ?? null;
}

export async function listSessions(
  db: DatabaseAdapter,
  params: {
    include_inactive?: boolean;
    project_root?: string;
    user_id?: string;
  } = {}
): Promise<Session[]> {
  let query = 'SELECT * FROM sessions WHERE 1=1';
  const bindings: (string | number)[] = [];

  if (!params.include_inactive) {
    query += " AND status = 'active'";
  }

  if (params.project_root) {
    query += ' AND project_root = ?';
    bindings.push(params.project_root);
  }

  if (params.user_id) {
    query += ' AND user_id = ?';
    bindings.push(params.user_id);
  }

  query += ' ORDER BY last_heartbeat DESC';

  const result = await db
    .prepare(query)
    .bind(...bindings)
    .all<Session>();
  return result.results;
}

export async function updateSessionHeartbeat(
  db: DatabaseAdapter,
  id: string,
  statusUpdate?: {
    current_task?: string | null;
    todos?: TodoItem[];
  }
): Promise<boolean> {
  const now = new Date().toISOString();

  // Calculate progress from todos if provided
  let progress: SessionProgress | null = null;
  let todosJson: string | null = null;

  if (statusUpdate?.todos) {
    const total = statusUpdate.todos.length;
    const completed = statusUpdate.todos.filter((t) => t.status === 'completed').length;
    progress = {
      completed,
      total,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
    todosJson = JSON.stringify(statusUpdate.todos);
  }

  let query = "UPDATE sessions SET last_heartbeat = ?";
  const bindings: (string | null)[] = [now];

  if (statusUpdate?.current_task !== undefined) {
    query += ", current_task = ?";
    bindings.push(statusUpdate.current_task);
  }

  if (progress) {
    query += ", progress = ?";
    bindings.push(JSON.stringify(progress));
  }

  if (todosJson) {
    query += ", todos = ?";
    bindings.push(todosJson);
  }

  query += " WHERE id = ? AND status = 'active'";
  bindings.push(id);

  const result = await db
    .prepare(query)
    .bind(...bindings)
    .run();
  return result.meta.changes > 0;
}

export async function updateSessionStatus(
  db: DatabaseAdapter,
  id: string,
  params: {
    current_task?: string | null;
    todos?: TodoItem[];
  }
): Promise<boolean> {
  const now = new Date().toISOString();

  // Calculate progress from todos
  let progress: SessionProgress | null = null;
  let todosJson: string | null = null;

  if (params.todos) {
    const total = params.todos.length;
    const completed = params.todos.filter((t) => t.status === 'completed').length;
    progress = {
      completed,
      total,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
    todosJson = JSON.stringify(params.todos);
  }

  const result = await db
    .prepare(
      `UPDATE sessions
       SET current_task = ?, progress = ?, todos = ?, last_heartbeat = ?
       WHERE id = ? AND status = 'active'`
    )
    .bind(
      params.current_task ?? null,
      progress ? JSON.stringify(progress) : null,
      todosJson,
      now,
      id
    )
    .run();

  return result.meta.changes > 0;
}

export async function endSession(
  db: DatabaseAdapter,
  id: string,
  release_claims: 'complete' | 'abandon' = 'abandon'
): Promise<boolean> {
  const claimStatus: ClaimStatus = release_claims === 'complete' ? 'completed' : 'abandoned';

  // Update all active claims for this session
  await db
    .prepare("UPDATE claims SET status = ?, updated_at = ? WHERE session_id = ? AND status = 'active'")
    .bind(claimStatus, new Date().toISOString(), id)
    .run();

  // Mark session as terminated
  const result = await db.prepare("UPDATE sessions SET status = 'terminated' WHERE id = ?").bind(id).run();

  return result.meta.changes > 0;
}

export async function cleanupStaleSessions(db: DatabaseAdapter, staleMinutes: number = 30): Promise<{ stale_sessions: number; orphaned_claims: number }> {
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  // Mark stale sessions as inactive
  const result = await db
    .prepare("UPDATE sessions SET status = 'inactive' WHERE status = 'active' AND last_heartbeat < ?")
    .bind(cutoff)
    .run();

  // Abandon claims from inactive/terminated sessions
  const orphanedResult = await db
    .prepare(
      `UPDATE claims SET status = 'abandoned', updated_at = ?
       WHERE status = 'active' AND session_id IN (
         SELECT id FROM sessions WHERE status IN ('inactive', 'terminated')
       )`
    )
    .bind(now)
    .run();

  return {
    stale_sessions: result.meta.changes,
    orphaned_claims: orphanedResult.meta.changes,
  };
}

export async function updateSessionConfig(
  db: DatabaseAdapter,
  id: string,
  config: SessionConfig
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE sessions SET config = ? WHERE id = ?')
    .bind(JSON.stringify(config), id)
    .run();

  return result.meta.changes > 0;
}

// ============ Claim Queries ============

export async function createClaim(
  db: DatabaseAdapter,
  params: {
    session_id: string;
    files: string[];
    intent: string;
    scope?: ClaimScope;
    symbols?: SymbolClaim[];
  }
): Promise<{ claim: Claim; files: string[]; symbols?: SymbolClaim[] }> {
  const id = generateId();
  const now = new Date().toISOString();
  const scope = params.scope ?? 'medium';

  // Batch insert: claim + all file paths in single transaction
  const claimStatement = db
    .prepare(
      `INSERT INTO claims (id, session_id, intent, scope, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`
    )
    .bind(id, params.session_id, params.intent, scope, now, now);

  const fileStatements = params.files.map((filePath) => {
    const isPattern = filePath.includes('*') ? 1 : 0;
    return db
      .prepare('INSERT INTO claim_files (claim_id, file_path, is_pattern) VALUES (?, ?, ?)')
      .bind(id, filePath, isPattern);
  });

  // Add symbol claims if provided
  const symbolStatements: ReturnType<typeof db.prepare>[] = [];
  if (params.symbols && params.symbols.length > 0) {
    for (const symbolClaim of params.symbols) {
      for (const symbolName of symbolClaim.symbols) {
        symbolStatements.push(
          db
            .prepare(
              'INSERT INTO claim_symbols (claim_id, file_path, symbol_name, symbol_type, created_at) VALUES (?, ?, ?, ?, ?)'
            )
            .bind(id, symbolClaim.file, symbolName, symbolClaim.symbol_type ?? 'function', now)
        );
      }
    }
  }

  await db.batch([claimStatement, ...fileStatements, ...symbolStatements]);

  return {
    claim: {
      id,
      session_id: params.session_id,
      intent: params.intent,
      scope,
      status: 'active',
      created_at: now,
      updated_at: now,
      completed_summary: null,
    },
    files: params.files,
    symbols: params.symbols,
  };
}

export async function getClaim(db: DatabaseAdapter, id: string): Promise<ClaimWithFiles | null> {
  const claim = await db.prepare('SELECT * FROM claims WHERE id = ?').bind(id).first<Claim>();

  if (!claim) return null;

  const files = await db.prepare('SELECT file_path FROM claim_files WHERE claim_id = ?').bind(id).all<{ file_path: string }>();

  const session = await db.prepare('SELECT name FROM sessions WHERE id = ?').bind(claim.session_id).first<{ name: string | null }>();

  return {
    ...claim,
    files: files.results.map((f) => f.file_path),
    session_name: session?.name ?? null,
  };
}

export async function listClaims(
  db: DatabaseAdapter,
  params: {
    session_id?: string;
    status?: ClaimStatus | 'all';
    project_root?: string;
  } = {}
): Promise<ClaimWithFiles[]> {
  let query = `
    SELECT c.*, s.name as session_name
    FROM claims c
    JOIN sessions s ON c.session_id = s.id
    WHERE 1=1
  `;
  const bindings: string[] = [];

  if (params.session_id) {
    query += ' AND c.session_id = ?';
    bindings.push(params.session_id);
  }

  if (params.status && params.status !== 'all') {
    query += ' AND c.status = ?';
    bindings.push(params.status);
  }

  if (params.project_root) {
    query += ' AND s.project_root = ?';
    bindings.push(params.project_root);
  }

  query += ' ORDER BY c.created_at DESC';

  const claims = await db
    .prepare(query)
    .bind(...bindings)
    .all<Claim & { session_name: string | null }>();

  if (claims.results.length === 0) {
    return [];
  }

  // Batch fetch all files for claims (avoid N+1 query)
  const claimIds = claims.results.map((c) => c.id);
  const placeholders = claimIds.map(() => '?').join(',');
  const allFiles = await db
    .prepare(`SELECT claim_id, file_path FROM claim_files WHERE claim_id IN (${placeholders})`)
    .bind(...claimIds)
    .all<{ claim_id: string; file_path: string }>();

  // Group files by claim_id
  const filesByClaimId = new Map<string, string[]>();
  for (const f of allFiles.results) {
    const arr = filesByClaimId.get(f.claim_id) ?? [];
    arr.push(f.file_path);
    filesByClaimId.set(f.claim_id, arr);
  }

  // Assemble results
  return claims.results.map((claim) => ({
    ...claim,
    files: filesByClaimId.get(claim.id) ?? [],
  }));
}

export async function checkConflicts(
  db: DatabaseAdapter,
  files: string[],
  excludeSessionId?: string,
  symbols?: SymbolClaim[]
): Promise<ConflictInfo[]> {
  const conflicts: ConflictInfo[] = [];

  // Build a map of file -> symbols for quick lookup
  const symbolsByFile = new Map<string, Set<string>>();
  if (symbols && symbols.length > 0) {
    for (const sc of symbols) {
      const existing = symbolsByFile.get(sc.file) ?? new Set();
      for (const sym of sc.symbols) {
        existing.add(sym);
      }
      symbolsByFile.set(sc.file, existing);
    }
  }

  for (const filePath of files) {
    const requestedSymbols = symbolsByFile.get(filePath);

    // First check if there are symbol-level claims for this file
    if (requestedSymbols && requestedSymbols.size > 0) {
      // Symbol-level conflict check
      let symbolQuery = `
        SELECT
          c.id as claim_id,
          c.session_id,
          s.name as session_name,
          cs.file_path,
          c.intent,
          c.scope,
          c.created_at,
          cs.symbol_name,
          cs.symbol_type
        FROM claim_symbols cs
        JOIN claims c ON cs.claim_id = c.id
        JOIN sessions s ON c.session_id = s.id
        WHERE c.status = 'active'
          AND s.status = 'active'
          AND cs.file_path = ?
          AND cs.symbol_name IN (${Array.from(requestedSymbols).map(() => '?').join(',')})
      `;
      const symbolBindings: string[] = [filePath, ...Array.from(requestedSymbols)];

      if (excludeSessionId) {
        symbolQuery += ' AND c.session_id != ?';
        symbolBindings.push(excludeSessionId);
      }

      const symbolResult = await db
        .prepare(symbolQuery)
        .bind(...symbolBindings)
        .all<ConflictInfo & { symbol_name: string; symbol_type: SymbolType }>();

      for (const r of symbolResult.results) {
        conflicts.push({
          ...r,
          conflict_level: 'symbol',
        });
      }

      // Also check if there's a file-level claim (no symbols = whole file claimed)
      let fileClaimQuery = `
        SELECT
          c.id as claim_id,
          c.session_id,
          s.name as session_name,
          cf.file_path,
          c.intent,
          c.scope,
          c.created_at
        FROM claim_files cf
        JOIN claims c ON cf.claim_id = c.id
        JOIN sessions s ON c.session_id = s.id
        WHERE c.status = 'active'
          AND s.status = 'active'
          AND (cf.file_path = ? OR (cf.is_pattern = 1 AND ? GLOB cf.file_path))
          AND NOT EXISTS (
            SELECT 1 FROM claim_symbols cs WHERE cs.claim_id = c.id AND cs.file_path = cf.file_path
          )
      `;
      const fileClaimBindings: string[] = [filePath, filePath];

      if (excludeSessionId) {
        fileClaimQuery += ' AND c.session_id != ?';
        fileClaimBindings.push(excludeSessionId);
      }

      const fileClaimResult = await db
        .prepare(fileClaimQuery)
        .bind(...fileClaimBindings)
        .all<Omit<ConflictInfo, 'conflict_level'>>();

      for (const r of fileClaimResult.results) {
        conflicts.push({
          ...r,
          conflict_level: 'file',
        });
      }
    } else {
      // No symbols specified - check both file-level and symbol-level claims
      // File-level claims (whole file)
      let fileQuery = `
        SELECT
          c.id as claim_id,
          c.session_id,
          s.name as session_name,
          cf.file_path,
          c.intent,
          c.scope,
          c.created_at
        FROM claim_files cf
        JOIN claims c ON cf.claim_id = c.id
        JOIN sessions s ON c.session_id = s.id
        WHERE c.status = 'active'
          AND s.status = 'active'
          AND (cf.file_path = ? OR (cf.is_pattern = 1 AND ? GLOB cf.file_path))
      `;
      const fileBindings: string[] = [filePath, filePath];

      if (excludeSessionId) {
        fileQuery += ' AND c.session_id != ?';
        fileBindings.push(excludeSessionId);
      }

      const fileResult = await db
        .prepare(fileQuery)
        .bind(...fileBindings)
        .all<Omit<ConflictInfo, 'conflict_level'>>();

      for (const r of fileResult.results) {
        conflicts.push({
          ...r,
          conflict_level: 'file',
        });
      }

      // Symbol-level claims on this file
      let symbolOnlyQuery = `
        SELECT DISTINCT
          c.id as claim_id,
          c.session_id,
          s.name as session_name,
          cs.file_path,
          c.intent,
          c.scope,
          c.created_at,
          cs.symbol_name,
          cs.symbol_type
        FROM claim_symbols cs
        JOIN claims c ON cs.claim_id = c.id
        JOIN sessions s ON c.session_id = s.id
        WHERE c.status = 'active'
          AND s.status = 'active'
          AND cs.file_path = ?
      `;
      const symbolOnlyBindings: string[] = [filePath];

      if (excludeSessionId) {
        symbolOnlyQuery += ' AND c.session_id != ?';
        symbolOnlyBindings.push(excludeSessionId);
      }

      const symbolOnlyResult = await db
        .prepare(symbolOnlyQuery)
        .bind(...symbolOnlyBindings)
        .all<ConflictInfo & { symbol_name: string; symbol_type: SymbolType }>();

      for (const r of symbolOnlyResult.results) {
        conflicts.push({
          ...r,
          conflict_level: 'symbol',
        });
      }
    }
  }

  // Deduplicate by claim_id + file_path + symbol_name
  const seen = new Set<string>();
  return conflicts.filter((c) => {
    const key = `${c.claim_id}:${c.file_path}:${c.symbol_name ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function releaseClaim(
  db: DatabaseAdapter,
  id: string,
  params: {
    status: 'completed' | 'abandoned';
    summary?: string;
  }
): Promise<boolean> {
  const now = new Date().toISOString();

  const result = await db
    .prepare('UPDATE claims SET status = ?, updated_at = ?, completed_summary = ? WHERE id = ?')
    .bind(params.status, now, params.summary ?? null, id)
    .run();

  return result.meta.changes > 0;
}

// ============ Message Queries ============

export async function sendMessage(
  db: DatabaseAdapter,
  params: {
    from_session_id: string;
    to_session_id?: string;
    content: string;
  }
): Promise<Message> {
  const id = generateId();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO messages (id, from_session_id, to_session_id, content, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(id, params.from_session_id, params.to_session_id ?? null, params.content, now)
    .run();

  return {
    id,
    from_session_id: params.from_session_id,
    to_session_id: params.to_session_id ?? null,
    content: params.content,
    read_at: null,
    created_at: now,
  };
}

export async function listMessages(
  db: DatabaseAdapter,
  params: {
    session_id: string;
    unread_only?: boolean;
    mark_as_read?: boolean;
  }
): Promise<Message[]> {
  let query = `
    SELECT * FROM messages
    WHERE (to_session_id = ? OR to_session_id IS NULL)
  `;
  const bindings: string[] = [params.session_id];

  if (params.unread_only) {
    query += ' AND read_at IS NULL';
  }

  query += ' ORDER BY created_at DESC';

  const messages = await db
    .prepare(query)
    .bind(...bindings)
    .all<Message>();

  // Mark as read if requested
  if (params.mark_as_read && messages.results.length > 0) {
    const now = new Date().toISOString();
    const ids = messages.results.map((m) => m.id);

    for (const id of ids) {
      await db.prepare('UPDATE messages SET read_at = ? WHERE id = ? AND read_at IS NULL').bind(now, id).run();
    }
  }

  return messages.results;
}

// ============ Decision Queries ============

export async function addDecision(
  db: DatabaseAdapter,
  params: {
    session_id: string;
    category?: DecisionCategory;
    title: string;
    description: string;
  }
): Promise<Decision> {
  const id = generateId();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO decisions (id, session_id, category, title, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id, params.session_id, params.category ?? null, params.title, params.description, now)
    .run();

  return {
    id,
    session_id: params.session_id,
    category: params.category ?? null,
    title: params.title,
    description: params.description,
    created_at: now,
  };
}

export async function listDecisions(
  db: DatabaseAdapter,
  params: {
    category?: DecisionCategory;
    limit?: number;
  } = {}
): Promise<Decision[]> {
  let query = 'SELECT * FROM decisions WHERE 1=1';
  const bindings: (string | number)[] = [];

  if (params.category) {
    query += ' AND category = ?';
    bindings.push(params.category);
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  bindings.push(params.limit ?? 20);

  const result = await db
    .prepare(query)
    .bind(...bindings)
    .all<Decision>();

  return result.results;
}
