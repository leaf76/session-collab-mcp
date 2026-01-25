import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, TestDatabase } from '../../db/__tests__/test-helper.js';
import { createSession } from '../../db/queries.js';
import {
  sendMessage,
  messageSendSchema,
  notificationListSchema,
} from '../legacy-entry.js';

describe('Legacy Entry', () => {
  let db: TestDatabase;
  let sessionId: string;

  beforeEach(async () => {
    db = createTestDatabase();
    const session = await createSession(db, { project_root: '/test' });
    sessionId = session.id;
  });

  afterEach(() => {
    db.close();
  });

  it('should expose legacy query functions', async () => {
    expect(typeof sendMessage).toBe('function');

    const message = await sendMessage(db, {
      from_session_id: sessionId,
      content: 'legacy',
    });

    expect(message.id).toBeDefined();
    expect(message.content).toBe('legacy');
  });

  it('should expose legacy schemas', () => {
    const result = messageSendSchema.safeParse({
      from_session_id: 's1',
      content: 'hello',
    });
    expect(result.success).toBe(true);

    const listResult = notificationListSchema.safeParse({
      session_id: 's1',
    });
    expect(listResult.success).toBe(true);
  });
});
