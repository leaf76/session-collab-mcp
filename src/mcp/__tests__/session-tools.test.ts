// Session tools tests - specifically testing collab_session_end claims_released feature
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

  describe('collab_session_end', () => {
    it('should return claims_released with details when session has active claims', async () => {
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

      // Assert: Check result structure
      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(true);
      expect(response.message).toContain('2 claim(s) marked as completed');
      expect(response.claims_released).toBeDefined();
      expect(response.claims_released.count).toBe(2);
      expect(response.claims_released.status).toBe('completed');
      expect(response.claims_released.details).toHaveLength(2);

      // Verify details structure
      const detail = response.claims_released.details[0];
      expect(detail).toHaveProperty('id');
      expect(detail).toHaveProperty('files');
      expect(detail).toHaveProperty('intent');
      expect(detail).toHaveProperty('scope');
      expect(detail).toHaveProperty('created_at');
    });

    it('should return claims_released as null when session has no active claims', async () => {
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
      expect(response.claims_released).toBeNull();
    });

    it('should mark claims as abandoned when release_claims is abandon', async () => {
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
      expect(response.claims_released.status).toBe('abandoned');
      expect(response.message).toContain('abandoned');
    });

    it('should include correct file paths in claims_released details', async () => {
      // Arrange
      const session = await createSession(db, {
        project_root: '/test/project',
        name: 'test-session',
      });

      const expectedFiles = ['src/auth/login.ts', 'src/auth/logout.ts', 'src/utils/helpers.ts'];
      await createClaim(db, {
        session_id: session.id,
        files: expectedFiles,
        intent: 'Auth refactoring',
        scope: 'large',
      });

      // Act
      const result = await handleSessionTool(db, 'collab_session_end', {
        session_id: session.id,
        release_claims: 'complete',
      });

      // Assert
      const response = JSON.parse(result.content[0].text);
      const detail = response.claims_released.details[0];

      expect(detail.files).toEqual(expect.arrayContaining(expectedFiles));
      expect(detail.files).toHaveLength(expectedFiles.length);
      expect(detail.intent).toBe('Auth refactoring');
      expect(detail.scope).toBe('large');
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
