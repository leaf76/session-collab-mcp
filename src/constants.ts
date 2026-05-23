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

export const SERVER_INSTRUCTIONS = `
# Session Collaboration MCP

Coordinate sessions and persist context across conversations.

## Core Tools

### Session
- \`collab_session_start\`: Start session with project_root
- \`collab_session_end\`: End session, release claims
- \`collab_session_list\`: List active sessions and their active claim summaries
- \`collab_session_update\`: Update heartbeat, current task, todos, and progress
- \`collab_config\`: Configure session behavior
- \`collab_status\`: Get session status and summary

### Claims (1 tool)
- \`collab_claim\`: Unified claim tool
  - action: "create" | "check" | "release" | "list"

### Memory (3 tools)
- \`collab_memory_save\`: Save context (upsert)
- \`collab_memory_recall\`: Recall context (use active=true for restoration)
- \`collab_memory_clear\`: Clear memories

### Protection (1 tool)
- \`collab_protect\`: Unified protection tool
  - action: "register" | "check" | "list"

## Workflow

1. **On start**: \`collab_session_start\` with project_root
2. **Before editing**: \`collab_claim\` action="check"
3. **For changes**: \`collab_claim\` action="create" (smart mode claims safe files and queues blocked files)
4. **Save context**: \`collab_memory_save\` for important findings
5. **While working**: \`collab_session_update\` with current_task/todos
6. **When done**: \`collab_claim\` action="release"
7. **On end**: \`collab_session_end\`

## Conflict Handling

- \`strict\`: conflicting claims are blocked; coordinate before editing.
- \`smart\` (default): same-file work can proceed when symbol claims do not overlap; mixed requests claim safe files and create coordination requests for blocked files.
- \`bypass\`: overlapping claims require explicit \`allow_conflicts=true\` and return a warning.
- If a file is blocked, narrow the claim to specific symbols before retrying. Do not overwrite, revert, or delete another active session's work.
- Check \`collab_status\` or \`collab_session_list\` for pending coordination requests.

## Memory Categories

- **finding**: Discovered facts, root causes
- **decision**: Architectural choices
- **state**: Current tracking info
- **important**: Critical context
- **context**: General context

## Best Practices

- Save important findings to memory as you discover them
- Use active=true in recall to restore context
- Register plans with collab_protect for protection
- Check files before editing to avoid conflicts
`.trim();
