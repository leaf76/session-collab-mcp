// Protection tools tests - unified action-based interface
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, TestDatabase } from '../../db/__tests__/test-helper.js';
import { handleProtectionTool } from '../tools/protection.js';
import { createSession, registerCreatedFile } from '../../db/queries.js';

describe('Protection Tools', () => {
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

  describe('collab_protect', () => {
    describe('action: register', () => {
      it('should register protection successfully', async () => {
        const result = await handleProtectionTool(db, 'collab_protect', {
          action: 'register',
          session_id: sessionId,
          file_path: 'src/critical.ts',
          reason: 'Core authentication logic',
          priority: 90,
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.protection_id).toBeDefined();
      });

      it('should validate required fields', async () => {
        const result = await handleProtectionTool(db, 'collab_protect', {
          action: 'register',
          session_id: sessionId,
          // Missing file_path and reason
        });

        expect(result.isError).toBe(true);
        const response = JSON.parse(result.content[0].text);
        expect(response.error).toBe('VALIDATION_ERROR');
      });

      it('should not allow duplicate protection for same file', async () => {
        // Register first protection
        await registerCreatedFile(db, sessionId, {
          file_path: 'src/duplicate.ts',
        });

        // Try to register again
        const result = await handleProtectionTool(db, 'collab_protect', {
          action: 'register',
          session_id: sessionId,
          file_path: 'src/duplicate.ts',
          reason: 'Duplicate protection',
          priority: 70,
        });

        expect(result.isError).toBe(true);
        const response = JSON.parse(result.content[0].text);
        expect(response.error).toBe('PROTECTION_EXISTS');
      });
    });

    describe('action: check', () => {
      beforeEach(async () => {
        // Setup test protections
        await registerCreatedFile(db, sessionId, {
          file_path: 'src/protected.ts',
        });
      });

      it('should detect protected files', async () => {
        const result = await handleProtectionTool(db, 'collab_protect', {
          action: 'check',
          session_id: sessionId,
          file_paths: ['src/protected.ts', 'src/unprotected.ts'],
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.protections).toHaveLength(1);
        expect(response.protections[0].file_path).toBe('src/protected.ts');
        expect(response.safe).toBe(false);
      });

      it('should return safe when no protections found', async () => {
        const result = await handleProtectionTool(db, 'collab_protect', {
          action: 'check',
          session_id: sessionId,
          file_paths: ['src/unprotected.ts', 'src/also-safe.ts'],
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.protections).toEqual([]);
        expect(response.safe).toBe(true);
      });

      it('should check single file protection', async () => {
        const result = await handleProtectionTool(db, 'collab_protect', {
          action: 'check',
          session_id: sessionId,
          file_paths: ['src/protected.ts'],
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.protections).toHaveLength(1);
        expect(response.blocked).toBe(true);
      });
    });

    describe('action: list', () => {
      beforeEach(async () => {
        // Setup test protections with different priorities
        await registerCreatedFile(db, sessionId, {
          file_path: 'src/high.ts',
        });

        await registerCreatedFile(db, sessionId, {
          file_path: 'src/low.ts',
        });
      });

      it('should list all protections', async () => {
        const result = await handleProtectionTool(db, 'collab_protect', {
          action: 'list',
          session_id: sessionId,
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.protections).toHaveLength(2);
        expect(response.total).toBe(2);
      });

      it('should filter by priority threshold', async () => {
        const result = await handleProtectionTool(db, 'collab_protect', {
          action: 'list',
          session_id: sessionId,
          priority_threshold: 50,
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.protections).toHaveLength(1);
        expect(response.protections[0].file_path).toBe('src/high.ts');
      });

      it('should return empty list when no protections exist', async () => {
        // Use different session with no protections
        const otherSession = await createSession(db, {
          project_root: '/test/project',
          name: 'other-session',
        });

        const result = await handleProtectionTool(db, 'collab_protect', {
          action: 'list',
          session_id: otherSession.id,
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.protections).toEqual([]);
        expect(response.total).toBe(0);
      });
    });
  });
});
