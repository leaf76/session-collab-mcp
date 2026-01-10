// Claim tools tests - unified action-based interface
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, TestDatabase } from '../../db/__tests__/test-helper.js';
import { handleClaimTool } from '../tools/claim.js';
import { createSession, createClaim } from '../../db/queries.js';

describe('Claim Tools', () => {
  let db: TestDatabase;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(() => {
    db.close();
  });

  describe('collab_claim', () => {
    let sessionId: string;

    beforeEach(async () => {
      const session = await createSession(db, {
        project_root: '/test/project',
        name: 'test-session',
      });
      sessionId = session.id;
    });

    describe('action: create', () => {
      it('should create a claim successfully', async () => {
        const result = await handleClaimTool(db, 'collab_claim', {
          action: 'create',
          session_id: sessionId,
          files: ['src/file.ts'],
          intent: 'Fix bug in authentication',
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.claim_id).toBeDefined();
      });

      it('should return error for invalid session', async () => {
        const result = await handleClaimTool(db, 'collab_claim', {
          action: 'create',
          session_id: 'invalid-session',
          files: ['src/file.ts'],
          intent: 'Test',
        });

        expect(result.isError).toBe(true);
        const response = JSON.parse(result.content[0].text);
        expect(response.error).toBe('SESSION_NOT_FOUND');
      });
    });

    describe('action: check', () => {
      it('should return no conflicts for unclaimed files', async () => {
        const result = await handleClaimTool(db, 'collab_claim', {
          action: 'check',
          session_id: sessionId,
          files: ['src/unclaimed.ts'],
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.conflicts).toEqual([]);
        expect(response.safe).toBe(true);
      });

      it('should detect conflicts for claimed files', async () => {
        // First, create a claim
        await createClaim(db, {
          session_id: sessionId,
          files: ['src/claimed.ts'],
          intent: 'Original work',
          scope: 'small',
        });

        // Check for conflicts
        const result = await handleClaimTool(db, 'collab_claim', {
          action: 'check',
          session_id: sessionId,
          files: ['src/claimed.ts'],
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.conflicts).toHaveLength(1);
        expect(response.safe).toBe(false);
      });
    });

    describe('action: release', () => {
      it('should release own claim successfully', async () => {
        // Create a claim first
        const claim = await createClaim(db, {
          session_id: sessionId,
          files: ['src/to-release.ts'],
          intent: 'Work to release',
          scope: 'small',
        });

        const result = await handleClaimTool(db, 'collab_claim', {
          action: 'release',
          session_id: sessionId,
          claim_id: claim.claim.id,
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.message).toContain('released');
      });

      it('should return error when releasing non-existent claim', async () => {
        const result = await handleClaimTool(db, 'collab_claim', {
          action: 'release',
          session_id: sessionId,
          claim_id: 'non-existent-claim',
        });

        expect(result.isError).toBe(true);
        const response = JSON.parse(result.content[0].text);
        expect(response.error).toBe('CLAIM_NOT_FOUND');
      });
    });

    describe('action: list', () => {
      it('should list active claims', async () => {
        // Create multiple claims
        await createClaim(db, {
          session_id: sessionId,
          files: ['src/file1.ts'],
          intent: 'Work 1',
          scope: 'small',
        });

        await createClaim(db, {
          session_id: sessionId,
          files: ['src/file2.ts'],
          intent: 'Work 2',
          scope: 'small',
        });

        const result = await handleClaimTool(db, 'collab_claim', {
          action: 'list',
          session_id: sessionId,
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.claims).toHaveLength(2);
        expect(response.total).toBe(2);
      });

      it('should return empty list when no claims exist', async () => {
        const result = await handleClaimTool(db, 'collab_claim', {
          action: 'list',
          session_id: sessionId,
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.claims).toEqual([]);
        expect(response.total).toBe(0);
      });
    });
  });
});
