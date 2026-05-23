// Claim management tools (unified action-based)

import type { DatabaseAdapter } from '../../db/sqlite-adapter.js';
import type { McpTool, McpToolResult } from '../protocol.js';
import { createToolResult } from '../protocol.js';
import type { ConflictInfo, Session, SessionConfig, SymbolClaim } from '../../db/types.js';
import { DEFAULT_SESSION_CONFIG } from '../../db/types.js';
import {
  checkConflicts,
  createClaim,
  createNotification,
  getClaim,
  getSession,
  joinQueue,
  listClaims,
  logAuditEvent,
  notifyQueueOnClaimRelease,
  releaseClaim,
  saveMemory,
  clearMemory,
} from '../../db/queries.js';
import { getPriorityLevel } from '../../db/types.js';
import {
  validateInput,
  claimCreateSchema,
  claimCheckSchema,
  claimReleaseSchema,
  claimListSchema,
} from '../schemas.js';
import {
  errorResponse,
  successResponse,
  validationError,
  validateActiveSession,
  ERROR_CODES,
} from '../../utils/response.js';

function parseSessionConfig(session: Session): SessionConfig {
  if (!session.config) {
    return DEFAULT_SESSION_CONFIG;
  }

  try {
    return { ...DEFAULT_SESSION_CONFIG, ...JSON.parse(session.config) };
  } catch {
    return DEFAULT_SESSION_CONFIG;
  }
}

function mapConflict(conflict: ConflictInfo, ownerSession: Session | null): Record<string, unknown> {
  return {
    claim_id: conflict.claim_id,
    session_id: conflict.session_id,
    session_name: conflict.session_name,
    file: conflict.file_path,
    intent: conflict.intent,
    scope: conflict.scope,
    created_at: conflict.created_at,
    conflict_level: conflict.conflict_level,
    symbol_name: conflict.symbol_name ?? null,
    symbol_type: conflict.symbol_type ?? null,
    current_task: ownerSession?.current_task ?? null,
    last_heartbeat: ownerSession?.last_heartbeat ?? null,
  };
}

async function formatConflicts(
  db: DatabaseAdapter,
  conflicts: ConflictInfo[]
): Promise<Array<Record<string, unknown>>> {
  const sessions = new Map<string, Session | null>();

  for (const conflict of conflicts) {
    if (!sessions.has(conflict.session_id)) {
      sessions.set(conflict.session_id, await getSession(db, conflict.session_id));
    }
  }

  return conflicts.map((conflict) => mapConflict(conflict, sessions.get(conflict.session_id) ?? null));
}

function uniqueBlockedFiles(conflicts: ConflictInfo[]): string[] {
  return Array.from(new Set(conflicts.map((conflict) => conflict.file_path)));
}

function filterSafeSymbols(symbols: SymbolClaim[] | undefined, safeFiles: string[]): SymbolClaim[] | undefined {
  if (!symbols || symbols.length === 0) {
    return undefined;
  }

  const safeFileSet = new Set(safeFiles);
  const safeSymbols = symbols.filter((symbol) => safeFileSet.has(symbol.file));
  return safeSymbols.length > 0 ? safeSymbols : undefined;
}

function getCoordinationRecommendation(symbols: SymbolClaim[] | undefined, conflicts: ConflictInfo[]): string {
  const hasFileLevelConflict = conflicts.some((conflict) => conflict.conflict_level === 'file');
  if (symbols && symbols.length > 0 && hasFileLevelConflict) {
    return 'provide_symbols_or_wait';
  }
  return 'wait_for_release_or_coordinate';
}

async function createTrackedClaim(
  db: DatabaseAdapter,
  input: {
    session_id: string;
    files: string[];
    symbols?: SymbolClaim[];
    intent: string;
    scope?: 'small' | 'medium' | 'large';
    priority?: number;
  }
): Promise<string> {
  const { claim } = await createClaim(db, {
    session_id: input.session_id,
    files: input.files,
    symbols: input.symbols,
    intent: input.intent,
    scope: input.scope,
    priority: input.priority,
  });

  await logAuditEvent(db, {
    session_id: input.session_id,
    action: 'claim_created',
    entity_type: 'claim',
    entity_id: claim.id,
    metadata: { files: input.files, intent: input.intent },
  });

  await saveMemory(db, input.session_id, {
    category: 'state',
    key: `claim_${claim.id}`,
    content: `Working on: ${input.intent}\nFiles: ${input.files.join(', ')}`,
    priority: 60,
    related_claim_id: claim.id,
    metadata: { claim_id: claim.id, files: input.files },
  });

  return claim.id;
}

async function createCoordinationRequests(
  db: DatabaseAdapter,
  input: {
    session_id: string;
    intent: string;
    scope?: 'small' | 'medium' | 'large';
    priority?: number;
  },
  conflicts: ConflictInfo[]
): Promise<Array<Record<string, unknown>>> {
  const grouped = new Map<string, { conflict: ConflictInfo; files: Set<string> }>();

  for (const conflict of conflicts) {
    const existing = grouped.get(conflict.claim_id);
    if (existing) {
      existing.files.add(conflict.file_path);
    } else {
      grouped.set(conflict.claim_id, {
        conflict,
        files: new Set([conflict.file_path]),
      });
    }
  }

  const requests: Array<Record<string, unknown>> = [];

  for (const { conflict, files } of grouped.values()) {
    const fileList = Array.from(files);
    const queueEntry = await joinQueue(db, {
      claim_id: conflict.claim_id,
      session_id: input.session_id,
      intent: input.intent,
      priority: input.priority,
      scope: input.scope,
    });

    await logAuditEvent(db, {
      session_id: input.session_id,
      action: 'queue_joined',
      entity_type: 'queue',
      entity_id: queueEntry.id,
      metadata: {
        claim_id: conflict.claim_id,
        files: fileList,
        conflicting_session_id: conflict.session_id,
        conflicting_session_name: conflict.session_name ?? undefined,
        priority: queueEntry.priority,
        scope: queueEntry.scope,
      },
    });

    await createNotification(db, {
      session_id: conflict.session_id,
      type: 'conflict_detected',
      title: 'Coordination requested',
      message: `Another session is waiting to coordinate work on ${fileList.join(', ')}.`,
      reference_type: 'claim',
      reference_id: conflict.claim_id,
      metadata: {
        claim_id: conflict.claim_id,
        files: fileList,
        conflicting_session_id: input.session_id,
      },
    });

    requests.push({
      queue_id: queueEntry.id,
      owner_claim_id: conflict.claim_id,
      owner_session_id: conflict.session_id,
      owner_session_name: conflict.session_name,
      requested_by_session_id: input.session_id,
      requested_intent: input.intent,
      files: fileList,
      position: queueEntry.position,
      estimated_wait_minutes: queueEntry.estimated_wait_minutes,
    });
  }

  return requests;
}

export const claimTools: McpTool[] = [
  {
    name: 'collab_claim',
    description: `Unified tool for file/symbol claims. Use action parameter to:
- "create": Declare files you're about to modify; smart mode queues blocked files for coordination
- "check": Check if files are being worked on (ALWAYS call before editing)
- "release": Release a claim when done
- "list": List all active claims`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'check', 'release', 'list'],
          description: 'Action to perform',
        },
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'File paths (for create/check actions)',
        },
        exclude_self: {
          type: 'boolean',
          description: 'Exclude your own claims when checking (for check action)',
        },
        symbols: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string' },
              symbols: { type: 'array', items: { type: 'string' } },
              symbol_type: {
                type: 'string',
                enum: ['function', 'class', 'method', 'variable', 'block', 'other'],
              },
            },
            required: ['file', 'symbols'],
          },
          description: 'Symbol claims (for create/check actions)',
        },
        intent: {
          type: 'string',
          description: 'What you plan to do (for create action)',
        },
        scope: {
          type: 'string',
          enum: ['small', 'medium', 'large'],
          description: 'Scope estimate (for create action)',
        },
        priority: {
          type: 'number',
          description: 'Priority 0-100 (for create action)',
        },
        claim_id: {
          type: 'string',
          description: 'Claim ID (for release action)',
        },
        status: {
          type: 'string',
          enum: ['completed', 'abandoned'],
          description: 'Release status (for release action)',
        },
        force: {
          type: 'boolean',
          description: 'Force release even if not owner (for release action)',
        },
        allow_conflicts: {
          type: 'boolean',
          description: 'Explicitly create a claim even when conflicts are detected (for create action)',
        },
        summary: {
          type: 'string',
          description: 'Release summary (for release action)',
        },
        project_root: {
          type: 'string',
          description: 'Filter by project root (for list action)',
        },
      },
      required: ['action', 'session_id'],
    },
  },
];

export async function handleClaimTool(
  db: DatabaseAdapter,
  name: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  if (name !== 'collab_claim') {
    return createToolResult(`Unknown tool: ${name}`, true);
  }

  const action = args.action as string;
  const sessionId = args.session_id as string;

  if (!action || !sessionId) {
    return validationError('action and session_id are required');
  }

  switch (action) {
    case 'create': {
      const validation = validateInput(claimCreateSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }
      const input = validation.data;

      // Verify session exists and is active
      const sessionResult = await validateActiveSession(db, input.session_id);
      if (!sessionResult.valid) {
        return sessionResult.error;
      }
      const config = parseSessionConfig(sessionResult.session);

      const symbolFiles = (input.symbols ?? []).map((symbol) => symbol.file);
      const files = Array.from(new Set([...(input.files ?? []), ...symbolFiles]));

      const conflicts = await checkConflicts(db, files, input.session_id, input.symbols);
      const formattedConflicts = await formatConflicts(db, conflicts);
      const blockedFiles = uniqueBlockedFiles(conflicts);
      const safeFiles = files.filter((file) => !blockedFiles.includes(file));
      const safeSymbols = filterSafeSymbols(input.symbols, safeFiles);

      if (conflicts.length > 0 && config.mode === 'strict') {
        return successResponse({
          success: false,
          status: 'blocked_by_conflicts',
          files,
          symbols: input.symbols ?? [],
          claimed_files: [],
          safe_files: safeFiles,
          blocked_files: blockedFiles,
          conflicts: formattedConflicts,
          recommendation: 'coordinate_before_editing',
          message: `Claim not created. ${conflicts.length} conflict(s) detected. Coordinate before proceeding.`,
        });
      }

      if (conflicts.length > 0) {
        if (!input.allow_conflicts) {
          const coordinationRequests = await createCoordinationRequests(db, {
            session_id: input.session_id,
            intent: input.intent,
            scope: input.scope,
            priority: input.priority,
          }, conflicts);

          if (config.mode === 'smart' && safeFiles.length > 0) {
            const claimId = await createTrackedClaim(db, {
              session_id: input.session_id,
              files: safeFiles,
              symbols: safeSymbols,
              intent: input.intent,
              scope: input.scope,
              priority: input.priority,
            });

            return successResponse({
              success: true,
              claim_id: claimId,
              status: 'partial_claim_created',
              files,
              claimed_files: safeFiles,
              safe_files: safeFiles,
              blocked_files: blockedFiles,
              symbols: safeSymbols ?? [],
              conflicts: formattedConflicts,
              coordination_requests: coordinationRequests,
              recommendation: getCoordinationRecommendation(input.symbols, conflicts),
              message: `Claim created for safe files only. Coordinate before editing blocked files: [${blockedFiles.join(', ')}].`,
            });
          }

          return successResponse({
            success: false,
            status: 'waiting_for_coordination',
            files,
            claimed_files: [],
            safe_files: [],
            blocked_files: blockedFiles,
            symbols: input.symbols ?? [],
            conflicts: formattedConflicts,
            coordination_requests: coordinationRequests,
            recommendation: getCoordinationRecommendation(input.symbols, conflicts),
            message: `Claim not created. Waiting for coordination on blocked files: [${blockedFiles.join(', ')}].`,
          });
        }

        const claimId = await createTrackedClaim(db, {
          session_id: input.session_id,
          files,
          symbols: input.symbols,
          intent: input.intent,
          scope: input.scope,
          priority: input.priority,
        });

        return successResponse({
          success: true,
          claim_id: claimId,
          status: 'created_with_conflicts',
          files,
          claimed_files: files,
          safe_files: safeFiles,
          blocked_files: blockedFiles,
          symbols: input.symbols ?? [],
          conflicts: formattedConflicts,
          warning: `⚠️ ${conflicts.length} conflict(s) detected. Coordinate before proceeding.`,
        });
      }

      const claimId = await createTrackedClaim(db, {
        session_id: input.session_id,
        files,
        symbols: input.symbols,
        intent: input.intent,
        scope: input.scope,
        priority: input.priority,
      });

      return successResponse({
        success: true,
        claim_id: claimId,
        status: 'created',
        files,
        claimed_files: files,
        safe_files: files,
        blocked_files: [],
        symbols: input.symbols ?? [],
        intent: input.intent,
        message: 'Claim created successfully.',
      });
    }

    case 'check': {
      const validation = validateInput(claimCheckSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }
      const input = validation.data;

      if (!input.session_id) {
        return validationError('session_id is required');
      }

      const excludeSelf = input.exclude_self ?? true;
      const excludeSessionId = excludeSelf ? input.session_id : undefined;
      const conflicts = await checkConflicts(db, input.files, excludeSessionId, input.symbols);
      const formattedConflicts = await formatConflicts(db, conflicts);

      if (conflicts.length === 0) {
        return successResponse({
          safe: true,
          has_conflicts: false,
          can_edit: true,
          recommendation: 'proceed',
          safe_files: input.files,
          conflicts: [],
          message: 'All files are safe to edit. Proceed.',
        });
      }

      const blockedFiles = new Set(conflicts.map(c => c.file_path));
      const safeFiles = input.files.filter(f => !blockedFiles.has(f));

      return successResponse({
        safe: false,
        has_conflicts: true,
        can_edit: safeFiles.length > 0,
        recommendation: safeFiles.length > 0 ? 'proceed_safe_only' : 'abort',
        safe_files: safeFiles,
        blocked_files: Array.from(blockedFiles),
        conflicts: formattedConflicts,
        message: safeFiles.length > 0
          ? `Edit ONLY safe files: [${safeFiles.join(', ')}]. Skip blocked files.`
          : 'All files blocked. Coordinate with other session(s).',
      });
    }

    case 'release': {
      const validation = validateInput(claimReleaseSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }
      const input = validation.data;
      const status = input.status ?? 'completed';
      const force = input.force;

      const claim = await getClaim(db, input.claim_id);
      if (!claim) {
        return errorResponse(ERROR_CODES.CLAIM_NOT_FOUND, 'Claim not found');
      }

      // Check ownership
      if (claim.session_id !== input.session_id && !force) {
        const callerSession = await getSession(db, input.session_id);
        let config: SessionConfig = DEFAULT_SESSION_CONFIG;
        if (callerSession?.config) {
          try {
            config = { ...DEFAULT_SESSION_CONFIG, ...JSON.parse(callerSession.config) };
          } catch {
            // Use default
          }
        }

        if (!config.allow_release_others) {
          return errorResponse(
            ERROR_CODES.NOT_OWNER,
            `Not your claim. Owner: ${claim.session_name}. Use force=true to override.`
          );
        }
      }

      if (claim.status !== 'active') {
        return errorResponse(ERROR_CODES.CLAIM_ALREADY_RELEASED, `Claim already ${claim.status}`);
      }

      const notifications_sent = await notifyQueueOnClaimRelease(db, input.claim_id, input.session_id, claim.files);

      await releaseClaim(db, input.claim_id, {
        status: status as 'completed' | 'abandoned',
        summary: input.summary,
      });

      await logAuditEvent(db, {
        session_id: input.session_id,
        action: 'claim_released',
        entity_type: 'claim',
        entity_id: input.claim_id,
        metadata: { status: status as 'completed' | 'abandoned', files: claim.files },
      });

      await clearMemory(db, claim.session_id, { key: `claim_${input.claim_id}` });

      return successResponse({
        success: true,
        claim_id: input.claim_id,
        files: claim.files,
        notifications_sent,
        message: `Claim ${status} released. Files now available.`,
      });
    }

    case 'list': {
      const validation = validateInput(claimListSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }
      const input = validation.data;

      if (!input.session_id) {
        return validationError('session_id is required');
      }

      const claims = await listClaims(db, {
        session_id: input.session_id,
        status: input.status ?? 'active',
        project_root: input.project_root,
      });

      return successResponse({
        claims: claims.map(c => ({
          id: c.id,
          session_name: c.session_name,
          files: c.files,
          intent: c.intent,
          priority: getPriorityLevel(c.priority),
          created_at: c.created_at,
        })),
        total: claims.length,
      });
    }

    default:
      return createToolResult(`Unknown action: ${action}`, true);
  }
}
