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

// Homepage HTML
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
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #e4e4e7;
      min-height: 100vh;
      padding: 2rem;
    }
    .container { max-width: 800px; margin: 0 auto; }
    header {
      text-align: center;
      margin-bottom: 3rem;
    }
    h1 {
      font-size: 2.5rem;
      background: linear-gradient(90deg, #60a5fa, #a78bfa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 0.5rem;
    }
    .badge {
      display: inline-block;
      background: #22c55e;
      color: #fff;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.875rem;
      font-weight: 500;
      margin: 0 0.25rem;
    }
    .badge.auth { background: #3b82f6; }
    .card {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 1rem;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    .card h2 {
      font-size: 1.25rem;
      color: #a78bfa;
      margin-bottom: 1rem;
    }
    .tools-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 0.75rem;
    }
    .tool {
      background: rgba(96,165,250,0.1);
      border: 1px solid rgba(96,165,250,0.2);
      border-radius: 0.5rem;
      padding: 0.75rem;
      font-size: 0.875rem;
    }
    .tool code {
      color: #60a5fa;
      font-weight: 600;
    }
    .tool p {
      color: #a1a1aa;
      margin-top: 0.25rem;
      font-size: 0.75rem;
    }
    .endpoint {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }
    .method {
      background: #3b82f6;
      color: #fff;
      padding: 0.125rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.75rem;
      font-weight: 600;
      min-width: 50px;
      text-align: center;
    }
    .method.get { background: #22c55e; }
    .method.put { background: #f59e0b; }
    .method.delete { background: #ef4444; }
    .path { font-family: monospace; color: #fbbf24; }
    .auth-badge {
      font-size: 0.65rem;
      background: rgba(239, 68, 68, 0.2);
      color: #fca5a5;
      padding: 0.125rem 0.375rem;
      border-radius: 0.25rem;
    }
    .auth-badge.public {
      background: rgba(34, 197, 94, 0.2);
      color: #86efac;
    }
    pre {
      background: #0d1117;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 0.5rem;
      padding: 1rem;
      overflow-x: auto;
      font-size: 0.8rem;
      line-height: 1.5;
      margin: 0.75rem 0;
    }
    code { color: #79c0ff; }
    .step {
      display: flex;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .step-num {
      flex-shrink: 0;
      width: 2rem;
      height: 2rem;
      background: linear-gradient(135deg, #60a5fa, #a78bfa);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 0.875rem;
    }
    .step-content { flex: 1; }
    .step-content h3 {
      font-size: 1rem;
      margin-bottom: 0.5rem;
      color: #e4e4e7;
    }
    .step-content p {
      color: #a1a1aa;
      font-size: 0.875rem;
      margin-bottom: 0.5rem;
    }
    .copy-btn {
      background: rgba(96,165,250,0.2);
      border: 1px solid rgba(96,165,250,0.3);
      color: #60a5fa;
      padding: 0.25rem 0.75rem;
      border-radius: 0.25rem;
      cursor: pointer;
      font-size: 0.75rem;
      margin-top: 0.5rem;
    }
    .copy-btn:hover { background: rgba(96,165,250,0.3); }
    footer {
      text-align: center;
      margin-top: 2rem;
      color: #71717a;
      font-size: 0.875rem;
    }
    .section-title {
      font-size: 0.875rem;
      color: #71717a;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin: 1rem 0 0.5rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Session Collab MCP</h1>
      <span class="badge">v0.2.0</span>
      <span class="badge">${env.ENVIRONMENT}</span>
      ${env.JWT_SECRET || env.API_TOKEN ? '<span class="badge auth">Auth Enabled</span>' : ''}
    </header>

    <div class="card">
      <h2>API Endpoints</h2>

      <div class="section-title">Authentication</div>
      <div class="endpoint">
        <span class="method">POST</span>
        <span class="path">/auth/register</span>
        <span class="auth-badge public">Public</span>
      </div>
      <div class="endpoint">
        <span class="method">POST</span>
        <span class="path">/auth/login</span>
        <span class="auth-badge public">Public</span>
      </div>
      <div class="endpoint">
        <span class="method">POST</span>
        <span class="path">/auth/refresh</span>
        <span class="auth-badge public">Public</span>
      </div>
      <div class="endpoint">
        <span class="method">POST</span>
        <span class="path">/auth/logout</span>
        <span class="auth-badge">JWT</span>
      </div>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/auth/me</span>
        <span class="auth-badge">JWT</span>
      </div>
      <div class="endpoint">
        <span class="method put">PUT</span>
        <span class="path">/auth/me</span>
        <span class="auth-badge">JWT</span>
      </div>
      <div class="endpoint">
        <span class="method put">PUT</span>
        <span class="path">/auth/password</span>
        <span class="auth-badge">JWT</span>
      </div>

      <div class="section-title">API Tokens</div>
      <div class="endpoint">
        <span class="method">POST</span>
        <span class="path">/tokens</span>
        <span class="auth-badge">JWT</span>
      </div>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/tokens</span>
        <span class="auth-badge">JWT</span>
      </div>
      <div class="endpoint">
        <span class="method delete">DELETE</span>
        <span class="path">/tokens/:id</span>
        <span class="auth-badge">JWT</span>
      </div>

      <div class="section-title">MCP</div>
      <div class="endpoint">
        <span class="method">POST</span>
        <span class="path">/mcp</span>
        <span class="auth-badge">API Token</span>
      </div>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/health</span>
        <span class="auth-badge public">Public</span>
      </div>
    </div>

    <div class="card">
      <h2>MCP Tools</h2>
      <div class="tools-grid">
        <div class="tool">
          <code>collab_session_start</code>
          <p>Start a new session</p>
        </div>
        <div class="tool">
          <code>collab_session_end</code>
          <p>End a session</p>
        </div>
        <div class="tool">
          <code>collab_session_list</code>
          <p>List active sessions</p>
        </div>
        <div class="tool">
          <code>collab_session_heartbeat</code>
          <p>Update session heartbeat</p>
        </div>
        <div class="tool">
          <code>collab_claim</code>
          <p>Claim files for editing</p>
        </div>
        <div class="tool">
          <code>collab_check</code>
          <p>Check file conflicts</p>
        </div>
        <div class="tool">
          <code>collab_release</code>
          <p>Release a file claim</p>
        </div>
        <div class="tool">
          <code>collab_claims_list</code>
          <p>List all claims</p>
        </div>
        <div class="tool">
          <code>collab_message_send</code>
          <p>Send message to sessions</p>
        </div>
        <div class="tool">
          <code>collab_message_list</code>
          <p>Read messages</p>
        </div>
        <div class="tool">
          <code>collab_decision_add</code>
          <p>Record a decision</p>
        </div>
        <div class="tool">
          <code>collab_decision_list</code>
          <p>List decisions</p>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Quick Start</h2>

      <div class="step">
        <div class="step-num">1</div>
        <div class="step-content">
          <h3>Register an Account</h3>
          <pre id="register-curl">curl -X POST ${origin}/auth/register \\
  -H "Content-Type: application/json" \\
  -d '{"email": "you@example.com", "password": "YourPassword123"}'</pre>
          <button class="copy-btn" onclick="copyToClipboard('register-curl')">Copy</button>
        </div>
      </div>

      <div class="step">
        <div class="step-num">2</div>
        <div class="step-content">
          <h3>Create an API Token</h3>
          <p>Use the <code>access_token</code> from login to create an API token:</p>
          <pre id="create-token">curl -X POST ${origin}/tokens \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \\
  -d '{"name": "Claude Code - My Machine"}'</pre>
          <button class="copy-btn" onclick="copyToClipboard('create-token')">Copy</button>
        </div>
      </div>

      <div class="step">
        <div class="step-num">3</div>
        <div class="step-content">
          <h3>Configure Claude Code</h3>
          <p>Add to <code>~/.claude.json</code>:</p>
          <pre id="mcp-config">{
  "mcpServers": {
    "session-collab": {
      "type": "url",
      "url": "${origin}/mcp",
      "headers": {
        "Authorization": "Bearer mcp_YOUR_API_TOKEN"
      }
    }
  }
}</pre>
          <button class="copy-btn" onclick="copyToClipboard('mcp-config')">Copy</button>
        </div>
      </div>
    </div>

    <footer>
      Powered by Cloudflare Workers + D1
    </footer>
  </div>

  <script>
    function copyToClipboard(id) {
      const el = document.getElementById(id);
      navigator.clipboard.writeText(el.textContent);
      event.target.textContent = 'Copied!';
      setTimeout(() => event.target.textContent = 'Copy', 2000);
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

    return new Response('Not found', { status: 404 });
  },
};
