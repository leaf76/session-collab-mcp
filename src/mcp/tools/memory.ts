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
import { clampMemoryContent, resolveRecallMaxItems } from '../../utils/memory-content.js';
import {
  MAX_MEMORY_CONTENT_CHARS,
  DEFAULT_RECALL_MAX_ITEMS,
  MAX_RECALL_MAX_ITEMS,
} from '../../constants.js';

export const memoryTools: McpTool[] = [
  {
    name: 'collab_memory_save',
    description: `Save short working-memory notes (finding/decision/state). Content capped at ${MAX_MEMORY_CONTENT_CHARS} chars. Not a long-term vault — use AI-Memory for durable prefs.`,
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
          description: `Short content (max ${MAX_MEMORY_CONTENT_CHARS} chars; longer values are truncated)`,
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
    description: `Recall short working-memory notes. active=true returns pinned + high priority (default max ${DEFAULT_RECALL_MAX_ITEMS}).`,
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        active: {
          type: 'boolean',
          description: 'If true, return pinned + high priority memories only',
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
        max_items: {
          type: 'number',
          description: `Max items for active recall (default ${DEFAULT_RECALL_MAX_ITEMS}, max ${MAX_RECALL_MAX_ITEMS})`,
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
      const rawContent = args.content as string;

      if (!category || !key || rawContent === undefined || rawContent === null) {
        return validationError('category, key, and content are required');
      }

      const clamped = clampMemoryContent(String(rawContent));

      const memory = await saveMemory(db, sessionId, {
        category,
        key,
        content: clamped.content,
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
        truncated: clamped.truncated,
        content_length: clamped.content.length,
        message: clamped.truncated
          ? `Memory saved (truncated to ${MAX_MEMORY_CONTENT_CHARS} chars): ${category}/${key}`
          : `Memory saved: ${category}/${key}`,
      });
    }

    case 'collab_memory_recall': {
      const active = args.active as boolean | undefined;
      const category = args.category as MemoryCategory | undefined;
      const key = args.key as string | undefined;
      const maxItems = resolveRecallMaxItems(args.max_items as number | undefined);

      // If active=true, use getActiveMemories for optimized recall
      if (active) {
        const memories = await getActiveMemories(db, sessionId, {
          priority_threshold: 70,
          max_items: maxItems,
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
          max_items: maxItems,
          by_category: byCategory,
          message: `Active memories: ${formatted.length} items`,
        });
      }

      // Regular recall — still cap to avoid huge dumps
      const memories = await recallMemory(db, sessionId, { category, key });
      const limited = key ? memories : memories.slice(0, maxItems);

      const formatted = limited.map((m) => ({
        category: m.category,
        key: m.key,
        content: m.content,
        priority: m.priority,
        pinned: m.pinned === 1,
      }));

      return successResponse({
        count: formatted.length,
        max_items: maxItems,
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
