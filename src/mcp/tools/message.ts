// Inter-session messaging tools

import type { D1Database } from '@cloudflare/workers-types';
import type { McpTool, McpToolResult } from '../protocol';
import { createToolResult } from '../protocol';
import { sendMessage, listMessages, getSession } from '../../db/queries';

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
  db: D1Database,
  name: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  switch (name) {
    case 'collab_message_send': {
      const fromSessionId = args.from_session_id as string;
      const toSessionId = args.to_session_id as string | undefined;
      const content = args.content as string;

      // Verify sender session
      const fromSession = await getSession(db, fromSessionId);
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
      if (toSessionId) {
        const toSession = await getSession(db, toSessionId);
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
        from_session_id: fromSessionId,
        to_session_id: toSessionId,
        content,
      });

      return createToolResult(
        JSON.stringify({
          success: true,
          message_id: message.id,
          sent_to: toSessionId ?? 'all sessions (broadcast)',
          message: 'Message sent successfully.',
        })
      );
    }

    case 'collab_message_list': {
      const sessionId = args.session_id as string;
      const unreadOnly = (args.unread_only as boolean) ?? true;
      const markAsRead = (args.mark_as_read as boolean) ?? true;

      const messages = await listMessages(db, {
        session_id: sessionId,
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
