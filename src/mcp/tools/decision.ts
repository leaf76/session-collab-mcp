// Decision recording tools

import type { D1Database } from '@cloudflare/workers-types';
import type { McpTool, McpToolResult } from '../protocol';
import { createToolResult } from '../protocol';
import type { DecisionCategory } from '../../db/types';
import { addDecision, listDecisions, getSession } from '../../db/queries';

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
  db: D1Database,
  name: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  switch (name) {
    case 'collab_decision_add': {
      const sessionId = args.session_id as string;
      const category = args.category as DecisionCategory | undefined;
      const title = args.title as string;
      const description = args.description as string;

      // Verify session
      const session = await getSession(db, sessionId);
      if (!session || session.status !== 'active') {
        return createToolResult(
          JSON.stringify({
            error: 'SESSION_INVALID',
            message: 'Session not found or inactive.',
          }),
          true
        );
      }

      const decision = await addDecision(db, {
        session_id: sessionId,
        category,
        title,
        description,
      });

      return createToolResult(
        JSON.stringify({
          success: true,
          decision_id: decision.id,
          message: 'Decision recorded successfully.',
        })
      );
    }

    case 'collab_decision_list': {
      const category = args.category as DecisionCategory | undefined;
      const limit = (args.limit as number) ?? 20;

      const decisions = await listDecisions(db, { category, limit });

      return createToolResult(
        JSON.stringify(
          {
            decisions: decisions.map((d) => ({
              id: d.id,
              category: d.category,
              title: d.title,
              description: d.description,
              created_at: d.created_at,
            })),
            total: decisions.length,
          },
          null,
          2
        )
      );
    }

    default:
      return createToolResult(`Unknown decision tool: ${name}`, true);
  }
}
