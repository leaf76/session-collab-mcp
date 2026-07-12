// Shared constants for Session Collaboration MCP

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Read version from package.json
function getVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

export const VERSION = getVersion();

export const SERVER_NAME = 'session-collab-mcp';

/** Idle sessions without heartbeat become inactive after this many minutes. */
export const DEFAULT_STALE_SESSION_MINUTES = 15;

/** Max characters stored per working-memory content field. */
export const MAX_MEMORY_CONTENT_CHARS = 800;

/** Default max items for active memory recall. */
export const DEFAULT_RECALL_MAX_ITEMS = 8;

/** Hard cap for memory recall max_items. */
export const MAX_RECALL_MAX_ITEMS = 20;

/** Keep short: hosts also inject skill docs; long instructions burn tokens every session. */
export const SERVER_INSTRUCTIONS = `
Session Collaboration: multi-agent file claims + short working memory.

When: non-trivial edits or parallel sessions on the same repo. Skip pure Q&A/chat.

Workflow: start (reuses same name+project) → collab_claim create (atomic; check optional) → optional memory_save → release → end.
- Paths are normalized to project_root (absolute/relative same file = same claim).
- create is enough to claim; check is probe-only. Batch files in one create.
- start: restore_context default false. list/status/claim responses: detail default false.
- memory: short finding/decision only (content capped). Not a long-term vault — use AI-Memory for durable prefs.
- Do not overwrite another session's claimed work.
`.trim();
