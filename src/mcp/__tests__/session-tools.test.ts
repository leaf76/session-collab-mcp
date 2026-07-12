// Session tools tests - testing collab_session_end (simplified response format)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, TestDatabase } from '../../db/__tests__/test-helper.js';
import { handleSessionTool } from '../tools/session.js';
import { createSession, createClaim, listClaims, getSession, joinQueue, saveMemory } from '../../db/queries.js';

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
      expect(response.reused).toBe(false);
      // Token default: no context restore unless opt-in
      expect(response.restored_context).toBeNull();
    });

    it('should reuse an active session with the same project_root + name', async () => {
      const first = await handleSessionTool(db, 'collab_session_start', {
        project_root: '/test/project',
        name: 'feature-auth',
      });
      const firstId = JSON.parse(first.content[0].text).session_id;

      const second = await handleSessionTool(db, 'collab_session_start', {
        project_root: '/test/project',
        name: 'feature-auth',
      });
      const secondResponse = JSON.parse(second.content[0].text);

      expect(secondResponse.reused).toBe(true);
      expect(secondResponse.session_id).toBe(firstId);
      expect(secondResponse.message).toContain('reused');
    });

    it('should force a new session when force_new is true', async () => {
      const first = await handleSessionTool(db, 'collab_session_start', {
        project_root: '/test/project',
        name: 'feature-auth',
      });
      const firstId = JSON.parse(first.content[0].text).session_id;

      const second = await handleSessionTool(db, 'collab_session_start', {
        project_root: '/test/project',
        name: 'feature-auth',
        force_new: true,
      });
      const secondResponse = JSON.parse(second.content[0].text);

      expect(secondResponse.reused).toBe(false);
      expect(secondResponse.session_id).not.toBe(firstId);
    });

    it('should not restore context by default even when high-priority memories exist', async () => {
      const prior = await createSession(db, {
        project_root: '/test/project',
        name: 'prior-session',
      });
      await saveMemory(db, prior.id, {
        category: 'finding',
        key: 'root-cause',
        content: 'Bug is in auth middleware',
        priority: 90,
        pinned: true,
      });

      const result = await handleSessionTool(db, 'collab_session_start', {
        project_root: '/test/project',
        name: 'new-session',
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);
      expect(response.restored_context).toBeNull();
    });

    it('should restore high-priority memories when restore_context is true', async () => {
      const prior = await createSession(db, {
        project_root: '/test/project',
        name: 'prior-session',
      });
      await saveMemory(db, prior.id, {
        category: 'finding',
        key: 'root-cause',
        content: 'Bug is in auth middleware',
        priority: 90,
        pinned: true,
      });

      const result = await handleSessionTool(db, 'collab_session_start', {
        project_root: '/test/project',
        name: 'new-session',
        restore_context: true,
        max_restore_items: 5,
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);
      expect(response.restored_context).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'root-cause',
            content: 'Bug is in auth middleware',
          }),
        ])
      );
      expect(response.restored_context.length).toBeLessThanOrEqual(5);
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

    it('should filter sessions by project_root', async () => {
      const otherSession = await createSession(db, {
        project_root: '/other/project',
        name: 'other-session',
      });

      const result = await handleSessionTool(db, 'collab_session_list', {
        project_root: '/test/project',
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);
      expect(response.sessions).toHaveLength(2);
      expect(response.sessions.some((s: { id: string }) => s.id === otherSession.id)).toBe(false);
    });

    it('should return summary counts by default without full claim payloads', async () => {
      const session = await createSession(db, {
        project_root: '/test/project',
        name: 'summary-session',
      });

      await createClaim(db, {
        session_id: session.id,
        files: ['src/summary.ts'],
        intent: 'Summarize active work',
        scope: 'small',
        priority: 75,
      });

      await handleSessionTool(db, 'collab_session_update', {
        session_id: session.id,
        current_task: 'Writing session summary',
      });

      const result = await handleSessionTool(db, 'collab_session_list', {
        project_root: '/test/project',
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);
      expect(response.detail).toBe(false);
      const listed = response.sessions.find((s: { id: string }) => s.id === session.id);
      expect(listed.current_task).toBe('Writing session summary');
      expect(listed.active_claims).toBe(1);
      expect(listed.claims).toBeUndefined();
      expect(listed.coordination_requests).toBeUndefined();
      expect(listed.todos).toBeUndefined();
    });

    it('should include full claim payloads when detail is true', async () => {
      const session = await createSession(db, {
        project_root: '/test/project',
        name: 'detail-session',
      });

      await createClaim(db, {
        session_id: session.id,
        files: ['src/summary.ts'],
        intent: 'Summarize active work',
        scope: 'small',
        priority: 75,
      });

      await handleSessionTool(db, 'collab_session_update', {
        session_id: session.id,
        current_task: 'Writing session summary',
      });

      const result = await handleSessionTool(db, 'collab_session_list', {
        project_root: '/test/project',
        detail: true,
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);
      expect(response.detail).toBe(true);
      const listed = response.sessions.find((s: { id: string }) => s.id === session.id);
      expect(listed.current_task).toBe('Writing session summary');
      expect(listed.active_claims).toBe(1);
      expect(listed.claims).toHaveLength(1);
      expect(listed.claims[0]).toMatchObject({
        files: ['src/summary.ts'],
        intent: 'Summarize active work',
      });
      expect(listed.claims[0].priority.level).toBe('high');
    });

    it('should include pending coordination summaries for waiting and owning sessions', async () => {
      const owner = await createSession(db, {
        project_root: '/test/project',
        name: 'owner-session',
      });
      const waiter = await createSession(db, {
        project_root: '/test/project',
        name: 'waiter-session',
      });

      const ownerClaim = await createClaim(db, {
        session_id: owner.id,
        files: ['src/shared.ts'],
        intent: 'Owner work',
        scope: 'small',
      });

      await joinQueue(db, {
        claim_id: ownerClaim.claim.id,
        session_id: waiter.id,
        intent: 'Waiting work',
        priority: 80,
        scope: 'small',
      });

      const summaryResult = await handleSessionTool(db, 'collab_session_list', {
        project_root: '/test/project',
      });
      const detailResult = await handleSessionTool(db, 'collab_session_list', {
        project_root: '/test/project',
        detail: true,
      });

      expect(summaryResult.isError).toBeFalsy();
      expect(detailResult.isError).toBeFalsy();
      const summary = JSON.parse(summaryResult.content[0].text);
      const detail = JSON.parse(detailResult.content[0].text);
      const summaryOwner = summary.sessions.find((s: { id: string }) => s.id === owner.id);
      const listedOwner = detail.sessions.find((s: { id: string }) => s.id === owner.id);
      const listedWaiter = detail.sessions.find((s: { id: string }) => s.id === waiter.id);

      expect(summaryOwner.pending_coordination.incoming).toBe(1);
      expect(summaryOwner.coordination_requests).toBeUndefined();
      expect(listedOwner.pending_coordination.incoming).toBe(1);
      expect(listedOwner.coordination_requests[0]).toMatchObject({
        requested_by_session_id: waiter.id,
        requested_by_session_name: 'waiter-session',
        owner_claim_id: ownerClaim.claim.id,
        files: ['src/shared.ts'],
      });
      expect(listedWaiter.pending_coordination.outgoing).toBe(1);
    });
  });

  describe('collab_session_update', () => {
    it('should update heartbeat, current task, todos, and progress', async () => {
      const session = await createSession(db, {
        project_root: '/test/project',
        name: 'heartbeat-session',
      });

      const result = await handleSessionTool(db, 'collab_session_update', {
        session_id: session.id,
        current_task: 'Implementing heartbeat',
        todos: [
          { content: 'Add schema', status: 'completed' },
          { content: 'Add tests', status: 'in_progress' },
        ],
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.current_task).toBe('Implementing heartbeat');
      expect(response.progress).toEqual({ completed: 1, total: 2, percentage: 50 });

      const stored = await getSession(db, session.id);
      expect(stored?.current_task).toBe('Implementing heartbeat');
      expect(JSON.parse(stored?.progress ?? '{}')).toEqual({ completed: 1, total: 2, percentage: 50 });
    });

    it('should return error for inactive session', async () => {
      const result = await handleSessionTool(db, 'collab_session_update', {
        session_id: 'missing-session',
        current_task: 'No-op',
      });

      expect(result.isError).toBe(true);
      const response = JSON.parse(result.content[0].text);
      expect(response.error).toBe('SESSION_NOT_FOUND');
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

    it('should return session status summary by default', async () => {
      const result = await handleSessionTool(db, 'collab_status', {
        session_id: sessionId,
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);
      expect(response.session.id).toBe(sessionId);
      expect(response.active_claims).toBe(1);
      expect(response.claims).toBeUndefined();
      expect(response.coordination_requests).toBeUndefined();
      expect(response.detail).toBe(false);
      expect(response.message).toContain('1 claim(s)');
    });

    it('should return full claim and coordination details when detail is true', async () => {
      const owner = await createSession(db, {
        project_root: '/test/project',
        name: 'owner-session',
      });

      const ownerClaim = await createClaim(db, {
        session_id: owner.id,
        files: ['src/shared.ts'],
        intent: 'Owner work',
        scope: 'small',
      });

      await joinQueue(db, {
        claim_id: ownerClaim.claim.id,
        session_id: sessionId,
        intent: 'Waiting work',
        priority: 75,
        scope: 'small',
      });

      const summaryStatus = await handleSessionTool(db, 'collab_status', {
        session_id: sessionId,
      });
      const waiterStatus = await handleSessionTool(db, 'collab_status', {
        session_id: sessionId,
        detail: true,
      });
      const ownerStatus = await handleSessionTool(db, 'collab_status', {
        session_id: owner.id,
        detail: true,
      });

      expect(summaryStatus.isError).toBeFalsy();
      expect(waiterStatus.isError).toBeFalsy();
      expect(ownerStatus.isError).toBeFalsy();
      const summaryResponse = JSON.parse(summaryStatus.content[0].text);
      const waiterResponse = JSON.parse(waiterStatus.content[0].text);
      const ownerResponse = JSON.parse(ownerStatus.content[0].text);

      expect(summaryResponse.pending_coordination.outgoing).toBe(1);
      expect(summaryResponse.coordination_requests).toBeUndefined();
      expect(waiterResponse.claims).toHaveLength(1);
      expect(waiterResponse.pending_coordination.outgoing).toBe(1);
      expect(waiterResponse.coordination_requests.outgoing[0]).toMatchObject({
        owner_session_id: owner.id,
        owner_session_name: 'owner-session',
        files: ['src/shared.ts'],
      });
      expect(ownerResponse.pending_coordination.incoming).toBe(1);
      expect(ownerResponse.coordination_requests.incoming[0]).toMatchObject({
        requested_by_session_id: sessionId,
        owner_claim_id: ownerClaim.claim.id,
      });
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
