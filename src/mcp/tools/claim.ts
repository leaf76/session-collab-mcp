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
import {
  normalizeClaimPaths,
  normalizeSymbolClaims,
  PathNormalizationError,
} from '../../utils/paths.js';
import { clampMemoryContent } from '../../utils/memory-content.js';

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

function mapConflict(
  conflict: ConflictInfo,
  ownerSession: Session | null,
  detail: boolean
): Record<string, unknown> {
  if (!detail) {
    return {
      claim_id: conflict.claim_id,
      session_id: conflict.session_id,
      session_name: conflict.session_name,
      file: conflict.file_path,
      intent: conflict.intent,
      conflict_level: conflict.conflict_level,
      symbol_name: conflict.symbol_name ?? null,
    };
  }
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
  conflicts: ConflictInfo[],
  detail: boolean
): Promise<Array<Record<string, unknown>>> {
  if (!detail) {
    return conflicts.map((conflict) => mapConflict(conflict, null, false));
  }

  const sessions = new Map<string, Session | null>();

  for (const conflict of conflicts) {
    if (!sessions.has(conflict.session_id)) {
      sessions.set(conflict.session_id, await getSession(db, conflict.session_id));
    }
  }

  return conflicts.map((conflict) =>
    mapConflict(conflict, sessions.get(conflict.session_id) ?? null, true)
  );
}

function compactClaimSuccess(params: {
  claim_id: string;
  status: string;
  files: string[];
  symbols?: SymbolClaim[];
  intent?: string;
  detail: boolean;
  message: string;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    success: true,
    claim_id: params.claim_id,
    status: params.status,
    file_count: params.files.length,
    message: params.message,
    ...params.extra,
  };
  if (params.detail) {
    base.files = params.files;
    base.claimed_files = params.files;
    base.safe_files = params.files;
    base.blocked_files = [];
    base.symbols = params.symbols ?? [];
    if (params.intent) base.intent = params.intent;
  }
  return base;
}

function compactConflictResponse(params: {
  success: boolean;
  status: string;
  files: string[];
  blockedFiles: string[];
  safeFiles: string[];
  symbols?: SymbolClaim[];
  conflicts: Array<Record<string, unknown>>;
  coordination_requests?: Array<Record<string, unknown>>;
  recommendation?: string;
  claim_id?: string;
  detail: boolean;
  message: string;
  warning?: string;
}): Record<string, unknown> {
  // Conflict paths always include safe/blocked file lists (agent must act on them)
  const base: Record<string, unknown> = {
    success: params.success,
    status: params.status,
    file_count: params.files.length,
    claimed_files: params.claim_id ? params.safeFiles : [],
    safe_files: params.safeFiles,
    blocked_files: params.blockedFiles,
    blocked_count: params.blockedFiles.length,
    safe_count: params.safeFiles.length,
    conflicts: params.conflicts,
    message: params.message,
  };
  if (params.claim_id) base.claim_id = params.claim_id;
  if (params.recommendation) base.recommendation = params.recommendation;
  if (params.warning) base.warning = params.warning;
  // Always surface coordination (needed for agent action); compact when !detail
  if (params.coordination_requests) {
    base.coordination_count = params.coordination_requests.length;
    base.coordination_requests = params.detail
      ? params.coordination_requests
      : params.coordination_requests.map((r) => ({
          queue_id: r.queue_id,
          owner_session_id: r.owner_session_id,
          owner_session_name: r.owner_session_name,
          owner_claim_id: r.owner_claim_id,
          requested_by_session_id: r.requested_by_session_id,
          files: r.files,
          position: r.position,
        }));
  }
  if (params.detail) {
    base.files = params.files;
    base.symbols = params.symbols ?? [];
  }
  return base;
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

  const filePreview =
    input.files.length <= 5
      ? input.files.join(', ')
      : `${input.files.slice(0, 5).join(', ')} (+${input.files.length - 5} more)`;
  const clamped = clampMemoryContent(
    `Working on: ${input.intent}\nFiles (${input.files.length}): ${filePreview}`
  );

  await saveMemory(db, input.session_id, {
    category: 'state',
    key: `claim_${claim.id}`,
    content: clamped.content,
    priority: 60,
    related_claim_id: claim.id,
    metadata: { claim_id: claim.id, file_count: input.files.length },
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
    description: `Unified file/symbol claims. Prefer action=create (atomic claim-or-block; paths normalized to project_root). check is optional probe-only. detail defaults false (compact).`,
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
          description: 'File paths (create/check); absolute or relative — normalized to project_root',
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
        detail: {
          type: 'boolean',
          description: 'Full files/conflicts payloads (default false)',
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
      const detail = input.detail ?? false;

      // Verify session exists and is active
      const sessionResult = await validateActiveSession(db, input.session_id);
      if (!sessionResult.valid) {
        return sessionResult.error;
      }
      const config = parseSessionConfig(sessionResult.session);
      const projectRoot = sessionResult.session.project_root;

      let files: string[];
      let symbols: SymbolClaim[] | undefined;
      try {
        const rawSymbols = input.symbols as SymbolClaim[] | undefined;
        symbols = rawSymbols
          ? (normalizeSymbolClaims(rawSymbols, projectRoot) as SymbolClaim[])
          : undefined;
        const symbolFiles = (symbols ?? []).map((symbol) => symbol.file);
        files = normalizeClaimPaths([...(input.files ?? []), ...symbolFiles], projectRoot);
      } catch (err) {
        const message = err instanceof PathNormalizationError ? err.message : 'Invalid file path';
        return validationError(message);
      }

      const conflicts = await checkConflicts(db, files, input.session_id, symbols);
      const formattedConflicts = await formatConflicts(db, conflicts, detail);
      const blockedFiles = uniqueBlockedFiles(conflicts);
      const safeFiles = files.filter((file) => !blockedFiles.includes(file));
      const safeSymbols = filterSafeSymbols(symbols, safeFiles);

      if (conflicts.length > 0 && config.mode === 'strict') {
        return successResponse(
          compactConflictResponse({
            success: false,
            status: 'blocked_by_conflicts',
            files,
            blockedFiles,
            safeFiles,
            symbols,
            conflicts: formattedConflicts,
            recommendation: 'coordinate_before_editing',
            detail,
            message: `Claim not created. ${conflicts.length} conflict(s) detected. Coordinate before proceeding.`,
          })
        );
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

            return successResponse(
              compactConflictResponse({
                success: true,
                status: 'partial_claim_created',
                claim_id: claimId,
                files,
                blockedFiles,
                safeFiles,
                symbols: safeSymbols,
                conflicts: formattedConflicts,
                coordination_requests: coordinationRequests,
                recommendation: getCoordinationRecommendation(symbols, conflicts),
                detail,
                message: `Claim created for safe files only. Coordinate before editing blocked files: [${blockedFiles.join(', ')}].`,
              })
            );
          }

          return successResponse(
            compactConflictResponse({
              success: false,
              status: 'waiting_for_coordination',
              files,
              blockedFiles,
              safeFiles: [],
              symbols,
              conflicts: formattedConflicts,
              coordination_requests: coordinationRequests,
              recommendation: getCoordinationRecommendation(symbols, conflicts),
              detail,
              message: `Claim not created. Waiting for coordination on blocked files: [${blockedFiles.join(', ')}].`,
            })
          );
        }

        const claimId = await createTrackedClaim(db, {
          session_id: input.session_id,
          files,
          symbols,
          intent: input.intent,
          scope: input.scope,
          priority: input.priority,
        });

        return successResponse(
          compactConflictResponse({
            success: true,
            status: 'created_with_conflicts',
            claim_id: claimId,
            files,
            blockedFiles,
            safeFiles,
            symbols,
            conflicts: formattedConflicts,
            detail,
            message: `Claim created with ${conflicts.length} conflict(s). Coordinate before proceeding.`,
            warning: `⚠️ ${conflicts.length} conflict(s) detected. Coordinate before proceeding.`,
          })
        );
      }

      const claimId = await createTrackedClaim(db, {
        session_id: input.session_id,
        files,
        symbols,
        intent: input.intent,
        scope: input.scope,
        priority: input.priority,
      });

      return successResponse(
        compactClaimSuccess({
          claim_id: claimId,
          status: 'created',
          files,
          symbols,
          intent: input.intent,
          detail,
          message: 'Claim created successfully.',
        })
      );
    }

    case 'check': {
      const validation = validateInput(claimCheckSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }
      const input = validation.data;
      const detail = input.detail ?? false;

      if (!input.session_id) {
        return validationError('session_id is required');
      }

      const sessionResult = await validateActiveSession(db, input.session_id);
      if (!sessionResult.valid) {
        return sessionResult.error;
      }

      let files: string[];
      let symbols: SymbolClaim[] | undefined;
      try {
        const rawSymbols = input.symbols as SymbolClaim[] | undefined;
        symbols = rawSymbols
          ? (normalizeSymbolClaims(rawSymbols, sessionResult.session.project_root) as SymbolClaim[])
          : undefined;
        files = normalizeClaimPaths(input.files, sessionResult.session.project_root);
      } catch (err) {
        const message = err instanceof PathNormalizationError ? err.message : 'Invalid file path';
        return validationError(message);
      }

      const excludeSelf = input.exclude_self ?? true;
      const excludeSessionId = excludeSelf ? input.session_id : undefined;
      const conflicts = await checkConflicts(db, files, excludeSessionId, symbols);
      const formattedConflicts = await formatConflicts(db, conflicts, detail);

      if (conflicts.length === 0) {
        const ok: Record<string, unknown> = {
          safe: true,
          has_conflicts: false,
          can_edit: true,
          recommendation: 'proceed',
          file_count: files.length,
          conflicts: [],
          message: 'All files are safe to edit. Prefer collab_claim create to reserve them.',
        };
        if (detail) {
          ok.safe_files = files;
        }
        return successResponse(ok);
      }

      const blockedFiles = new Set(conflicts.map(c => c.file_path));
      const safeFiles = files.filter(f => !blockedFiles.has(f));

      const blocked: Record<string, unknown> = {
        safe: false,
        has_conflicts: true,
        can_edit: safeFiles.length > 0,
        recommendation: safeFiles.length > 0 ? 'proceed_safe_only' : 'abort',
        file_count: files.length,
        blocked_files: Array.from(blockedFiles),
        blocked_count: blockedFiles.size,
        safe_count: safeFiles.length,
        conflicts: formattedConflicts,
        message: safeFiles.length > 0
          ? `Edit ONLY safe files: [${safeFiles.join(', ')}]. Skip blocked files.`
          : 'All files blocked. Coordinate with other session(s).',
      };
      if (detail) {
        blocked.safe_files = safeFiles;
      }
      return successResponse(blocked);
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
        file_count: claim.files.length,
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
      const detail = input.detail ?? false;

      if (!input.session_id) {
        return validationError('session_id is required');
      }

      const claims = await listClaims(db, {
        session_id: input.session_id,
        status: input.status ?? 'active',
        project_root: input.project_root,
      });

      return successResponse({
        claims: claims.map(c => {
          const row: Record<string, unknown> = {
            id: c.id,
            session_name: c.session_name,
            file_count: c.files.length,
            intent: c.intent,
            priority: getPriorityLevel(c.priority),
            created_at: c.created_at,
          };
          if (detail) {
            row.files = c.files;
          }
          return row;
        }),
        total: claims.length,
        detail,
      });
    }

    default:
      return createToolResult(`Unknown action: ${action}`, true);
  }
}
