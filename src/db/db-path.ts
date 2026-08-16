import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export function getLegacyDbPath(): string {
  return join(homedir(), '.claude', 'session-collab', 'collab.db');
}

export function getModernDbPath(): string {
  return join(homedir(), '.session-collab', 'collab.db');
}

/**
 * Resolve the local SQLite path.
 * Order: SESSION_COLLAB_DB → existing modern path → existing legacy path → modern (new installs).
 */
export function getDefaultDbPath(): string {
  const fromEnv = process.env.SESSION_COLLAB_DB?.trim();
  if (fromEnv) {
    return isAbsolute(fromEnv) ? fromEnv : resolve(fromEnv);
  }

  const modern = getModernDbPath();
  const legacy = getLegacyDbPath();
  if (existsSync(modern)) return modern;
  if (existsSync(legacy)) return legacy;
  return modern;
}

export function getDataDir(dbPath: string = getDefaultDbPath()): string {
  return dirname(dbPath);
}
