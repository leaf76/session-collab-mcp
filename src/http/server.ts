import http from 'http';
import { URL } from 'url';
import type { DatabaseAdapter } from '../db/sqlite-adapter.js';
import type { McpToolResult } from '../mcp/protocol.js';
import { getMcpTools, handleMcpRequest } from '../mcp/server.js';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type HttpResponse = {
  ok: boolean;
  data?: JsonValue;
  error?: { code: string; message: string };
};

function sendJson(res: http.ServerResponse, status: number, body: HttpResponse): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function parseBody(req: http.IncomingMessage): Promise<JsonValue | undefined> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!data) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(data) as JsonValue);
      } catch (error) {
        reject(error);
      }
    });
  });
}

export function normalizeToolResult(result: McpToolResult): HttpResponse {
  const text = result.content?.[0]?.text ?? '';
  try {
    const data = JSON.parse(text) as JsonValue;
    if (result.isError) {
      const errorCode = (data && typeof data === 'object' && 'error' in data)
        ? String((data as { error?: string }).error ?? 'UNKNOWN')
        : 'UNKNOWN';
      const message = (data && typeof data === 'object' && 'message' in data)
        ? String((data as { message?: string }).message ?? 'Error')
        : 'Error';
      return { ok: false, error: { code: errorCode, message } };
    }
    return { ok: true, data };
  } catch {
    if (result.isError) {
      return { ok: false, error: { code: 'UNKNOWN', message: text || 'Error' } };
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

async function handleTool(
  db: DatabaseAdapter,
  name: string,
  args: Record<string, unknown>
): Promise<HttpResponse> {
  const result = await handleMcpRequest(db, name, args);
  return normalizeToolResult(result);
}

export function createHttpServer(db: DatabaseAdapter): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { ok: true, data: { status: 'ok' } });
        return;
      }

      if (method === 'GET' && url.pathname === '/v1/tools') {
        sendJson(res, 200, { ok: true, data: { tools: getMcpTools() } });
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/tools/call') {
        const body = (await parseBody(req)) as { name?: string; args?: Record<string, unknown> } | undefined;
        if (!body?.name) {
          sendJson(res, 400, { ok: false, error: { code: 'INVALID_INPUT', message: 'name is required' } });
          return;
        }
        const response = await handleTool(db, body.name, body.args ?? {});
        sendJson(res, response.ok ? 200 : 400, response);
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/sessions/start') {
        const body = (await parseBody(req)) as Record<string, unknown>;
        const response = await handleTool(db, 'collab_session_start', body ?? {});
        sendJson(res, response.ok ? 200 : 400, response);
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/sessions/end') {
        const body = (await parseBody(req)) as Record<string, unknown>;
        const response = await handleTool(db, 'collab_session_end', body ?? {});
        sendJson(res, response.ok ? 200 : 400, response);
        return;
      }

      if (method === 'GET' && url.pathname === '/v1/sessions') {
        const args = parseQueryParams(url);
        const response = await handleTool(db, 'collab_session_list', args);
        sendJson(res, response.ok ? 200 : 400, response);
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/config') {
        const body = (await parseBody(req)) as Record<string, unknown>;
        const response = await handleTool(db, 'collab_config', body ?? {});
        sendJson(res, response.ok ? 200 : 400, response);
        return;
      }

      if (method === 'GET' && url.pathname === '/v1/status') {
        const args = parseQueryParams(url);
        const response = await handleTool(db, 'collab_status', args);
        sendJson(res, response.ok ? 200 : 400, response);
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/claims') {
        const body = (await parseBody(req)) as Record<string, unknown>;
        const response = await handleTool(db, 'collab_claim', { action: 'create', ...(body ?? {}) });
        sendJson(res, response.ok ? 200 : 400, response);
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/claims/check') {
        const body = (await parseBody(req)) as Record<string, unknown>;
        const response = await handleTool(db, 'collab_claim', { action: 'check', ...(body ?? {}) });
        sendJson(res, response.ok ? 200 : 400, response);
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/claims/release') {
        const body = (await parseBody(req)) as Record<string, unknown>;
        const response = await handleTool(db, 'collab_claim', { action: 'release', ...(body ?? {}) });
        sendJson(res, response.ok ? 200 : 400, response);
        return;
      }

      if (method === 'GET' && url.pathname === '/v1/claims') {
        const args = parseQueryParams(url);
        const response = await handleTool(db, 'collab_claim', { action: 'list', ...args });
        sendJson(res, response.ok ? 200 : 400, response);
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/memory/save') {
        const body = (await parseBody(req)) as Record<string, unknown>;
        const response = await handleTool(db, 'collab_memory_save', body ?? {});
        sendJson(res, response.ok ? 200 : 400, response);
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/memory/recall') {
        const body = (await parseBody(req)) as Record<string, unknown>;
        const response = await handleTool(db, 'collab_memory_recall', body ?? {});
        sendJson(res, response.ok ? 200 : 400, response);
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/memory/clear') {
        const body = (await parseBody(req)) as Record<string, unknown>;
        const response = await handleTool(db, 'collab_memory_clear', body ?? {});
        sendJson(res, response.ok ? 200 : 400, response);
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/protect/register') {
        const body = (await parseBody(req)) as Record<string, unknown>;
        const response = await handleTool(db, 'collab_protect', { action: 'register', ...(body ?? {}) });
        sendJson(res, response.ok ? 200 : 400, response);
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/protect/check') {
        const body = (await parseBody(req)) as Record<string, unknown>;
        const response = await handleTool(db, 'collab_protect', { action: 'check', ...(body ?? {}) });
        sendJson(res, response.ok ? 200 : 400, response);
        return;
      }

      if (method === 'GET' && url.pathname === '/v1/protect/list') {
        const args = parseQueryParams(url);
        const response = await handleTool(db, 'collab_protect', { action: 'list', ...args });
        sendJson(res, response.ok ? 200 : 400, response);
        return;
      }

      sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error';
      sendJson(res, 500, { ok: false, error: { code: 'INTERNAL_ERROR', message } });
    }
  });
}

export async function startHttpServer(
  db: DatabaseAdapter,
  options: { host: string; port: number }
): Promise<http.Server> {
  const server = createHttpServer(db);
  await new Promise<void>((resolve, reject) => {
    server.listen(options.port, options.host, () => resolve());
    server.on('error', reject);
  });
  return server;
}
