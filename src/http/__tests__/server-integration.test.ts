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
});
