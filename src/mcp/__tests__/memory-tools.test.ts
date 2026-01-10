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
      expect(response.success).toBe(true);
      expect(response.memory_id).toBeDefined();
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
      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.updated).toBe(true);
    });

    it('should validate required fields', async () => {
      const result = await handleMemoryTool(db, 'collab_memory_save', {
        session_id: sessionId,
        // Missing required fields
      });

      expect(result.isError).toBe(true);
      const response = JSON.parse(result.content[0].text);
      expect(response.error).toBe('VALIDATION_ERROR');
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
        priority_threshold: 60,
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);
      expect(response.memories.length).toBeGreaterThan(0);
      expect(response.total).toBeDefined();
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
      expect(response.success).toBe(true);
      expect(response.cleared_count).toBe(1);
    });

    it('should clear memories below priority threshold', async () => {
      const result = await handleMemoryTool(db, 'collab_memory_clear', {
        session_id: sessionId,
        priority_threshold: 35,
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);
      expect(response.cleared_count).toBe(1);
    });

    it('should clear specific memory by key', async () => {
      const result = await handleMemoryTool(db, 'collab_memory_clear', {
        session_id: sessionId,
        key: 'temp1',
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.cleared_count).toBe(1);
    });

    it('should clear all memories when no filters provided', async () => {
      const result = await handleMemoryTool(db, 'collab_memory_clear', {
        session_id: sessionId,
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.cleared_count).toBe(2);
    });
  });
});
