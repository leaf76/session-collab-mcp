// Session Collaboration MCP - Cloudflare Worker Entry Point
// Implements MCP SSE transport for Claude Code integration

import type { D1Database } from '@cloudflare/workers-types';
import { McpServer, parseRequest } from './mcp/server';
import { createErrorResponse, MCP_ERROR_CODES, type JsonRpcResponse } from './mcp/protocol';

export interface Env {
  DB: D1Database;
  API_TOKEN?: string;
  ENVIRONMENT: string;
}

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Constant-time string comparison to prevent timing attacks
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Compare against itself to maintain constant time even when lengths differ
    b = a;
  }
  let result = a.length === b.length ? 0 : 1;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// Validate API token if configured
function validateAuth(request: Request, env: Env): boolean {
  if (!env.API_TOKEN) {
    return true; // No token configured, allow all
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return false;

  const token = authHeader.replace('Bearer ', '');
  return timingSafeEqual(token, env.API_TOKEN);
}

// Handle MCP SSE endpoint
async function handleMcpRequest(request: Request, env: Env): Promise<Response> {
  // Validate auth
  if (!validateAuth(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const server = new McpServer(env.DB);

  // Handle SSE GET request (for establishing connection)
  if (request.method === 'GET') {
    // Return SSE endpoint info
    return new Response(
      JSON.stringify({
        type: 'sse',
        endpoint: '/mcp',
        description: 'Session Collaboration MCP Server',
        instructions: 'POST JSON-RPC requests to this endpoint',
      }),
      {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }

  // Handle POST request (MCP message)
  if (request.method === 'POST') {
    const body = await request.text();
    const jsonRpcRequest = parseRequest(body);

    let response: JsonRpcResponse;

    if (!jsonRpcRequest) {
      response = createErrorResponse(undefined, MCP_ERROR_CODES.PARSE_ERROR, 'Invalid JSON-RPC request');
    } else {
      response = await server.handleRequest(jsonRpcRequest);
    }

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  return new Response('Method not allowed', { status: 405 });
}

// Health check endpoint
function handleHealthCheck(env: Env): Response {
  return new Response(
    JSON.stringify({
      status: 'healthy',
      service: 'session-collab-mcp',
      version: '0.1.0',
      environment: env.ENVIRONMENT,
    }),
    {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    }
  );
}

// Main request handler
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Route requests
    switch (url.pathname) {
      case '/':
      case '/health':
        return handleHealthCheck(env);

      case '/mcp':
      case '/mcp/':
        return handleMcpRequest(request, env);

      case '/sse':
      case '/sse/':
        // SSE endpoint for streaming (future enhancement)
        return handleMcpRequest(request, env);

      default:
        return new Response('Not found', { status: 404 });
    }
  },
};
