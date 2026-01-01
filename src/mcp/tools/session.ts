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
  cleanupStaleClaims,
  listClaims,
  logAuditEvent,
  removeSessionFromAllQueues,
  getActiveMemories,
  recallMemory,
  saveMemory,
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

      // Cleanup stale sessions and claims first
      await cleanupStaleSessions(db, 30);
      await cleanupStaleClaims(db);

      const session = await createSession(db, {
        name: input.name,
        project_root: input.project_root,
        machine_id: input.machine_id,
        user_id: userId,
      });

      // Log audit event
      await logAuditEvent(db, {
        session_id: session.id,
        action: 'session_started',
        entity_type: 'session',
        entity_id: session.id,
        metadata: { project_root: input.project_root },
      });

      const activeSessions = await listSessions(db, { project_root: input.project_root, user_id: userId });

      // AUTO-LOAD: Collect active memories from all sessions in this project
      const allMemories: Array<{
        session_name: string | null;
        category: string;
        key: string;
        content: string;
        priority: number;
        pinned: boolean;
      }> = [];

      for (const otherSession of activeSessions) {
        const memories = await getActiveMemories(db, otherSession.id, {
          priority_threshold: 70,
          max_items: 10
        });
        for (const mem of memories) {
          allMemories.push({
            session_name: otherSession.name,
            category: mem.category,
            key: mem.key,
            content: mem.content,
            priority: mem.priority,
            pinned: mem.pinned === 1,
          });
        }
      }

      // Sort by priority and pinned status
      allMemories.sort((a, b) => {
        if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
        return b.priority - a.priority;
      });

      // Limit to top 20 memories
      const topMemories = allMemories.slice(0, 20);

      // Group by category for easier reading
      const memoriesByCategory: Record<string, Array<{ key: string; content: string; session: string | null }>> = {};
      for (const mem of topMemories) {
        if (!memoriesByCategory[mem.category]) {
          memoriesByCategory[mem.category] = [];
        }
        memoriesByCategory[mem.category].push({
          key: mem.key,
          content: mem.content,
          session: mem.session_name,
        });
      }

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
            // AUTO-LOADED CONTEXT
            restored_context: topMemories.length > 0 ? {
              count: topMemories.length,
              by_category: memoriesByCategory,
              note: 'These memories were automatically loaded from previous sessions. Use them to maintain context continuity.',
            } : null,
            tip: 'Use collab_memory_save to persist important context. Plans and files are auto-protected when registered.',
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

      // Generate memory summary before ending session
      const memories = await recallMemory(db, input.session_id, {});
      let memorySummary: {
        total: number;
        findings: string[];
        decisions: string[];
        important: string[];
      } | null = null;

      if (memories.length > 0) {
        // Group memories by category for summary
        const findings = memories.filter(m => m.category === 'finding').map(m => m.content);
        const decisions = memories.filter(m => m.category === 'decision').map(m => m.content);
        const important = memories.filter(m => m.category === 'important' || m.pinned === 1).map(m => m.content);

        memorySummary = {
          total: memories.length,
          findings: findings.slice(0, 5), // Top 5
          decisions: decisions.slice(0, 5),
          important: important.slice(0, 5),
        };

        // Save session summary as a persistent record
        const summaryContent = [
          `Session: ${sessionResult.session.name || input.session_id}`,
          `Ended: ${new Date().toISOString()}`,
          findings.length > 0 ? `\nFindings:\n- ${findings.slice(0, 5).join('\n- ')}` : '',
          decisions.length > 0 ? `\nDecisions:\n- ${decisions.slice(0, 5).join('\n- ')}` : '',
          important.length > 0 ? `\nImportant:\n- ${important.slice(0, 5).join('\n- ')}` : '',
        ].filter(Boolean).join('\n');

        // Save summary with high priority so it can be found by future sessions
        await saveMemory(db, input.session_id, {
          category: 'context',
          key: 'session_summary',
          content: summaryContent,
          priority: 80,
          pinned: true,
          metadata: {
            session_name: sessionResult.session.name,
            ended_at: new Date().toISOString(),
            memory_count: memories.length,
          },
        });
      }

      // Remove from all queues first
      const removedFromQueues = await removeSessionFromAllQueues(db, input.session_id);

      await endSession(db, input.session_id, input.release_claims);

      // Log audit event
      const claimStatus = input.release_claims === 'complete' ? 'completed' : 'abandoned';
      await logAuditEvent(db, {
        session_id: input.session_id,
        action: 'session_ended',
        entity_type: 'session',
        entity_id: input.session_id,
        metadata: { status: claimStatus, memory_count: memories.length },
      });

      return successResponse({
        success: true,
        message: `Session ended. All claims marked as ${input.release_claims === 'complete' ? 'completed' : 'abandoned'}.${removedFromQueues > 0 ? ` Removed from ${removedFromQueues} queue(s).` : ''}`,
        memory_summary: memorySummary,
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
        auto_release_immediate: input.auto_release_immediate !== undefined
          ? input.auto_release_immediate
          : currentConfig.auto_release_immediate,
        auto_release_delay_minutes: input.auto_release_delay_minutes ?? currentConfig.auto_release_delay_minutes,
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
