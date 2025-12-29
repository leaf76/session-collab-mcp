// Claim queue tools

import type { DatabaseAdapter } from '../../db/sqlite-adapter.js';
import type { McpTool, McpToolResult } from '../protocol.js';
import {
  joinQueue,
  leaveQueue,
  listQueue,
  getClaim,
  getQueueEntry,
  logAuditEvent,
} from '../../db/queries.js';
import { getPriorityLevel } from '../../db/types.js';
import { queueJoinSchema, queueLeaveSchema, queueListSchema, validateInput } from '../schemas.js';
import {
  errorResponse,
  successResponse,
  validationError,
  validateActiveSession,
  ERROR_CODES,
} from '../../utils/response.js';

export const queueTools: McpTool[] = [
  {
    name: 'collab_queue_join',
    description: 'Join waiting queue for a blocked claim. Use this when you want to work on files that are currently claimed by another session.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        claim_id: {
          type: 'string',
          description: 'The claim ID you want to wait for',
        },
        intent: {
          type: 'string',
          description: 'What you plan to do when the claim becomes available',
        },
        priority: {
          type: 'number',
          description: 'Priority (0-100). Higher priority entries are served first. Default: 50',
        },
        scope: {
          type: 'string',
          enum: ['small', 'medium', 'large'],
          description: 'Estimated scope of your work: small(<30min), medium(30min-2hr), large(>2hr)',
        },
      },
      required: ['session_id', 'claim_id', 'intent'],
    },
  },
  {
    name: 'collab_queue_leave',
    description: 'Leave the waiting queue for a claim.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        queue_id: {
          type: 'string',
          description: 'Queue entry ID to leave',
        },
      },
      required: ['session_id', 'queue_id'],
    },
  },
  {
    name: 'collab_queue_list',
    description: 'List queue entries. View who is waiting for claims.',
    inputSchema: {
      type: 'object',
      properties: {
        claim_id: {
          type: 'string',
          description: 'Filter by claim ID to see who is waiting for a specific claim',
        },
        session_id: {
          type: 'string',
          description: 'Filter by session ID to see what claims a session is waiting for',
        },
      },
    },
  },
];

export async function handleQueueTool(
  db: DatabaseAdapter,
  name: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  switch (name) {
    case 'collab_queue_join': {
      const validation = validateInput(queueJoinSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const { session_id: sessionId, claim_id: claimId, intent, priority, scope } = validation.data;

      // Verify session is active
      const sessionResult = await validateActiveSession(db, sessionId);
      if (!sessionResult.valid) {
        return sessionResult.error;
      }

      // Verify claim exists
      const claim = await getClaim(db, claimId);
      if (!claim) {
        return errorResponse(ERROR_CODES.CLAIM_NOT_FOUND, 'Claim not found');
      }

      // Cannot queue for your own claim
      if (claim.session_id === sessionId) {
        return errorResponse(
          ERROR_CODES.CANNOT_QUEUE_OWN_CLAIM,
          'You cannot queue for your own claim'
        );
      }

      // Check if claim is still active
      if (claim.status !== 'active') {
        return successResponse({
          message: `Claim is already ${claim.status}. No need to queue - you can claim these files now.`,
          claim_status: claim.status,
          files: claim.files,
        });
      }

      // Check if already in queue
      const existingQueue = await listQueue(db, { claim_id: claimId, session_id: sessionId });
      if (existingQueue.length > 0) {
        return errorResponse(
          ERROR_CODES.ALREADY_IN_QUEUE,
          'You are already in the queue for this claim'
        );
      }

      // Join the queue
      const entry = await joinQueue(db, {
        claim_id: claimId,
        session_id: sessionId,
        intent,
        priority,
        scope,
      });

      // Log audit event
      await logAuditEvent(db, {
        session_id: sessionId,
        action: 'queue_joined',
        entity_type: 'queue',
        entity_id: entry.id,
        metadata: {
          claim_id: claimId,
          position: entry.position,
          priority: entry.priority,
        },
      });

      const priorityInfo = getPriorityLevel(entry.priority);

      return successResponse({
        queue_id: entry.id,
        position: entry.position,
        priority: priorityInfo,
        estimated_wait_minutes: entry.estimated_wait_minutes,
        message: `Joined queue at position ${entry.position}. Estimated wait: ${entry.estimated_wait_minutes} minutes.`,
        claim_owner: claim.session_name,
        claim_intent: claim.intent,
        files: claim.files,
      });
    }

    case 'collab_queue_leave': {
      const validation = validateInput(queueLeaveSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const { session_id: sessionId, queue_id: queueId } = validation.data;

      // Verify session is active
      const sessionResult = await validateActiveSession(db, sessionId);
      if (!sessionResult.valid) {
        return sessionResult.error;
      }

      // Get queue entry
      const entry = await getQueueEntry(db, queueId);
      if (!entry) {
        return errorResponse(
          ERROR_CODES.QUEUE_ENTRY_NOT_FOUND,
          'Queue entry not found'
        );
      }

      // Verify ownership
      if (entry.session_id !== sessionId) {
        return errorResponse(
          ERROR_CODES.NOT_OWNER,
          'You can only leave your own queue entries'
        );
      }

      // Leave the queue
      await leaveQueue(db, queueId);

      // Log audit event
      await logAuditEvent(db, {
        session_id: sessionId,
        action: 'queue_left',
        entity_type: 'queue',
        entity_id: queueId,
        metadata: { claim_id: entry.claim_id },
      });

      return successResponse({
        success: true,
        message: 'Left the queue successfully',
      });
    }

    case 'collab_queue_list': {
      const validation = validateInput(queueListSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const { claim_id: claimId, session_id: sessionId } = validation.data;

      const entries = await listQueue(db, { claim_id: claimId, session_id: sessionId });

      return successResponse({
        entries: entries.map((e) => ({
          queue_id: e.id,
          claim_id: e.claim_id,
          session_id: e.session_id,
          session_name: e.session_name,
          intent: e.intent,
          position: e.position,
          priority: getPriorityLevel(e.priority),
          scope: e.scope,
          estimated_wait_minutes: e.estimated_wait_minutes,
          claim_owner: e.claim_session_name,
          claim_intent: e.claim_intent,
          files: e.claim_files,
          created_at: e.created_at,
        })),
        total: entries.length,
        message: entries.length > 0
          ? `Found ${entries.length} queue entries`
          : 'No queue entries found',
      }, true);
    }

    default:
      return successResponse({ error: `Unknown queue tool: ${name}` });
  }
}
