// Inter-session messaging tools

import type { DatabaseAdapter } from '../../db/sqlite-adapter.js';
import type { McpTool, McpToolResult } from '../protocol';
import { createToolResult } from '../protocol';
import { sendMessage, listMessages, getSession } from '../../db/queries';
import { validateInput, messageSendSchema, messageListSchema } from '../schemas';

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
        return createToolResult(
          JSON.stringify({ error: 'INVALID_INPUT', message: validation.error }),
          true
        );
      }
      const input = validation.data;

      // Verify sender session
      const fromSession = await getSession(db, input.from_session_id);
      if (!fromSession || fromSession.status !== 'active') {
        return createToolResult(
          JSON.stringify({
            error: 'SESSION_INVALID',
            message: 'Your session is not active.',
          }),
          true
        );
      }

      // Verify target session if specified
      if (input.to_session_id) {
        const toSession = await getSession(db, input.to_session_id);
        if (!toSession || toSession.status !== 'active') {
          return createToolResult(
            JSON.stringify({
              error: 'TARGET_SESSION_INVALID',
              message: 'Target session not found or inactive.',
            }),
            true
          );
        }
      }

      const message = await sendMessage(db, {
        from_session_id: input.from_session_id,
        to_session_id: input.to_session_id,
        content: input.content,
      });

      return createToolResult(
        JSON.stringify({
          success: true,
          message_id: message.id,
          sent_to: input.to_session_id ?? 'all sessions (broadcast)',
          message: 'Message sent successfully.',
        })
      );
    }

    case 'collab_message_list': {
      const validation = validateInput(messageListSchema, args);
      if (!validation.success) {
        return createToolResult(
          JSON.stringify({ error: 'INVALID_INPUT', message: validation.error }),
          true
        );
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
        return createToolResult(
          JSON.stringify({
            messages: [],
            message: unreadOnly ? 'No unread messages.' : 'No messages.',
          })
        );
      }

      return createToolResult(
        JSON.stringify(
          {
            messages: messages.map((m) => ({
              id: m.id,
              from_session_id: m.from_session_id,
              content: m.content,
              created_at: m.created_at,
              is_broadcast: m.to_session_id === null,
            })),
            total: messages.length,
            marked_as_read: markAsRead,
          },
          null,
          2
        )
      );
    }

    default:
      return createToolResult(`Unknown message tool: ${name}`, true);
  }
}
