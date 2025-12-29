// Session management tools

import type { D1Database } from '@cloudflare/workers-types';
import type { McpTool, McpToolResult } from '../protocol';
import { createToolResult } from '../protocol';
import {
  createSession,
  getSession,
  listSessions,
  updateSessionHeartbeat,
  endSession,
  cleanupStaleSessions,
  listClaims,
} from '../../db/queries';

export const sessionTools: McpTool[] = [
  {
    name: 'collab_session_start',
    description:
      'Register a new collaboration session. Call this when starting work to enable coordination with other sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: "Optional session name, e.g., 'frontend-refactor'",
        },
        project_root: {
          type: 'string',
          description: 'Project root directory path',
        },
        machine_id: {
          type: 'string',
          description: 'Optional machine identifier for multi-machine setups',
        },
      },
      required: ['project_root'],
    },
  },
  {
    name: 'collab_session_end',
    description: 'End a session and release all its claims.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Session ID to end',
        },
        release_claims: {
          type: 'string',
          enum: ['complete', 'abandon'],
          description: 'How to handle unreleased claims: complete (mark as done) or abandon',
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'collab_session_list',
    description: 'List all active sessions. Use to see who else is working.',
    inputSchema: {
      type: 'object',
      properties: {
        include_inactive: {
          type: 'boolean',
          description: 'Include inactive/terminated sessions',
        },
        project_root: {
          type: 'string',
          description: 'Filter by project root',
        },
      },
    },
  },
  {
    name: 'collab_session_heartbeat',
    description: 'Update session heartbeat to indicate the session is still active.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Session ID to update',
        },
      },
      required: ['session_id'],
    },
  },
];

export async function handleSessionTool(
  db: D1Database,
  name: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  switch (name) {
    case 'collab_session_start': {
      // Cleanup stale sessions first
      await cleanupStaleSessions(db, 30);

      const session = await createSession(db, {
        name: args.name as string | undefined,
        project_root: args.project_root as string,
        machine_id: args.machine_id as string | undefined,
      });

      const activeSessions = await listSessions(db, { project_root: args.project_root as string });

      return createToolResult(
        JSON.stringify(
          {
            session_id: session.id,
            name: session.name,
            message: `Session registered. ${activeSessions.length} active session(s) in this project.`,
            active_sessions: activeSessions.map((s) => ({
              id: s.id,
              name: s.name,
              last_heartbeat: s.last_heartbeat,
            })),
          },
          null,
          2
        )
      );
    }

    case 'collab_session_end': {
      const sessionId = args.session_id as string;
      const releaseClaims = (args.release_claims as 'complete' | 'abandon') ?? 'abandon';

      const session = await getSession(db, sessionId);
      if (!session) {
        return createToolResult(
          JSON.stringify({ error: 'SESSION_NOT_FOUND', message: 'Session not found' }),
          true
        );
      }

      await endSession(db, sessionId, releaseClaims);

      return createToolResult(
        JSON.stringify({
          success: true,
          message: `Session ended. All claims marked as ${releaseClaims === 'complete' ? 'completed' : 'abandoned'}.`,
        })
      );
    }

    case 'collab_session_list': {
      const sessions = await listSessions(db, {
        include_inactive: args.include_inactive as boolean,
        project_root: args.project_root as string | undefined,
      });

      // Get active claims count for each session
      const sessionsWithClaims = await Promise.all(
        sessions.map(async (session) => {
          const claims = await listClaims(db, { session_id: session.id, status: 'active' });
          return {
            id: session.id,
            name: session.name,
            project_root: session.project_root,
            status: session.status,
            active_claims: claims.length,
            last_heartbeat: session.last_heartbeat,
          };
        })
      );

      return createToolResult(
        JSON.stringify(
          {
            sessions: sessionsWithClaims,
            total: sessionsWithClaims.length,
          },
          null,
          2
        )
      );
    }

    case 'collab_session_heartbeat': {
      const sessionId = args.session_id as string;
      const updated = await updateSessionHeartbeat(db, sessionId);

      if (!updated) {
        return createToolResult(
          JSON.stringify({
            error: 'SESSION_NOT_FOUND',
            message: 'Session not found or inactive. Please start a new session.',
          }),
          true
        );
      }

      return createToolResult(
        JSON.stringify({
          success: true,
          message: 'Heartbeat updated',
        })
      );
    }

    default:
      return createToolResult(`Unknown session tool: ${name}`, true);
  }
}
