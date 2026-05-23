// Claim tools tests - unified action-based interface
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, TestDatabase } from '../../db/__tests__/test-helper.js';
import { handleClaimTool } from '../tools/claim.js';
import { createSession, createClaim, getClaim } from '../../db/queries.js';
import { handleSessionTool } from '../tools/session.js';

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

      it('should block claim creation in strict mode when another active session has a conflict', async () => {
        const otherSession = await createSession(db, {
          project_root: '/test/project',
          name: 'other-session',
        });

        await handleSessionTool(db, 'collab_config', {
          session_id: sessionId,
          mode: 'strict',
        });

        await createClaim(db, {
          session_id: otherSession.id,
          files: ['src/conflict.ts'],
          intent: 'Other active work',
          scope: 'small',
        });

        const result = await handleClaimTool(db, 'collab_claim', {
          action: 'create',
          session_id: sessionId,
          files: ['src/conflict.ts'],
          intent: 'Conflicting work',
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(false);
        expect(response.status).toBe('blocked_by_conflicts');
        expect(response.claim_id).toBeUndefined();

        const list = await handleClaimTool(db, 'collab_claim', {
          action: 'list',
          session_id: otherSession.id,
          project_root: '/test/project',
        });
        const listResponse = JSON.parse(list.content[0].text);
        expect(listResponse.claims).toHaveLength(1);
        expect(listResponse.claims[0].session_name).toBe('other-session');
      });

      it('should wait for coordination in smart mode when the same symbol is claimed', async () => {
        const otherSession = await createSession(db, {
          project_root: '/test/project',
          name: 'owner-session',
        });

        await handleSessionTool(db, 'collab_session_update', {
          session_id: otherSession.id,
          current_task: 'Editing validateToken',
        });

        await createClaim(db, {
          session_id: otherSession.id,
          files: ['src/auth.ts'],
          symbols: [{ file: 'src/auth.ts', symbols: ['validateToken'], symbol_type: 'function' }],
          intent: 'Update token validation',
          scope: 'small',
        });

        const result = await handleClaimTool(db, 'collab_claim', {
          action: 'create',
          session_id: sessionId,
          symbols: [{ file: 'src/auth.ts', symbols: ['validateToken'], symbol_type: 'function' }],
          intent: 'Refactor token validation',
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(false);
        expect(response.status).toBe('waiting_for_coordination');
        expect(response.claim_id).toBeUndefined();
        expect(response.safe_files).toEqual([]);
        expect(response.blocked_files).toEqual(['src/auth.ts']);
        expect(response.conflicts[0]).toMatchObject({
          session_id: otherSession.id,
          session_name: 'owner-session',
          file: 'src/auth.ts',
          symbol_name: 'validateToken',
          current_task: 'Editing validateToken',
        });
        expect(response.coordination_requests).toHaveLength(1);
        expect(response.coordination_requests[0]).toMatchObject({
          owner_session_id: otherSession.id,
          requested_by_session_id: sessionId,
          files: ['src/auth.ts'],
        });
      });

      it('should create a symbol claim in smart mode when symbols do not overlap', async () => {
        const otherSession = await createSession(db, {
          project_root: '/test/project',
          name: 'owner-session',
        });

        await createClaim(db, {
          session_id: otherSession.id,
          files: ['src/auth.ts'],
          symbols: [{ file: 'src/auth.ts', symbols: ['validateToken'], symbol_type: 'function' }],
          intent: 'Update token validation',
          scope: 'small',
        });

        const result = await handleClaimTool(db, 'collab_claim', {
          action: 'create',
          session_id: sessionId,
          symbols: [{ file: 'src/auth.ts', symbols: ['refreshToken'], symbol_type: 'function' }],
          intent: 'Update refresh token',
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.status).toBe('created');
        expect(response.claim_id).toBeDefined();
        expect(response.claimed_files).toEqual(['src/auth.ts']);
        expect(response.blocked_files).toEqual([]);
      });

      it('should ask for narrower symbols or wait when a file-level claim blocks a symbol claim', async () => {
        const otherSession = await createSession(db, {
          project_root: '/test/project',
          name: 'owner-session',
        });

        await createClaim(db, {
          session_id: otherSession.id,
          files: ['src/auth.ts'],
          intent: 'Broad auth refactor',
          scope: 'medium',
        });

        const result = await handleClaimTool(db, 'collab_claim', {
          action: 'create',
          session_id: sessionId,
          symbols: [{ file: 'src/auth.ts', symbols: ['refreshToken'], symbol_type: 'function' }],
          intent: 'Update refresh token',
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(false);
        expect(response.status).toBe('waiting_for_coordination');
        expect(response.recommendation).toBe('provide_symbols_or_wait');
        expect(response.coordination_requests).toHaveLength(1);
      });

      it('should partially claim safe files in smart mode and queue blocked files', async () => {
        const otherSession = await createSession(db, {
          project_root: '/test/project',
          name: 'owner-session',
        });

        await createClaim(db, {
          session_id: otherSession.id,
          files: ['src/blocked.ts'],
          intent: 'Edit blocked file',
          scope: 'small',
        });

        const result = await handleClaimTool(db, 'collab_claim', {
          action: 'create',
          session_id: sessionId,
          files: ['src/safe.ts', 'src/blocked.ts'],
          intent: 'Edit mixed files',
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.status).toBe('partial_claim_created');
        expect(response.claim_id).toBeDefined();
        expect(response.claimed_files).toEqual(['src/safe.ts']);
        expect(response.safe_files).toEqual(['src/safe.ts']);
        expect(response.blocked_files).toEqual(['src/blocked.ts']);
        expect(response.coordination_requests).toHaveLength(1);

        const claim = await getClaim(db, response.claim_id);
        expect(claim?.files).toEqual(['src/safe.ts']);
      });

      it('should allow explicit conflict claim creation in bypass mode when allow_conflicts is true', async () => {
        const otherSession = await createSession(db, {
          project_root: '/test/project',
          name: 'other-session',
        });

        await handleSessionTool(db, 'collab_config', {
          session_id: sessionId,
          mode: 'bypass',
        });

        await createClaim(db, {
          session_id: otherSession.id,
          files: ['src/force-conflict.ts'],
          intent: 'Other active work',
          scope: 'small',
        });

        const result = await handleClaimTool(db, 'collab_claim', {
          action: 'create',
          session_id: sessionId,
          files: ['src/force-conflict.ts'],
          intent: 'Explicitly coordinated conflicting work',
          allow_conflicts: true,
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.status).toBe('created_with_conflicts');
        expect(response.claim_id).toBeDefined();
      });

      it('should reject unsafe file paths', async () => {
        const result = await handleClaimTool(db, 'collab_claim', {
          action: 'create',
          session_id: sessionId,
          files: ['../secrets.txt'],
          intent: 'Test unsafe path',
        });

        expect(result.isError).toBe(true);
        const response = JSON.parse(result.content[0].text);
        expect(response.error).toBe('INVALID_INPUT');
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
        expect(response.has_conflicts).toBe(false);
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
          exclude_self: false,
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.conflicts).toHaveLength(1);
        expect(response.safe).toBe(false);
        expect(response.has_conflicts).toBe(true);
      });

      it('should ignore own claims by default', async () => {
        await createClaim(db, {
          session_id: sessionId,
          files: ['src/self-claimed.ts'],
          intent: 'Own work',
          scope: 'small',
        });

        const result = await handleClaimTool(db, 'collab_claim', {
          action: 'check',
          session_id: sessionId,
          files: ['src/self-claimed.ts'],
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.conflicts).toEqual([]);
        expect(response.safe).toBe(true);
        expect(response.has_conflicts).toBe(false);
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

      it('should persist release summary', async () => {
        const claim = await createClaim(db, {
          session_id: sessionId,
          files: ['src/summary.ts'],
          intent: 'Work with summary',
          scope: 'small',
        });

        const result = await handleClaimTool(db, 'collab_claim', {
          action: 'release',
          session_id: sessionId,
          claim_id: claim.claim.id,
          summary: 'Done with implementation details',
        });

        expect(result.isError).toBeFalsy();
        const stored = await getClaim(db, claim.claim.id);
        expect(stored?.completed_summary).toBe('Done with implementation details');
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

      it('should list completed claims when status=completed', async () => {
        const claim = await createClaim(db, {
          session_id: sessionId,
          files: ['src/done.ts'],
          intent: 'Finish work',
          scope: 'small',
        });

        await handleClaimTool(db, 'collab_claim', {
          action: 'release',
          session_id: sessionId,
          claim_id: claim.claim.id,
          status: 'completed',
        });

        const result = await handleClaimTool(db, 'collab_claim', {
          action: 'list',
          session_id: sessionId,
          status: 'completed',
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.claims).toHaveLength(1);
        expect(response.claims[0].id).toBe(claim.claim.id);
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
