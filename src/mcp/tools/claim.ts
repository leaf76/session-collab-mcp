// Claim management tools (unified action-based)

import type { DatabaseAdapter } from '../../db/sqlite-adapter.js';
import type { McpTool, McpToolResult } from '../protocol.js';
import { createToolResult } from '../protocol.js';
import type { SessionConfig } from '../../db/types.js';
import { DEFAULT_SESSION_CONFIG } from '../../db/types.js';
import { createClaim, getClaim, listClaims, checkConflicts, releaseClaim, getSession, logAuditEvent, saveMemory, clearMemory } from '../../db/queries.js';
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
        intent: {
          type: 'string',
          description: 'What you plan to do (for create action)',
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
      const files = args.files as string[] | undefined;
      const intent = args.intent as string | undefined;

      if (!intent) {
        return validationError('intent is required for create action');
      }
      if (!files || files.length === 0) {
        return validationError('files array is required for create action');
      }

      // Verify session exists and is active
      const sessionResult = await validateActiveSession(db, sessionId);
      if (!sessionResult.valid) {
        return sessionResult.error;
      }

      // Create the claim
      const { claim } = await createClaim(db, {
        session_id: sessionId,
        files,
        intent,
        scope: 'medium',
        priority: 50,
      });

      // Log audit event
      await logAuditEvent(db, {
        session_id: sessionId,
        action: 'claim_created',
        entity_type: 'claim',
        entity_id: claim.id,
        metadata: { files, intent },
      });

      // Auto-save to memory
      await saveMemory(db, sessionId, {
        category: 'state',
        key: `claim_${claim.id}`,
        content: `Working on: ${intent}\nFiles: ${files.join(', ')}`,
        priority: 60,
        related_claim_id: claim.id,
        metadata: { claim_id: claim.id, files },
      });

      // Check for conflicts
      const conflicts = await checkConflicts(db, files, sessionId);

      if (conflicts.length > 0) {
        return successResponse({
          claim_id: claim.id,
          status: 'created_with_conflicts',
          files,
          conflicts: conflicts.map(c => ({
            session_name: c.session_name,
            file: c.file_path,
            intent: c.intent,
          })),
          warning: `⚠️ ${conflicts.length} conflict(s) detected. Coordinate before proceeding.`,
        });
      }

      return successResponse({
        claim_id: claim.id,
        status: 'created',
        files,
        intent,
        message: 'Claim created successfully.',
      });
    }

    case 'check': {
      const files = args.files as string[] | undefined;

      if (!files || files.length === 0) {
        return validationError('files array is required for check action');
      }

      const conflicts = await checkConflicts(db, files, sessionId);

      if (conflicts.length === 0) {
        return successResponse({
          has_conflicts: false,
          can_edit: true,
          recommendation: 'proceed',
          safe_files: files,
          message: 'All files are safe to edit. Proceed.',
        });
      }

      const blockedFiles = new Set(conflicts.map(c => c.file_path));
      const safeFiles = files.filter(f => !blockedFiles.has(f));

      return successResponse({
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
      const claimId = args.claim_id as string | undefined;
      const status = (args.status as string) || 'completed';
      const force = args.force as boolean | undefined;

      if (!claimId) {
        return validationError('claim_id is required for release action');
      }

      const claim = await getClaim(db, claimId);
      if (!claim) {
        return errorResponse(ERROR_CODES.CLAIM_NOT_FOUND, 'Claim not found');
      }

      // Check ownership
      if (claim.session_id !== sessionId && !force) {
        const callerSession = await getSession(db, sessionId);
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

      await releaseClaim(db, claimId, { status: status as 'completed' | 'abandoned' });

      await logAuditEvent(db, {
        session_id: sessionId,
        action: 'claim_released',
        entity_type: 'claim',
        entity_id: claimId,
        metadata: { status: status as 'completed' | 'abandoned', files: claim.files },
      });

      await clearMemory(db, claim.session_id, { key: `claim_${claimId}` });

      return successResponse({
        success: true,
        claim_id: claimId,
        files: claim.files,
        message: `Claim ${status}. Files now available.`,
      });
    }

    case 'list': {
      const claims = await listClaims(db, { session_id: sessionId, status: 'active' });

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
