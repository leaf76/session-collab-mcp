import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { createTestDatabase, TestDatabase } from './test-helper.js';
import { checkConflicts, createClaim, createSession } from '../queries.js';

const fileTokenArb = fc.constantFrom('alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta');
const filePathArb = fileTokenArb.map((token) => `src/${token}.ts`);
const uniqueFilesArb = fc.uniqueArray(filePathArb, { minLength: 1, maxLength: 4 });
const symbolNamesArb = fc.uniqueArray(
  fc.constantFrom('render', 'load', 'save', 'delete', 'sync', 'refresh'),
  { minLength: 1, maxLength: 3 }
);

describe('checkConflicts properties', () => {
  let db: TestDatabase;
  let ownerSessionId: string;
  let peerSessionId: string;

  beforeEach(async () => {
    db = createTestDatabase();
    ownerSessionId = (await createSession(db, { project_root: '/property-tests', name: 'owner' })).id;
    peerSessionId = (await createSession(db, { project_root: '/property-tests', name: 'peer' })).id;
  });

  afterEach(() => {
    db.close();
  });

  it('should never report conflicts against the caller when exclude_self is used', async () => {
    await fc.assert(
      fc.asyncProperty(uniqueFilesArb, async (files) => {
        await createClaim(db, {
          session_id: ownerSessionId,
          files,
          intent: 'Self-owned work',
        });

        const conflicts = await checkConflicts(db, files, ownerSessionId);
        expect(conflicts).toEqual([]);

        db.reset();
        ownerSessionId = (await createSession(db, { project_root: '/property-tests', name: 'owner' })).id;
        peerSessionId = (await createSession(db, { project_root: '/property-tests', name: 'peer' })).id;
      }),
      { numRuns: 20 }
    );
  });

  it('should keep symbol conflict results deduplicated when file and symbol inputs overlap', async () => {
    await fc.assert(
      fc.asyncProperty(filePathArb, symbolNamesArb, async (filePath, symbols) => {
        await createClaim(db, {
          session_id: ownerSessionId,
          files: [filePath],
          intent: 'Symbol claim',
          symbols: [{ file: filePath, symbols }],
        });

        const conflicts = await checkConflicts(
          db,
          [filePath],
          peerSessionId,
          [{ file: filePath, symbols }]
        );

        const keys = conflicts.map((conflict) => `${conflict.claim_id}:${conflict.file_path}:${conflict.symbol_name ?? ''}`);
        expect(new Set(keys).size).toBe(keys.length);
        expect(conflicts.every((conflict) => conflict.file_path === filePath)).toBe(true);

        db.reset();
        ownerSessionId = (await createSession(db, { project_root: '/property-tests', name: 'owner' })).id;
        peerSessionId = (await createSession(db, { project_root: '/property-tests', name: 'peer' })).id;
      }),
      { numRuns: 20 }
    );
  });

  it('should match glob-style file claims for peer sessions', async () => {
    await fc.assert(
      fc.asyncProperty(fileTokenArb, async (token) => {
        await createClaim(db, {
          session_id: ownerSessionId,
          files: ['src/*.ts'],
          intent: 'Glob claim',
        });

        const conflicts = await checkConflicts(db, [`src/${token}.ts`], peerSessionId);
        expect(conflicts.length).toBeGreaterThan(0);

        db.reset();
        ownerSessionId = (await createSession(db, { project_root: '/property-tests', name: 'owner' })).id;
        peerSessionId = (await createSession(db, { project_root: '/property-tests', name: 'peer' })).id;
      }),
      { numRuns: 12 }
    );
  });
});
