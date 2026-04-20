import http from 'http';
import { URL } from 'url';
import type { DatabaseAdapter } from '../db/sqlite-adapter.js';
import type { JsonRpcRequest, JsonRpcResponse, McpToolResult } from '../mcp/protocol.js';
import { JsonRpcRequestSchema } from '../mcp/protocol.js';
import { McpServer, getMcpTools, handleMcpRequest } from '../mcp/server.js';
import { generateId } from '../utils/crypto.js';

type JsonPrimitive = null | boolean | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type HttpSuccessResponse = {
  ok: true;
  data?: JsonValue;
};

export type HttpErrorResponse = {
  ok: false;
  error: string;
  code: string;
  message: string;
  trace_id: string;
};

export type HttpResponse = HttpSuccessResponse | HttpErrorResponse;

export type HttpServerOptions = {
  host?: string;
  allowedHosts?: string[];
  apiToken?: string;
};

class HttpRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'HttpRequestError';
  }
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase();
}

function normalizeHostHeader(rawHost: string | undefined): string | null {
  if (!rawHost) return null;
  const first = rawHost.split(',')[0]?.trim();
  if (!first) return null;

  if (first.startsWith('[')) {
    const closingIndex = first.indexOf(']');
    if (closingIndex !== -1) {
      return normalizeHost(first.slice(1, closingIndex));
    }
  }

  const withoutPort = first.includes(':') ? first.split(':')[0] : first;
  return normalizeHost(withoutPort);
}

function isLocalBindHost(host: string): boolean {
  const normalized = normalizeHost(host);
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

function buildAllowedHosts(host: string, configuredHosts: string[] = []): Set<string> {
  const allowedHosts = new Set(configuredHosts.map(normalizeHost).filter(Boolean));

  if (isLocalBindHost(host)) {
    allowedHosts.add('localhost');
    allowedHosts.add('127.0.0.1');
    allowedHosts.add('::1');
  } else if (host !== '0.0.0.0' && host !== '::') {
    allowedHosts.add(normalizeHost(host));
  }

  return allowedHosts;
}

function getTraceId(req: http.IncomingMessage): string {
  const requestId = req.headers['x-request-id'];
  if (typeof requestId === 'string' && requestId.trim()) {
    return requestId.trim();
  }
  return generateId();
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  traceId: string,
  contentType: string = 'application/json'
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(payload),
    'X-Request-ID': traceId,
  });
  res.end(payload);
}

function sendHttpError(
  res: http.ServerResponse,
  status: number,
  code: string,
  message: string,
  traceId: string
): void {
  sendJson(res, status, { ok: false, error: code, code, message, trace_id: traceId }, traceId);
}

function sendJsonRpcResponse(
  res: http.ServerResponse,
  status: number,
  response: JsonRpcResponse,
  traceId: string
): void {
  sendJson(res, status, response as unknown as JsonValue, traceId);
}

function sendJsonRpcError(
  res: http.ServerResponse,
  status: number,
  id: string | number | null,
  code: number,
  message: string,
  traceId: string
): void {
  sendJson(
    res,
    status,
    {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        data: { trace_id: traceId },
      },
    } as unknown as JsonValue,
    traceId
  );
}

async function readJsonBody(req: http.IncomingMessage): Promise<JsonValue | undefined> {
  return await new Promise((resolve, reject) => {
    let data = '';
    let settled = false;

    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const resolveOnce = (value: JsonValue | undefined) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    req.on('data', (chunk) => {
      if (settled) return;
      data += chunk;
      if (data.length > 1_000_000) {
        rejectOnce(new HttpRequestError(413, 'PAYLOAD_TOO_LARGE', 'Payload too large'));
        req.pause();
      }
    });

    req.on('end', () => {
      if (settled) return;
      if (!data) {
        resolveOnce(undefined);
        return;
      }

      try {
        resolveOnce(JSON.parse(data) as JsonValue);
      } catch {
        rejectOnce(new HttpRequestError(400, 'INVALID_JSON', 'Request body must be valid JSON'));
      }
    });

    req.on('error', (error) => rejectOnce(error instanceof Error ? error : new Error(String(error))));
  });
}

export function normalizeToolResult(result: McpToolResult, traceId: string): HttpResponse {
  const text = result.content?.[0]?.text ?? '';

  try {
    const data = JSON.parse(text) as JsonValue;
    if (result.isError) {
      const errorCode =
        data && typeof data === 'object' && 'error' in data
          ? String((data as { error?: string }).error ?? 'UNKNOWN')
          : 'UNKNOWN';
      const message =
        data && typeof data === 'object' && 'message' in data
          ? String((data as { message?: string }).message ?? 'Error')
          : 'Error';
      return {
        ok: false,
        error: errorCode,
        code: errorCode,
        message,
        trace_id: traceId,
      };
    }

    return { ok: true, data };
  } catch {
    if (result.isError) {
      return {
        ok: false,
        error: 'UNKNOWN',
        code: 'UNKNOWN',
        message: text || 'Error',
        trace_id: traceId,
      };
    }

    return { ok: true, data: text };
  }
}

export function coerceQueryValue(value: string): string | number | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  const num = Number(value);
  if (!Number.isNaN(num) && value.trim() !== '') {
    return num;
  }
  return value;
}

export function parseQueryParams(url: URL): Record<string, JsonValue> {
  const params: Record<string, JsonValue> = {};
  for (const [key, value] of url.searchParams.entries()) {
    params[key] = coerceQueryValue(value);
  }
  return params;
}

function enforceHttpSecurity(
  req: http.IncomingMessage,
  options: Required<Pick<HttpServerOptions, 'host'>> & Pick<HttpServerOptions, 'allowedHosts' | 'apiToken'>
): void {
  const allowedHosts = buildAllowedHosts(options.host, options.allowedHosts);
  const hostHeader = normalizeHostHeader(req.headers.host);

  if (allowedHosts.size > 0) {
    if (!hostHeader || !allowedHosts.has(hostHeader)) {
      throw new HttpRequestError(403, 'INVALID_HOST', 'Host header is not allowed');
    }

    const originHeader = req.headers.origin;
    if (originHeader) {
      let origin: URL;
      try {
        origin = new URL(originHeader);
      } catch {
        throw new HttpRequestError(403, 'INVALID_ORIGIN', 'Origin header is invalid');
      }

      if (!allowedHosts.has(normalizeHost(origin.hostname))) {
        throw new HttpRequestError(403, 'INVALID_ORIGIN', 'Origin header is not allowed');
      }
    }
  }

  if (options.apiToken) {
    const authHeader = req.headers.authorization;
    const expected = `Bearer ${options.apiToken}`;
    if (authHeader !== expected) {
      throw new HttpRequestError(401, 'UNAUTHORIZED', 'Valid bearer token is required');
    }
  }
}

async function handleRestTool(
  db: DatabaseAdapter,
  name: string,
  args: Record<string, unknown>,
  traceId: string
): Promise<HttpResponse> {
  const result = await handleMcpRequest(db, name, args);
  return normalizeToolResult(result, traceId);
}

export function createHttpServer(db: DatabaseAdapter, options: HttpServerOptions = {}): http.Server {
  const host = options.host ?? '127.0.0.1';
  const mcpServer = new McpServer(db);

  return http.createServer(async (req, res) => {
    const traceId = getTraceId(req);

    try {
      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { ok: true, data: { status: 'ok' } }, traceId);
        return;
      }

      enforceHttpSecurity(req, {
        host,
        allowedHosts: options.allowedHosts,
        apiToken: options.apiToken,
      });

      if (method === 'GET' && url.pathname === '/v1/tools') {
        sendJson(res, 200, { ok: true, data: { tools: getMcpTools() } }, traceId);
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/tools/call') {
        const body = (await readJsonBody(req)) as { name?: string; args?: Record<string, unknown> } | undefined;
        if (!body?.name) {
          sendHttpError(res, 400, 'INVALID_INPUT', 'name is required', traceId);
          return;
        }
        const response = await handleRestTool(db, body.name, body.args ?? {}, traceId);
        sendJson(res, response.ok ? 200 : 400, response as unknown as JsonValue, traceId);
        return;
      }

      if (method === 'POST' && url.pathname === '/mcp') {
        const body = await readJsonBody(req);
        const validation = JsonRpcRequestSchema.safeParse(body);
        if (!validation.success) {
          sendJsonRpcError(res, 400, null, -32600, 'Invalid Request', traceId);
          return;
        }

        const response = await mcpServer.handleRequest(validation.data as JsonRpcRequest);
        sendJsonRpcResponse(res, 200, response, traceId);
        return;
      }

      if (method === 'GET' && url.pathname === '/mcp') {
        sendHttpError(
          res,
          501,
          'STREAM_NOT_SUPPORTED',
          'This server exposes MCP JSON-RPC over HTTP POST at /mcp. SSE streaming is not implemented.',
          traceId
        );
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/sessions/start') {
        const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
        const response = await handleRestTool(db, 'collab_session_start', body ?? {}, traceId);
        sendJson(res, response.ok ? 200 : 400, response as unknown as JsonValue, traceId);
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/sessions/end') {
        const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
        const response = await handleRestTool(db, 'collab_session_end', body ?? {}, traceId);
        sendJson(res, response.ok ? 200 : 400, response as unknown as JsonValue, traceId);
        return;
      }

      if (method === 'GET' && url.pathname === '/v1/sessions') {
        const response = await handleRestTool(db, 'collab_session_list', parseQueryParams(url), traceId);
        sendJson(res, response.ok ? 200 : 400, response as unknown as JsonValue, traceId);
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/config') {
        const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
        const response = await handleRestTool(db, 'collab_config', body ?? {}, traceId);
        sendJson(res, response.ok ? 200 : 400, response as unknown as JsonValue, traceId);
        return;
      }

      if (method === 'GET' && url.pathname === '/v1/status') {
        const response = await handleRestTool(db, 'collab_status', parseQueryParams(url), traceId);
        sendJson(res, response.ok ? 200 : 400, response as unknown as JsonValue, traceId);
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/claims') {
        const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
        const response = await handleRestTool(db, 'collab_claim', { action: 'create', ...(body ?? {}) }, traceId);
        sendJson(res, response.ok ? 200 : 400, response as unknown as JsonValue, traceId);
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/claims/check') {
        const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
        const response = await handleRestTool(db, 'collab_claim', { action: 'check', ...(body ?? {}) }, traceId);
        sendJson(res, response.ok ? 200 : 400, response as unknown as JsonValue, traceId);
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/claims/release') {
        const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
        const response = await handleRestTool(db, 'collab_claim', { action: 'release', ...(body ?? {}) }, traceId);
        sendJson(res, response.ok ? 200 : 400, response as unknown as JsonValue, traceId);
        return;
      }

      if (method === 'GET' && url.pathname === '/v1/claims') {
        const response = await handleRestTool(
          db,
          'collab_claim',
          { action: 'list', ...parseQueryParams(url) },
          traceId
        );
        sendJson(res, response.ok ? 200 : 400, response as unknown as JsonValue, traceId);
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/memory/save') {
        const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
        const response = await handleRestTool(db, 'collab_memory_save', body ?? {}, traceId);
        sendJson(res, response.ok ? 200 : 400, response as unknown as JsonValue, traceId);
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/memory/recall') {
        const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
        const response = await handleRestTool(db, 'collab_memory_recall', body ?? {}, traceId);
        sendJson(res, response.ok ? 200 : 400, response as unknown as JsonValue, traceId);
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/memory/clear') {
        const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
        const response = await handleRestTool(db, 'collab_memory_clear', body ?? {}, traceId);
        sendJson(res, response.ok ? 200 : 400, response as unknown as JsonValue, traceId);
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/protect/register') {
        const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
        const response = await handleRestTool(db, 'collab_protect', { action: 'register', ...(body ?? {}) }, traceId);
        sendJson(res, response.ok ? 200 : 400, response as unknown as JsonValue, traceId);
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/protect/check') {
        const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
        const response = await handleRestTool(db, 'collab_protect', { action: 'check', ...(body ?? {}) }, traceId);
        sendJson(res, response.ok ? 200 : 400, response as unknown as JsonValue, traceId);
        return;
      }

      if (method === 'GET' && url.pathname === '/v1/protect/list') {
        const response = await handleRestTool(
          db,
          'collab_protect',
          { action: 'list', ...parseQueryParams(url) },
          traceId
        );
        sendJson(res, response.ok ? 200 : 400, response as unknown as JsonValue, traceId);
        return;
      }

      sendHttpError(res, 404, 'NOT_FOUND', 'Not found', traceId);
    } catch (error) {
      if (error instanceof HttpRequestError) {
        sendHttpError(res, error.status, error.code, error.message, traceId);
        return;
      }

      const message = error instanceof Error ? error.message : 'Unexpected error';
      sendHttpError(res, 500, 'INTERNAL_ERROR', message, traceId);
    }
  });
}

export async function startHttpServer(
  db: DatabaseAdapter,
  options: { host: string; port: number; allowedHosts?: string[]; apiToken?: string }
): Promise<http.Server> {
  const normalizedHost = normalizeHost(options.host);

  if (!isLocalBindHost(normalizedHost)) {
    if (!options.apiToken) {
      throw new Error('Non-local HTTP binds require SESSION_COLLAB_HTTP_TOKEN');
    }

    const allowedHosts = buildAllowedHosts(normalizedHost, options.allowedHosts);
    if (allowedHosts.size === 0) {
      throw new Error('Non-local HTTP binds require at least one allowed host');
    }
  }

  const server = createHttpServer(db, options);
  await new Promise<void>((resolve, reject) => {
    server.listen(options.port, options.host, () => resolve());
    server.on('error', reject);
  });
  return server;
}
