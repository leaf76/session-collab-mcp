// Session management tools

import type { D1Database } from '@cloudflare/workers-types';
import type { McpTool, McpToolResult } from '../protocol';
import { createToolResult } from '../protocol';
import {
  createSession,
  getSession,
  listSessions,
  updateSessionHeartbeat,
  updateSessionStatus,
  endSession,
  cleanupStaleSessions,
  listClaims,
} from '../../db/queries';
import type { TodoItem } from '../../db/types';

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
        current_task: {
          type: 'string',
          description: 'Optional: Current task being worked on',
        },
        todos: {
          type: 'array',
          description: 'Optional: Current todo list to sync',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            },
          },
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'collab_status_update',
    description: 'Update session work status. Use this to share what you are currently working on with other sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        current_task: {
          type: 'string',
          description: 'Description of current task (e.g., "Refactoring auth module")',
        },
        todos: {
          type: 'array',
          description: 'Your current todo list',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Task description' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            },
            required: ['content', 'status'],
          },
        },
      },
      required: ['session_id'],
    },
  },
];

export async function handleSessionTool(
  db: D1Database,
  name: string,
  args: Record<string, unknown>,
  userId?: string
): Promise<McpToolResult> {
  switch (name) {
    case 'collab_session_start': {
      // Cleanup stale sessions first
      await cleanupStaleSessions(db, 30);

      const session = await createSession(db, {
        name: args.name as string | undefined,
        project_root: args.project_root as string,
        machine_id: args.machine_id as string | undefined,
        user_id: userId,
      });

      const activeSessions = await listSessions(db, { project_root: args.project_root as string, user_id: userId });

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
        user_id: userId,
      });

      // Get active claims count for each session and include status info
      const sessionsWithDetails = await Promise.all(
        sessions.map(async (session) => {
          const claims = await listClaims(db, { session_id: session.id, status: 'active' });

          // Parse progress and todos if present
          let progress = null;
          let todos = null;
          try {
            if (session.progress) progress = JSON.parse(session.progress);
            if (session.todos) todos = JSON.parse(session.todos);
          } catch {
            // Ignore parse errors
          }

          return {
            id: session.id,
            name: session.name,
            project_root: session.project_root,
            status: session.status,
            active_claims: claims.length,
            last_heartbeat: session.last_heartbeat,
            current_task: session.current_task,
            progress,
            todos,
          };
        })
      );

      return createToolResult(
        JSON.stringify(
          {
            sessions: sessionsWithDetails,
            total: sessionsWithDetails.length,
          },
          null,
          2
        )
      );
    }

    case 'collab_session_heartbeat': {
      const sessionId = args.session_id as string;
      const currentTask = args.current_task as string | undefined;
      const todos = args.todos as TodoItem[] | undefined;

      const updated = await updateSessionHeartbeat(db, sessionId, {
        current_task: currentTask,
        todos,
      });

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
          status_synced: !!(currentTask || todos),
        })
      );
    }

    case 'collab_status_update': {
      const sessionId = args.session_id as string;
      const currentTask = args.current_task as string | undefined;
      const todos = args.todos as TodoItem[] | undefined;

      // Validate session exists
      const session = await getSession(db, sessionId);
      if (!session || session.status !== 'active') {
        return createToolResult(
          JSON.stringify({
            error: 'SESSION_INVALID',
            message: 'Session not found or inactive.',
          }),
          true
        );
      }

      await updateSessionStatus(db, sessionId, {
        current_task: currentTask,
        todos,
      });

      // Calculate progress for response
      let progress = null;
      if (todos && todos.length > 0) {
        const completed = todos.filter((t) => t.status === 'completed').length;
        progress = {
          completed,
          total: todos.length,
          percentage: Math.round((completed / todos.length) * 100),
        };
      }

      return createToolResult(
        JSON.stringify({
          success: true,
          message: 'Status updated successfully.',
          current_task: currentTask ?? null,
          progress,
        })
      );
    }

    default:
      return createToolResult(`Unknown session tool: ${name}`, true);
  }
}
