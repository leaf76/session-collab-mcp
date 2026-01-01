// Phase 3: Plan & File Protection Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, TestDatabase } from './test-helper.js';
import {
  createSession,
  registerPlan,
  updatePlanStatus,
  getPlan,
  listPlans,
  registerCreatedFile,
  getCreatedFiles,
  isFileProtected,
  getProtectedFiles,
  recallMemory,
} from '../queries';

describe('Phase 3: Plan & File Protection', () => {
  let db: TestDatabase;
  let sessionId: string;

  beforeEach(async () => {
    db = createTestDatabase();

    // Create a test session
    const session = await createSession(db, {
      name: 'test-protection-session',
      project_root: '/test/project',
    });
    sessionId = session.id;
  });

  afterEach(() => {
    db.close();
  });

  describe('Plan Registration', () => {
    it('should register a plan with high priority and pinned', async () => {
      const memory = await registerPlan(db, sessionId, {
        file_path: 'docs/plan.md',
        title: 'Test Implementation Plan',
        content_summary: '1. Step one\n2. Step two\n3. Step three',
        status: 'draft',
      });

      expect(memory.priority).toBe(95);
      expect(memory.pinned).toBe(1);
      expect(memory.category).toBe('important');
      expect(memory.key).toBe('plan:docs/plan.md');
    });

    it('should store plan metadata correctly', async () => {
      await registerPlan(db, sessionId, {
        file_path: 'docs/plan.md',
        title: 'Test Plan',
        content_summary: 'Summary here',
        status: 'approved',
      });

      const plan = await getPlan(db, sessionId, 'docs/plan.md');
      expect(plan).not.toBeNull();
      expect(plan!.title).toBe('Test Plan');
      expect(plan!.status).toBe('approved');
      expect(plan!.file_path).toBe('docs/plan.md');
    });

    it('should update existing plan if registered again', async () => {
      await registerPlan(db, sessionId, {
        file_path: 'docs/plan.md',
        title: 'Original Title',
        content_summary: 'Original summary',
      });

      await registerPlan(db, sessionId, {
        file_path: 'docs/plan.md',
        title: 'Updated Title',
        content_summary: 'Updated summary',
      });

      const plan = await getPlan(db, sessionId, 'docs/plan.md');
      expect(plan!.title).toBe('Updated Title');
    });
  });

  describe('Plan Status Lifecycle', () => {
    beforeEach(async () => {
      await registerPlan(db, sessionId, {
        file_path: 'docs/plan.md',
        title: 'Lifecycle Test Plan',
        content_summary: 'Testing lifecycle',
        status: 'draft',
      });
    });

    it('should update status from draft to approved', async () => {
      const updated = await updatePlanStatus(db, sessionId, 'docs/plan.md', 'approved');
      expect(updated).toBe(true);

      const plan = await getPlan(db, sessionId, 'docs/plan.md');
      expect(plan!.status).toBe('approved');
    });

    it('should update status to in_progress', async () => {
      await updatePlanStatus(db, sessionId, 'docs/plan.md', 'in_progress');

      const plan = await getPlan(db, sessionId, 'docs/plan.md');
      expect(plan!.status).toBe('in_progress');
    });

    it('should reduce priority and unpin when completed', async () => {
      await updatePlanStatus(db, sessionId, 'docs/plan.md', 'completed', 'All done!');

      const memories = await recallMemory(db, sessionId, { key: 'plan:docs/plan.md' });
      expect(memories.length).toBe(1);
      expect(memories[0].priority).toBe(50); // Reduced from 95
      expect(memories[0].pinned).toBe(0); // Unpinned

      const plan = await getPlan(db, sessionId, 'docs/plan.md');
      expect(plan!.status).toBe('completed');
      expect(plan!.completed_at).toBeDefined();
    });

    it('should further reduce priority when archived', async () => {
      await updatePlanStatus(db, sessionId, 'docs/plan.md', 'archived');

      const memories = await recallMemory(db, sessionId, { key: 'plan:docs/plan.md' });
      expect(memories[0].priority).toBe(30); // Very low
      expect(memories[0].pinned).toBe(0);
    });

    it('should return false for non-existent plan', async () => {
      const updated = await updatePlanStatus(db, sessionId, 'nonexistent.md', 'completed');
      expect(updated).toBe(false);
    });
  });

  describe('Plan Listing', () => {
    beforeEach(async () => {
      await registerPlan(db, sessionId, {
        file_path: 'docs/plan1.md',
        title: 'Plan 1',
        content_summary: 'First plan',
        status: 'draft',
      });
      await registerPlan(db, sessionId, {
        file_path: 'docs/plan2.md',
        title: 'Plan 2',
        content_summary: 'Second plan',
        status: 'in_progress',
      });
      await registerPlan(db, sessionId, {
        file_path: 'docs/plan3.md',
        title: 'Plan 3',
        content_summary: 'Third plan',
        status: 'archived',
      });
    });

    it('should list all non-archived plans by default', async () => {
      const plans = await listPlans(db, sessionId);
      expect(plans.length).toBe(2);
      expect(plans.map(p => p.title)).toContain('Plan 1');
      expect(plans.map(p => p.title)).toContain('Plan 2');
      expect(plans.map(p => p.title)).not.toContain('Plan 3');
    });

    it('should include archived when requested', async () => {
      const plans = await listPlans(db, sessionId, { include_archived: true });
      expect(plans.length).toBe(3);
    });

    it('should filter by status', async () => {
      const draftPlans = await listPlans(db, sessionId, { status: 'draft' });
      expect(draftPlans.length).toBe(1);
      expect(draftPlans[0].title).toBe('Plan 1');
    });
  });

  describe('File Creation Registry', () => {
    it('should register a created file', async () => {
      const memory = await registerCreatedFile(db, sessionId, {
        file_path: 'src/new-file.ts',
        file_type: 'code',
        description: 'New utility file',
      });

      expect(memory.category).toBe('state');
      expect(memory.key).toBe('created_file:src/new-file.ts');
      expect(memory.priority).toBe(70);
    });

    it('should give higher priority to plan type files', async () => {
      const memory = await registerCreatedFile(db, sessionId, {
        file_path: 'docs/new-plan.md',
        file_type: 'plan',
      });

      expect(memory.priority).toBe(90);
      expect(memory.pinned).toBe(1);
    });

    it('should list all created files', async () => {
      await registerCreatedFile(db, sessionId, {
        file_path: 'src/file1.ts',
        file_type: 'code',
      });
      await registerCreatedFile(db, sessionId, {
        file_path: 'src/file2.ts',
        file_type: 'code',
      });
      await registerCreatedFile(db, sessionId, {
        file_path: 'config/app.json',
        file_type: 'config',
      });

      const files = await getCreatedFiles(db, sessionId);
      expect(files.length).toBe(3);
      expect(files.map(f => f.file_path)).toContain('src/file1.ts');
      expect(files.map(f => f.file_path)).toContain('src/file2.ts');
      expect(files.map(f => f.file_path)).toContain('config/app.json');
    });
  });

  describe('File Protection Check', () => {
    beforeEach(async () => {
      // Register a plan
      await registerPlan(db, sessionId, {
        file_path: 'docs/important-plan.md',
        title: 'Important Plan',
        content_summary: 'Very important',
      });

      // Register a created file
      await registerCreatedFile(db, sessionId, {
        file_path: 'src/new-feature.ts',
        file_type: 'code',
      });
    });

    it('should detect plan as protected', async () => {
      const result = await isFileProtected(db, sessionId, 'docs/important-plan.md');
      expect(result.protected).toBe(true);
      expect(result.reason).toBe('plan');
    });

    it('should detect created file as protected', async () => {
      const result = await isFileProtected(db, sessionId, 'src/new-feature.ts');
      expect(result.protected).toBe(true);
      expect(result.reason).toBe('created_file');
    });

    it('should return not protected for unknown files', async () => {
      const result = await isFileProtected(db, sessionId, 'src/random-file.ts');
      expect(result.protected).toBe(false);
      expect(result.reason).toBeUndefined();
    });

    it('should not protect archived plans', async () => {
      await updatePlanStatus(db, sessionId, 'docs/important-plan.md', 'archived');

      const result = await isFileProtected(db, sessionId, 'docs/important-plan.md');
      expect(result.protected).toBe(false);
    });
  });

  describe('Get Protected Files', () => {
    beforeEach(async () => {
      await registerPlan(db, sessionId, {
        file_path: 'docs/plan1.md',
        title: 'Plan 1',
        content_summary: 'First',
      });
      await registerPlan(db, sessionId, {
        file_path: 'docs/plan2.md',
        title: 'Plan 2',
        content_summary: 'Second',
      });
      await registerCreatedFile(db, sessionId, {
        file_path: 'src/code.ts',
        file_type: 'code',
      });
      // Archive one plan
      await updatePlanStatus(db, sessionId, 'docs/plan2.md', 'archived');
    });

    it('should list all non-archived protected files', async () => {
      const files = await getProtectedFiles(db, sessionId);

      expect(files.length).toBe(2); // plan1 + code.ts (plan2 is archived)

      const planFile = files.find(f => f.file_path === 'docs/plan1.md');
      expect(planFile).toBeDefined();
      expect(planFile!.protection_type).toBe('plan');
      expect(planFile!.pinned).toBe(true);

      const codeFile = files.find(f => f.file_path === 'src/code.ts');
      expect(codeFile).toBeDefined();
      expect(codeFile!.protection_type).toBe('created_file');
    });

    it('should order by priority', async () => {
      const files = await getProtectedFiles(db, sessionId);

      // Plans have priority 95, code files have 70
      expect(files[0].file_path).toBe('docs/plan1.md');
      expect(files[0].priority).toBe(95);
    });
  });

  describe('Integration: Full Protection Workflow', () => {
    it('should handle complete plan lifecycle', async () => {
      // 1. Create and register plan
      await registerPlan(db, sessionId, {
        file_path: 'docs/feature-plan.md',
        title: 'New Feature Plan',
        content_summary: '1. Design\n2. Implement\n3. Test',
        status: 'draft',
      });

      // Verify it's protected
      let protection = await isFileProtected(db, sessionId, 'docs/feature-plan.md');
      expect(protection.protected).toBe(true);

      // 2. Approve the plan
      await updatePlanStatus(db, sessionId, 'docs/feature-plan.md', 'approved');
      let plan = await getPlan(db, sessionId, 'docs/feature-plan.md');
      expect(plan!.status).toBe('approved');

      // 3. Start working
      await updatePlanStatus(db, sessionId, 'docs/feature-plan.md', 'in_progress');

      // 4. Register files created during implementation
      await registerCreatedFile(db, sessionId, {
        file_path: 'src/feature/index.ts',
        file_type: 'code',
        description: 'Feature entry point',
      });
      await registerCreatedFile(db, sessionId, {
        file_path: 'src/feature/utils.ts',
        file_type: 'code',
      });

      // 5. Verify all files are protected
      const protectedFiles = await getProtectedFiles(db, sessionId);
      expect(protectedFiles.length).toBe(3);

      // 6. Complete the plan
      await updatePlanStatus(
        db,
        sessionId,
        'docs/feature-plan.md',
        'completed',
        'Feature implemented successfully!'
      );

      plan = await getPlan(db, sessionId, 'docs/feature-plan.md');
      expect(plan!.status).toBe('completed');
      expect(plan!.completed_at).toBeDefined();

      // 7. Plan still exists but with reduced protection
      const memories = await recallMemory(db, sessionId, { key: 'plan:docs/feature-plan.md' });
      expect(memories[0].priority).toBe(50);
      expect(memories[0].pinned).toBe(0);

      // 8. Archive the plan
      await updatePlanStatus(db, sessionId, 'docs/feature-plan.md', 'archived');

      // 9. Plan no longer in protected files
      const remainingProtected = await getProtectedFiles(db, sessionId);
      expect(remainingProtected.length).toBe(2); // Only the code files

      // 10. Plan still accessible but not protected
      protection = await isFileProtected(db, sessionId, 'docs/feature-plan.md');
      expect(protection.protected).toBe(false);
    });
  });
});
