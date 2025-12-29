// Session Collaboration MCP - Cloudflare Worker Entry Point
// Implements MCP SSE transport for Claude Code integration

import type { D1Database } from '@cloudflare/workers-types';
import { McpServer, parseRequest } from './mcp/server';
import { createErrorResponse, MCP_ERROR_CODES, type JsonRpcResponse } from './mcp/protocol';
import { validateAuth, unauthorizedResponse, type Env as AuthEnv } from './auth/middleware';
import type { AuthContext } from './auth/types';
import {
  handleRegister,
  handleLogin,
  handleRefresh,
  handleLogout,
  handleGetMe,
  handleUpdateMe,
  handleChangePassword,
} from './auth/handlers';
import { handleCreateToken, handleListTokens, handleRevokeToken } from './tokens/handlers';
import { generateAppHtml } from './frontend/app';

export interface Env extends AuthEnv {
  DB: D1Database;
  API_TOKEN?: string;
  JWT_SECRET?: string;
  ENVIRONMENT: string;
}

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Handle MCP SSE endpoint
async function handleMcpRequest(request: Request, env: Env, authContext: AuthContext | null): Promise<Response> {
  // Validate auth - require authentication if JWT_SECRET or API_TOKEN is configured
  if ((env.JWT_SECRET || env.API_TOKEN) && !authContext) {
    return unauthorizedResponse();
  }

  const server = new McpServer(env.DB, authContext ?? undefined);

  // Handle SSE GET request (for establishing connection)
  if (request.method === 'GET') {
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

// Handle auth routes
async function handleAuthRoute(request: Request, env: Env, pathname: string, authContext: AuthContext | null): Promise<Response> {
  const ctx = { db: env.DB, jwtSecret: env.JWT_SECRET ?? '', request };

  // Public auth routes (no auth required)
  if (request.method === 'POST') {
    if (pathname === '/auth/register') {
      return handleRegister(ctx);
    }
    if (pathname === '/auth/login') {
      return handleLogin(ctx);
    }
    if (pathname === '/auth/refresh') {
      return handleRefresh(ctx);
    }
  }

  // Protected auth routes (auth required)
  if (!authContext) {
    return unauthorizedResponse();
  }

  if (request.method === 'POST' && pathname === '/auth/logout') {
    return handleLogout(ctx, authContext);
  }

  if (pathname === '/auth/me') {
    if (request.method === 'GET') {
      return handleGetMe(ctx, authContext);
    }
    if (request.method === 'PUT') {
      return handleUpdateMe(ctx, authContext);
    }
  }

  if (request.method === 'PUT' && pathname === '/auth/password') {
    return handleChangePassword(ctx, authContext);
  }

  return new Response('Not found', { status: 404 });
}

// Handle token routes
async function handleTokenRoute(request: Request, env: Env, pathname: string, authContext: AuthContext | null): Promise<Response> {
  if (!authContext) {
    return unauthorizedResponse();
  }

  const ctx = { db: env.DB, request };

  // POST /tokens - create token
  if (request.method === 'POST' && pathname === '/tokens') {
    return handleCreateToken(ctx, authContext);
  }

  // GET /tokens - list tokens
  if (request.method === 'GET' && pathname === '/tokens') {
    return handleListTokens(ctx, authContext);
  }

  // DELETE /tokens/:id - revoke token
  const deleteMatch = pathname.match(/^\/tokens\/([a-f0-9-]+)$/);
  if (request.method === 'DELETE' && deleteMatch) {
    const tokenId = deleteMatch[1];
    return handleRevokeToken(ctx, authContext, tokenId);
  }

  return new Response('Not found', { status: 404 });
}

// Health check endpoint (JSON)
function handleHealthCheck(env: Env): Response {
  return new Response(
    JSON.stringify({
      status: 'healthy',
      service: 'session-collab-mcp',
      version: '0.2.0',
      environment: env.ENVIRONMENT,
      auth_enabled: !!(env.JWT_SECRET || env.API_TOKEN),
    }),
    {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    }
  );
}

// Homepage - MCP service info and quick start
function handleHomepage(env: Env, request: Request): Response {
  const url = new URL(request.url);
  const origin = url.origin;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Session Collab MCP</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
      padding: 2rem;
    }
    .container { max-width: 720px; margin: 0 auto; }
    header { text-align: center; margin-bottom: 2rem; }
    h1 { font-size: 1.75rem; font-weight: 600; margin-bottom: 0.5rem; }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(34, 197, 94, 0.1);
      border: 1px solid rgba(34, 197, 94, 0.3);
      color: #22c55e;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
    }
    .dot {
      width: 6px; height: 6px;
      background: #22c55e;
      border-radius: 50%;
    }
    .version { color: #64748b; font-size: 0.75rem; margin-top: 0.5rem; }
    .card {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 0.75rem;
      padding: 1.25rem;
      margin-bottom: 1rem;
    }
    h2 { font-size: 1rem; color: #94a3b8; margin-bottom: 1rem; font-weight: 500; }
    .tools {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 0.5rem;
    }
    .tool {
      background: rgba(99, 102, 241, 0.1);
      border: 1px solid rgba(99, 102, 241, 0.2);
      border-radius: 0.5rem;
      padding: 0.5rem 0.75rem;
      font-size: 0.8rem;
    }
    .tool code { color: #818cf8; }
    .tool span { color: #64748b; font-size: 0.7rem; display: block; margin-top: 0.125rem; }
    .step { display: flex; gap: 0.75rem; margin-bottom: 1rem; }
    .step:last-child { margin-bottom: 0; }
    .num {
      flex-shrink: 0;
      width: 1.5rem; height: 1.5rem;
      background: #3b82f6;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .step-content { flex: 1; }
    .step-content h3 { font-size: 0.875rem; margin-bottom: 0.375rem; font-weight: 500; }
    pre {
      background: #020617;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 0.375rem;
      padding: 0.75rem;
      font-size: 0.7rem;
      overflow-x: auto;
      line-height: 1.5;
    }
    code { color: #7dd3fc; }
    .copy-btn {
      background: rgba(59, 130, 246, 0.2);
      border: 1px solid rgba(59, 130, 246, 0.3);
      color: #60a5fa;
      padding: 0.2rem 0.5rem;
      border-radius: 0.25rem;
      cursor: pointer;
      font-size: 0.65rem;
      margin-top: 0.375rem;
    }
    .copy-btn:hover { background: rgba(59, 130, 246, 0.3); }
    footer { text-align: center; color: #475569; font-size: 0.7rem; margin-top: 1.5rem; }
    .login-btn {
      display: inline-block;
      margin-top: 1rem;
      padding: 0.5rem 1.5rem;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      color: #fff;
      text-decoration: none;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      font-weight: 500;
      transition: opacity 0.2s;
    }
    .login-btn:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Session Collab MCP</h1>
      <div class="status"><span class="dot"></span>Operational</div>
      <p class="version">v0.2.0 · ${env.ENVIRONMENT}</p>
      <a href="/app" class="login-btn">Login</a>
    </header>

    <div class="card">
      <h2>Quick Start</h2>

      <div class="step">
        <div class="num">1</div>
        <div class="step-content">
          <h3>Register & Login</h3>
          <pre id="s1">curl -X POST ${origin}/auth/register -H "Content-Type: application/json" \\
  -d '{"email": "you@example.com", "password": "YourPass123"}'</pre>
          <button class="copy-btn" onclick="copy('s1')">Copy</button>
        </div>
      </div>

      <div class="step">
        <div class="num">2</div>
        <div class="step-content">
          <h3>Create API Token</h3>
          <pre id="s2">curl -X POST ${origin}/tokens -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ACCESS_TOKEN" -d '{"name": "My Machine"}'</pre>
          <button class="copy-btn" onclick="copy('s2')">Copy</button>
        </div>
      </div>

      <div class="step">
        <div class="num">3</div>
        <div class="step-content">
          <h3>Configure Claude Code</h3>
          <pre id="s3">{
  "mcpServers": {
    "session-collab": {
      "type": "http",
      "url": "${origin}/mcp",
      "headers": {
        "Authorization": "Bearer mcp_YOUR_TOKEN"
      }
    }
  }
}</pre>
          <button class="copy-btn" onclick="copy('s3')">Copy</button>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>MCP Tools</h2>
      <div class="tools">
        <div class="tool"><code>collab_session_start</code><span>Start a session</span></div>
        <div class="tool"><code>collab_session_end</code><span>End a session</span></div>
        <div class="tool"><code>collab_session_list</code><span>List sessions</span></div>
        <div class="tool"><code>collab_session_heartbeat</code><span>Update heartbeat</span></div>
        <div class="tool"><code>collab_claim</code><span>Claim files</span></div>
        <div class="tool"><code>collab_check</code><span>Check conflicts</span></div>
        <div class="tool"><code>collab_release</code><span>Release claim</span></div>
        <div class="tool"><code>collab_claims_list</code><span>List all claims</span></div>
        <div class="tool"><code>collab_message_send</code><span>Send message</span></div>
        <div class="tool"><code>collab_message_list</code><span>Read messages</span></div>
        <div class="tool"><code>collab_decision_add</code><span>Record decision</span></div>
        <div class="tool"><code>collab_decision_list</code><span>List decisions</span></div>
      </div>
    </div>

    <footer>Powered by Cloudflare Workers + D1</footer>
  </div>
  <script>
    function copy(id) {
      navigator.clipboard.writeText(document.getElementById(id).textContent);
      event.target.textContent = 'Copied!';
      setTimeout(() => event.target.textContent = 'Copy', 1500);
    }
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
  });
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

    // Validate auth once for all routes
    const authContext = await validateAuth(request, env);

    // Route requests
    const pathname = url.pathname;

    // Homepage
    if (pathname === '/') {
      return handleHomepage(env, request);
    }

    // Dashboard App
    if (pathname === '/app' || pathname === '/dashboard') {
      const html = generateAppHtml(url.origin);
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
      });
    }

    // Health check
    if (pathname === '/health') {
      return handleHealthCheck(env);
    }

    // Auth routes
    if (pathname.startsWith('/auth/')) {
      return handleAuthRoute(request, env, pathname, authContext);
    }

    // Token routes
    if (pathname.startsWith('/tokens')) {
      return handleTokenRoute(request, env, pathname, authContext);
    }

    // MCP routes
    if (pathname === '/mcp' || pathname === '/mcp/' || pathname === '/sse' || pathname === '/sse/') {
      return handleMcpRequest(request, env, authContext);
    }

    // Handle OAuth discovery - indicate this server uses Bearer token auth, not OAuth
    if (pathname === '/.well-known/oauth-authorization-server') {
      return new Response(
        JSON.stringify({
          error: 'oauth_not_supported',
          error_description: 'This server uses Bearer token authentication, not OAuth. Include your API token in the Authorization header.',
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    // Return JSON 404 for all other routes
    return new Response(
      JSON.stringify({ error: 'not_found', message: 'The requested resource was not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  },
};
