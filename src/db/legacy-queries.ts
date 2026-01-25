// Legacy queries for deprecated tools (messages, decisions, references, queue, notifications).

import type { DatabaseAdapter } from './sqlite-adapter.js';
import type {
  Message,
  Decision,
  DecisionCategory,
  ReferenceInput,
  SymbolReference,
  ImpactInfo,
  ClaimScope,
  QueueEntry,
  QueueEntryWithDetails,
  Notification,
  NotificationType,
  NotificationMetadata,
} from './types.js';
import { SCOPE_WAIT_MINUTES } from './types.js';
import { generateId } from '../utils/crypto.js';
import { getClaim } from './queries.js';

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

export async function storeReferences(
  db: DatabaseAdapter,
  sessionId: string,
  references: ReferenceInput[]
): Promise<{ stored: number; skipped: number }> {
  const now = new Date().toISOString();
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

  try {
    const results = await db.batch(statements);
    const stored = results.reduce((acc, r) => acc + r.meta.changes, 0);
    return { stored, skipped: statements.length - stored };
  } catch {
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
  const refs = await getReferencesForSymbol(db, sourceFile, sourceSymbol);
  const affectedFiles = [...new Set(refs.map((r) => r.ref_file))];
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

// ============ Claim Queue Queries ============

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

  const position = await getNextQueuePosition(db, params.claim_id);
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
