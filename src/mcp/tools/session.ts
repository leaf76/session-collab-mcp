// Session management tools

import type { DatabaseAdapter } from '../../db/sqlite-adapter.js';
import type { McpTool, McpToolResult } from '../protocol.js';
import { createToolResult } from '../protocol.js';
import {
  createSession,
  listSessions,
  updateSessionHeartbeat,
  updateSessionStatus,
  updateSessionConfig,
  endSession,
  cleanupStaleSessions,
  listClaims,
} from '../../db/queries.js';
import type { TodoItem, SessionConfig } from '../../db/types.js';
import { DEFAULT_SESSION_CONFIG } from '../../db/types.js';
import {
  validateInput,
  sessionStartSchema,
  sessionEndSchema,
  sessionListSchema,
  sessionHeartbeatSchema,
  statusUpdateSchema,
  configSchema,
} from '../schemas.js';
import {
  errorResponse,
  successResponse,
  validationError,
  validateActiveSession,
  validateSessionExists,
  ERROR_CODES,
} from '../../utils/response.js';

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
  {
    name: 'collab_config',
    description: 'Configure session behavior for conflict handling. Settings persist for the session duration.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        mode: {
          type: 'string',
          enum: ['strict', 'smart', 'bypass'],
          description: 'Conflict handling mode: strict (always ask), smart (ask but suggest for stale), bypass (warn only)',
        },
        allow_release_others: {
          type: 'boolean',
          description: 'Allow releasing claims from other sessions (default: false)',
        },
        auto_release_stale: {
          type: 'boolean',
          description: 'Automatically release stale claims (default: false)',
        },
        stale_threshold_hours: {
          type: 'number',
          description: 'Hours before a claim is considered stale (default: 2)',
        },
      },
      required: ['session_id'],
    },
  },
];

export async function handleSessionTool(
  db: DatabaseAdapter,
  name: string,
  args: Record<string, unknown>,
  userId?: string
): Promise<McpToolResult> {
  switch (name) {
    case 'collab_session_start': {
      const validation = validateInput(sessionStartSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }
      const input = validation.data;

      // Cleanup stale sessions first
      await cleanupStaleSessions(db, 30);

      const session = await createSession(db, {
        name: input.name,
        project_root: input.project_root,
        machine_id: input.machine_id,
        user_id: userId,
      });

      const activeSessions = await listSessions(db, { project_root: input.project_root, user_id: userId });

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
      const validation = validateInput(sessionEndSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }
      const input = validation.data;

      const sessionResult = await validateSessionExists(db, input.session_id);
      if (!sessionResult.valid) {
        return sessionResult.error;
      }

      await endSession(db, input.session_id, input.release_claims);

      return successResponse({
        success: true,
        message: `Session ended. All claims marked as ${input.release_claims === 'complete' ? 'completed' : 'abandoned'}.`,
      });
    }

    case 'collab_session_list': {
      const validation = validateInput(sessionListSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }
      const input = validation.data;

      // Do not filter by user_id - collaboration tool should show all sessions
      const sessions = await listSessions(db, {
        include_inactive: input.include_inactive,
        project_root: input.project_root,
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
      const validation = validateInput(sessionHeartbeatSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }
      const input = validation.data;

      const updated = await updateSessionHeartbeat(db, input.session_id, {
        current_task: input.current_task,
        todos: input.todos as TodoItem[] | undefined,
      });

      if (!updated) {
        return errorResponse(
          ERROR_CODES.SESSION_NOT_FOUND,
          'Session not found or inactive. Please start a new session.'
        );
      }

      return successResponse({
        success: true,
        message: 'Heartbeat updated',
        status_synced: !!(input.current_task || input.todos),
      });
    }

    case 'collab_status_update': {
      const validation = validateInput(statusUpdateSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }
      const input = validation.data;
      const todos = input.todos as TodoItem[] | undefined;

      // Validate session exists and is active
      const sessionResult = await validateActiveSession(db, input.session_id);
      if (!sessionResult.valid) {
        return sessionResult.error;
      }

      await updateSessionStatus(db, input.session_id, {
        current_task: input.current_task,
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

      return successResponse({
        success: true,
        message: 'Status updated successfully.',
        current_task: input.current_task ?? null,
        progress,
      });
    }

    case 'collab_config': {
      const validation = validateInput(configSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }
      const input = validation.data;

      // Validate session exists and is active
      const sessionResult = await validateActiveSession(db, input.session_id);
      if (!sessionResult.valid) {
        return sessionResult.error;
      }
      const { session } = sessionResult;

      // Get current config or default
      let currentConfig: SessionConfig = DEFAULT_SESSION_CONFIG;
      if (session.config) {
        try {
          currentConfig = { ...DEFAULT_SESSION_CONFIG, ...JSON.parse(session.config) };
        } catch {
          // Use default if parse fails
        }
      }

      // Update with new values
      const newConfig: SessionConfig = {
        mode: input.mode ?? currentConfig.mode,
        allow_release_others: input.allow_release_others !== undefined
          ? input.allow_release_others
          : currentConfig.allow_release_others,
        auto_release_stale: input.auto_release_stale !== undefined
          ? input.auto_release_stale
          : currentConfig.auto_release_stale,
        stale_threshold_hours: input.stale_threshold_hours ?? currentConfig.stale_threshold_hours,
      };

      await updateSessionConfig(db, input.session_id, newConfig);

      return successResponse({
        success: true,
        message: 'Configuration updated.',
        config: newConfig,
      });
    }

    default:
      return createToolResult(`Unknown session tool: ${name}`, true);
  }
}
