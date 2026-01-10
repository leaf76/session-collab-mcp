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
import { sessionTools, handleSessionTool } from './tools/session.js';
import { claimTools, handleClaimTool } from './tools/claim.js';
import { memoryTools, handleMemoryTool } from './tools/memory.js';
import { protectionTools, handleProtectionTool } from './tools/protection.js';
import type { AuthContext } from '../auth/types.js';
import { VERSION, SERVER_NAME, SERVER_INSTRUCTIONS } from '../constants.js';

const SERVER_INFO: McpServerInfo = {
  name: SERVER_NAME,
  version: VERSION,
};

const CAPABILITIES: McpCapabilities = {
  tools: {},
};

// 9 core tools: session (4) + claim (1) + memory (3) + protect (1)

// All tools combined (now only 10 core tools)
const ALL_TOOLS: McpTool[] = [...sessionTools, ...claimTools, ...memoryTools, ...protectionTools];

// Server mode detection removed - now single unified mode with 10 tools

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
    return createSuccessResponse(id, {
      protocolVersion: '2024-11-05',
      serverInfo: SERVER_INFO,
      capabilities: CAPABILITIES,
      instructions: SERVER_INSTRUCTIONS,
    });
  }

  private async handleToolsList(id: string | number | undefined): Promise<JsonRpcResponse> {
    return createSuccessResponse(id, { tools: ALL_TOOLS });
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
      // Route to appropriate handler (10 core tools)
      if (name.startsWith('collab_session_') || name === 'collab_config' || name === 'collab_status') {
        result = await handleSessionTool(this.db, name, args, userId);
      } else if (name === 'collab_claim') {
        result = await handleClaimTool(this.db, name, args);
      } else if (name.startsWith('collab_memory_')) {
        result = await handleMemoryTool(this.db, name, args);
      } else if (name === 'collab_protect') {
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

// Handle MCP tool call for CLI
export async function handleMcpRequest(
  db: DatabaseAdapter,
  name: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  try {
    if (name.startsWith('collab_session_') || name === 'collab_config' || name === 'collab_status') {
      return await handleSessionTool(db, name, args);
    } else if (name === 'collab_claim') {
      return await handleClaimTool(db, name, args);
    } else if (name.startsWith('collab_memory_')) {
      return await handleMemoryTool(db, name, args);
    } else if (name === 'collab_protect') {
      return await handleProtectionTool(db, name, args);
    } else {
      return createToolResult(`Unknown tool: ${name}`, true);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tool execution failed';
    return createToolResult(message, true);
  }
}
