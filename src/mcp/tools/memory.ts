// Working Memory tools - Simplified to 3 core tools

import type { DatabaseAdapter } from '../../db/sqlite-adapter.js';
import type { McpTool, McpToolResult } from '../protocol.js';
import type { MemoryCategory } from '../../db/types.js';
import {
  saveMemory,
  recallMemory,
  clearMemory,
  getActiveMemories,
} from '../../db/queries.js';
import {
  errorResponse,
  successResponse,
  validationError,
  validateActiveSession,
  ERROR_CODES,
} from '../../utils/response.js';

export const memoryTools: McpTool[] = [
  {
    name: 'collab_memory_save',
    description: `Save or update context to working memory (upsert). Use to persist findings, decisions, or state that should survive context compaction.`,
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        category: {
          type: 'string',
          enum: ['finding', 'decision', 'state', 'todo', 'important', 'context'],
          description: 'Category: finding, decision, state, todo, important, context',
        },
        key: {
          type: 'string',
          description: 'Unique identifier (e.g., "auth_bug_root_cause")',
        },
        content: {
          type: 'string',
          description: 'The content to remember',
        },
        priority: {
          type: 'number',
          description: 'Priority 0-100 (default 50). Higher = more important.',
        },
        pinned: {
          type: 'boolean',
          description: 'If true, always loaded when recalling active memories.',
        },
      },
      required: ['session_id', 'category', 'key', 'content'],
    },
  },
  {
    name: 'collab_memory_recall',
    description: `Recall memories. Use active=true to get pinned + high priority memories for context restoration.`,
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        active: {
          type: 'boolean',
          description: 'If true, return pinned + high priority memories only (default behavior for context restoration)',
        },
        category: {
          type: 'string',
          enum: ['finding', 'decision', 'state', 'todo', 'important', 'context'],
          description: 'Filter by category',
        },
        key: {
          type: 'string',
          description: 'Get a specific memory by key',
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'collab_memory_clear',
    description: 'Clear memories. Specify key, category, or clear_all.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        key: {
          type: 'string',
          description: 'Clear specific memory by key',
        },
        category: {
          type: 'string',
          enum: ['finding', 'decision', 'state', 'todo', 'important', 'context'],
          description: 'Clear all in category',
        },
        clear_all: {
          type: 'boolean',
          description: 'Clear ALL memories (use with caution)',
        },
      },
      required: ['session_id'],
    },
  },
];

export async function handleMemoryTool(
  db: DatabaseAdapter,
  name: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const sessionId = args.session_id as string;

  if (!sessionId) {
    return validationError('session_id is required');
  }

  // Validate session exists
  const sessionCheck = await validateActiveSession(db, sessionId);
  if (!sessionCheck.valid) {
    return sessionCheck.error!;
  }

  switch (name) {
    case 'collab_memory_save': {
      const category = args.category as MemoryCategory;
      const key = args.key as string;
      const content = args.content as string;

      if (!category || !key || !content) {
        return validationError('category, key, and content are required');
      }

      const memory = await saveMemory(db, sessionId, {
        category,
        key,
        content,
        priority: (args.priority as number) ?? 50,
        pinned: (args.pinned as boolean) ?? false,
      });

      return successResponse({
        saved: true,
        id: memory.id,
        category: memory.category,
        key: memory.key,
        priority: memory.priority,
        pinned: memory.pinned === 1,
        message: `Memory saved: ${category}/${key}`,
      });
    }

    case 'collab_memory_recall': {
      const active = args.active as boolean | undefined;
      const category = args.category as MemoryCategory | undefined;
      const key = args.key as string | undefined;

      // If active=true, use getActiveMemories for optimized recall
      if (active) {
        const memories = await getActiveMemories(db, sessionId, {
          priority_threshold: 70,
          max_items: 20,
        });

        const formatted = memories.map((m) => ({
          category: m.category,
          key: m.key,
          content: m.content,
          priority: m.priority,
          pinned: m.pinned === 1,
        }));

        // Group by category
        const byCategory: Record<string, Array<{ key: string; content: string }>> = {};
        for (const mem of formatted) {
          if (!byCategory[mem.category]) {
            byCategory[mem.category] = [];
          }
          byCategory[mem.category].push({ key: mem.key, content: mem.content });
        }

        return successResponse({
          count: formatted.length,
          by_category: byCategory,
          message: `Active memories: ${formatted.length} items`,
        });
      }

      // Regular recall
      const memories = await recallMemory(db, sessionId, { category, key });

      const formatted = memories.map((m) => ({
        category: m.category,
        key: m.key,
        content: m.content,
        priority: m.priority,
        pinned: m.pinned === 1,
      }));

      return successResponse({
        count: formatted.length,
        memories: formatted,
      });
    }

    case 'collab_memory_clear': {
      const key = args.key as string | undefined;
      const category = args.category as MemoryCategory | undefined;
      const clearAll = args.clear_all as boolean | undefined;

      if (!key && !category && !clearAll) {
        return validationError('One of key, category, or clear_all is required');
      }

      const cleared = await clearMemory(db, sessionId, {
        key,
        category,
        clear_all: clearAll,
      });

      let message: string;
      if (key) {
        message = cleared > 0 ? `Memory cleared: ${key}` : `Memory not found: ${key}`;
      } else if (category) {
        message = `Cleared ${cleared} memories from category: ${category}`;
      } else {
        message = `Cleared all ${cleared} memories`;
      }

      return successResponse({ cleared, message });
    }

    default:
      return errorResponse(ERROR_CODES.UNKNOWN_TOOL, `Unknown memory tool: ${name}`);
  }
}
