// Claim management tools (WIP declarations)

import type { DatabaseAdapter } from '../../db/sqlite-adapter.js';
import type { McpTool, McpToolResult } from '../protocol';
import { createToolResult } from '../protocol';
import type { ClaimScope, SessionConfig } from '../../db/types';
import { DEFAULT_SESSION_CONFIG } from '../../db/types';
import { createClaim, getClaim, listClaims, checkConflicts, releaseClaim, getSession } from '../../db/queries';

export const claimTools: McpTool[] = [
  {
    name: 'collab_claim',
    description:
      'Declare files you are about to modify. Other sessions will see a warning before modifying the same files.',
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
          description: "File paths to claim. Supports glob patterns like 'src/api/*'",
        },
        intent: {
          type: 'string',
          description: 'What you plan to do with these files',
        },
        scope: {
          type: 'string',
          enum: ['small', 'medium', 'large'],
          description: 'Estimated scope: small(<30min), medium(30min-2hr), large(>2hr)',
        },
      },
      required: ['session_id', 'files', 'intent'],
    },
  },
  {
    name: 'collab_check',
    description:
      'Check if files are being worked on by other sessions. ALWAYS call this before deleting or significantly modifying files.',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'File paths to check',
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
];

export async function handleClaimTool(
  db: DatabaseAdapter,
  name: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  switch (name) {
    case 'collab_claim': {
      const sessionId = args.session_id as string | undefined;
      const files = args.files as string[] | undefined;
      const intent = args.intent as string | undefined;
      const scope = (args.scope as ClaimScope) ?? 'medium';

      // Input validation
      if (!sessionId || typeof sessionId !== 'string') {
        return createToolResult(
          JSON.stringify({ error: 'INVALID_INPUT', message: 'session_id is required' }),
          true
        );
      }
      if (!files || !Array.isArray(files) || files.length === 0) {
        return createToolResult(
          JSON.stringify({ error: 'INVALID_INPUT', message: 'files array cannot be empty' }),
          true
        );
      }
      if (!intent || typeof intent !== 'string' || intent.trim() === '') {
        return createToolResult(
          JSON.stringify({ error: 'INVALID_INPUT', message: 'intent is required' }),
          true
        );
      }

      // Verify session exists and is active
      const session = await getSession(db, sessionId);
      if (!session || session.status !== 'active') {
        return createToolResult(
          JSON.stringify({
            error: 'SESSION_INVALID',
            message: 'Session not found or inactive. Please start a new session.',
          }),
          true
        );
      }

      // Check for conflicts before creating claim
      const conflicts = await checkConflicts(db, files, sessionId);

      // Create the claim
      const { claim } = await createClaim(db, {
        session_id: sessionId,
        files,
        intent,
        scope,
      });

      if (conflicts.length > 0) {
        // Group conflicts by claim
        const conflictsByClaim = new Map<string, typeof conflicts>();
        for (const c of conflicts) {
          const existing = conflictsByClaim.get(c.claim_id) ?? [];
          existing.push(c);
          conflictsByClaim.set(c.claim_id, existing);
        }

        const conflictDetails = Array.from(conflictsByClaim.entries()).map(([claimId, items]) => ({
          claim_id: claimId,
          session_name: items[0].session_name,
          intent: items[0].intent,
          scope: items[0].scope,
          overlapping_files: items.map((i) => i.file_path),
        }));

        return createToolResult(
          JSON.stringify(
            {
              claim_id: claim.id,
              status: 'created_with_conflicts',
              conflicts: conflictDetails,
              warning: `⚠️ ${conflicts.length} file(s) overlap with other sessions. Please coordinate before proceeding.`,
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
          files,
          intent,
          scope,
          message: 'Claim created successfully. Other sessions will be warned about these files.',
        })
      );
    }

    case 'collab_check': {
      const files = args.files as string[] | undefined;
      const sessionId = args.session_id as string | undefined;

      // Input validation
      if (!files || !Array.isArray(files) || files.length === 0) {
        return createToolResult(
          JSON.stringify({ error: 'INVALID_INPUT', message: 'files array cannot be empty' }),
          true
        );
      }

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

      const conflicts = await checkConflicts(db, files, sessionId);

      if (conflicts.length === 0) {
        return createToolResult(
          JSON.stringify({
            has_conflicts: false,
            safe: true,
            message: 'These files are not being worked on by other sessions.',
            has_in_progress_todo: hasInProgressTodo,
            todos_status: todosStatus,
          })
        );
      }

      // Group by session for clearer output
      const bySession = new Map<string, typeof conflicts>();
      for (const c of conflicts) {
        const key = c.session_id;
        const existing = bySession.get(key) ?? [];
        existing.push(c);
        bySession.set(key, existing);
      }

      const conflictDetails = Array.from(bySession.entries()).map(([sessId, items]) => ({
        session_id: sessId,
        session_name: items[0].session_name,
        intent: items[0].intent,
        scope: items[0].scope,
        files: items.map((i) => i.file_path),
        started_at: items[0].created_at,
      }));

      return createToolResult(
        JSON.stringify(
          {
            has_conflicts: true,
            safe: false,
            conflicts: conflictDetails,
            warning: `⚠️ ${conflicts.length} file(s) are being worked on by ${bySession.size} other session(s). Coordinate before modifying.`,
            has_in_progress_todo: hasInProgressTodo,
            todos_status: todosStatus,
          },
          null,
          2
        )
      );
    }

    case 'collab_release': {
      const sessionId = args.session_id as string;
      const claimId = args.claim_id as string;
      const status = args.status as 'completed' | 'abandoned';
      const summary = args.summary as string | undefined;
      const force = args.force as boolean | undefined;

      // Validate session_id
      if (!sessionId || typeof sessionId !== 'string') {
        return createToolResult(
          JSON.stringify({
            error: 'INVALID_INPUT',
            message: 'session_id is required to verify ownership',
          }),
          true
        );
      }

      const claim = await getClaim(db, claimId);
      if (!claim) {
        return createToolResult(
          JSON.stringify({
            error: 'CLAIM_NOT_FOUND',
            message: 'Claim not found. It may have already been released.',
          }),
          true
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
        return createToolResult(
          JSON.stringify({
            error: 'CLAIM_ALREADY_RELEASED',
            message: `Claim was already ${claim.status}.`,
          }),
          true
        );
      }

      const isOwnClaim = claim.session_id === sessionId;
      await releaseClaim(db, claimId, { status, summary });

      return createToolResult(
        JSON.stringify({
          success: true,
          message: isOwnClaim
            ? `Claim ${status}. Files are now available for other sessions.`
            : `Claim from ${claim.session_name} forcefully ${status}.`,
          files: claim.files,
          summary: summary ?? null,
          was_forced: !isOwnClaim,
        })
      );
    }

    case 'collab_claims_list': {
      const claims = await listClaims(db, {
        session_id: args.session_id as string | undefined,
        status: (args.status as 'active' | 'completed' | 'abandoned' | 'all') ?? 'active',
        project_root: args.project_root as string | undefined,
      });

      return createToolResult(
        JSON.stringify(
          {
            claims: claims.map((c) => ({
              id: c.id,
              session_id: c.session_id,
              session_name: c.session_name,
              files: c.files,
              intent: c.intent,
              scope: c.scope,
              status: c.status,
              created_at: c.created_at,
              completed_summary: c.completed_summary,
            })),
            total: claims.length,
          },
          null,
          2
        )
      );
    }

    default:
      return createToolResult(`Unknown claim tool: ${name}`, true);
  }
}
