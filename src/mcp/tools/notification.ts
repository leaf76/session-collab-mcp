// Notification tools

import type { DatabaseAdapter } from '../../db/sqlite-adapter.js';
import type { McpTool, McpToolResult } from '../protocol.js';
import {
  listNotifications,
  markNotificationsRead,
  getNotification,
} from '../../db/queries.js';
import { notificationListSchema, notificationMarkReadSchema, validateInput } from '../schemas.js';
import {
  errorResponse,
  successResponse,
  validationError,
  validateActiveSession,
  ERROR_CODES,
} from '../../utils/response.js';

export const notificationTools: McpTool[] = [
  {
    name: 'collab_notifications_list',
    description: 'List notifications for your session. Check periodically for claim releases, queue updates, and messages.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        unread_only: {
          type: 'boolean',
          description: 'Only show unread notifications (default: false)',
        },
        type: {
          type: 'string',
          enum: ['claim_released', 'queue_ready', 'conflict_detected', 'session_message'],
          description: 'Filter by notification type',
        },
        limit: {
          type: 'number',
          description: 'Maximum notifications to return (default: 50, max: 100)',
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'collab_notifications_mark_read',
    description: 'Mark notifications as read.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        notification_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Notification IDs to mark as read',
        },
      },
      required: ['session_id', 'notification_ids'],
    },
  },
];

export async function handleNotificationTool(
  db: DatabaseAdapter,
  name: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  switch (name) {
    case 'collab_notifications_list': {
      const validation = validateInput(notificationListSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const { session_id: sessionId, unread_only, type, limit } = validation.data;

      // Verify session is active
      const sessionResult = await validateActiveSession(db, sessionId);
      if (!sessionResult.valid) {
        return sessionResult.error;
      }

      const notifications = await listNotifications(db, {
        session_id: sessionId,
        unread_only,
        type,
        limit,
      });

      const unreadCount = notifications.filter((n) => !n.read_at).length;

      return successResponse({
        notifications: notifications.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          message: n.message,
          reference_type: n.reference_type,
          reference_id: n.reference_id,
          metadata: n.metadata ? JSON.parse(n.metadata) : null,
          is_read: !!n.read_at,
          created_at: n.created_at,
        })),
        total: notifications.length,
        unread_count: unreadCount,
        message: notifications.length > 0
          ? `${notifications.length} notification(s), ${unreadCount} unread`
          : 'No notifications',
      }, true);
    }

    case 'collab_notifications_mark_read': {
      const validation = validateInput(notificationMarkReadSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const { session_id: sessionId, notification_ids: notificationIds } = validation.data;

      // Verify session is active
      const sessionResult = await validateActiveSession(db, sessionId);
      if (!sessionResult.valid) {
        return sessionResult.error;
      }

      // Verify all notifications belong to this session
      for (const notifId of notificationIds) {
        const notif = await getNotification(db, notifId);
        if (!notif) {
          return errorResponse(
            ERROR_CODES.NOTIFICATION_NOT_FOUND,
            `Notification ${notifId} not found`
          );
        }
        if (notif.session_id !== sessionId) {
          return errorResponse(
            ERROR_CODES.NOT_OWNER,
            'You can only mark your own notifications as read'
          );
        }
      }

      const markedCount = await markNotificationsRead(db, notificationIds);

      return successResponse({
        success: true,
        marked_count: markedCount,
        message: `Marked ${markedCount} notification(s) as read`,
      });
    }

    default:
      return successResponse({ error: `Unknown notification tool: ${name}` });
  }
}
