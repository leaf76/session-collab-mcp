// Claim management tools (WIP declarations)

import type { D1Database } from '@cloudflare/workers-types';
import type { McpTool, McpToolResult } from '../protocol';
import { createToolResult } from '../protocol';
import type { ClaimScope } from '../../db/types';
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
    description: 'Release a claim when done or abandoning work.',
    inputSchema: {
      type: 'object',
      properties: {
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
      },
      required: ['claim_id', 'status'],
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
  db: D1Database,
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

      const conflicts = await checkConflicts(db, files, sessionId);

      if (conflicts.length === 0) {
        return createToolResult(
          JSON.stringify({
            safe: true,
            message: 'These files are not being worked on by other sessions.',
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
            safe: false,
            conflicts: conflictDetails,
            warning: `⚠️ ${conflicts.length} file(s) are being worked on by ${bySession.size} other session(s). Coordinate before modifying.`,
          },
          null,
          2
        )
      );
    }

    case 'collab_release': {
      const claimId = args.claim_id as string;
      const status = args.status as 'completed' | 'abandoned';
      const summary = args.summary as string | undefined;

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

      if (claim.status !== 'active') {
        return createToolResult(
          JSON.stringify({
            error: 'CLAIM_ALREADY_RELEASED',
            message: `Claim was already ${claim.status}.`,
          }),
          true
        );
      }

      await releaseClaim(db, claimId, { status, summary });

      return createToolResult(
        JSON.stringify({
          success: true,
          message: `Claim ${status}. Files are now available for other sessions.`,
          files: claim.files,
          summary: summary ?? null,
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
