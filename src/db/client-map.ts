import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeProjectRoot } from '../utils/paths.js';
import { getDataDir } from './db-path.js';

const PENDING_MAX_AGE_MS = 10 * 60 * 1000;

type ClientMap = Record<string, string>;

type PendingClient = {
  claude_session_id: string;
  cwd: string;
  ts: number;
};

function mapPath(): string {
  return join(getDataDir(), 'client-map.json');
}

function pendingPath(): string {
  return join(getDataDir(), 'pending-client.json');
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(getDataDir(), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value)}\n`, 'utf8');
}

export function writePendingClientSession(claudeSessionId: string, cwd: string): void {
  if (!claudeSessionId || !cwd) return;
  writeJson(pendingPath(), {
    claude_session_id: claudeSessionId,
    cwd,
    ts: Date.now(),
  } satisfies PendingClient);
}

export function bindClientSession(
  collabSessionId: string,
  projectRoot: string,
  explicitClientId?: string
): string | null {
  const map = readJson<ClientMap>(mapPath(), {});
  const clientId = explicitClientId?.trim() || consumePendingClientId(projectRoot);
  if (!clientId) return mapByCollab(map, collabSessionId);

  map[clientId] = collabSessionId;
  writeJson(mapPath(), map);
  return clientId;
}

export function lookupCollabSessionId(claudeSessionId: string | undefined): string | null {
  if (!claudeSessionId) return null;
  const map = readJson<ClientMap>(mapPath(), {});
  return map[claudeSessionId] ?? null;
}

function mapByCollab(map: ClientMap, collabSessionId: string): string | null {
  const entry = Object.entries(map).find(([, id]) => id === collabSessionId);
  return entry?.[0] ?? null;
}

function consumePendingClientId(projectRoot: string): string | undefined {
  const pending = readJson<PendingClient | null>(pendingPath(), null);
  if (!pending?.claude_session_id || !pending.cwd) return undefined;
  if (Date.now() - pending.ts > PENDING_MAX_AGE_MS) return undefined;

  try {
    if (normalizeProjectRoot(pending.cwd) !== normalizeProjectRoot(projectRoot)) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return pending.claude_session_id;
}
