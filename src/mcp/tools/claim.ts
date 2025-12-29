// Claim management tools (WIP declarations)

import type { DatabaseAdapter } from '../../db/sqlite-adapter.js';
import type { McpTool, McpToolResult } from '../protocol.js';
import { createToolResult } from '../protocol.js';
import type { SessionConfig } from '../../db/types.js';
import { DEFAULT_SESSION_CONFIG } from '../../db/types.js';
import { createClaim, getClaim, listClaims, checkConflicts, releaseClaim, getSession, updateClaimPriority, logAuditEvent, notifyQueueOnClaimRelease } from '../../db/queries.js';
import { claimCreateSchema, claimCheckSchema, claimReleaseSchema, claimListSchema, claimUpdatePrioritySchema, validateInput } from '../schemas.js';
import { getPriorityLevel } from '../../db/types.js';
import {
  errorResponse,
  successResponse,
  validationError,
  validateActiveSession,
  ERROR_CODES,
} from '../../utils/response.js';

export const claimTools: McpTool[] = [
  {
    name: 'collab_claim',
    description:
      'Declare files or specific symbols (functions/classes) you are about to modify. Use symbols for fine-grained claims that allow other sessions to work on different parts of the same file.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: "File paths to claim. Supports glob patterns like 'src/api/*'. Use this for whole-file claims.",
        },
        symbols: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string', description: 'File path containing the symbols' },
              symbols: {
                type: 'array',
                items: { type: 'string' },
                description: 'Symbol names (function, class, method names) to claim',
              },
              symbol_type: {
                type: 'string',
                enum: ['function', 'class', 'method', 'variable', 'block', 'other'],
                description: 'Type of symbols being claimed (default: function)',
              },
            },
            required: ['file', 'symbols'],
          },
          description: 'Symbol-level claims for fine-grained conflict detection. Use this instead of files when you only need to modify specific functions/classes.',
        },
        intent: {
          type: 'string',
          description: 'What you plan to do with these files/symbols',
        },
        scope: {
          type: 'string',
          enum: ['small', 'medium', 'large'],
          description: 'Estimated scope: small(<30min), medium(30min-2hr), large(>2hr)',
        },
        priority: {
          type: 'number',
          description: 'Priority (0-100). Levels: critical (90-100), high (70-89), normal (40-69, default: 50), low (0-39)',
        },
      },
      required: ['session_id', 'intent'],
    },
  },
  {
    name: 'collab_check',
    description:
      'Check if files or symbols are being worked on by other sessions. ALWAYS call this before modifying files. Supports symbol-level checking for fine-grained conflict detection.',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'File paths to check',
        },
        symbols: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string', description: 'File path containing the symbols' },
              symbols: {
                type: 'array',
                items: { type: 'string' },
                description: 'Symbol names to check for conflicts',
              },
            },
            required: ['file', 'symbols'],
          },
          description: 'Symbol-level check. If provided, only checks for conflicts with these specific symbols.',
        },
        session_id: {
          type: 'string',
          description: 'Your session ID (to exclude your own claims from results)',
        },
      },
      required: ['files'],
    },
  },
  {
    name: 'collab_release',
    description: 'Release a claim when done or abandoning work. By default you can only release your own claims. Use force=true with user confirmation to release stale claims from other sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID (required to verify ownership)',
        },
        claim_id: {
          type: 'string',
          description: 'Claim ID to release',
        },
        status: {
          type: 'string',
          enum: ['completed', 'abandoned'],
          description: 'Whether work was completed or abandoned',
        },
        summary: {
          type: 'string',
          description: 'Optional summary of what was done (for completed claims)',
        },
        force: {
          type: 'boolean',
          description: 'Force release even if claim belongs to another session (requires user confirmation)',
        },
      },
      required: ['session_id', 'claim_id', 'status'],
    },
  },
  {
    name: 'collab_claims_list',
    description: 'List all WIP claims. Use to see what files are being worked on.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Filter by session ID',
        },
        status: {
          type: 'string',
          enum: ['active', 'completed', 'abandoned', 'all'],
          description: 'Filter by claim status',
        },
        project_root: {
          type: 'string',
          description: 'Filter by project root',
        },
      },
    },
  },
  {
    name: 'collab_claim_update_priority',
    description: 'Update the priority of an existing claim. Higher priority claims take precedence in queue ordering.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        claim_id: {
          type: 'string',
          description: 'Claim ID to update',
        },
        priority: {
          type: 'number',
          description: 'New priority (0-100). Levels: critical (90-100), high (70-89), normal (40-69), low (0-39)',
        },
        reason: {
          type: 'string',
          description: 'Optional reason for priority change',
        },
      },
      required: ['session_id', 'claim_id', 'priority'],
    },
  },
];

export async function handleClaimTool(
  db: DatabaseAdapter,
  name: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  switch (name) {
    case 'collab_claim': {
      // Validate input with Zod schema
      const validation = validateInput(claimCreateSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const { session_id: sessionId, files, symbols, intent, scope = 'medium', priority = 50 } = validation.data;
      const hasSymbols = symbols && symbols.length > 0;
      const priorityInfo = getPriorityLevel(priority);

      // Verify session exists and is active
      const sessionResult = await validateActiveSession(db, sessionId);
      if (!sessionResult.valid) {
        return sessionResult.error;
      }

      // Build file list from both files and symbols
      const allFiles = new Set<string>(files ?? []);
      if (hasSymbols) {
        for (const sc of symbols!) {
          allFiles.add(sc.file);
        }
      }
      const fileList = Array.from(allFiles);

      // Create the claim FIRST (atomic operation)
      // This ensures our claim is registered before checking conflicts
      const { claim } = await createClaim(db, {
        session_id: sessionId,
        files: fileList,
        intent,
        scope,
        priority,
        symbols: hasSymbols ? symbols : undefined,
      });

      // Log audit event for claim creation
      await logAuditEvent(db, {
        session_id: sessionId,
        action: 'claim_created',
        entity_type: 'claim',
        entity_id: claim.id,
        metadata: { files: fileList, intent, scope, priority },
      });

      // Check for conflicts AFTER creating claim
      // This eliminates race condition: if two sessions claim simultaneously,
      // both will see each other's claims and can coordinate
      const conflicts = await checkConflicts(db, fileList, sessionId, symbols);

      if (conflicts.length > 0) {
        // Log conflict detection
        for (const conflict of conflicts) {
          await logAuditEvent(db, {
            session_id: sessionId,
            action: 'conflict_detected',
            entity_type: 'claim',
            entity_id: claim.id,
            metadata: {
              conflicting_session_id: conflict.session_id,
              conflicting_session_name: conflict.session_name ?? undefined,
              files: [conflict.file_path],
            },
          });
        }

        // Group conflicts by type (file vs symbol)
        const fileConflicts = conflicts.filter((c) => c.conflict_level === 'file');
        const symbolConflicts = conflicts.filter((c) => c.conflict_level === 'symbol');

        const conflictDetails = {
          file_level: fileConflicts.map((c) => ({
            session_name: c.session_name,
            file: c.file_path,
            intent: c.intent,
          })),
          symbol_level: symbolConflicts.map((c) => ({
            session_name: c.session_name,
            file: c.file_path,
            symbol: c.symbol_name,
            symbol_type: c.symbol_type,
            intent: c.intent,
          })),
        };

        return createToolResult(
          JSON.stringify(
            {
              claim_id: claim.id,
              status: 'created_with_conflicts',
              files: fileList,
              symbols: hasSymbols ? symbols : undefined,
              conflicts: conflictDetails,
              warning: `⚠️ Conflicts detected: ${fileConflicts.length} file-level, ${symbolConflicts.length} symbol-level. Coordinate before proceeding.`,
            },
            null,
            2
          )
        );
      }

      return createToolResult(
        JSON.stringify({
          claim_id: claim.id,
          status: 'created',
          files: fileList,
          symbols: hasSymbols ? symbols : undefined,
          intent,
          scope,
          priority: priorityInfo,
          message: hasSymbols
            ? 'Symbol-level claim created. Other sessions can work on different symbols in the same file.'
            : 'Claim created successfully. Other sessions will be warned about these files.',
        })
      );
    }

    case 'collab_check': {
      // Validate input with Zod schema
      const validation = validateInput(claimCheckSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const { files, symbols, session_id: sessionId } = validation.data;

      // Check todos status if session_id provided
      let hasInProgressTodo = false;
      let todosStatus: { total: number; in_progress: number; completed: number; pending: number } | null = null;
      if (sessionId) {
        const session = await getSession(db, sessionId);
        if (session?.todos) {
          try {
            const todos = JSON.parse(session.todos) as Array<{ status: string }>;
            const inProgress = todos.filter((t) => t.status === 'in_progress').length;
            const completed = todos.filter((t) => t.status === 'completed').length;
            const pending = todos.filter((t) => t.status === 'pending').length;
            hasInProgressTodo = inProgress > 0;
            todosStatus = {
              total: todos.length,
              in_progress: inProgress,
              completed,
              pending,
            };
          } catch {
            // Ignore parse errors
          }
        }
      }

      const hasSymbols = symbols && Array.isArray(symbols) && symbols.length > 0;
      const conflicts = await checkConflicts(db, files, sessionId, hasSymbols ? symbols : undefined);

      // Build per-file status (considering both file and symbol conflicts)
      const blockedFiles = new Set<string>();
      const blockedSymbols = new Map<string, Set<string>>(); // file -> symbols

      for (const c of conflicts) {
        if (c.conflict_level === 'file') {
          blockedFiles.add(c.file_path);
        } else if (c.conflict_level === 'symbol' && c.symbol_name) {
          const existing = blockedSymbols.get(c.file_path) ?? new Set();
          existing.add(c.symbol_name);
          blockedSymbols.set(c.file_path, existing);
        }
      }

      // For symbol-level check, determine safe symbols
      let safeSymbols: Array<{ file: string; symbols: string[] }> = [];
      let blockedSymbolsList: Array<{ file: string; symbols: string[] }> = [];

      if (hasSymbols) {
        for (const sc of symbols!) {
          const blocked = blockedSymbols.get(sc.file) ?? new Set();
          const safe = sc.symbols.filter((s) => !blocked.has(s));
          const blockedList = sc.symbols.filter((s) => blocked.has(s));

          if (safe.length > 0) {
            safeSymbols.push({ file: sc.file, symbols: safe });
          }
          if (blockedList.length > 0) {
            blockedSymbolsList.push({ file: sc.file, symbols: blockedList });
          }
        }
      }

      const safeFiles = files.filter((f) => !blockedFiles.has(f) && !blockedSymbols.has(f));
      const blockedFilesList = files.filter((f) => blockedFiles.has(f));

      // Determine recommendation for Claude's auto-decision
      type Recommendation = 'proceed_all' | 'proceed_safe_only' | 'abort';
      let recommendation: Recommendation;
      let canEdit: boolean;

      const hasSafeContent = safeFiles.length > 0 || safeSymbols.length > 0;

      if (conflicts.length === 0) {
        recommendation = 'proceed_all';
        canEdit = true;
      } else if (hasSafeContent) {
        recommendation = 'proceed_safe_only';
        canEdit = true;
      } else {
        recommendation = 'abort';
        canEdit = false;
      }

      if (conflicts.length === 0) {
        return createToolResult(
          JSON.stringify({
            has_conflicts: false,
            safe: true,
            can_edit: true,
            recommendation: 'proceed_all',
            file_status: {
              safe: files,
              blocked: [],
            },
            symbol_status: hasSymbols ? { safe: symbols, blocked: [] } : undefined,
            message: hasSymbols
              ? 'All symbols are safe to edit. Proceed.'
              : 'All files are safe to edit. Proceed.',
            has_in_progress_todo: hasInProgressTodo,
            todos_status: todosStatus,
          })
        );
      }

      // Group conflicts by session for clearer output
      const bySession = new Map<string, typeof conflicts>();
      for (const c of conflicts) {
        const key = c.session_id;
        const existing = bySession.get(key) ?? [];
        existing.push(c);
        bySession.set(key, existing);
      }

      const conflictDetails = Array.from(bySession.entries()).map(([sessId, items]) => {
        const fileItems = items.filter((i) => i.conflict_level === 'file');
        const symbolItems = items.filter((i) => i.conflict_level === 'symbol');

        return {
          session_id: sessId,
          session_name: items[0].session_name,
          intent: items[0].intent,
          scope: items[0].scope,
          files: fileItems.map((i) => i.file_path),
          symbols: symbolItems.map((i) => ({
            file: i.file_path,
            symbol: i.symbol_name,
            type: i.symbol_type,
          })),
          started_at: items[0].created_at,
        };
      });

      // Build actionable message based on recommendation
      let message: string;
      if (recommendation === 'proceed_safe_only') {
        if (hasSymbols && safeSymbols.length > 0) {
          const safeDesc = safeSymbols.map((s) => `${s.file}:[${s.symbols.join(',')}]`).join(', ');
          const blockedDesc = blockedSymbolsList.map((s) => `${s.file}:[${s.symbols.join(',')}]`).join(', ');
          message = `Edit ONLY these safe symbols: ${safeDesc}. Skip blocked: ${blockedDesc}.`;
        } else {
          message = `Edit ONLY these safe files: [${safeFiles.join(', ')}]. Skip blocked files: [${blockedFilesList.join(', ')}].`;
        }
      } else {
        message = hasSymbols
          ? `All requested symbols are blocked. Coordinate with other session(s) or wait.`
          : `All ${files.length} file(s) are blocked. Coordinate with other session(s) or wait.`;
      }

      return createToolResult(
        JSON.stringify(
          {
            has_conflicts: true,
            safe: false,
            can_edit: canEdit,
            recommendation,
            file_status: {
              safe: safeFiles,
              blocked: blockedFilesList,
            },
            symbol_status: hasSymbols
              ? {
                  safe: safeSymbols,
                  blocked: blockedSymbolsList,
                }
              : undefined,
            conflicts: conflictDetails,
            message,
            has_in_progress_todo: hasInProgressTodo,
            todos_status: todosStatus,
          },
          null,
          2
        )
      );
    }

    case 'collab_release': {
      // Validate input with Zod schema
      const validation = validateInput(claimReleaseSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const { session_id: sessionId, claim_id: claimId, status, summary, force } = validation.data;

      const claim = await getClaim(db, claimId);
      if (!claim) {
        return errorResponse(
          ERROR_CODES.CLAIM_NOT_FOUND,
          'Claim not found. It may have already been released.'
        );
      }

      // Check ownership - only allow releasing your own claims unless config allows or force=true
      if (claim.session_id !== sessionId) {
        // Get caller's session config
        const callerSession = await getSession(db, sessionId);
        let config: SessionConfig = DEFAULT_SESSION_CONFIG;
        if (callerSession?.config) {
          try {
            config = { ...DEFAULT_SESSION_CONFIG, ...JSON.parse(callerSession.config) };
          } catch {
            // Use default if parse fails
          }
        }

        // Check if allowed to release others' claims
        const canRelease = force === true || config.allow_release_others;

        if (!canRelease) {
          // Calculate how old the claim is
          const claimAge = Date.now() - new Date(claim.created_at).getTime();
          const staleHours = config.stale_threshold_hours;
          const isStale = claimAge > staleHours * 60 * 60 * 1000;

          return createToolResult(
            JSON.stringify({
              error: 'NOT_OWNER',
              message: 'You can only release your own claims. This claim belongs to another session.',
              claim_owner: claim.session_name,
              claim_age_hours: Math.round(claimAge / (60 * 60 * 1000) * 10) / 10,
              is_stale: isStale,
              suggestions: [
                'Use collab_message_send to ask the owner to release it.',
                isStale ? 'This claim is stale. Ask user for confirmation, then use force=true to release.' : null,
                'Use collab_config to enable allow_release_others for future releases.',
              ].filter(Boolean),
            }),
            true
          );
        }
      }

      if (claim.status !== 'active') {
        return errorResponse(
          ERROR_CODES.CLAIM_ALREADY_RELEASED,
          `Claim was already ${claim.status}.`
        );
      }

      const isOwnClaim = claim.session_id === sessionId;
      await releaseClaim(db, claimId, { status, summary });

      // Log audit event for claim release
      await logAuditEvent(db, {
        session_id: sessionId,
        action: 'claim_released',
        entity_type: 'claim',
        entity_id: claimId,
        metadata: { status, files: claim.files },
      });

      // Notify sessions in queue that the claim is released
      const notifiedCount = await notifyQueueOnClaimRelease(db, claimId, sessionId, claim.files);

      return createToolResult(
        JSON.stringify({
          success: true,
          message: isOwnClaim
            ? `Claim ${status}. Files are now available for other sessions.`
            : `Claim from ${claim.session_name} forcefully ${status}.`,
          files: claim.files,
          summary: summary ?? null,
          was_forced: !isOwnClaim,
          notified_sessions: notifiedCount,
        })
      );
    }

    case 'collab_claims_list': {
      // Validate input with Zod schema (all fields optional)
      const validation = validateInput(claimListSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const { session_id, status = 'active', project_root } = validation.data;
      const claims = await listClaims(db, { session_id, status, project_root });

      return successResponse({
        claims: claims.map((c) => ({
          id: c.id,
          session_id: c.session_id,
          session_name: c.session_name,
          files: c.files,
          intent: c.intent,
          scope: c.scope,
          priority: getPriorityLevel(c.priority),
          status: c.status,
          created_at: c.created_at,
          completed_summary: c.completed_summary,
        })),
        total: claims.length,
      }, true);
    }

    case 'collab_claim_update_priority': {
      // Validate input with Zod schema
      const validation = validateInput(claimUpdatePrioritySchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const { session_id: sessionId, claim_id: claimId, priority, reason } = validation.data;

      // Verify session is active
      const sessionResult = await validateActiveSession(db, sessionId);
      if (!sessionResult.valid) {
        return sessionResult.error;
      }

      // Get the claim
      const claim = await getClaim(db, claimId);
      if (!claim) {
        return errorResponse(ERROR_CODES.CLAIM_NOT_FOUND, 'Claim not found');
      }

      // Verify ownership
      if (claim.session_id !== sessionId) {
        return errorResponse(ERROR_CODES.NOT_OWNER, 'You can only update priority of your own claims');
      }

      if (claim.status !== 'active') {
        return errorResponse(ERROR_CODES.CLAIM_ALREADY_RELEASED, `Claim is ${claim.status}, cannot update priority`);
      }

      const oldPriority = getPriorityLevel(claim.priority);
      const newPriority = getPriorityLevel(priority);

      // Update priority
      const updated = await updateClaimPriority(db, claimId, priority);
      if (!updated) {
        return errorResponse(ERROR_CODES.CLAIM_NOT_FOUND, 'Failed to update priority');
      }

      // Log audit event for priority change
      await logAuditEvent(db, {
        session_id: sessionId,
        action: 'priority_changed',
        entity_type: 'claim',
        entity_id: claimId,
        metadata: {
          old_value: claim.priority,
          new_value: priority,
          reason,
        },
      });

      return successResponse({
        success: true,
        claim_id: claimId,
        old_priority: oldPriority,
        new_priority: newPriority,
        reason: reason ?? null,
        message: `Priority updated from ${oldPriority.level} (${oldPriority.value}) to ${newPriority.level} (${newPriority.value})`,
      });
    }

    default:
      return createToolResult(`Unknown claim tool: ${name}`, true);
  }
}
