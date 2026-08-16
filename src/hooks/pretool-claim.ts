#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { createLocalDatabase, getDefaultDbPath } from '../db/sqlite-adapter.js';
import { lookupCollabSessionId, writePendingClientSession } from '../db/client-map.js';
import { normalizeClaimPath, normalizeProjectRoot, PathNormalizationError } from '../utils/paths.js';
import { decidePretoolWrite, extractWritePath } from './pretool-policy.js';

type HookInput = {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
};

function allow(): never {
  process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
  process.exit(0);
}

function deny(reason: string): never {
  const payload = {
    hookSpecificOutput: { permissionDecision: 'deny' },
    systemMessage: reason,
  };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exit(2);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  if (process.env.SESSION_COLLAB_HOOK_DISABLE === '1') {
    allow();
  }

  const raw = await readStdin();
  let input: HookInput = {};
  try {
    input = raw.trim() ? (JSON.parse(raw) as HookInput) : {};
  } catch {
    allow();
  }

  if (input.hook_event_name === 'SessionStart' && input.session_id && input.cwd) {
    writePendingClientSession(input.session_id, input.cwd);
    allow();
  }

  const toolName = input.tool_name ?? '';
  const filePath = extractWritePath(toolName, input.tool_input);
  if (!filePath) {
    allow();
  }

  const dbPath = getDefaultDbPath();
  if (!existsSync(dbPath)) {
    allow();
  }

  const projectRoot = normalizeProjectRoot(
    process.env.CLAUDE_PROJECT_DIR?.trim() || input.cwd || process.cwd()
  );

  let relativePath: string;
  try {
    relativePath = normalizeClaimPath(filePath, projectRoot);
  } catch (error) {
    if (error instanceof PathNormalizationError) {
      allow();
    }
    throw error;
  }

  const db = createLocalDatabase(dbPath);
  try {
    const hits = await db
      .prepare(
        `SELECT c.session_id as session_id, s.name as session_name, cf.file_path as file_path
         FROM claim_files cf
         JOIN claims c ON c.id = cf.claim_id
         JOIN sessions s ON s.id = c.session_id
         WHERE c.status = 'active' AND s.status = 'active'
           AND s.project_root = ? AND cf.file_path = ?`
      )
      .bind(projectRoot, relativePath)
      .all<{ session_id: string; session_name: string; file_path: string }>();

    const activeSessions = await db
      .prepare(
        `SELECT id FROM sessions WHERE status = 'active' AND project_root = ?`
      )
      .bind(projectRoot)
      .all<{ id: string }>();

    const soleActiveSessionId =
      activeSessions.results.length === 1 ? activeSessions.results[0]?.id ?? null : null;

    const decision = decidePretoolWrite({
      selfCollabSessionId: lookupCollabSessionId(input.session_id),
      soleActiveSessionId,
      hits: hits.results,
    });

    if (decision.decision === 'deny' && decision.reason) {
      deny(decision.reason);
    }
    allow();
  } finally {
    db.close();
  }
}

main().catch(() => {
  allow();
});
