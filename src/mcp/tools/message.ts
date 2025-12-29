// Inter-session messaging tools

import type { DatabaseAdapter } from '../../db/sqlite-adapter.js';
import type { McpTool, McpToolResult } from '../protocol.js';
import { createToolResult } from '../protocol.js';
import { sendMessage, listMessages, createNotification, listSessions } from '../../db/queries.js';
import { validateInput, messageSendSchema, messageListSchema } from '../schemas.js';
import {
  errorResponse,
  successResponse,
  validationError,
  validateActiveSession,
  ERROR_CODES,
} from '../../utils/response.js';

export const messageTools: McpTool[] = [
  {
    name: 'collab_message_send',
    description: 'Send a message to another session or broadcast to all sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        from_session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        to_session_id: {
          type: 'string',
          description: 'Target session ID. Leave empty to broadcast to all.',
        },
        content: {
          type: 'string',
          description: 'Message content',
        },
      },
      required: ['from_session_id', 'content'],
    },
  },
  {
    name: 'collab_message_list',
    description: 'Read messages sent to your session.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        unread_only: {
          type: 'boolean',
          description: 'Only show unread messages',
        },
        mark_as_read: {
          type: 'boolean',
          description: 'Mark retrieved messages as read',
        },
      },
      required: ['session_id'],
    },
  },
];

export async function handleMessageTool(
  db: DatabaseAdapter,
  name: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  switch (name) {
    case 'collab_message_send': {
      const validation = validateInput(messageSendSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }
      const input = validation.data;

      // Verify sender session
      const senderResult = await validateActiveSession(db, input.from_session_id);
      if (!senderResult.valid) {
        return errorResponse(ERROR_CODES.SESSION_INVALID, 'Your session is not active.');
      }

      // Verify target session if specified
      if (input.to_session_id) {
        const targetResult = await validateActiveSession(db, input.to_session_id);
        if (!targetResult.valid) {
          return errorResponse(
            ERROR_CODES.TARGET_SESSION_INVALID,
            'Target session not found or inactive.'
          );
        }
      }

      const message = await sendMessage(db, {
        from_session_id: input.from_session_id,
        to_session_id: input.to_session_id,
        content: input.content,
      });

      // Create notification(s) for the message
      const senderName = senderResult.session.name ?? 'Unknown session';
      const contentPreview = input.content.length > 50
        ? input.content.substring(0, 50) + '...'
        : input.content;

      if (input.to_session_id) {
        // Direct message - notify target session
        await createNotification(db, {
          session_id: input.to_session_id,
          type: 'session_message',
          title: `Message from ${senderName}`,
          message: contentPreview,
          reference_type: 'message',
          reference_id: message.id,
          metadata: { from_session_id: input.from_session_id, from_session_name: senderName },
        });
      } else {
        // Broadcast - notify all active sessions except sender
        const allSessions = await listSessions(db, { include_inactive: false });
        for (const session of allSessions) {
          if (session.id !== input.from_session_id) {
            await createNotification(db, {
              session_id: session.id,
              type: 'session_message',
              title: `Broadcast from ${senderName}`,
              message: contentPreview,
              reference_type: 'message',
              reference_id: message.id,
              metadata: { from_session_id: input.from_session_id, from_session_name: senderName, is_broadcast: true },
            });
          }
        }
      }

      return successResponse({
        success: true,
        message_id: message.id,
        sent_to: input.to_session_id ?? 'all sessions (broadcast)',
        message: 'Message sent successfully.',
      });
    }

    case 'collab_message_list': {
      const validation = validateInput(messageListSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }
      const input = validation.data;

      const unreadOnly = input.unread_only ?? true;
      const markAsRead = input.mark_as_read ?? true;

      const messages = await listMessages(db, {
        session_id: input.session_id,
        unread_only: unreadOnly,
        mark_as_read: markAsRead,
      });

      if (messages.length === 0) {
        return successResponse({
          messages: [],
          message: unreadOnly ? 'No unread messages.' : 'No messages.',
        });
      }

      return successResponse({
        messages: messages.map((m) => ({
          id: m.id,
          from_session_id: m.from_session_id,
          content: m.content,
          created_at: m.created_at,
          is_broadcast: m.to_session_id === null,
        })),
        total: messages.length,
        marked_as_read: markAsRead,
      }, true);
    }

    default:
      return createToolResult(`Unknown message tool: ${name}`, true);
  }
}
