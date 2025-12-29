// MCP Server implementation for Session Collaboration

import type { D1Database } from '@cloudflare/workers-types';
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
import type { AuthContext } from '../auth/types';

const SERVER_INFO: McpServerInfo = {
  name: 'session-collab-mcp',
  version: '0.2.0',
};

const CAPABILITIES: McpCapabilities = {
  tools: {},
};

// Combine all tools
const ALL_TOOLS: McpTool[] = [...sessionTools, ...claimTools, ...messageTools, ...decisionTools];

export class McpServer {
  private authContext?: AuthContext;

  constructor(private db: D1Database, authContext?: AuthContext) {
    this.authContext = authContext;
  }

  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { method, params, id } = request;

    try {
      switch (method) {
        case 'initialize':
          return this.handleInitialize(id);

        case 'notifications/initialized':
          // Client acknowledging initialization - no response needed for notifications
          return createSuccessResponse(id, {});

        case 'tools/list':
          return this.handleToolsList(id);

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

  private handleInitialize(id: string | number | undefined): JsonRpcResponse {
    return createSuccessResponse(id, {
      protocolVersion: '2024-11-05',
      serverInfo: SERVER_INFO,
      capabilities: CAPABILITIES,
    });
  }

  private handleToolsList(id: string | number | undefined): JsonRpcResponse {
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
      // Route to appropriate handler
      if (name.startsWith('collab_session_')) {
        result = await handleSessionTool(this.db, name, args, userId);
      } else if (name.startsWith('collab_claim') || name === 'collab_check' || name === 'collab_release') {
        result = await handleClaimTool(this.db, name, args);
      } else if (name.startsWith('collab_message_')) {
        result = await handleMessageTool(this.db, name, args);
      } else if (name.startsWith('collab_decision_')) {
        result = await handleDecisionTool(this.db, name, args);
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
