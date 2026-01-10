// Session management tools - Simplified to 4 core tools

import type { DatabaseAdapter } from '../../db/sqlite-adapter.js';
import type { McpTool, McpToolResult } from '../protocol.js';
import { createToolResult } from '../protocol.js';
import {
  createSession,
  listSessions,
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
  getSession,
} from '../../db/queries.js';
import type { SessionConfig } from '../../db/types.js';
import { DEFAULT_SESSION_CONFIG } from '../../db/types.js';
import {
  validateInput,
  sessionStartSchema,
  sessionEndSchema,
  sessionListSchema,
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
    description: 'Start a new session. Call this when starting work.',
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
      },
      required: ['project_root'],
    },
  },
  {
    name: 'collab_session_end',
    description: 'End session and release all claims.',
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
          description: 'How to handle unreleased claims',
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'collab_session_list',
    description: 'List all active sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        include_inactive: {
          type: 'boolean',
          description: 'Include inactive sessions',
        },
        project_root: {
          type: 'string',
          description: 'Filter by project root',
        },
      },
    },
  },
  {
    name: 'collab_config',
    description: 'Configure session behavior.',
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
          description: 'Conflict handling mode',
        },
        allow_release_others: {
          type: 'boolean',
          description: 'Allow releasing other sessions claims',
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

      // Cleanup stale sessions and claims
      await cleanupStaleSessions(db, 30);
      await cleanupStaleClaims(db);

      const session = await createSession(db, {
        name: input.name,
        project_root: input.project_root,
        machine_id: input.machine_id,
        user_id: userId,
      });

      await logAuditEvent(db, {
        session_id: session.id,
        action: 'session_started',
        entity_type: 'session',
        entity_id: session.id,
        metadata: { project_root: input.project_root },
      });

      const activeSessions = await listSessions(db, { project_root: input.project_root, user_id: userId });

      // Load active memories from all sessions
      const allMemories: Array<{
        category: string;
        key: string;
        content: string;
      }> = [];

      for (const otherSession of activeSessions) {
        const memories = await getActiveMemories(db, otherSession.id, {
          priority_threshold: 70,
          max_items: 10
        });
        for (const mem of memories) {
          allMemories.push({
            category: mem.category,
            key: mem.key,
            content: mem.content,
          });
        }
      }

      return successResponse({
        session_id: session.id,
        name: session.name,
        active_sessions: activeSessions.length,
        restored_context: allMemories.length > 0 ? allMemories.slice(0, 15) : null,
        message: `Session started. ${activeSessions.length} active session(s).`,
      });
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

      const activeClaims = await listClaims(db, { session_id: input.session_id, status: 'active' });
      const memories = await recallMemory(db, input.session_id, {});

      // Save session summary
      if (memories.length > 0) {
        const findings = memories.filter(m => m.category === 'finding').map(m => m.content);
        const decisions = memories.filter(m => m.category === 'decision').map(m => m.content);

        const summaryContent = [
          `Session: ${sessionResult.session.name || input.session_id}`,
          `Ended: ${new Date().toISOString()}`,
          findings.length > 0 ? `\nFindings:\n- ${findings.slice(0, 5).join('\n- ')}` : '',
          decisions.length > 0 ? `\nDecisions:\n- ${decisions.slice(0, 5).join('\n- ')}` : '',
        ].filter(Boolean).join('\n');

        await saveMemory(db, input.session_id, {
          category: 'context',
          key: 'session_summary',
          content: summaryContent,
          priority: 80,
          pinned: true,
        });
      }

      await removeSessionFromAllQueues(db, input.session_id);
      await endSession(db, input.session_id, input.release_claims);

      await logAuditEvent(db, {
        session_id: input.session_id,
        action: 'session_ended',
        entity_type: 'session',
        entity_id: input.session_id,
      });

      return successResponse({
        success: true,
        claims_released: activeClaims.length,
        memories_saved: memories.length,
        message: `Session ended. ${activeClaims.length} claim(s) released.`,
      });
    }

    case 'collab_session_list': {
      const validation = validateInput(sessionListSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }
      const input = validation.data;

      const sessions = await listSessions(db, {
        include_inactive: input.include_inactive,
        project_root: input.project_root,
      });

      const sessionsWithClaims = await Promise.all(
        sessions.map(async (session) => {
          const claims = await listClaims(db, { session_id: session.id, status: 'active' });
          return {
            id: session.id,
            name: session.name,
            status: session.status,
            active_claims: claims.length,
            last_heartbeat: session.last_heartbeat,
          };
        })
      );

      return successResponse({
        sessions: sessionsWithClaims,
        total: sessionsWithClaims.length,
      });
    }

    case 'collab_config': {
      const validation = validateInput(configSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }
      const input = validation.data;

      const sessionResult = await validateActiveSession(db, input.session_id);
      if (!sessionResult.valid) {
        return sessionResult.error;
      }
      const { session } = sessionResult;

      let currentConfig: SessionConfig = DEFAULT_SESSION_CONFIG;
      if (session.config) {
        try {
          currentConfig = { ...DEFAULT_SESSION_CONFIG, ...JSON.parse(session.config) };
        } catch {
          // Use default
        }
      }

      const newConfig: SessionConfig = {
        mode: input.mode ?? currentConfig.mode,
        allow_release_others: input.allow_release_others ?? currentConfig.allow_release_others,
        auto_release_stale: input.auto_release_stale ?? currentConfig.auto_release_stale,
        stale_threshold_hours: input.stale_threshold_hours ?? currentConfig.stale_threshold_hours,
        auto_release_immediate: input.auto_release_immediate ?? currentConfig.auto_release_immediate,
        auto_release_delay_minutes: input.auto_release_delay_minutes ?? currentConfig.auto_release_delay_minutes,
      };

      await updateSessionConfig(db, input.session_id, newConfig);

      return successResponse({
        success: true,
        config: newConfig,
        message: 'Configuration updated.',
      });
    }

    case 'collab_status': {
      // New unified status tool
      const sessionId = args.session_id as string;

      if (!sessionId) {
        return validationError('session_id is required');
      }

      const session = await getSession(db, sessionId);
      if (!session) {
        return errorResponse(ERROR_CODES.SESSION_NOT_FOUND, 'Session not found');
      }

      const claims = await listClaims(db, { session_id: sessionId, status: 'active' });
      const memories = await getActiveMemories(db, sessionId, { priority_threshold: 70, max_items: 10 });
      const allSessions = await listSessions(db, { project_root: session.project_root });

      return successResponse({
        session: {
          id: session.id,
          name: session.name,
          status: session.status,
        },
        claims: claims.map(c => ({
          id: c.id,
          files: c.files,
          intent: c.intent,
        })),
        active_memories: memories.length,
        other_sessions: allSessions.filter(s => s.id !== sessionId).length,
        message: `Session active. ${claims.length} claim(s), ${memories.length} memories.`,
      });
    }

    default:
      return createToolResult(`Unknown session tool: ${name}`, true);
  }
}
