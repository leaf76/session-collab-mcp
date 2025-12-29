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

import type { Notification, NotificationType, NotificationMetadata } from './types';

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
