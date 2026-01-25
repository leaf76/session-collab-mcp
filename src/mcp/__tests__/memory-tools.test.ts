// Memory tools tests - simplified 3-tool interface
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, TestDatabase } from '../../db/__tests__/test-helper.js';
import { handleMemoryTool } from '../tools/memory.js';
import { createSession, saveMemory } from '../../db/queries.js';

describe('Memory Tools', () => {
  let db: TestDatabase;
  let sessionId: string;

  beforeEach(async () => {
    db = createTestDatabase();
    const session = await createSession(db, {
      project_root: '/test/project',
      name: 'test-session',
    });
    sessionId = session.id;
  });

  afterEach(() => {
    db.close();
  });

  describe('collab_memory_save', () => {
    it('should save memory successfully', async () => {
      const result = await handleMemoryTool(db, 'collab_memory_save', {
        session_id: sessionId,
        category: 'finding',
        key: 'auth_bug_root_cause',
        content: 'Authentication fails due to missing token validation',
        priority: 80,
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);
      expect(response.saved).toBe(true);
      expect(response.id).toBeDefined();
    });

    it('should update existing memory (upsert)', async () => {
      // Create initial memory
      await saveMemory(db, sessionId, {
        category: 'finding',
        key: 'test_key',
        content: 'Initial content',
        priority: 50,
      });

      // Update it
      const result = await handleMemoryTool(db, 'collab_memory_save', {
        session_id: sessionId,
        category: 'finding',
        key: 'test_key',
        content: 'Updated content',
        priority: 90,
      });

      expect(result.isError).toBeFalsy();
      const recall = await handleMemoryTool(db, 'collab_memory_recall', {
        session_id: sessionId,
        key: 'test_key',
      });
      const response = JSON.parse(recall.content[0].text);
      expect(response.memories).toHaveLength(1);
      expect(response.memories[0].content).toBe('Updated content');
    });

    it('should validate required fields', async () => {
      const result = await handleMemoryTool(db, 'collab_memory_save', {
        session_id: sessionId,
        // Missing required fields
      });

      expect(result.isError).toBe(true);
      const response = JSON.parse(result.content[0].text);
      expect(response.error).toBe('INVALID_INPUT');
    });
  });

  describe('collab_memory_recall', () => {
    beforeEach(async () => {
      // Setup test memories
      await saveMemory(db, sessionId, {
        category: 'finding',
        key: 'bug1',
        content: 'Authentication bug',
        priority: 90,
      });

      await saveMemory(db, sessionId, {
        category: 'decision',
        key: 'approach1',
        content: 'Use JWT for auth',
        priority: 70,
      });
    });

    it('should recall memories by category', async () => {
      const result = await handleMemoryTool(db, 'collab_memory_recall', {
        session_id: sessionId,
        category: 'finding',
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);
      expect(response.memories).toHaveLength(1);
      expect(response.memories[0].key).toBe('bug1');
    });

    it('should recall active memories when active=true', async () => {
      const result = await handleMemoryTool(db, 'collab_memory_recall', {
        session_id: sessionId,
        active: true,
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);
      expect(response.count).toBeGreaterThan(0);
      expect(response.by_category).toBeDefined();
    });

    it('should exclude low-priority unpinned memories from active recall', async () => {
      await saveMemory(db, sessionId, {
        category: 'context',
        key: 'low_priority',
        content: 'Low priority context',
        priority: 10,
        pinned: false,
      });

      const result = await handleMemoryTool(db, 'collab_memory_recall', {
        session_id: sessionId,
        active: true,
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);
      const byCategory = response.by_category ?? {};
      const contextItems = byCategory.context ?? [];
      expect(contextItems.find((m: { key: string }) => m.key === 'low_priority')).toBeUndefined();
    });

    it('should recall memory by key', async () => {
      const result = await handleMemoryTool(db, 'collab_memory_recall', {
        session_id: sessionId,
        key: 'bug1',
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);
      expect(response.memories).toHaveLength(1);
      expect(response.memories[0].content).toBe('Authentication bug');
    });
  });

  describe('collab_memory_clear', () => {
    beforeEach(async () => {
      // Setup test memories
      await saveMemory(db, sessionId, {
        category: 'finding',
        key: 'temp1',
        content: 'Temporary finding',
        priority: 30,
      });

      await saveMemory(db, sessionId, {
        category: 'state',
        key: 'temp2',
        content: 'Temporary state',
        priority: 40,
      });
    });

    it('should clear memories by category', async () => {
      const result = await handleMemoryTool(db, 'collab_memory_clear', {
        session_id: sessionId,
        category: 'finding',
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);
      expect(response.cleared).toBe(1);
    });

    it('should require filter or clear_all', async () => {
      const result = await handleMemoryTool(db, 'collab_memory_clear', {
        session_id: sessionId,
      });

      expect(result.isError).toBe(true);
      const response = JSON.parse(result.content[0].text);
      expect(response.error).toBe('INVALID_INPUT');
    });

    it('should clear specific memory by key', async () => {
      const result = await handleMemoryTool(db, 'collab_memory_clear', {
        session_id: sessionId,
        key: 'temp1',
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);
      expect(response.cleared).toBe(1);
    });

    it('should clear all memories when clear_all is true', async () => {
      const result = await handleMemoryTool(db, 'collab_memory_clear', {
        session_id: sessionId,
        clear_all: true,
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);
      expect(response.cleared).toBe(2);
    });
  });
});
