// Protection tools tests - unified action-based interface
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, TestDatabase } from '../../db/__tests__/test-helper.js';
import { handleProtectionTool } from '../tools/protection.js';
import { createSession, registerCreatedFile, registerPlan } from '../../db/queries.js';

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
          description: 'Core authentication logic',
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.registered).toBe(true);
        expect(response.type).toBe('file');
        expect(response.file_path).toBe('src/critical.ts');
      });

      it('should validate required fields', async () => {
        const result = await handleProtectionTool(db, 'collab_protect', {
          action: 'register',
          session_id: sessionId,
          // Missing file_path and reason
        });

        expect(result.isError).toBe(true);
        const response = JSON.parse(result.content[0].text);
        expect(response.error).toBe('INVALID_INPUT');
      });

      it('should allow re-registering same file (upsert)', async () => {
        await registerCreatedFile(db, sessionId, { file_path: 'src/duplicate.ts' });

        const result = await handleProtectionTool(db, 'collab_protect', {
          action: 'register',
          session_id: sessionId,
          file_path: 'src/duplicate.ts',
          description: 'Duplicate protection',
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.registered).toBe(true);
      });

      it('should register plan protection', async () => {
        const result = await handleProtectionTool(db, 'collab_protect', {
          action: 'register',
          session_id: sessionId,
          file_path: 'docs/plan.md',
          type: 'plan',
          title: 'Refactor Plan',
          content_summary: 'Steps for refactoring core modules',
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.registered).toBe(true);
        expect(response.type).toBe('plan');
        expect(response.file_path).toBe('docs/plan.md');
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
          file_path: 'src/protected.ts',
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.protected).toBe(true);
        expect(response.reason).toBeDefined();
      });

      it('should return not protected when no protections found', async () => {
        const result = await handleProtectionTool(db, 'collab_protect', {
          action: 'check',
          session_id: sessionId,
          file_path: 'src/unprotected.ts',
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.protected).toBe(false);
      });
    });

    describe('action: list', () => {
      beforeEach(async () => {
        // Setup test protections with different priorities
        await registerCreatedFile(db, sessionId, {
          file_path: 'src/high.ts',
        });

        await registerPlan(db, sessionId, {
          file_path: 'docs/plan.md',
          title: 'Refactor Plan',
          content_summary: 'Steps for refactoring',
          status: 'in_progress',
        });
      });

      it('should list files and plans', async () => {
        const result = await handleProtectionTool(db, 'collab_protect', {
          action: 'list',
          session_id: sessionId,
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.files.length).toBe(2);
        expect(response.plan_list.length).toBe(1);
        expect(response.protected_files).toBe(2);
        expect(response.plans).toBe(1);
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
        expect(response.files).toEqual([]);
        expect(response.plan_list).toEqual([]);
        expect(response.protected_files).toBe(0);
        expect(response.plans).toBe(0);
      });
    });
  });
});
