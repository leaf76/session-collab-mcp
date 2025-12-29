// Decision recording tools

import type { DatabaseAdapter } from '../../db/sqlite-adapter.js';
import type { McpTool, McpToolResult } from '../protocol.js';
import { createToolResult } from '../protocol.js';
import { addDecision, listDecisions } from '../../db/queries.js';
import { validateInput, decisionAddSchema, decisionListSchema } from '../schemas.js';
import {
  successResponse,
  validationError,
  validateActiveSession,
} from '../../utils/response.js';

export const decisionTools: McpTool[] = [
  {
    name: 'collab_decision_add',
    description: 'Record an architectural or design decision for team reference.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        category: {
          type: 'string',
          enum: ['architecture', 'naming', 'api', 'database', 'ui', 'other'],
          description: 'Decision category',
        },
        title: {
          type: 'string',
          description: 'Brief title of the decision',
        },
        description: {
          type: 'string',
          description: 'Detailed description of the decision and rationale',
        },
      },
      required: ['session_id', 'title', 'description'],
    },
  },
  {
    name: 'collab_decision_list',
    description: 'List recorded decisions. Use to understand past architectural choices.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['architecture', 'naming', 'api', 'database', 'ui', 'other'],
          description: 'Filter by category',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of decisions to return',
        },
      },
    },
  },
];

export async function handleDecisionTool(
  db: DatabaseAdapter,
  name: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  switch (name) {
    case 'collab_decision_add': {
      const validation = validateInput(decisionAddSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }
      const input = validation.data;

      // Verify session exists and is active
      const sessionResult = await validateActiveSession(db, input.session_id);
      if (!sessionResult.valid) {
        return sessionResult.error;
      }

      const decision = await addDecision(db, {
        session_id: input.session_id,
        category: input.category,
        title: input.title,
        description: input.description,
      });

      return successResponse({
        success: true,
        decision_id: decision.id,
        message: 'Decision recorded successfully.',
      });
    }

    case 'collab_decision_list': {
      const validation = validateInput(decisionListSchema, args);
      if (!validation.success) {
        return validationError(validation.error);
      }
      const input = validation.data;

      const decisions = await listDecisions(db, {
        category: input.category,
        limit: input.limit ?? 20,
      });

      return successResponse({
        decisions: decisions.map((d) => ({
          id: d.id,
          category: d.category,
          title: d.title,
          description: d.description,
          created_at: d.created_at,
        })),
        total: decisions.length,
      }, true);
    }

    default:
      return createToolResult(`Unknown decision tool: ${name}`, true);
  }
}
