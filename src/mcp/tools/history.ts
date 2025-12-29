// Audit history tools

import type { DatabaseAdapter } from '../../db/sqlite-adapter.js';
import type { McpTool, McpToolResult } from '../protocol.js';
import { listAuditHistory, cleanupOldAuditHistory } from '../../db/queries.js';
import { historyListSchema, validateInput } from '../schemas.js';
import { successResponse, validationError } from '../../utils/response.js';

export const historyTools: McpTool[] = [
  {
    name: 'collab_history_list',
    description: 'List audit history entries. Useful for debugging coordination issues and understanding past actions.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Filter by session ID',
        },
        action: {
          type: 'string',
          enum: [
            'session_started', 'session_ended',
            'claim_created', 'claim_released', 'conflict_detected',
            'queue_joined', 'queue_left', 'priority_changed'
          ],
          description: 'Filter by action type',
        },
        entity_type: {
          type: 'string',
          enum: ['session', 'claim', 'queue'],
          description: 'Filter by entity type',
        },
        entity_id: {
          type: 'string',
          description: 'Filter by specific entity ID',
        },
        from_date: {
          type: 'string',
          description: 'Start date (ISO 8601 format)',
        },
        to_date: {
          type: 'string',
          description: 'End date (ISO 8601 format)',
        },
        limit: {
          type: 'number',
          description: 'Maximum entries to return (default: 50, max: 500)',
        },
      },
    },
  },
];

export async function handleHistoryTool(
  db: DatabaseAdapter,
  name: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  switch (name) {
    case 'collab_history_list': {
      const validation = validateInput(historyListSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const { session_id, action, entity_type, entity_id, from_date, to_date, limit } = validation.data;

      // Also cleanup old entries while listing
      await cleanupOldAuditHistory(db, 7);

      const entries = await listAuditHistory(db, {
        session_id,
        action,
        entity_type,
        entity_id,
        from_date,
        to_date,
        limit,
      });

      return successResponse({
        entries: entries.map((e) => ({
          id: e.id,
          session_id: e.session_id,
          session_name: e.session_name,
          action: e.action,
          entity_type: e.entity_type,
          entity_id: e.entity_id,
          metadata: e.metadata ? JSON.parse(e.metadata) : null,
          created_at: e.created_at,
        })),
        total: entries.length,
        message: entries.length > 0
          ? `Found ${entries.length} audit entries`
          : 'No audit entries found matching the criteria',
      }, true);
    }

    default:
      return successResponse({ error: `Unknown history tool: ${name}` });
  }
}
