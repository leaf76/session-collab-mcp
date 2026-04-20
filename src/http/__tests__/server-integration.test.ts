import http from 'http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, TestDatabase } from '../../db/__tests__/test-helper.js';
import { createHttpServer } from '../server.js';

const shouldRun = process.env.SESSION_COLLAB_HTTP_TESTS === 'true';

describe.runIf(shouldRun)('HTTP Server Integration', () => {
  let db: TestDatabase;
  let server: ReturnType<typeof createHttpServer>;
  let baseUrl: string;

  beforeEach(async () => {
    db = createTestDatabase();
    server = createHttpServer(db);
    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve());
      server.on('error', reject);
    });
    const address = server.address();
    if (typeof address === 'string' || address === null) {
      throw new Error('Unexpected server address');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  });

  it('should respond to health', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('should allow tool calls via HTTP', async () => {
    const res = await fetch(`${baseUrl}/v1/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'collab_session_start',
        args: { project_root: '/test', name: 'http-session' },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.session_id).toBeDefined();
  });

  it('should return trace_id on invalid input', async () => {
    const res = await fetch(`${baseUrl}/v1/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'trace-invalid-input' },
      body: JSON.stringify({ args: {} }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe('INVALID_INPUT');
    expect(body.trace_id).toBe('trace-invalid-input');
  });

  it('should return 404 for unknown routes', async () => {
    const res = await fetch(`${baseUrl}/v1/unknown`, {
      headers: { 'X-Request-ID': 'trace-not-found' },
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NOT_FOUND');
    expect(body.trace_id).toBe('trace-not-found');
  });

  it('should return 413 for oversized payloads', async () => {
    const res = await fetch(`${baseUrl}/v1/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'collab_session_start',
        args: {
          project_root: '/test',
          name: 'x'.repeat(1_000_100),
        },
      }),
    });

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.code).toBe('PAYLOAD_TOO_LARGE');
    expect(body.trace_id).toBeTruthy();
  });

  it('should reject invalid host headers', async () => {
    const body = await new Promise<{ statusCode: number; payload: string }>((resolve, reject) => {
      const req = http.request(
        `${baseUrl}/v1/tools`,
        {
          method: 'GET',
          headers: { Host: 'evil.example' },
        },
        (res) => {
          let payload = '';
          res.on('data', (chunk) => {
            payload += chunk;
          });
          res.on('end', () => {
            resolve({ statusCode: res.statusCode ?? 0, payload });
          });
        }
      );
      req.on('error', reject);
      req.end();
    });

    expect(body.statusCode).toBe(403);
    expect(JSON.parse(body.payload).code).toBe('INVALID_HOST');
  });

  it('should serve MCP JSON-RPC over POST /mcp', async () => {
    const initializeRes = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }),
    });

    expect(initializeRes.status).toBe(200);
    const initializeBody = await initializeRes.json();
    expect(initializeBody.result.protocolVersion).toBe('2024-11-05');

    const toolsRes = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      }),
    });

    expect(toolsRes.status).toBe(200);
    const toolsBody = await toolsRes.json();
    expect(Array.isArray(toolsBody.result.tools)).toBe(true);
    expect(toolsBody.result.tools.some((tool: { name: string }) => tool.name === 'collab_session_start')).toBe(true);

    const callRes = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'collab_session_start',
          arguments: { project_root: '/test', name: 'mcp-http' },
        },
      }),
    });

    expect(callRes.status).toBe(200);
    const callBody = await callRes.json();
    expect(callBody.result.content[0].text).toContain('session_id');
  });
});
