// Claim management tools (unified action-based)

import type { DatabaseAdapter } from '../../db/sqlite-adapter.js';
import type { McpTool, McpToolResult } from '../protocol.js';
import { createToolResult } from '../protocol.js';
import type { SessionConfig } from '../../db/types.js';
import { DEFAULT_SESSION_CONFIG } from '../../db/types.js';
import { createClaim, getClaim, listClaims, checkConflicts, releaseClaim, getSession, logAuditEvent, saveMemory, clearMemory } from '../../db/queries.js';
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

export const claimTools: McpTool[] = [
  {
    name: 'collab_claim',
    description: `Unified tool for file/symbol claims. Use action parameter to:
- "create": Declare files you're about to modify
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

      const symbolFiles = (input.symbols ?? []).map((symbol) => symbol.file);
      const files = Array.from(new Set([...(input.files ?? []), ...symbolFiles]));

      // Create the claim
      const { claim } = await createClaim(db, {
        session_id: input.session_id,
        files,
        symbols: input.symbols,
        intent: input.intent,
        scope: input.scope,
        priority: input.priority,
      });

      // Log audit event
      await logAuditEvent(db, {
        session_id: input.session_id,
        action: 'claim_created',
        entity_type: 'claim',
        entity_id: claim.id,
        metadata: { files, intent: input.intent },
      });

      // Auto-save to memory
      await saveMemory(db, input.session_id, {
        category: 'state',
        key: `claim_${claim.id}`,
        content: `Working on: ${input.intent}\nFiles: ${files.join(', ')}`,
        priority: 60,
        related_claim_id: claim.id,
        metadata: { claim_id: claim.id, files },
      });

      // Check for conflicts
      const conflicts = await checkConflicts(db, files, input.session_id, input.symbols);

      if (conflicts.length > 0) {
        return successResponse({
          success: true,
          claim_id: claim.id,
          status: 'created_with_conflicts',
          files,
          symbols: input.symbols ?? [],
          conflicts: conflicts.map(c => ({
            session_name: c.session_name,
            file: c.file_path,
            intent: c.intent,
          })),
          warning: `⚠️ ${conflicts.length} conflict(s) detected. Coordinate before proceeding.`,
        });
      }

      return successResponse({
        success: true,
        claim_id: claim.id,
        status: 'created',
        files,
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
        conflicts: conflicts.map(c => ({
          session_name: c.session_name,
          file: c.file_path,
          intent: c.intent,
        })),
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
