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
  AuditAction,
  AuditEntityType,
  AuditHistoryEntry,
  AuditHistoryWithSession,
  AuditMetadata,
} from './types';
import { generateId } from '../utils/crypto.js';

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

/**
 * Cleanup stale claims based on session config.
 * Only releases claims for sessions that have auto_release_stale=true.
 */
export async function cleanupStaleClaims(
  db: DatabaseAdapter
): Promise<{ released_claims: number; details: Array<{ claim_id: string; session_name: string | null; files: string[] }> }> {
  const now = new Date();
  const details: Array<{ claim_id: string; session_name: string | null; files: string[] }> = [];

  // Find active sessions with auto_release_stale enabled
  const sessions = await db
    .prepare(
      `SELECT id, name, config FROM sessions
       WHERE status = 'active' AND config IS NOT NULL`
    )
    .all<{ id: string; name: string | null; config: string }>();

  let released = 0;

  for (const session of sessions.results ?? []) {
    let config: Partial<SessionConfig> = {};
    try {
      config = JSON.parse(session.config || '{}');
    } catch {
      // Skip sessions with invalid config
      continue;
    }
    if (!config.auto_release_stale) continue;

    const thresholdHours = config.stale_threshold_hours ?? 2;
    const delayMinutes = config.auto_release_delay_minutes ?? 5;
    const cutoff = new Date(
      now.getTime() - thresholdHours * 60 * 60 * 1000 - delayMinutes * 60 * 1000
    ).toISOString();

    // Find stale claims for this session
    const staleClaims = await db
      .prepare(
        `SELECT c.id, GROUP_CONCAT(cf.file_path, '|||') as files
         FROM claims c
         LEFT JOIN claim_files cf ON c.id = cf.claim_id
         WHERE c.session_id = ? AND c.status = 'active' AND c.updated_at < ?
         GROUP BY c.id`
      )
      .bind(session.id, cutoff)
      .all<{ id: string; files: string | null }>();

    for (const claim of staleClaims.results ?? []) {
      await releaseClaim(db, claim.id, { status: 'abandoned' });
      released++;
      details.push({
        claim_id: claim.id,
        session_name: session.name,
        files: claim.files ? claim.files.split('|||') : [],
      });
    }
  }

  return { released_claims: released, details };
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
    priority?: number;
  }
): Promise<{ claim: Claim; files: string[]; symbols?: SymbolClaim[] }> {
  const id = generateId();
  const now = new Date().toISOString();
  const scope = params.scope ?? 'medium';
  const priority = params.priority ?? 50;

  // Batch insert: claim + all file paths in single transaction
  const claimStatement = db
    .prepare(
      `INSERT INTO claims (id, session_id, intent, scope, priority, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
    )
    .bind(id, params.session_id, params.intent, scope, priority, now, now);

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
      priority,
      created_at: now,
      updated_at: now,
      completed_summary: null,
    },
    files: params.files,
    symbols: params.symbols,
  };
}

export async function updateClaimPriority(
  db: DatabaseAdapter,
  claimId: string,
  priority: number
): Promise<boolean> {
  const now = new Date().toISOString();

  const result = await db
    .prepare('UPDATE claims SET priority = ?, updated_at = ? WHERE id = ? AND status = ?')
    .bind(priority, now, claimId, 'active')
    .run();

  return result.meta.changes > 0;
}

export async function getClaim(db: DatabaseAdapter, id: string): Promise<ClaimWithFiles | null> {
  // Single query with JOIN to avoid N+1 problem
  const result = await db
    .prepare(
      `SELECT
        c.id, c.session_id, c.intent, c.scope, c.priority, c.status,
        c.created_at, c.updated_at, c.completed_summary,
        s.name as session_name,
        GROUP_CONCAT(cf.file_path, '|||') as file_paths
      FROM claims c
      LEFT JOIN sessions s ON c.session_id = s.id
      LEFT JOIN claim_files cf ON c.id = cf.claim_id
      WHERE c.id = ?
      GROUP BY c.id`
    )
    .bind(id)
    .first<Claim & { session_name: string | null; file_paths: string | null }>();

  if (!result) return null;

  return {
    id: result.id,
    session_id: result.session_id,
    intent: result.intent,
    scope: result.scope,
    priority: result.priority,
    status: result.status,
    created_at: result.created_at,
    updated_at: result.updated_at,
    completed_summary: result.completed_summary,
    files: result.file_paths ? result.file_paths.split('|||') : [],
    session_name: result.session_name,
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
  if (files.length === 0) {
    return [];
  }

  const conflicts: ConflictInfo[] = [];

  // Build a map of file -> symbols for quick lookup
  const symbolsByFile = new Map<string, Set<string>>();
  const allSymbolNames = new Set<string>();
  if (symbols && symbols.length > 0) {
    for (const sc of symbols) {
      const existing = symbolsByFile.get(sc.file) ?? new Set();
      for (const sym of sc.symbols) {
        existing.add(sym);
        allSymbolNames.add(sym);
      }
      symbolsByFile.set(sc.file, existing);
    }
  }

  const hasSymbols = symbolsByFile.size > 0;
  const sessionFilter = excludeSessionId ? ' AND c.session_id != ?' : '';

  // Query 1: File-level conflicts (batch all files)
  const fileConditions = files.map(() => '(cf.file_path = ? OR (cf.is_pattern = 1 AND ? GLOB cf.file_path))').join(' OR ');

  let fileQuery = `
    SELECT DISTINCT
      c.id as claim_id,
      c.session_id,
      s.name as session_name,
      cf.file_path,
      c.intent,
      c.scope,
      c.created_at,
      NULL as symbol_name,
      NULL as symbol_type,
      'file' as conflict_level
    FROM claim_files cf
    JOIN claims c ON cf.claim_id = c.id
    JOIN sessions s ON c.session_id = s.id
    WHERE c.status = 'active'
      AND s.status = 'active'
      AND (${fileConditions})
      ${sessionFilter}
  `;

  // For symbol-level checks, exclude file claims that have symbol-level claims
  if (hasSymbols) {
    fileQuery += `
      AND NOT EXISTS (
        SELECT 1 FROM claim_symbols cs
        WHERE cs.claim_id = c.id AND cs.file_path = cf.file_path
      )
    `;
  }

  const fileBindings: string[] = files.flatMap(f => [f, f]);
  if (excludeSessionId) {
    fileBindings.push(excludeSessionId);
  }

  const fileResult = await db
    .prepare(fileQuery)
    .bind(...fileBindings)
    .all<ConflictInfo>();

  conflicts.push(...fileResult.results);

  // Query 2: Symbol-level conflicts (batch all files)
  const symbolFilePlaceholders = files.map(() => '?').join(',');
  let symbolQuery: string;
  let symbolBindings: string[];

  if (hasSymbols && allSymbolNames.size > 0) {
    // Check specific symbols
    const symbolPlaceholders = Array.from(allSymbolNames).map(() => '?').join(',');
    symbolQuery = `
      SELECT DISTINCT
        c.id as claim_id,
        c.session_id,
        s.name as session_name,
        cs.file_path,
        c.intent,
        c.scope,
        c.created_at,
        cs.symbol_name,
        cs.symbol_type,
        'symbol' as conflict_level
      FROM claim_symbols cs
      JOIN claims c ON cs.claim_id = c.id
      JOIN sessions s ON c.session_id = s.id
      WHERE c.status = 'active'
        AND s.status = 'active'
        AND cs.file_path IN (${symbolFilePlaceholders})
        AND cs.symbol_name IN (${symbolPlaceholders})
        ${sessionFilter}
    `;
    symbolBindings = [...files, ...Array.from(allSymbolNames)];
  } else {
    // Check all symbols on these files
    symbolQuery = `
      SELECT DISTINCT
        c.id as claim_id,
        c.session_id,
        s.name as session_name,
        cs.file_path,
        c.intent,
        c.scope,
        c.created_at,
        cs.symbol_name,
        cs.symbol_type,
        'symbol' as conflict_level
      FROM claim_symbols cs
      JOIN claims c ON cs.claim_id = c.id
      JOIN sessions s ON c.session_id = s.id
      WHERE c.status = 'active'
        AND s.status = 'active'
        AND cs.file_path IN (${symbolFilePlaceholders})
        ${sessionFilter}
    `;
    symbolBindings = [...files];
  }

  if (excludeSessionId) {
    symbolBindings.push(excludeSessionId);
  }

  const symbolResult = await db
    .prepare(symbolQuery)
    .bind(...symbolBindings)
    .all<ConflictInfo>();

  conflicts.push(...symbolResult.results);

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

/**
 * Get claim info by file path without modifying anything.
 * Use this to check claim details before deciding whether to release.
 */
export async function getClaimInfoByFile(
  db: DatabaseAdapter,
  sessionId: string,
  filePath: string
): Promise<{
  claim_id: string;
  scope: ClaimScope;
  file_count: number;
  files: string[];
} | null> {
  // Find claim containing this file for this session
  const claim = await db
    .prepare(
      `SELECT c.id, c.scope
       FROM claims c
       JOIN claim_files cf ON c.id = cf.claim_id
       WHERE c.session_id = ? AND c.status = 'active' AND cf.file_path = ?`
    )
    .bind(sessionId, filePath)
    .first<{ id: string; scope: ClaimScope }>();

  if (!claim) {
    return null;
  }

  // Get all files in this claim
  const filesResult = await db
    .prepare('SELECT file_path FROM claim_files WHERE claim_id = ?')
    .bind(claim.id)
    .all<{ file_path: string }>();

  const files = (filesResult.results ?? []).map((f) => f.file_path);

  return {
    claim_id: claim.id,
    scope: claim.scope,
    file_count: files.length,
    files,
  };
}

/**
 * Release a claim by file path.
 * If the claim has only one file, releases the entire claim.
 * If the claim has multiple files, removes just the specified file from the claim.
 */
export async function releaseClaimByFile(
  db: DatabaseAdapter,
  sessionId: string,
  filePath: string
): Promise<{
  released: boolean;
  claim_id?: string;
  scope?: ClaimScope;
  partial?: boolean;
  files_remaining?: number;
}> {
  // Find claim containing this file for this session
  const claim = await db
    .prepare(
      `SELECT c.id, c.scope
       FROM claims c
       JOIN claim_files cf ON c.id = cf.claim_id
       WHERE c.session_id = ? AND c.status = 'active' AND cf.file_path = ?`
    )
    .bind(sessionId, filePath)
    .first<{ id: string; scope: ClaimScope }>();

  if (!claim) {
    return { released: false };
  }

  // Check how many files are in this claim
  const fileCount = await db
    .prepare('SELECT COUNT(*) as count FROM claim_files WHERE claim_id = ?')
    .bind(claim.id)
    .first<{ count: number }>();

  const count = fileCount?.count ?? 0;

  if (count <= 1) {
    // Release the entire claim
    await releaseClaim(db, claim.id, { status: 'completed' });
    return { released: true, claim_id: claim.id, scope: claim.scope, partial: false };
  } else {
    // Remove just this file from the claim
    await db
      .prepare('DELETE FROM claim_files WHERE claim_id = ? AND file_path = ?')
      .bind(claim.id, filePath)
      .run();

    // Also remove any symbols for this file
    await db
      .prepare('DELETE FROM claim_symbols WHERE claim_id = ? AND file_path = ?')
      .bind(claim.id, filePath)
      .run();

    // Update claim's updated_at timestamp
    await db
      .prepare('UPDATE claims SET updated_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), claim.id)
      .run();

    return {
      released: true,
      claim_id: claim.id,
      scope: claim.scope,
      partial: true,
      files_remaining: count - 1,
    };
  }
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

  // Mark as read if requested - batch update for efficiency
  if (params.mark_as_read && messages.results.length > 0) {
    const now = new Date().toISOString();
    const ids = messages.results.map((m) => m.id);
    const placeholders = ids.map(() => '?').join(',');

    await db
      .prepare(`UPDATE messages SET read_at = ? WHERE id IN (${placeholders}) AND read_at IS NULL`)
      .bind(now, ...ids)
      .run();
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

// ============ Reference Queries ============

import type { ReferenceInput, SymbolReference, ImpactInfo } from './types';

export async function storeReferences(
  db: DatabaseAdapter,
  sessionId: string,
  references: ReferenceInput[]
): Promise<{ stored: number; skipped: number }> {
  const now = new Date().toISOString();

  // Collect all insert statements for batch execution
  const statements: ReturnType<typeof db.prepare>[] = [];

  for (const ref of references) {
    for (const r of ref.references) {
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO symbol_references
             (source_file, source_symbol, ref_file, ref_line, ref_context, session_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(ref.source_file, ref.source_symbol, r.file, r.line, r.context ?? null, sessionId, now)
      );
    }
  }

  if (statements.length === 0) {
    return { stored: 0, skipped: 0 };
  }

  // Batch execute all inserts in a single transaction
  try {
    const results = await db.batch(statements);
    const stored = results.reduce((acc, r) => acc + r.meta.changes, 0);
    return { stored, skipped: statements.length - stored };
  } catch (err) {
    // Log error for debugging, return partial result
    console.error('[storeReferences] Batch insert failed:', err);
    return { stored: 0, skipped: statements.length };
  }
}

export async function getReferencesForSymbol(
  db: DatabaseAdapter,
  sourceFile: string,
  sourceSymbol: string
): Promise<SymbolReference[]> {
  const result = await db
    .prepare(
      `SELECT * FROM symbol_references
       WHERE source_file = ? AND source_symbol = ?
       ORDER BY ref_file, ref_line`
    )
    .bind(sourceFile, sourceSymbol)
    .all<SymbolReference>();

  return result.results;
}


export async function analyzeClaimImpact(
  db: DatabaseAdapter,
  sourceFile: string,
  sourceSymbol: string,
  excludeSessionId?: string
): Promise<ImpactInfo> {
  // Get all references to this symbol
  const refs = await getReferencesForSymbol(db, sourceFile, sourceSymbol);

  // Get unique files that reference this symbol
  const affectedFiles = [...new Set(refs.map((r) => r.ref_file))];

  // Check if any of these files have active claims
  const affectedClaims: ImpactInfo['affected_claims'] = [];

  if (affectedFiles.length > 0) {
    const placeholders = affectedFiles.map(() => '?').join(',');
    let query = `
      SELECT DISTINCT
        c.id as claim_id,
        s.name as session_name,
        c.intent,
        cf.file_path
      FROM claim_files cf
      JOIN claims c ON cf.claim_id = c.id
      JOIN sessions s ON c.session_id = s.id
      WHERE c.status = 'active'
        AND s.status = 'active'
        AND cf.file_path IN (${placeholders})
    `;
    const bindings: string[] = [...affectedFiles];

    if (excludeSessionId) {
      query += ' AND c.session_id != ?';
      bindings.push(excludeSessionId);
    }

    const claimResults = await db
      .prepare(query)
      .bind(...bindings)
      .all<{ claim_id: string; session_name: string | null; intent: string; file_path: string }>();

    // Group by claim
    const claimMap = new Map<string, { session_name: string | null; intent: string; files: string[] }>();
    for (const r of claimResults.results) {
      const existing = claimMap.get(r.claim_id);
      if (existing) {
        existing.files.push(r.file_path);
      } else {
        claimMap.set(r.claim_id, {
          session_name: r.session_name,
          intent: r.intent,
          files: [r.file_path],
        });
      }
    }

    for (const [claimId, data] of claimMap) {
      affectedClaims.push({
        claim_id: claimId,
        session_name: data.session_name,
        intent: data.intent,
        affected_symbols: data.files,
      });
    }
  }

  return {
    symbol: sourceSymbol,
    file: sourceFile,
    affected_claims: affectedClaims,
    reference_count: refs.length,
    affected_files: affectedFiles,
  };
}

export async function clearSessionReferences(
  db: DatabaseAdapter,
  sessionId: string
): Promise<number> {
  const result = await db
    .prepare('DELETE FROM symbol_references WHERE session_id = ?')
    .bind(sessionId)
    .run();

  return result.meta.changes;
}

// ============ Audit History Queries ============

export async function logAuditEvent(
  db: DatabaseAdapter,
  params: {
    session_id?: string;
    action: AuditAction;
    entity_type: AuditEntityType;
    entity_id: string;
    metadata?: AuditMetadata;
  }
): Promise<AuditHistoryEntry> {
  const id = generateId();
  const now = new Date().toISOString();
  const metadataJson = params.metadata ? JSON.stringify(params.metadata) : null;

  await db
    .prepare(
      `INSERT INTO audit_history (id, session_id, action, entity_type, entity_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, params.session_id ?? null, params.action, params.entity_type, params.entity_id, metadataJson, now)
    .run();

  return {
    id,
    session_id: params.session_id ?? null,
    action: params.action,
    entity_type: params.entity_type,
    entity_id: params.entity_id,
    metadata: metadataJson,
    created_at: now,
  };
}

export async function listAuditHistory(
  db: DatabaseAdapter,
  params: {
    session_id?: string;
    action?: AuditAction;
    entity_type?: AuditEntityType;
    entity_id?: string;
    from_date?: string;
    to_date?: string;
    limit?: number;
  } = {}
): Promise<AuditHistoryWithSession[]> {
  let query = `
    SELECT h.*, s.name as session_name
    FROM audit_history h
    LEFT JOIN sessions s ON h.session_id = s.id
    WHERE 1=1
  `;
  const bindings: (string | number)[] = [];

  if (params.session_id) {
    query += ' AND h.session_id = ?';
    bindings.push(params.session_id);
  }

  if (params.action) {
    query += ' AND h.action = ?';
    bindings.push(params.action);
  }

  if (params.entity_type) {
    query += ' AND h.entity_type = ?';
    bindings.push(params.entity_type);
  }

  if (params.entity_id) {
    query += ' AND h.entity_id = ?';
    bindings.push(params.entity_id);
  }

  if (params.from_date) {
    query += ' AND h.created_at >= ?';
    bindings.push(params.from_date);
  }

  if (params.to_date) {
    query += ' AND h.created_at <= ?';
    bindings.push(params.to_date);
  }

  query += ' ORDER BY h.created_at DESC LIMIT ?';
  bindings.push(params.limit ?? 50);

  const result = await db
    .prepare(query)
    .bind(...bindings)
    .all<AuditHistoryWithSession>();

  return result.results;
}

export async function cleanupOldAuditHistory(
  db: DatabaseAdapter,
  retentionDays: number = 7
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const result = await db
    .prepare('DELETE FROM audit_history WHERE created_at < ?')
    .bind(cutoff)
    .run();

  return result.meta.changes;
}

// ============ Claim Queue Queries ============

import type { QueueEntry, QueueEntryWithDetails } from './types';
import { SCOPE_WAIT_MINUTES } from './types';

export async function getNextQueuePosition(
  db: DatabaseAdapter,
  claimId: string
): Promise<number> {
  const result = await db
    .prepare('SELECT MAX(position) as max_pos FROM claim_queue WHERE claim_id = ?')
    .bind(claimId)
    .first<{ max_pos: number | null }>();

  return (result?.max_pos ?? 0) + 1;
}

export async function calculateEstimatedWait(
  db: DatabaseAdapter,
  claimId: string,
  position: number
): Promise<number> {
  // Get all entries before this position, sum their scope times
  const result = await db
    .prepare(
      `SELECT scope FROM claim_queue
       WHERE claim_id = ? AND position < ?
       ORDER BY priority DESC, position ASC`
    )
    .bind(claimId, position)
    .all<{ scope: ClaimScope }>();

  let totalMinutes = 0;
  for (const entry of result.results) {
    totalMinutes += SCOPE_WAIT_MINUTES[entry.scope] ?? SCOPE_WAIT_MINUTES.medium;
  }

  // Also add the current claim's remaining time (estimate as half its scope)
  const claim = await getClaim(db, claimId);
  if (claim) {
    totalMinutes += Math.round(SCOPE_WAIT_MINUTES[claim.scope] / 2);
  }

  return totalMinutes;
}

export async function joinQueue(
  db: DatabaseAdapter,
  params: {
    claim_id: string;
    session_id: string;
    intent: string;
    priority?: number;
    scope?: ClaimScope;
  }
): Promise<QueueEntry> {
  const id = generateId();
  const now = new Date().toISOString();
  const priority = params.priority ?? 50;
  const scope = params.scope ?? 'medium';

  // Get next position for this claim's queue
  const position = await getNextQueuePosition(db, params.claim_id);

  // Calculate estimated wait time
  const estimatedWait = await calculateEstimatedWait(db, params.claim_id, position);

  await db
    .prepare(
      `INSERT INTO claim_queue (id, claim_id, session_id, intent, position, priority, scope, estimated_wait_minutes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, params.claim_id, params.session_id, params.intent, position, priority, scope, estimatedWait, now)
    .run();

  return {
    id,
    claim_id: params.claim_id,
    session_id: params.session_id,
    intent: params.intent,
    position,
    priority,
    scope,
    estimated_wait_minutes: estimatedWait,
    created_at: now,
  };
}

export async function leaveQueue(
  db: DatabaseAdapter,
  queueId: string
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM claim_queue WHERE id = ?')
    .bind(queueId)
    .run();

  return result.meta.changes > 0;
}

export async function getQueueEntry(
  db: DatabaseAdapter,
  queueId: string
): Promise<QueueEntry | null> {
  const result = await db
    .prepare('SELECT * FROM claim_queue WHERE id = ?')
    .bind(queueId)
    .first<QueueEntry>();

  return result ?? null;
}

export async function listQueue(
  db: DatabaseAdapter,
  params: {
    claim_id?: string;
    session_id?: string;
  } = {}
): Promise<QueueEntryWithDetails[]> {
  let query = `
    SELECT
      q.*,
      s.name as session_name,
      c.intent as claim_intent,
      cs.name as claim_session_name,
      GROUP_CONCAT(cf.file_path, '|||') as claim_files_concat
    FROM claim_queue q
    JOIN sessions s ON q.session_id = s.id
    JOIN claims c ON q.claim_id = c.id
    JOIN sessions cs ON c.session_id = cs.id
    LEFT JOIN claim_files cf ON c.id = cf.claim_id
    WHERE 1=1
  `;
  const bindings: string[] = [];

  if (params.claim_id) {
    query += ' AND q.claim_id = ?';
    bindings.push(params.claim_id);
  }

  if (params.session_id) {
    query += ' AND q.session_id = ?';
    bindings.push(params.session_id);
  }

  query += ' GROUP BY q.id ORDER BY q.priority DESC, q.position ASC';

  const result = await db
    .prepare(query)
    .bind(...bindings)
    .all<QueueEntry & {
      session_name: string | null;
      claim_intent: string;
      claim_session_name: string | null;
      claim_files_concat: string | null;
    }>();

  return result.results.map((r) => ({
    ...r,
    claim_files: r.claim_files_concat ? r.claim_files_concat.split('|||') : [],
  }));
}

export async function removeSessionFromAllQueues(
  db: DatabaseAdapter,
  sessionId: string
): Promise<number> {
  const result = await db
    .prepare('DELETE FROM claim_queue WHERE session_id = ?')
    .bind(sessionId)
    .run();

  return result.meta.changes;
}

export async function getQueuedSessionsForClaim(
  db: DatabaseAdapter,
  claimId: string
): Promise<Array<{ session_id: string; session_name: string | null; position: number }>> {
  const result = await db
    .prepare(
      `SELECT q.session_id, s.name as session_name, q.position
       FROM claim_queue q
       JOIN sessions s ON q.session_id = s.id
       WHERE q.claim_id = ?
       ORDER BY q.priority DESC, q.position ASC`
    )
    .bind(claimId)
    .all<{ session_id: string; session_name: string | null; position: number }>();

  return result.results;
}

// ============ Notification Queries ============

import type {
  Notification,
  NotificationType,
  NotificationMetadata,
  WorkingMemory,
  WorkingMemoryInput,
  MemoryCategory,
} from './types';

export async function createNotification(
  db: DatabaseAdapter,
  params: {
    session_id: string;
    type: NotificationType;
    title: string;
    message: string;
    reference_type?: string;
    reference_id?: string;
    metadata?: NotificationMetadata;
  }
): Promise<Notification> {
  const id = generateId();
  const now = new Date().toISOString();
  const metadataJson = params.metadata ? JSON.stringify(params.metadata) : null;

  await db
    .prepare(
      `INSERT INTO notifications (id, session_id, type, title, message, reference_type, reference_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      params.session_id,
      params.type,
      params.title,
      params.message,
      params.reference_type ?? null,
      params.reference_id ?? null,
      metadataJson,
      now
    )
    .run();

  return {
    id,
    session_id: params.session_id,
    type: params.type,
    title: params.title,
    message: params.message,
    reference_type: params.reference_type ?? null,
    reference_id: params.reference_id ?? null,
    metadata: metadataJson,
    read_at: null,
    created_at: now,
  };
}

export async function listNotifications(
  db: DatabaseAdapter,
  params: {
    session_id: string;
    unread_only?: boolean;
    type?: NotificationType;
    limit?: number;
  }
): Promise<Notification[]> {
  let query = 'SELECT * FROM notifications WHERE session_id = ?';
  const bindings: (string | number)[] = [params.session_id];

  if (params.unread_only) {
    query += ' AND read_at IS NULL';
  }

  if (params.type) {
    query += ' AND type = ?';
    bindings.push(params.type);
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  bindings.push(params.limit ?? 50);

  const result = await db
    .prepare(query)
    .bind(...bindings)
    .all<Notification>();

  return result.results;
}

export async function markNotificationsRead(
  db: DatabaseAdapter,
  notificationIds: string[]
): Promise<number> {
  if (notificationIds.length === 0) return 0;

  const now = new Date().toISOString();
  const placeholders = notificationIds.map(() => '?').join(',');

  const result = await db
    .prepare(`UPDATE notifications SET read_at = ? WHERE id IN (${placeholders}) AND read_at IS NULL`)
    .bind(now, ...notificationIds)
    .run();

  return result.meta.changes;
}

export async function getNotification(
  db: DatabaseAdapter,
  id: string
): Promise<Notification | null> {
  const result = await db
    .prepare('SELECT * FROM notifications WHERE id = ?')
    .bind(id)
    .first<Notification>();

  return result ?? null;
}

// Helper to notify all sessions in a claim's queue when the claim is released
export async function notifyQueueOnClaimRelease(
  db: DatabaseAdapter,
  claimId: string,
  releasedBy: string,
  files: string[]
): Promise<number> {
  const queuedSessions = await getQueuedSessionsForClaim(db, claimId);

  if (queuedSessions.length === 0) return 0;

  let notified = 0;
  for (let i = 0; i < queuedSessions.length; i++) {
    const entry = queuedSessions[i];
    const isFirst = i === 0;

    await createNotification(db, {
      session_id: entry.session_id,
      type: isFirst ? 'queue_ready' : 'claim_released',
      title: isFirst ? 'You are next in queue!' : 'Claim released',
      message: isFirst
        ? `The claim for ${files.join(', ')} has been released. You can now claim these files.`
        : `A claim you were waiting for has been released. Position: ${i + 1}`,
      reference_type: 'claim',
      reference_id: claimId,
      metadata: {
        claim_id: claimId,
        files,
        released_by: releasedBy,
        queue_position: i + 1,
      },
    });
    notified++;
  }

  return notified;
}

// ============ Working Memory Queries ============

export async function saveMemory(
  db: DatabaseAdapter,
  sessionId: string,
  input: WorkingMemoryInput
): Promise<WorkingMemory> {
  const now = new Date().toISOString();
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;

  // Use INSERT OR REPLACE to update if exists
  await db
    .prepare(
      `INSERT INTO working_memory
       (session_id, category, key, content, priority, pinned, created_at, updated_at, expires_at, related_claim_id, related_decision_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, category, key) DO UPDATE SET
         content = excluded.content,
         priority = excluded.priority,
         pinned = excluded.pinned,
         updated_at = excluded.updated_at,
         expires_at = excluded.expires_at,
         related_claim_id = excluded.related_claim_id,
         related_decision_id = excluded.related_decision_id,
         metadata = excluded.metadata`
    )
    .bind(
      sessionId,
      input.category,
      input.key,
      input.content,
      input.priority ?? 50,
      input.pinned ? 1 : 0,
      now,
      now,
      input.expires_at ?? null,
      input.related_claim_id ?? null,
      input.related_decision_id ?? null,
      metadataJson
    )
    .run();

  // Fetch the saved/updated record
  const result = await db
    .prepare('SELECT * FROM working_memory WHERE session_id = ? AND category = ? AND key = ?')
    .bind(sessionId, input.category, input.key)
    .first<WorkingMemory>();

  return result!;
}

export async function recallMemory(
  db: DatabaseAdapter,
  sessionId: string,
  params: {
    category?: MemoryCategory;
    key?: string;
    pinned_only?: boolean;
    limit?: number;
    include_expired?: boolean;
  } = {}
): Promise<WorkingMemory[]> {
  let query = 'SELECT * FROM working_memory WHERE session_id = ?';
  const bindings: (string | number)[] = [sessionId];

  if (params.category) {
    query += ' AND category = ?';
    bindings.push(params.category);
  }

  if (params.key) {
    query += ' AND key = ?';
    bindings.push(params.key);
  }

  if (params.pinned_only) {
    query += ' AND pinned = 1';
  }

  if (!params.include_expired) {
    query += ' AND (expires_at IS NULL OR expires_at > ?)';
    bindings.push(new Date().toISOString());
  }

  query += ' ORDER BY pinned DESC, priority DESC, updated_at DESC';

  if (params.limit) {
    query += ' LIMIT ?';
    bindings.push(params.limit);
  }

  const result = await db
    .prepare(query)
    .bind(...bindings)
    .all<WorkingMemory>();

  return result.results;
}

export async function updateMemory(
  db: DatabaseAdapter,
  sessionId: string,
  key: string,
  updates: {
    content?: string;
    priority?: number;
    pinned?: boolean;
    expires_at?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<boolean> {
  const now = new Date().toISOString();
  const setParts: string[] = ['updated_at = ?'];
  const bindings: (string | number | null)[] = [now];

  if (updates.content !== undefined) {
    setParts.push('content = ?');
    bindings.push(updates.content);
  }

  if (updates.priority !== undefined) {
    setParts.push('priority = ?');
    bindings.push(updates.priority);
  }

  if (updates.pinned !== undefined) {
    setParts.push('pinned = ?');
    bindings.push(updates.pinned ? 1 : 0);
  }

  if (updates.expires_at !== undefined) {
    setParts.push('expires_at = ?');
    bindings.push(updates.expires_at);
  }

  if (updates.metadata !== undefined) {
    setParts.push('metadata = ?');
    bindings.push(JSON.stringify(updates.metadata));
  }

  bindings.push(sessionId, key);

  const result = await db
    .prepare(`UPDATE working_memory SET ${setParts.join(', ')} WHERE session_id = ? AND key = ?`)
    .bind(...bindings)
    .run();

  return result.meta.changes > 0;
}

export async function clearMemory(
  db: DatabaseAdapter,
  sessionId: string,
  params: {
    key?: string;
    category?: MemoryCategory;
    clear_all?: boolean;
  } = {}
): Promise<number> {
  if (params.key) {
    // Clear specific key
    const result = await db
      .prepare('DELETE FROM working_memory WHERE session_id = ? AND key = ?')
      .bind(sessionId, params.key)
      .run();
    return result.meta.changes;
  }

  if (params.category) {
    // Clear entire category
    const result = await db
      .prepare('DELETE FROM working_memory WHERE session_id = ? AND category = ?')
      .bind(sessionId, params.category)
      .run();
    return result.meta.changes;
  }

  if (params.clear_all) {
    // Clear all memory for session
    const result = await db
      .prepare('DELETE FROM working_memory WHERE session_id = ?')
      .bind(sessionId)
      .run();
    return result.meta.changes;
  }

  return 0;
}

export async function pinMemory(
  db: DatabaseAdapter,
  sessionId: string,
  key: string,
  pinned: boolean
): Promise<boolean> {
  const now = new Date().toISOString();

  const result = await db
    .prepare('UPDATE working_memory SET pinned = ?, updated_at = ? WHERE session_id = ? AND key = ?')
    .bind(pinned ? 1 : 0, now, sessionId, key)
    .run();

  return result.meta.changes > 0;
}

export async function cleanupExpiredMemory(
  db: DatabaseAdapter
): Promise<number> {
  const now = new Date().toISOString();

  const result = await db
    .prepare('DELETE FROM working_memory WHERE expires_at IS NOT NULL AND expires_at < ?')
    .bind(now)
    .run();

  return result.meta.changes;
}

export async function getMemoryStats(
  db: DatabaseAdapter,
  sessionId: string
): Promise<{
  total: number;
  by_category: Record<string, number>;
  pinned_count: number;
}> {
  const totalResult = await db
    .prepare('SELECT COUNT(*) as count FROM working_memory WHERE session_id = ?')
    .bind(sessionId)
    .first<{ count: number }>();

  const categoryResult = await db
    .prepare(
      `SELECT category, COUNT(*) as count
       FROM working_memory
       WHERE session_id = ?
       GROUP BY category`
    )
    .bind(sessionId)
    .all<{ category: string; count: number }>();

  const pinnedResult = await db
    .prepare('SELECT COUNT(*) as count FROM working_memory WHERE session_id = ? AND pinned = 1')
    .bind(sessionId)
    .first<{ count: number }>();

  const byCategory: Record<string, number> = {};
  for (const row of categoryResult.results) {
    byCategory[row.category] = row.count;
  }

  return {
    total: totalResult?.count ?? 0,
    by_category: byCategory,
    pinned_count: pinnedResult?.count ?? 0,
  };
}

/**
 * Get all pinned and high-priority memories for injection into context.
 * This is the main function used for automatic context restoration.
 */
export async function getActiveMemories(
  db: DatabaseAdapter,
  sessionId: string,
  params: {
    priority_threshold?: number;
    max_items?: number;
  } = {}
): Promise<WorkingMemory[]> {
  const threshold = params.priority_threshold ?? 70;
  const limit = params.max_items ?? 20;
  const now = new Date().toISOString();

  const result = await db
    .prepare(
      `SELECT * FROM working_memory
       WHERE session_id = ?
         AND (pinned = 1 OR priority >= ?)
         AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY pinned DESC, priority DESC, updated_at DESC
       LIMIT ?`
    )
    .bind(sessionId, threshold, now, limit)
    .all<WorkingMemory>();

  return result.results;
}

// ============ Phase 3: Plan & File Protection ============

export type PlanStatus = 'draft' | 'approved' | 'in_progress' | 'completed' | 'archived';

export interface PlanInfo {
  file_path: string;
  title: string;
  status: PlanStatus;
  content_summary: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

/**
 * Register a plan document for protection.
 * Plans are automatically pinned and have high priority.
 */
export async function registerPlan(
  db: DatabaseAdapter,
  sessionId: string,
  params: {
    file_path: string;
    title: string;
    content_summary: string;
    status?: PlanStatus;
  }
): Promise<WorkingMemory> {
  const key = `plan:${params.file_path}`;
  const status = params.status ?? 'draft';

  return saveMemory(db, sessionId, {
    category: 'important',
    key,
    content: `[PLAN] ${params.title}\nStatus: ${status}\n\n${params.content_summary}`,
    priority: 95, // Very high priority for plans
    pinned: true,
    metadata: {
      type: 'plan',
      file_path: params.file_path,
      title: params.title,
      status,
    },
  });
}

/**
 * Update plan status (e.g., draft → approved → in_progress → completed)
 */
export async function updatePlanStatus(
  db: DatabaseAdapter,
  sessionId: string,
  filePath: string,
  newStatus: PlanStatus,
  summary?: string
): Promise<boolean> {
  const key = `plan:${filePath}`;

  // Get current memory
  const memories = await recallMemory(db, sessionId, { key });
  if (memories.length === 0) return false;

  const current = memories[0];
  let metadata: Record<string, unknown> = {};
  try {
    metadata = current.metadata ? JSON.parse(current.metadata) : {};
  } catch {
    // ignore
  }

  metadata.status = newStatus;
  if (newStatus === 'completed') {
    metadata.completed_at = new Date().toISOString();
  }

  // Adjust priority based on status
  let priority = 95;
  let pinned = true;
  if (newStatus === 'completed') {
    priority = 50; // Reduce priority but keep in memory
    pinned = false;
  } else if (newStatus === 'archived') {
    priority = 30; // Low priority for archived
    pinned = false;
  }

  const updatedContent = summary
    ? `[PLAN] ${metadata.title}\nStatus: ${newStatus}\n\n${summary}`
    : current.content.replace(/Status: \w+/, `Status: ${newStatus}`);

  return updateMemory(db, sessionId, key, {
    content: updatedContent,
    priority,
    pinned,
    metadata,
  });
}

/**
 * Get plan info by file path
 */
export async function getPlan(
  db: DatabaseAdapter,
  sessionId: string,
  filePath: string
): Promise<PlanInfo | null> {
  const key = `plan:${filePath}`;
  const memories = await recallMemory(db, sessionId, { key });

  if (memories.length === 0) return null;

  const memory = memories[0];
  let metadata: Record<string, unknown> = {};
  try {
    metadata = memory.metadata ? JSON.parse(memory.metadata) : {};
  } catch {
    // ignore
  }

  return {
    file_path: filePath,
    title: (metadata.title as string) ?? 'Untitled Plan',
    status: (metadata.status as PlanStatus) ?? 'draft',
    content_summary: memory.content,
    created_at: memory.created_at,
    updated_at: memory.updated_at,
    completed_at: metadata.completed_at as string | undefined,
  };
}

/**
 * List all plans for a session
 */
export async function listPlans(
  db: DatabaseAdapter,
  sessionId: string,
  params: {
    status?: PlanStatus;
    include_archived?: boolean;
  } = {}
): Promise<PlanInfo[]> {
  const now = new Date().toISOString();

  let query = `
    SELECT * FROM working_memory
    WHERE session_id = ?
      AND key LIKE 'plan:%'
      AND (expires_at IS NULL OR expires_at > ?)
  `;
  const bindings: (string | number)[] = [sessionId, now];

  if (params.status) {
    query += ` AND json_extract(metadata, '$.status') = ?`;
    bindings.push(params.status);
  }

  if (!params.include_archived) {
    query += ` AND json_extract(metadata, '$.status') != 'archived'`;
  }

  query += ' ORDER BY pinned DESC, priority DESC, updated_at DESC';

  const result = await db.prepare(query).bind(...bindings).all<WorkingMemory>();

  return result.results.map((memory) => {
    let metadata: Record<string, unknown> = {};
    try {
      metadata = memory.metadata ? JSON.parse(memory.metadata) : {};
    } catch {
      // ignore
    }

    return {
      file_path: (metadata.file_path as string) ?? memory.key.replace('plan:', ''),
      title: (metadata.title as string) ?? 'Untitled Plan',
      status: (metadata.status as PlanStatus) ?? 'draft',
      content_summary: memory.content,
      created_at: memory.created_at,
      updated_at: memory.updated_at,
      completed_at: metadata.completed_at as string | undefined,
    };
  });
}

/**
 * Register a file created in this session for protection.
 */
export async function registerCreatedFile(
  db: DatabaseAdapter,
  sessionId: string,
  params: {
    file_path: string;
    file_type?: 'plan' | 'code' | 'config' | 'doc' | 'other';
    description?: string;
  }
): Promise<WorkingMemory> {
  const key = `created_file:${params.file_path}`;
  const fileType = params.file_type ?? 'other';

  // Plans get higher priority
  const priority = fileType === 'plan' ? 90 : 70;
  const pinned = fileType === 'plan';

  return saveMemory(db, sessionId, {
    category: 'state',
    key,
    content: `Created file: ${params.file_path}${params.description ? `\n${params.description}` : ''}`,
    priority,
    pinned,
    metadata: {
      type: 'created_file',
      file_path: params.file_path,
      file_type: fileType,
      created_at: new Date().toISOString(),
    },
  });
}

/**
 * Get all files created in this session
 */
export async function getCreatedFiles(
  db: DatabaseAdapter,
  sessionId: string
): Promise<Array<{ file_path: string; file_type: string; created_at: string }>> {
  const result = await db
    .prepare(
      `SELECT * FROM working_memory
       WHERE session_id = ?
         AND key LIKE 'created_file:%'
       ORDER BY created_at DESC`
    )
    .bind(sessionId)
    .all<WorkingMemory>();

  return result.results.map((memory) => {
    let metadata: Record<string, unknown> = {};
    try {
      metadata = memory.metadata ? JSON.parse(memory.metadata) : {};
    } catch {
      // ignore
    }

    return {
      file_path: (metadata.file_path as string) ?? memory.key.replace('created_file:', ''),
      file_type: (metadata.file_type as string) ?? 'other',
      created_at: (metadata.created_at as string) ?? memory.created_at,
    };
  });
}

/**
 * Check if a file is protected (either a plan or created in this session)
 */
export async function isFileProtected(
  db: DatabaseAdapter,
  sessionId: string,
  filePath: string
): Promise<{
  protected: boolean;
  reason?: 'plan' | 'created_file';
  details?: PlanInfo | { file_type: string; created_at: string };
}> {
  // Check if it's a plan
  const plan = await getPlan(db, sessionId, filePath);
  if (plan && plan.status !== 'archived') {
    return {
      protected: true,
      reason: 'plan',
      details: plan,
    };
  }

  // Check if it's a created file
  const createdFiles = await getCreatedFiles(db, sessionId);
  const createdFile = createdFiles.find((f) => f.file_path === filePath);
  if (createdFile) {
    return {
      protected: true,
      reason: 'created_file',
      details: {
        file_type: createdFile.file_type,
        created_at: createdFile.created_at,
      },
    };
  }

  return { protected: false };
}

/**
 * Get all protected files in a session
 */
export async function getProtectedFiles(
  db: DatabaseAdapter,
  sessionId: string
): Promise<Array<{
  file_path: string;
  protection_type: 'plan' | 'created_file';
  priority: number;
  pinned: boolean;
}>> {
  const result = await db
    .prepare(
      `SELECT * FROM working_memory
       WHERE session_id = ?
         AND (key LIKE 'plan:%' OR key LIKE 'created_file:%')
         AND (
           json_extract(metadata, '$.status') IS NULL
           OR json_extract(metadata, '$.status') != 'archived'
         )
       ORDER BY priority DESC, pinned DESC`
    )
    .bind(sessionId)
    .all<WorkingMemory>();

  return result.results.map((memory) => {
    let metadata: Record<string, unknown> = {};
    try {
      metadata = memory.metadata ? JSON.parse(memory.metadata) : {};
    } catch {
      // ignore
    }

    const isPlan = memory.key.startsWith('plan:');
    return {
      file_path: (metadata.file_path as string) ?? memory.key.replace(/^(plan|created_file):/, ''),
      protection_type: isPlan ? 'plan' : 'created_file',
      priority: memory.priority,
      pinned: memory.pinned === 1,
    };
  });
}
