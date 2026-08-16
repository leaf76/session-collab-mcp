import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getDefaultDbPath, getLegacyDbPath, getModernDbPath } from '../db-path.js';

describe('getDefaultDbPath', () => {
  const original = process.env.SESSION_COLLAB_DB;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.SESSION_COLLAB_DB;
    } else {
      process.env.SESSION_COLLAB_DB = original;
    }
  });

  it('prefers SESSION_COLLAB_DB', () => {
    const dir = mkdtempSync(join(tmpdir(), 'collab-db-'));
    const custom = join(dir, 'custom.db');
    process.env.SESSION_COLLAB_DB = custom;
    expect(getDefaultDbPath()).toBe(custom);
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns modern or legacy helpers', () => {
    expect(getModernDbPath()).toContain('.session-collab');
    expect(getLegacyDbPath()).toContain('.claude/session-collab');
  });
});
