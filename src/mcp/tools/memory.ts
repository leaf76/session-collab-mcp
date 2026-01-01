// Working Memory tools - Persist important context within a session

import type { DatabaseAdapter } from '../../db/sqlite-adapter.js';
import type { McpTool, McpToolResult } from '../protocol.js';
import type { MemoryCategory } from '../../db/types.js';
import {
  saveMemory,
  recallMemory,
  updateMemory,
  clearMemory,
  pinMemory,
  getMemoryStats,
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
    description:
      'Save important context to working memory. Use this to persist findings, decisions, state, or any critical information that should survive context compaction.',
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
          description:
            'Category of memory: finding (discovered facts), decision (choices made), state (current status), todo (pending work), important (critical info), context (general context)',
        },
        key: {
          type: 'string',
          description: 'Unique identifier for this memory within the category (e.g., "auth_bug_root_cause")',
        },
        content: {
          type: 'string',
          description: 'The actual content to remember',
        },
        priority: {
          type: 'number',
          description: 'Priority 0-100 (default 50). Higher priority memories are more likely to be recalled.',
        },
        pinned: {
          type: 'boolean',
          description: 'If true, this memory will always be loaded when recalling active memories.',
        },
        expires_at: {
          type: 'string',
          description: 'Optional ISO datetime when this memory should expire (e.g., for temporary state)',
        },
        related_claim_id: {
          type: 'string',
          description: 'Optional claim ID this memory relates to',
        },
        metadata: {
          type: 'object',
          description: 'Optional additional structured data (file_path, line_number, confidence, etc.)',
        },
      },
      required: ['session_id', 'category', 'key', 'content'],
    },
  },
  {
    name: 'collab_memory_recall',
    description:
      'Recall memories from working memory. Use this to retrieve previously saved context, findings, or state.',
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
          description: 'Filter by category (optional)',
        },
        key: {
          type: 'string',
          description: 'Get a specific memory by key (optional)',
        },
        pinned_only: {
          type: 'boolean',
          description: 'Only return pinned memories',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of memories to return (default: all)',
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'collab_memory_update',
    description: 'Update an existing memory entry. Use this to modify content, priority, or other properties.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        key: {
          type: 'string',
          description: 'The key of the memory to update',
        },
        content: {
          type: 'string',
          description: 'New content (optional)',
        },
        priority: {
          type: 'number',
          description: 'New priority 0-100 (optional)',
        },
        pinned: {
          type: 'boolean',
          description: 'New pinned status (optional)',
        },
        expires_at: {
          type: 'string',
          description: 'New expiration time, or null to remove expiration (optional)',
        },
        metadata: {
          type: 'object',
          description: 'New metadata (replaces existing)',
        },
      },
      required: ['session_id', 'key'],
    },
  },
  {
    name: 'collab_memory_clear',
    description: 'Clear memories from working memory. Can clear by key, category, or all.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        key: {
          type: 'string',
          description: 'Clear a specific memory by key',
        },
        category: {
          type: 'string',
          enum: ['finding', 'decision', 'state', 'todo', 'important', 'context'],
          description: 'Clear all memories in a category',
        },
        clear_all: {
          type: 'boolean',
          description: 'Clear ALL memories for this session (use with caution)',
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'collab_memory_pin',
    description: 'Pin or unpin a memory. Pinned memories are always included when loading active memories.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        key: {
          type: 'string',
          description: 'The key of the memory to pin/unpin',
        },
        pinned: {
          type: 'boolean',
          description: 'True to pin, false to unpin',
        },
      },
      required: ['session_id', 'key', 'pinned'],
    },
  },
  {
    name: 'collab_memory_stats',
    description: 'Get statistics about working memory usage for this session.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'collab_memory_active',
    description:
      'Get all active (pinned + high priority) memories. This is the main function for loading context that should be preserved.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        priority_threshold: {
          type: 'number',
          description: 'Minimum priority to include (default: 70)',
        },
        max_items: {
          type: 'number',
          description: 'Maximum items to return (default: 20)',
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
  switch (name) {
    case 'collab_memory_save':
      return handleMemorySave(db, args);
    case 'collab_memory_recall':
      return handleMemoryRecall(db, args);
    case 'collab_memory_update':
      return handleMemoryUpdate(db, args);
    case 'collab_memory_clear':
      return handleMemoryClear(db, args);
    case 'collab_memory_pin':
      return handleMemoryPin(db, args);
    case 'collab_memory_stats':
      return handleMemoryStats(db, args);
    case 'collab_memory_active':
      return handleMemoryActive(db, args);
    default:
      return errorResponse(ERROR_CODES.UNKNOWN_TOOL, `Unknown memory tool: ${name}`);
  }
}

async function handleMemorySave(
  db: DatabaseAdapter,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const sessionId = args.session_id as string;
  const category = args.category as MemoryCategory;
  const key = args.key as string;
  const content = args.content as string;

  if (!sessionId || !category || !key || !content) {
    return validationError('session_id, category, key, and content are required');
  }

  // Validate session exists
  const sessionCheck = await validateActiveSession(db, sessionId);
  if (!sessionCheck.valid) {
    return sessionCheck.error!;
  }

  const memory = await saveMemory(db, sessionId, {
    category,
    key,
    content,
    priority: (args.priority as number) ?? 50,
    pinned: (args.pinned as boolean) ?? false,
    expires_at: args.expires_at as string | undefined,
    related_claim_id: args.related_claim_id as string | undefined,
    related_decision_id: args.related_decision_id as string | undefined,
    metadata: args.metadata as Record<string, unknown> | undefined,
  });

  return successResponse({
    saved: true,
    memory: {
      id: memory.id,
      category: memory.category,
      key: memory.key,
      priority: memory.priority,
      pinned: memory.pinned === 1,
      created_at: memory.created_at,
      updated_at: memory.updated_at,
    },
    message: `Memory saved: ${category}/${key}`,
  });
}

async function handleMemoryRecall(
  db: DatabaseAdapter,
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

  const memories = await recallMemory(db, sessionId, {
    category: args.category as MemoryCategory | undefined,
    key: args.key as string | undefined,
    pinned_only: args.pinned_only as boolean | undefined,
    limit: args.limit as number | undefined,
  });

  // Format memories for response
  const formattedMemories = memories.map((m) => ({
    category: m.category,
    key: m.key,
    content: m.content,
    priority: m.priority,
    pinned: m.pinned === 1,
    created_at: m.created_at,
    updated_at: m.updated_at,
    expires_at: m.expires_at,
    metadata: m.metadata ? JSON.parse(m.metadata) : null,
  }));

  return successResponse({
    count: formattedMemories.length,
    memories: formattedMemories,
  });
}

async function handleMemoryUpdate(
  db: DatabaseAdapter,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const sessionId = args.session_id as string;
  const key = args.key as string;

  if (!sessionId || !key) {
    return validationError('session_id and key are required');
  }

  // Validate session exists
  const sessionCheck = await validateActiveSession(db, sessionId);
  if (!sessionCheck.valid) {
    return sessionCheck.error!;
  }

  const updates: {
    content?: string;
    priority?: number;
    pinned?: boolean;
    expires_at?: string | null;
    metadata?: Record<string, unknown>;
  } = {};

  if (args.content !== undefined) updates.content = args.content as string;
  if (args.priority !== undefined) updates.priority = args.priority as number;
  if (args.pinned !== undefined) updates.pinned = args.pinned as boolean;
  if (args.expires_at !== undefined) updates.expires_at = args.expires_at as string | null;
  if (args.metadata !== undefined) updates.metadata = args.metadata as Record<string, unknown>;

  if (Object.keys(updates).length === 0) {
    return validationError('At least one field to update is required');
  }

  const updated = await updateMemory(db, sessionId, key, updates);

  if (!updated) {
    return errorResponse(ERROR_CODES.MEMORY_NOT_FOUND, `Memory not found: ${key}`);
  }

  return successResponse({
    updated: true,
    key,
    message: `Memory updated: ${key}`,
  });
}

async function handleMemoryClear(
  db: DatabaseAdapter,
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

  return successResponse({
    cleared,
    message,
  });
}

async function handleMemoryPin(
  db: DatabaseAdapter,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const sessionId = args.session_id as string;
  const key = args.key as string;
  const pinned = args.pinned as boolean;

  if (!sessionId || !key || pinned === undefined) {
    return validationError('session_id, key, and pinned are required');
  }

  // Validate session exists
  const sessionCheck = await validateActiveSession(db, sessionId);
  if (!sessionCheck.valid) {
    return sessionCheck.error!;
  }

  const updated = await pinMemory(db, sessionId, key, pinned);

  if (!updated) {
    return errorResponse(ERROR_CODES.MEMORY_NOT_FOUND, `Memory not found: ${key}`);
  }

  return successResponse({
    updated: true,
    key,
    pinned,
    message: pinned ? `Memory pinned: ${key}` : `Memory unpinned: ${key}`,
  });
}

async function handleMemoryStats(
  db: DatabaseAdapter,
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

  const stats = await getMemoryStats(db, sessionId);

  return successResponse({
    ...stats,
    message: `Working memory: ${stats.total} total, ${stats.pinned_count} pinned`,
  });
}

async function handleMemoryActive(
  db: DatabaseAdapter,
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

  const memories = await getActiveMemories(db, sessionId, {
    priority_threshold: args.priority_threshold as number | undefined,
    max_items: args.max_items as number | undefined,
  });

  // Format for context injection
  const formattedMemories = memories.map((m) => ({
    category: m.category,
    key: m.key,
    content: m.content,
    priority: m.priority,
    pinned: m.pinned === 1,
  }));

  // Group by category for easier reading
  const byCategory: Record<string, Array<{ key: string; content: string; priority: number; pinned: boolean }>> = {};
  for (const mem of formattedMemories) {
    if (!byCategory[mem.category]) {
      byCategory[mem.category] = [];
    }
    byCategory[mem.category].push({
      key: mem.key,
      content: mem.content,
      priority: mem.priority,
      pinned: mem.pinned,
    });
  }

  return successResponse({
    count: formattedMemories.length,
    by_category: byCategory,
    memories: formattedMemories,
    message: `Active memories: ${formattedMemories.length} items (pinned + priority >= threshold)`,
  });
}
