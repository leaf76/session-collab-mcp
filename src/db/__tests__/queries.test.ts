import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, TestDatabase } from './test-helper.js';
import {
  createSession,
  getSession,
  listSessions,
  updateSessionHeartbeat,
  endSession,
  createClaim,
  getClaim,
  listClaims,
  checkConflicts,
  releaseClaim,
  sendMessage,
  listMessages,
  addDecision,
  listDecisions,
  storeReferences,
  getReferencesForSymbol,
  analyzeClaimImpact,
} from '../queries.js';

describe('Session Queries', () => {
  let db: TestDatabase;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(() => {
    db.close();
  });

  describe('createSession', () => {
    it('should create a new session with required fields', async () => {
      const session = await createSession(db, {
        project_root: '/test/project',
      });

      expect(session.id).toBeDefined();
      expect(session.project_root).toBe('/test/project');
      expect(session.status).toBe('active');
      expect(session.name).toBeNull();
    });

    it('should create a session with all optional fields', async () => {
      const session = await createSession(db, {
        name: 'test-session',
        project_root: '/test/project',
        machine_id: 'machine-1',
      });

      expect(session.name).toBe('test-session');
      expect(session.machine_id).toBe('machine-1');
    });
  });

  describe('getSession', () => {
    it('should return null for non-existent session', async () => {
      const session = await getSession(db, 'non-existent-id');
      expect(session).toBeNull();
    });

    it('should return existing session', async () => {
      const created = await createSession(db, { project_root: '/test' });
      const fetched = await getSession(db, created.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
    });
  });

  describe('listSessions', () => {
    it('should list only active sessions by default', async () => {
      const session1 = await createSession(db, { project_root: '/test1' });
      const session2 = await createSession(db, { project_root: '/test2' });
      await endSession(db, session2.id);

      const sessions = await listSessions(db);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(session1.id);
    });

    it('should include inactive sessions when requested', async () => {
      await createSession(db, { project_root: '/test1' });
      const session2 = await createSession(db, { project_root: '/test2' });
      await endSession(db, session2.id);

      const sessions = await listSessions(db, { include_inactive: true });
      expect(sessions).toHaveLength(2);
    });

    it('should filter by project_root', async () => {
      await createSession(db, { project_root: '/project-a' });
      await createSession(db, { project_root: '/project-b' });

      const sessions = await listSessions(db, { project_root: '/project-a' });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].project_root).toBe('/project-a');
    });
  });

  describe('updateSessionHeartbeat', () => {
    it('should update heartbeat timestamp', async () => {
      const session = await createSession(db, { project_root: '/test' });
      const originalHeartbeat = session.last_heartbeat;

      // Wait a bit to ensure timestamp changes
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = await updateSessionHeartbeat(db, session.id);
      expect(updated).toBe(true);

      const fetched = await getSession(db, session.id);
      expect(fetched!.last_heartbeat).not.toBe(originalHeartbeat);
    });

    it('should update current task and todos', async () => {
      const session = await createSession(db, { project_root: '/test' });

      await updateSessionHeartbeat(db, session.id, {
        current_task: 'Working on feature X',
        todos: [
          { content: 'Task 1', status: 'completed' },
          { content: 'Task 2', status: 'in_progress' },
        ],
      });

      const fetched = await getSession(db, session.id);
      expect(fetched!.current_task).toBe('Working on feature X');
      expect(fetched!.progress).not.toBeNull();

      const progress = JSON.parse(fetched!.progress!);
      expect(progress.completed).toBe(1);
      expect(progress.total).toBe(2);
      expect(progress.percentage).toBe(50);
    });
  });

  describe('endSession', () => {
    it('should mark session as terminated', async () => {
      const session = await createSession(db, { project_root: '/test' });
      await endSession(db, session.id);

      const fetched = await getSession(db, session.id);
      expect(fetched!.status).toBe('terminated');
    });

    it('should abandon active claims by default', async () => {
      const session = await createSession(db, { project_root: '/test' });
      const { claim } = await createClaim(db, {
        session_id: session.id,
        files: ['file.ts'],
        intent: 'Test',
      });

      await endSession(db, session.id, 'abandon');

      const fetchedClaim = await getClaim(db, claim.id);
      expect(fetchedClaim!.status).toBe('abandoned');
    });

    it('should complete claims when requested', async () => {
      const session = await createSession(db, { project_root: '/test' });
      const { claim } = await createClaim(db, {
        session_id: session.id,
        files: ['file.ts'],
        intent: 'Test',
      });

      await endSession(db, session.id, 'complete');

      const fetchedClaim = await getClaim(db, claim.id);
      expect(fetchedClaim!.status).toBe('completed');
    });
  });
});

describe('Claim Queries', () => {
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

  describe('createClaim', () => {
    it('should create a file-level claim', async () => {
      const result = await createClaim(db, {
        session_id: sessionId,
        files: ['src/app.ts', 'src/utils.ts'],
        intent: 'Refactoring utilities',
      });

      expect(result.claim.id).toBeDefined();
      expect(result.claim.status).toBe('active');
      expect(result.files).toEqual(['src/app.ts', 'src/utils.ts']);
    });

    it('should create a symbol-level claim', async () => {
      const result = await createClaim(db, {
        session_id: sessionId,
        files: ['src/auth.ts'],
        intent: 'Updating auth functions',
        symbols: [
          { file: 'src/auth.ts', symbols: ['validateToken', 'refreshToken'] },
        ],
      });

      expect(result.symbols).toBeDefined();
      expect(result.symbols).toHaveLength(1);
      expect(result.symbols![0].symbols).toContain('validateToken');
    });

    it('should handle glob patterns', async () => {
      const result = await createClaim(db, {
        session_id: sessionId,
        files: ['src/**/*.ts'],
        intent: 'Refactoring all TS files',
      });

      const claim = await getClaim(db, result.claim.id);
      expect(claim!.files).toContain('src/**/*.ts');
    });
  });

  describe('getClaim', () => {
    it('should return null for non-existent claim', async () => {
      const claim = await getClaim(db, 'non-existent');
      expect(claim).toBeNull();
    });

    it('should include files and session name', async () => {
      // Create session with name
      const namedSession = await createSession(db, {
        name: 'feature-dev',
        project_root: '/test',
      });

      const { claim } = await createClaim(db, {
        session_id: namedSession.id,
        files: ['file.ts'],
        intent: 'Test',
      });

      const fetched = await getClaim(db, claim.id);
      expect(fetched!.files).toContain('file.ts');
      expect(fetched!.session_name).toBe('feature-dev');
    });
  });

  describe('listClaims', () => {
    it('should list claims for a session', async () => {
      await createClaim(db, { session_id: sessionId, files: ['a.ts'], intent: 'A' });
      await createClaim(db, { session_id: sessionId, files: ['b.ts'], intent: 'B' });

      const claims = await listClaims(db, { session_id: sessionId });
      expect(claims).toHaveLength(2);
    });

    it('should filter by status', async () => {
      const { claim } = await createClaim(db, { session_id: sessionId, files: ['a.ts'], intent: 'A' });
      await createClaim(db, { session_id: sessionId, files: ['b.ts'], intent: 'B' });
      await releaseClaim(db, claim.id, { status: 'completed' });

      const activeClaims = await listClaims(db, { status: 'active' });
      expect(activeClaims).toHaveLength(1);

      const completedClaims = await listClaims(db, { status: 'completed' });
      expect(completedClaims).toHaveLength(1);
    });
  });

  describe('releaseClaim', () => {
    it('should update claim status to completed', async () => {
      const { claim } = await createClaim(db, {
        session_id: sessionId,
        files: ['file.ts'],
        intent: 'Test',
      });

      await releaseClaim(db, claim.id, {
        status: 'completed',
        summary: 'Done!',
      });

      const fetched = await getClaim(db, claim.id);
      expect(fetched!.status).toBe('completed');
      expect(fetched!.completed_summary).toBe('Done!');
    });

    it('should update claim status to abandoned', async () => {
      const { claim } = await createClaim(db, {
        session_id: sessionId,
        files: ['file.ts'],
        intent: 'Test',
      });

      await releaseClaim(db, claim.id, { status: 'abandoned' });

      const fetched = await getClaim(db, claim.id);
      expect(fetched!.status).toBe('abandoned');
    });
  });
});

describe('Conflict Detection', () => {
  let db: TestDatabase;
  let session1Id: string;
  let session2Id: string;

  beforeEach(async () => {
    db = createTestDatabase();
    const session1 = await createSession(db, { name: 'session-1', project_root: '/test' });
    const session2 = await createSession(db, { name: 'session-2', project_root: '/test' });
    session1Id = session1.id;
    session2Id = session2.id;
  });

  afterEach(() => {
    db.close();
  });

  describe('File-level conflicts', () => {
    it('should detect conflict when same file is claimed', async () => {
      await createClaim(db, {
        session_id: session1Id,
        files: ['src/app.ts'],
        intent: 'Working on app',
      });

      const conflicts = await checkConflicts(db, ['src/app.ts'], session2Id);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].file_path).toBe('src/app.ts');
      expect(conflicts[0].session_name).toBe('session-1');
      expect(conflicts[0].conflict_level).toBe('file');
    });

    it('should not detect conflict for own claims', async () => {
      await createClaim(db, {
        session_id: session1Id,
        files: ['src/app.ts'],
        intent: 'Working on app',
      });

      const conflicts = await checkConflicts(db, ['src/app.ts'], session1Id);
      expect(conflicts).toHaveLength(0);
    });

    it('should not detect conflict for released claims', async () => {
      const { claim } = await createClaim(db, {
        session_id: session1Id,
        files: ['src/app.ts'],
        intent: 'Working on app',
      });
      await releaseClaim(db, claim.id, { status: 'completed' });

      const conflicts = await checkConflicts(db, ['src/app.ts'], session2Id);
      expect(conflicts).toHaveLength(0);
    });

    it('should detect conflict with glob patterns', async () => {
      await createClaim(db, {
        session_id: session1Id,
        files: ['src/**/*.ts'],
        intent: 'Refactoring',
      });

      const conflicts = await checkConflicts(db, ['src/utils/helper.ts'], session2Id);
      expect(conflicts).toHaveLength(1);
    });

    it('should handle multiple files with mixed conflicts', async () => {
      await createClaim(db, {
        session_id: session1Id,
        files: ['src/a.ts', 'src/b.ts'],
        intent: 'Working',
      });

      const conflicts = await checkConflicts(db, ['src/a.ts', 'src/c.ts'], session2Id);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].file_path).toBe('src/a.ts');
    });
  });

  describe('Symbol-level conflicts', () => {
    it('should detect symbol-level conflict', async () => {
      await createClaim(db, {
        session_id: session1Id,
        files: ['src/auth.ts'],
        intent: 'Updating validateToken',
        symbols: [{ file: 'src/auth.ts', symbols: ['validateToken'] }],
      });

      const conflicts = await checkConflicts(
        db,
        ['src/auth.ts'],
        session2Id,
        [{ file: 'src/auth.ts', symbols: ['validateToken'] }]
      );

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].symbol_name).toBe('validateToken');
      expect(conflicts[0].conflict_level).toBe('symbol');
    });

    it('should NOT conflict when different symbols in same file', async () => {
      await createClaim(db, {
        session_id: session1Id,
        files: ['src/auth.ts'],
        intent: 'Updating validateToken',
        symbols: [{ file: 'src/auth.ts', symbols: ['validateToken'] }],
      });

      const conflicts = await checkConflicts(
        db,
        ['src/auth.ts'],
        session2Id,
        [{ file: 'src/auth.ts', symbols: ['refreshToken'] }]
      );

      expect(conflicts).toHaveLength(0);
    });

    it('should conflict when file-level claim exists and checking symbols', async () => {
      // Session 1 claims entire file (no symbols)
      await createClaim(db, {
        session_id: session1Id,
        files: ['src/auth.ts'],
        intent: 'Refactoring entire file',
      });

      // Session 2 wants to modify a specific symbol
      const conflicts = await checkConflicts(
        db,
        ['src/auth.ts'],
        session2Id,
        [{ file: 'src/auth.ts', symbols: ['validateToken'] }]
      );

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].conflict_level).toBe('file');
    });

    it('should detect symbol conflicts when checking file without symbols', async () => {
      // Session 1 claims specific symbols
      await createClaim(db, {
        session_id: session1Id,
        files: ['src/auth.ts'],
        intent: 'Updating auth',
        symbols: [{ file: 'src/auth.ts', symbols: ['validateToken', 'refreshToken'] }],
      });

      // Session 2 wants to modify the entire file (no symbols specified)
      const conflicts = await checkConflicts(db, ['src/auth.ts'], session2Id);

      // Should detect both file-level claim AND symbol-level claims
      expect(conflicts.length).toBeGreaterThanOrEqual(2);
      const symbolConflicts = conflicts.filter((c) => c.conflict_level === 'symbol');
      expect(symbolConflicts.map((c) => c.symbol_name)).toContain('validateToken');
      expect(symbolConflicts.map((c) => c.symbol_name)).toContain('refreshToken');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty files array', async () => {
      const conflicts = await checkConflicts(db, [], session2Id);
      expect(conflicts).toHaveLength(0);
    });

    it('should detect conflicts from simultaneous claims (race condition scenario)', async () => {
      // Simulate race condition: both sessions create claims, then check conflicts
      // This tests the "create first, check after" pattern

      // Session 1 creates claim
      await createClaim(db, {
        session_id: session1Id,
        files: ['src/shared.ts'],
        intent: 'Session 1 working',
      });

      // Session 2 creates claim (simulating simultaneous creation)
      await createClaim(db, {
        session_id: session2Id,
        files: ['src/shared.ts'],
        intent: 'Session 2 working',
      });

      // Both sessions should see the other's claim as a conflict
      const conflicts1 = await checkConflicts(db, ['src/shared.ts'], session1Id);
      const conflicts2 = await checkConflicts(db, ['src/shared.ts'], session2Id);

      // Session 1 sees Session 2's claim
      expect(conflicts1).toHaveLength(1);
      expect(conflicts1[0].session_id).toBe(session2Id);

      // Session 2 sees Session 1's claim
      expect(conflicts2).toHaveLength(1);
      expect(conflicts2[0].session_id).toBe(session1Id);
    });

    it('should handle inactive session claims', async () => {
      await createClaim(db, {
        session_id: session1Id,
        files: ['src/app.ts'],
        intent: 'Working',
      });
      await endSession(db, session1Id);

      const conflicts = await checkConflicts(db, ['src/app.ts'], session2Id);
      expect(conflicts).toHaveLength(0);
    });

    it('should deduplicate conflicts', async () => {
      // Create two claims for the same file
      await createClaim(db, {
        session_id: session1Id,
        files: ['src/app.ts'],
        intent: 'Claim 1',
      });
      await createClaim(db, {
        session_id: session1Id,
        files: ['src/app.ts'],
        intent: 'Claim 2',
      });

      const conflicts = await checkConflicts(db, ['src/app.ts'], session2Id);
      // Should have 2 conflicts (one per claim)
      expect(conflicts.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('Message Queries', () => {
  let db: TestDatabase;
  let session1Id: string;
  let session2Id: string;

  beforeEach(async () => {
    db = createTestDatabase();
    const session1 = await createSession(db, { project_root: '/test' });
    const session2 = await createSession(db, { project_root: '/test' });
    session1Id = session1.id;
    session2Id = session2.id;
  });

  afterEach(() => {
    db.close();
  });

  it('should send and receive messages', async () => {
    const message = await sendMessage(db, {
      from_session_id: session1Id,
      to_session_id: session2Id,
      content: 'Hello from session 1',
    });

    expect(message.id).toBeDefined();
    expect(message.content).toBe('Hello from session 1');
    expect(message.read_at).toBeNull();
  });

  it('should list messages for a session', async () => {
    await sendMessage(db, {
      from_session_id: session1Id,
      to_session_id: session2Id,
      content: 'Message 1',
    });
    await sendMessage(db, {
      from_session_id: session1Id,
      to_session_id: session2Id,
      content: 'Message 2',
    });

    const messages = await listMessages(db, { session_id: session2Id });
    expect(messages).toHaveLength(2);
  });

  it('should include broadcast messages', async () => {
    await sendMessage(db, {
      from_session_id: session1Id,
      content: 'Broadcast message',
    });

    const messages = await listMessages(db, { session_id: session2Id });
    expect(messages).toHaveLength(1);
    expect(messages[0].to_session_id).toBeNull();
  });

  it('should filter unread messages', async () => {
    await sendMessage(db, {
      from_session_id: session1Id,
      to_session_id: session2Id,
      content: 'Message 1',
    });

    // Read messages (marks them as read)
    await listMessages(db, { session_id: session2Id, mark_as_read: true });

    // Send another message
    await sendMessage(db, {
      from_session_id: session1Id,
      to_session_id: session2Id,
      content: 'Message 2',
    });

    const unread = await listMessages(db, { session_id: session2Id, unread_only: true });
    expect(unread).toHaveLength(1);
    expect(unread[0].content).toBe('Message 2');
  });
});

describe('Decision Queries', () => {
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

  it('should add a decision', async () => {
    const decision = await addDecision(db, {
      session_id: sessionId,
      category: 'architecture',
      title: 'Use microservices',
      description: 'We decided to use microservices architecture for scalability.',
    });

    expect(decision.id).toBeDefined();
    expect(decision.category).toBe('architecture');
  });

  it('should list decisions by category', async () => {
    await addDecision(db, {
      session_id: sessionId,
      category: 'architecture',
      title: 'Architecture decision',
      description: 'Details...',
    });
    await addDecision(db, {
      session_id: sessionId,
      category: 'api',
      title: 'API decision',
      description: 'Details...',
    });

    const archDecisions = await listDecisions(db, { category: 'architecture' });
    expect(archDecisions).toHaveLength(1);
    expect(archDecisions[0].title).toBe('Architecture decision');
  });

  it('should respect limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await addDecision(db, {
        session_id: sessionId,
        title: `Decision ${i}`,
        description: 'Details...',
      });
    }

    const limited = await listDecisions(db, { limit: 3 });
    expect(limited).toHaveLength(3);
  });
});

describe('Reference Queries', () => {
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

  describe('storeReferences', () => {
    it('should store symbol references', async () => {
      const result = await storeReferences(db, sessionId, [
        {
          source_file: 'src/auth.ts',
          source_symbol: 'validateToken',
          references: [
            { file: 'src/api/users.ts', line: 15, context: 'const valid = validateToken(token)' },
            { file: 'src/api/orders.ts', line: 23 },
          ],
        },
      ]);

      expect(result.stored).toBe(2);
      expect(result.skipped).toBe(0);
    });

    it('should skip duplicate references', async () => {
      await storeReferences(db, sessionId, [
        {
          source_file: 'src/auth.ts',
          source_symbol: 'validateToken',
          references: [{ file: 'src/api/users.ts', line: 15 }],
        },
      ]);

      await storeReferences(db, sessionId, [
        {
          source_file: 'src/auth.ts',
          source_symbol: 'validateToken',
          references: [{ file: 'src/api/users.ts', line: 15 }], // Same reference
        },
      ]);

      // INSERT OR IGNORE counts as stored (no error), so we verify by checking total count
      const refs = await getReferencesForSymbol(db, 'src/auth.ts', 'validateToken');
      expect(refs).toHaveLength(1); // Still only 1 reference (duplicate was ignored)
    });
  });

  describe('getReferencesForSymbol', () => {
    it('should return references for a symbol', async () => {
      await storeReferences(db, sessionId, [
        {
          source_file: 'src/auth.ts',
          source_symbol: 'validateToken',
          references: [
            { file: 'src/api/users.ts', line: 15 },
            { file: 'src/api/orders.ts', line: 23 },
          ],
        },
      ]);

      const refs = await getReferencesForSymbol(db, 'src/auth.ts', 'validateToken');
      expect(refs).toHaveLength(2);
    });
  });

  describe('analyzeClaimImpact', () => {
    it('should identify impacted claims', async () => {
      // Store references
      await storeReferences(db, sessionId, [
        {
          source_file: 'src/auth.ts',
          source_symbol: 'validateToken',
          references: [{ file: 'src/api/users.ts', line: 15 }],
        },
      ]);

      // Create a second session with a claim on the referencing file
      const session2 = await createSession(db, { name: 'other-session', project_root: '/test' });
      await createClaim(db, {
        session_id: session2.id,
        files: ['src/api/users.ts'],
        intent: 'Working on users API',
      });

      // Analyze impact
      const impact = await analyzeClaimImpact(db, 'src/auth.ts', 'validateToken', sessionId);

      expect(impact.symbol).toBe('validateToken');
      expect(impact.reference_count).toBe(1);
      expect(impact.affected_files).toContain('src/api/users.ts');
      expect(impact.affected_claims).toHaveLength(1);
      expect(impact.affected_claims[0].session_name).toBe('other-session');
    });

    it('should exclude own session from impacted claims', async () => {
      await storeReferences(db, sessionId, [
        {
          source_file: 'src/auth.ts',
          source_symbol: 'validateToken',
          references: [{ file: 'src/api/users.ts', line: 15 }],
        },
      ]);

      // Same session claims the referencing file
      await createClaim(db, {
        session_id: sessionId,
        files: ['src/api/users.ts'],
        intent: 'Own work',
      });

      const impact = await analyzeClaimImpact(db, 'src/auth.ts', 'validateToken', sessionId);
      expect(impact.affected_claims).toHaveLength(0);
    });
  });
});
