import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalDatabase } from '../sqlite-adapter.js';
import { listMigrationFiles, loadMigrationsFromDir } from '../migrations.js';
import { handleSessionTool } from '../../mcp/tools/session.js';
import { handleClaimTool } from '../../mcp/tools/claim.js';
import { handleMemoryTool } from '../../mcp/tools/memory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'migrations');

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe('Migration loader', () => {
  it('should load versioned migrations in filename order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-collab-migrations-'));
    cleanupPaths.push(dir);

    writeFileSync(join(dir, '0002_session_status.sql'), '-- second\nSELECT 2;');
    writeFileSync(join(dir, '0001_init.sql'), '-- first\nSELECT 1;');
    writeFileSync(join(dir, '0002_auth.sql'), '-- third\nSELECT 3;');
    writeFileSync(join(dir, 'notes.txt'), 'ignore me');

    expect(listMigrationFiles(dir)).toEqual([
      '0001_init.sql',
      '0002_auth.sql',
      '0002_session_status.sql',
    ]);
  });

  it('should support core session, claim, config, memory, and status flows on a fresh database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-collab-db-'));
    cleanupPaths.push(dir);

    const dbPath = join(dir, 'collab.db');
    const db = createLocalDatabase(dbPath);

    try {
      db.initSchema(loadMigrationsFromDir(MIGRATIONS_DIR));

      const startResult = await handleSessionTool(db, 'collab_session_start', {
        project_root: '/tmp/project',
        name: 'migration-smoke',
      });
      expect(startResult.isError).toBeFalsy();
      const startPayload = JSON.parse(startResult.content[0].text);
      const sessionId = startPayload.session_id as string;
      expect(sessionId).toBeTruthy();

      const configResult = await handleSessionTool(db, 'collab_config', {
        session_id: sessionId,
        mode: 'strict',
        auto_release_stale: true,
      });
      expect(configResult.isError).toBeFalsy();

      const createResult = await handleClaimTool(db, 'collab_claim', {
        action: 'create',
        session_id: sessionId,
        files: ['src/demo.ts'],
        intent: 'Smoke test claim',
      });
      expect(createResult.isError).toBeFalsy();
      const claimPayload = JSON.parse(createResult.content[0].text);
      expect(claimPayload.claim_id).toBeTruthy();

      const checkResult = await handleClaimTool(db, 'collab_claim', {
        action: 'check',
        session_id: sessionId,
        files: ['src/demo.ts'],
      });
      expect(checkResult.isError).toBeFalsy();

      const listResult = await handleClaimTool(db, 'collab_claim', {
        action: 'list',
        session_id: sessionId,
      });
      expect(listResult.isError).toBeFalsy();
      expect(JSON.parse(listResult.content[0].text).total).toBe(1);

      const memorySaveResult = await handleMemoryTool(db, 'collab_memory_save', {
        session_id: sessionId,
        category: 'finding',
        key: 'migration_smoke',
        content: 'Fresh DB migration path works',
        priority: 90,
        pinned: true,
      });
      expect(memorySaveResult.isError).toBeFalsy();

      const memoryRecallResult = await handleMemoryTool(db, 'collab_memory_recall', {
        session_id: sessionId,
        active: true,
      });
      expect(memoryRecallResult.isError).toBeFalsy();
      expect(JSON.parse(memoryRecallResult.content[0].text).count).toBeGreaterThan(0);

      const statusResult = await handleSessionTool(db, 'collab_status', {
        session_id: sessionId,
      });
      expect(statusResult.isError).toBeFalsy();
      expect(JSON.parse(statusResult.content[0].text).session.id).toBe(sessionId);

      const releaseResult = await handleClaimTool(db, 'collab_claim', {
        action: 'release',
        session_id: sessionId,
        claim_id: claimPayload.claim_id,
      });
      expect(releaseResult.isError).toBeFalsy();

      const memoryClearResult = await handleMemoryTool(db, 'collab_memory_clear', {
        session_id: sessionId,
        key: 'migration_smoke',
      });
      expect(memoryClearResult.isError).toBeFalsy();
    } finally {
      db.close();
    }
  });
});
