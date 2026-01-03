// MCP Server implementation for Session Collaboration

import type { DatabaseAdapter } from '../db/sqlite-adapter.js';
import {
  JsonRpcRequestSchema,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type McpServerInfo,
  type McpCapabilities,
  type McpTool,
  type McpToolResult,
  createSuccessResponse,
  createErrorResponse,
  createToolResult,
  MCP_ERROR_CODES,
} from './protocol';
import { sessionTools, handleSessionTool } from './tools/session';
import { claimTools, handleClaimTool } from './tools/claim';
import { messageTools, handleMessageTool } from './tools/message';
import { decisionTools, handleDecisionTool } from './tools/decision';
import { lspTools, handleLspTool } from './tools/lsp';
import { historyTools, handleHistoryTool } from './tools/history';
import { queueTools, handleQueueTool } from './tools/queue';
import { notificationTools, handleNotificationTool } from './tools/notification';
import { memoryTools, handleMemoryTool } from './tools/memory';
import { protectionTools, handleProtectionTool } from './tools/protection';
import type { AuthContext } from '../auth/types';
import { VERSION, SERVER_NAME, SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_LITE } from '../constants.js';

const SERVER_INFO: McpServerInfo = {
  name: SERVER_NAME,
  version: VERSION,
};

const CAPABILITIES: McpCapabilities = {
  tools: {},
};

// Lite mode: Core tools for single-session (focus on memory/context)
const LITE_TOOL_NAMES = new Set([
  'collab_session_start',
  'collab_session_end',
  'collab_session_list',
  'collab_status_update',
  'collab_memory_save',
  'collab_memory_recall',
  'collab_memory_active',
  'collab_memory_clear',
  'collab_plan_register',
  'collab_plan_list',
  'collab_plan_get',
  'collab_decision_add',
  'collab_decision_list',
]);

// All tools combined
const ALL_TOOLS: McpTool[] = [...sessionTools, ...claimTools, ...messageTools, ...decisionTools, ...lspTools, ...historyTools, ...queueTools, ...notificationTools, ...memoryTools, ...protectionTools];

// Lite mode tools (filtered)
const LITE_TOOLS: McpTool[] = ALL_TOOLS.filter(t => LITE_TOOL_NAMES.has(t.name));

export type ServerMode = 'lite' | 'full';

export async function detectServerMode(db: DatabaseAdapter): Promise<ServerMode> {
  const result = await db
    .prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'active'")
    .first<{ count: number }>();
  const activeCount = result?.count ?? 0;
  return activeCount > 1 ? 'full' : 'lite';
}

export class McpServer {
  private authContext?: AuthContext;

  constructor(private db: DatabaseAdapter, authContext?: AuthContext) {
    this.authContext = authContext;
  }

  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { method, params, id } = request;

    try {
      switch (method) {
        case 'initialize':
          return await this.handleInitialize(id);

        case 'notifications/initialized':
          return createSuccessResponse(id, {});

        case 'tools/list':
          return await this.handleToolsList(id);

        case 'tools/call':
          return await this.handleToolCall(id, params as { name: string; arguments?: Record<string, unknown> });

        case 'ping':
          return createSuccessResponse(id, {});

        default:
          return createErrorResponse(id, MCP_ERROR_CODES.METHOD_NOT_FOUND, `Method not found: ${method}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return createErrorResponse(id, MCP_ERROR_CODES.INTERNAL_ERROR, message);
    }
  }

  private async handleInitialize(id: string | number | undefined): Promise<JsonRpcResponse> {
    const mode = await detectServerMode(this.db);
    const instructions = mode === 'lite' ? SERVER_INSTRUCTIONS_LITE : SERVER_INSTRUCTIONS;
    return createSuccessResponse(id, {
      protocolVersion: '2024-11-05',
      serverInfo: SERVER_INFO,
      capabilities: CAPABILITIES,
      instructions,
    });
  }

  private async handleToolsList(id: string | number | undefined): Promise<JsonRpcResponse> {
    const mode = await detectServerMode(this.db);
    const tools = mode === 'lite' ? LITE_TOOLS : ALL_TOOLS;
    return createSuccessResponse(id, { tools });
  }

  private async handleToolCall(
    id: string | number | undefined,
    params: { name: string; arguments?: Record<string, unknown> }
  ): Promise<JsonRpcResponse> {
    const { name, arguments: args = {} } = params;

    let result: McpToolResult;

    // Get user_id from auth context (for associating sessions with users)
    const userId = this.authContext?.userId !== 'legacy' ? this.authContext?.userId : undefined;

    try {
      // Route to appropriate handler
      if (name.startsWith('collab_session_') || name === 'collab_status_update' || name === 'collab_config') {
        result = await handleSessionTool(this.db, name, args, userId);
      } else if (name.startsWith('collab_claim') || name === 'collab_check' || name === 'collab_release' || name === 'collab_auto_release') {
        // Includes: collab_claim, collab_claims_list, collab_claim_update_priority, collab_check, collab_release, collab_auto_release
        result = await handleClaimTool(this.db, name, args);
      } else if (name.startsWith('collab_message_')) {
        result = await handleMessageTool(this.db, name, args);
      } else if (name.startsWith('collab_decision_')) {
        result = await handleDecisionTool(this.db, name, args);
      } else if (
        name === 'collab_analyze_symbols' ||
        name === 'collab_validate_symbols' ||
        name === 'collab_store_references' ||
        name === 'collab_impact_analysis'
      ) {
        result = await handleLspTool(this.db, name, args);
      } else if (name === 'collab_history_list') {
        result = await handleHistoryTool(this.db, name, args);
      } else if (name.startsWith('collab_queue_')) {
        result = await handleQueueTool(this.db, name, args);
      } else if (name.startsWith('collab_notifications_')) {
        result = await handleNotificationTool(this.db, name, args);
      } else if (name.startsWith('collab_memory_')) {
        result = await handleMemoryTool(this.db, name, args);
      } else if (name.startsWith('collab_plan_') || name.startsWith('collab_file_')) {
        result = await handleProtectionTool(this.db, name, args);
      } else {
        result = createToolResult(`Unknown tool: ${name}`, true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool execution failed';
      result = createToolResult(message, true);
    }

    return createSuccessResponse(id, result);
  }
}

// Parse and validate incoming request
export function parseRequest(body: string): JsonRpcRequest | null {
  try {
    const json = JSON.parse(body);
    const result = JsonRpcRequestSchema.safeParse(json);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function getMcpTools(): McpTool[] {
  return ALL_TOOLS;
}

export async function getMcpToolsForMode(db: DatabaseAdapter): Promise<McpTool[]> {
  const mode = await detectServerMode(db);
  return mode === 'lite' ? LITE_TOOLS : ALL_TOOLS;
}

// Handle MCP tool call for CLI
export async function handleMcpRequest(
  db: DatabaseAdapter,
  name: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  try {
    if (name.startsWith('collab_session_') || name === 'collab_status_update' || name === 'collab_config') {
      return await handleSessionTool(db, name, args);
    } else if (name.startsWith('collab_claim') || name === 'collab_check' || name === 'collab_release' || name === 'collab_auto_release') {
      // Includes: collab_claim, collab_claims_list, collab_claim_update_priority, collab_check, collab_release, collab_auto_release
      return await handleClaimTool(db, name, args);
    } else if (name.startsWith('collab_message_')) {
      return await handleMessageTool(db, name, args);
    } else if (name.startsWith('collab_decision_')) {
      return await handleDecisionTool(db, name, args);
    } else if (
      name === 'collab_analyze_symbols' ||
      name === 'collab_validate_symbols' ||
      name === 'collab_store_references' ||
      name === 'collab_impact_analysis'
    ) {
      return await handleLspTool(db, name, args);
    } else if (name === 'collab_history_list') {
      return await handleHistoryTool(db, name, args);
    } else if (name.startsWith('collab_queue_')) {
      return await handleQueueTool(db, name, args);
    } else if (name.startsWith('collab_notifications_')) {
      return await handleNotificationTool(db, name, args);
    } else if (name.startsWith('collab_memory_')) {
      return await handleMemoryTool(db, name, args);
    } else if (name.startsWith('collab_plan_') || name.startsWith('collab_file_')) {
      return await handleProtectionTool(db, name, args);
    } else {
      return createToolResult(`Unknown tool: ${name}`, true);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tool execution failed';
    return createToolResult(message, true);
  }
}
