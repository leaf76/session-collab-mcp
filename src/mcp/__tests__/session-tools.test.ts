// Session tools tests - testing collab_session_end (simplified response format)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, TestDatabase } from '../../db/__tests__/test-helper.js';
import { handleSessionTool } from '../tools/session.js';
import { createSession, createClaim, listClaims } from '../../db/queries.js';

describe('Session Tools', () => {
  let db: TestDatabase;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(() => {
    db.close();
  });

  describe('collab_session_start', () => {
    it('should start session successfully', async () => {
      const result = await handleSessionTool(db, 'collab_session_start', {
        project_root: '/test/project',
        name: 'test-session',
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);
      expect(response.session_id).toBeDefined();
      expect(response.message).toContain('started');
    });

    it('should validate required project_root', async () => {
      const result = await handleSessionTool(db, 'collab_session_start', {
        name: 'test-session',
        // Missing project_root
      });

      expect(result.isError).toBe(true);
      const response = JSON.parse(result.content[0].text);
      expect(response.error).toBe('INVALID_INPUT');
    });
  });

  describe('collab_session_list', () => {
    beforeEach(async () => {
      // Create test sessions
      await createSession(db, {
        project_root: '/test/project',
        name: 'session1',
      });

      await createSession(db, {
        project_root: '/test/project',
        name: 'session2',
      });
    });

    it('should list active sessions', async () => {
      const result = await handleSessionTool(db, 'collab_session_list', {});

      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);
      expect(response.sessions).toHaveLength(2);
      expect(response.total).toBe(2);
    });

    it('should include inactive sessions when requested', async () => {
      const result = await handleSessionTool(db, 'collab_session_list', {
        include_inactive: true,
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);
      expect(response.sessions.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('collab_config', () => {
    let sessionId: string;

    beforeEach(async () => {
      const session = await createSession(db, {
        project_root: '/test/project',
        name: 'test-session',
      });
      sessionId = session.id;
    });

    it('should update session config', async () => {
      const result = await handleSessionTool(db, 'collab_config', {
        session_id: sessionId,
        mode: 'smart',
        allow_release_others: true,
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);

      expect(response.config.mode).toBe('smart');
      expect(response.config.allow_release_others).toBe(true);
    });

    it('should return error for invalid session', async () => {
      const result = await handleSessionTool(db, 'collab_config', {
        session_id: 'invalid-session',
        mode: 'smart',
      });

      expect(result.isError).toBe(true);
      const response = JSON.parse(result.content[0].text);
      expect(response.error).toBe('SESSION_NOT_FOUND');
    });
  });

  describe('collab_status', () => {
    let sessionId: string;

    beforeEach(async () => {
      const session = await createSession(db, {
        project_root: '/test/project',
        name: 'test-session',
      });
      sessionId = session.id;

      // Add a claim
      await createClaim(db, {
        session_id: sessionId,
        files: ['src/test.ts'],
        intent: 'Test work',
        scope: 'small',
      });
    });

    it('should return session status', async () => {
      const result = await handleSessionTool(db, 'collab_status', {
        session_id: sessionId,
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);
      expect(response.session.id).toBe(sessionId);
      expect(response.claims).toHaveLength(1);
      expect(response.message).toContain('1 claim(s)');
    });

    it('should return error for missing session_id', async () => {
      const result = await handleSessionTool(db, 'collab_status', {});

      expect(result.isError).toBe(true);
      const response = JSON.parse(result.content[0].text);
      expect(response.error).toBe('INVALID_INPUT');
    });
  });

  describe('collab_session_end', () => {
    it('should return claims_released count when session has active claims', async () => {
      // Arrange: Create session with claims
      const session = await createSession(db, {
        project_root: '/test/project',
        name: 'test-session',
      });

      await createClaim(db, {
        session_id: session.id,
        files: ['src/file1.ts', 'src/file2.ts'],
        intent: 'Testing feature',
        scope: 'small',
      });

      await createClaim(db, {
        session_id: session.id,
        files: ['README.md'],
        intent: 'Updating docs',
        scope: 'small',
      });

      // Verify claims are active before ending
      const claimsBefore = await listClaims(db, { session_id: session.id, status: 'active' });
      expect(claimsBefore).toHaveLength(2);

      // Act: End session
      const result = await handleSessionTool(db, 'collab_session_end', {
        session_id: session.id,
        release_claims: 'complete',
      });

      // Assert: Check result structure (simplified format)
      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(true);
      expect(response.message).toContain('2 claim(s) released');
      expect(response.claims_released).toBe(2);
    });

    it('should return claims_released as 0 when session has no active claims', async () => {
      // Arrange: Create session without claims
      const session = await createSession(db, {
        project_root: '/test/project',
        name: 'test-session',
      });

      // Act: End session
      const result = await handleSessionTool(db, 'collab_session_end', {
        session_id: session.id,
        release_claims: 'complete',
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(true);
      expect(response.message).toContain('0 claim(s)');
      expect(response.claims_released).toBe(0);
    });

    it('should release claims when release_claims is abandon', async () => {
      // Arrange
      const session = await createSession(db, {
        project_root: '/test/project',
        name: 'test-session',
      });

      await createClaim(db, {
        session_id: session.id,
        files: ['src/incomplete.ts'],
        intent: 'Incomplete work',
        scope: 'medium',
      });

      // Act
      const result = await handleSessionTool(db, 'collab_session_end', {
        session_id: session.id,
        release_claims: 'abandon',
      });

      // Assert
      const response = JSON.parse(result.content[0].text);
      expect(response.claims_released).toBe(1);
      expect(response.success).toBe(true);
    });

    it('should track memories_saved count', async () => {
      // Arrange
      const session = await createSession(db, {
        project_root: '/test/project',
        name: 'test-session',
      });

      // Act
      const result = await handleSessionTool(db, 'collab_session_end', {
        session_id: session.id,
        release_claims: 'complete',
      });

      // Assert
      const response = JSON.parse(result.content[0].text);
      expect(response).toHaveProperty('memories_saved');
      expect(typeof response.memories_saved).toBe('number');
    });

    it('should return error for non-existent session', async () => {
      // Act
      const result = await handleSessionTool(db, 'collab_session_end', {
        session_id: 'non-existent-id',
        release_claims: 'complete',
      });

      // Assert
      expect(result.isError).toBe(true);
      const response = JSON.parse(result.content[0].text);
      expect(response.error).toBe('SESSION_NOT_FOUND');
    });
  });
});
