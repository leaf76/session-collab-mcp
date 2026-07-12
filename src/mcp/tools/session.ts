// Session management tools

import type { DatabaseAdapter } from '../../db/sqlite-adapter.js';
import type { McpTool, McpToolResult } from '../protocol.js';
import { createToolResult } from '../protocol.js';
import {
  createSession,
  findReusableSession,
  listSessions,
  listSessionSummaries,
  countActiveClaims,
  countCoordination,
  updateSessionConfig,
  updateSessionHeartbeat,
  endSession,
  cleanupStaleSessions,
  cleanupStaleClaims,
  listClaims,
  listQueue,
  logAuditEvent,
  removeSessionFromAllQueues,
  getActiveMemories,
  recallMemory,
  saveMemory,
  getSession,
} from '../../db/queries.js';
import type { QueueEntryWithDetails, SessionConfig } from '../../db/types.js';
import { DEFAULT_SESSION_CONFIG } from '../../db/types.js';
import {
  validateInput,
  sessionStartSchema,
  sessionEndSchema,
  sessionListSchema,
  configSchema,
  statusUpdateSchema,
  statusSchema,
} from '../schemas.js';
import {
  errorResponse,
  successResponse,
  validationError,
  validateActiveSession,
  validateSessionExists,
  ERROR_CODES,
} from '../../utils/response.js';
import { getPriorityLevel } from '../../db/types.js';
import { DEFAULT_STALE_SESSION_MINUTES } from '../../constants.js';
import { normalizeProjectRoot, PathNormalizationError } from '../../utils/paths.js';

function parseJsonField<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function formatIncomingCoordination(entry: QueueEntryWithDetails): Record<string, unknown> {
  return {
    queue_id: entry.id,
    owner_claim_id: entry.claim_id,
    requested_by_session_id: entry.session_id,
    requested_by_session_name: entry.session_name,
    intent: entry.intent,
    files: entry.claim_files,
    priority: getPriorityLevel(entry.priority),
    position: entry.position,
    estimated_wait_minutes: entry.estimated_wait_minutes,
    created_at: entry.created_at,
  };
}

function formatOutgoingCoordination(entry: QueueEntryWithDetails): Record<string, unknown> {
  return {
    queue_id: entry.id,
    owner_claim_id: entry.claim_id,
    owner_session_id: entry.owner_session_id,
    owner_session_name: entry.claim_session_name,
    owner_intent: entry.claim_intent,
    intent: entry.intent,
    files: entry.claim_files,
    priority: getPriorityLevel(entry.priority),
    position: entry.position,
    estimated_wait_minutes: entry.estimated_wait_minutes,
    created_at: entry.created_at,
  };
}

export const sessionTools: McpTool[] = [
  {
    name: 'collab_session_start',
    description:
      'Start or reuse a collaboration session for non-trivial / multi-session work. Skip pure Q&A. restore_context defaults false; reuses same name+project by default.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: "Optional session name, e.g., 'frontend-refactor' (enables reuse)",
        },
        project_root: {
          type: 'string',
          description: 'Project root directory path',
        },
        restore_context: {
          type: 'boolean',
          description:
            'If true, restore high-priority memories from active sessions (token cost). Default false.',
        },
        max_restore_items: {
          type: 'number',
          description: 'Max restored memories when restore_context is true (0-15, default 5).',
        },
        reuse: {
          type: 'boolean',
          description: 'Reuse active session with same project_root + name. Default true.',
        },
        force_new: {
          type: 'boolean',
          description: 'Always create a new session. Default false.',
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
    description:
      'List sessions. Default is summary (counts only). Set detail=true for full claims and coordination payloads.',
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
        detail: {
          type: 'boolean',
          description: 'Include full claims and coordination requests. Default false.',
        },
      },
    },
  },
  {
    name: 'collab_session_update',
    description: 'Update session heartbeat, current task, todos, and progress.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Session ID to update',
        },
        current_task: {
          type: 'string',
          description: 'Current work summary',
        },
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
              },
            },
            required: ['content', 'status'],
          },
          description: 'Current todo state for progress reporting',
        },
      },
      required: ['session_id'],
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
  {
    name: 'collab_status',
    description:
      'Get current session status. Default omits full coordination payloads; set detail=true when needed.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Session ID to check',
        },
        detail: {
          type: 'boolean',
          description: 'Include full coordination request payloads. Default false.',
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

      let projectRoot: string;
      try {
        projectRoot = normalizeProjectRoot(input.project_root);
      } catch (err) {
        const message = err instanceof PathNormalizationError ? err.message : 'Invalid project_root';
        return validationError(message);
      }

      // Cleanup stale sessions and claims
      await cleanupStaleSessions(db, DEFAULT_STALE_SESSION_MINUTES);
      await cleanupStaleClaims(db);

      const forceNew = input.force_new ?? false;
      const reuse = (input.reuse ?? true) && !forceNew;
      let session = reuse
        ? await findReusableSession(db, {
            project_root: projectRoot,
            name: input.name,
            machine_id: input.machine_id,
            user_id: userId,
          })
        : null;
      let reused = false;

      if (session) {
        reused = true;
        await updateSessionHeartbeat(db, session.id, {});
        session = (await getSession(db, session.id)) ?? session;
      } else {
        session = await createSession(db, {
          name: input.name,
          project_root: projectRoot,
          machine_id: input.machine_id,
          user_id: userId,
        });

        await logAuditEvent(db, {
          session_id: session.id,
          action: 'session_started',
          entity_type: 'session',
          entity_id: session.id,
          metadata: { project_root: projectRoot },
        });
      }

      const activeSessions = await listSessions(db, { project_root: projectRoot, user_id: userId });

      // Opt-in context restore (default off) to avoid burning tokens on every start
      const restoreContext = input.restore_context ?? false;
      const maxRestoreItems = input.max_restore_items ?? 5;
      let restoredContext: Array<{
        category: string;
        key: string;
        content: string;
      }> | null = null;

      if (restoreContext && maxRestoreItems > 0) {
        const allMemories: Array<{
          category: string;
          key: string;
          content: string;
        }> = [];
        const perSessionCap = Math.min(10, maxRestoreItems);

        for (const otherSession of activeSessions) {
          if (allMemories.length >= maxRestoreItems) break;
          const memories = await getActiveMemories(db, otherSession.id, {
            priority_threshold: 70,
            max_items: perSessionCap,
          });
          for (const mem of memories) {
            allMemories.push({
              category: mem.category,
              key: mem.key,
              content: mem.content,
            });
            if (allMemories.length >= maxRestoreItems) break;
          }
        }

        restoredContext = allMemories.length > 0 ? allMemories : null;
      }

      return successResponse({
        session_id: session.id,
        name: session.name,
        project_root: projectRoot,
        reused,
        active_sessions: activeSessions.length,
        restored_context: restoredContext,
        message: reused
          ? `Session reused. ${activeSessions.length} active session(s).`
          : `Session started. ${activeSessions.length} active session(s).`,
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
      const detail = input.detail ?? false;

      // Summary path: COUNT subqueries only (no claim row loads)
      if (!detail) {
        const summaries = await listSessionSummaries(db, {
          include_inactive: input.include_inactive,
          project_root: input.project_root,
        });

        return successResponse({
          sessions: summaries.map((session) => ({
            id: session.id,
            name: session.name,
            status: session.status,
            current_task: session.current_task,
            progress: parseJsonField(session.progress),
            active_claims: session.active_claims,
            pending_coordination: {
              incoming: session.incoming_coordination,
              outgoing: session.outgoing_coordination,
            },
            last_heartbeat: session.last_heartbeat,
          })),
          total: summaries.length,
          detail: false,
        });
      }

      const sessions = await listSessions(db, {
        include_inactive: input.include_inactive,
        project_root: input.project_root,
      });

      const sessionsWithClaims = await Promise.all(
        sessions.map(async (session) => {
          const claims = await listClaims(db, { session_id: session.id, status: 'active' });
          const incomingCoordination = await listQueue(db, { owner_session_id: session.id });
          const outgoingCoordination = await listQueue(db, { session_id: session.id });
          return {
            id: session.id,
            name: session.name,
            status: session.status,
            current_task: session.current_task,
            progress: parseJsonField(session.progress),
            todos: parseJsonField(session.todos),
            active_claims: claims.length,
            claims: claims.map(c => ({
              id: c.id,
              files: c.files,
              intent: c.intent,
              priority: getPriorityLevel(c.priority),
              created_at: c.created_at,
            })),
            pending_coordination: {
              incoming: incomingCoordination.length,
              outgoing: outgoingCoordination.length,
            },
            coordination_requests: incomingCoordination.map(formatIncomingCoordination),
            last_heartbeat: session.last_heartbeat,
          };
        })
      );

      return successResponse({
        sessions: sessionsWithClaims,
        total: sessionsWithClaims.length,
        detail: true,
      });
    }

    case 'collab_session_update': {
      const validation = validateInput(statusUpdateSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }
      const input = validation.data;

      const sessionResult = await validateActiveSession(db, input.session_id);
      if (!sessionResult.valid) {
        return sessionResult.error;
      }

      const updated = await updateSessionHeartbeat(db, input.session_id, {
        current_task: input.current_task,
        todos: input.todos,
      });
      if (!updated) {
        return errorResponse(ERROR_CODES.SESSION_NOT_FOUND, 'Session not found');
      }

      const session = await getSession(db, input.session_id);

      return successResponse({
        success: true,
        session_id: input.session_id,
        current_task: session?.current_task ?? null,
        progress: parseJsonField(session?.progress ?? null),
        todos: parseJsonField(session?.todos ?? null),
        last_heartbeat: session?.last_heartbeat ?? null,
        message: 'Session updated.',
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
      const validation = validateInput(statusSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }
      const { session_id: sessionId } = validation.data;
      const detail = validation.data.detail ?? false;

      const session = await getSession(db, sessionId);
      if (!session) {
        return errorResponse(ERROR_CODES.SESSION_NOT_FOUND, 'Session not found');
      }

      const activeClaimCount = await countActiveClaims(db, sessionId);
      const coordination = await countCoordination(db, sessionId);
      const memories = await getActiveMemories(db, sessionId, { priority_threshold: 70, max_items: 10 });
      const allSessions = await listSessions(db, { project_root: session.project_root });

      const response: Record<string, unknown> = {
        session: {
          id: session.id,
          name: session.name,
          status: session.status,
        },
        active_claims: activeClaimCount,
        active_memories: memories.length,
        other_sessions: allSessions.filter(s => s.id !== sessionId).length,
        pending_coordination: coordination,
        detail,
        message: `Session active. ${activeClaimCount} claim(s), ${memories.length} memories.`,
      };

      if (detail) {
        const claims = await listClaims(db, { session_id: sessionId, status: 'active' });
        const incomingCoordination = await listQueue(db, { owner_session_id: sessionId });
        const outgoingCoordination = await listQueue(db, { session_id: sessionId });
        response.claims = claims.map(c => ({
          id: c.id,
          files: c.files,
          intent: c.intent,
        }));
        response.coordination_requests = {
          incoming: incomingCoordination.map(formatIncomingCoordination),
          outgoing: outgoingCoordination.map(formatOutgoingCoordination),
        };
      }

      return successResponse(response);
    }

    default:
      return createToolResult(`Unknown session tool: ${name}`, true);
  }
}
