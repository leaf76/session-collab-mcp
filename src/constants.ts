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

## 9 Core Tools

### Session (4 tools)
- \`collab_session_start\`: Start session with project_root
- \`collab_session_end\`: End session, release claims
- \`collab_session_list\`: List active sessions
- \`collab_config\`: Configure session behavior

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
3. **For changes**: \`collab_claim\` action="create"
4. **Save context**: \`collab_memory_save\` for important findings
5. **When done**: \`collab_claim\` action="release"
6. **On end**: \`collab_session_end\`

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
