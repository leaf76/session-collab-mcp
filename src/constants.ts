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
# Session Collaboration

This MCP server coordinates multiple Claude Code sessions working on the same codebase.

## Required Behaviors

1. **On conversation start**: Immediately call \`collab_session_start\` with:
   - project_root: Current working directory
   - name: Descriptive session name (e.g., "feature-auth", "bugfix-api")

2. **Before editing any file**: Call \`collab_check\` with the file path to verify no conflicts

3. **If conflicts detected** (DEFAULT: coordinate):
   - Show warning to user with options:
     a) **Coordinate** (default): Send message to other session via \`collab_message_send\`, wait for response
     b) **Bypass**: Proceed anyway (warn about potential conflicts)
     c) **Request release**: Ask owner to release if claim seems stale
   - NEVER auto-release another session's claim without explicit user permission

4. **For significant changes**: Call \`collab_claim\` before starting work on files

5. **When done with files**: Call \`collab_release\` with YOUR session_id to free them

6. **On conversation end**: Call \`collab_session_end\` to clean up

## Permission Rules

- You can ONLY release claims that belong to YOUR session
- To release another session's claim, you must ask the user and they must explicitly confirm
- Use \`force=true\` in \`collab_release\` only after user explicitly confirms
- When user chooses "coordinate", send a message first and suggest waiting

## Conflict Handling Modes

Configure your session behavior with \`collab_config\`:

- **"strict"**: Always ask user, never bypass or auto-release
- **"smart"** (default): Ask user, but suggest auto-release for stale claims (>2hr old)
- **"bypass"**: Proceed despite conflicts (just warn, don't block)

Config options:
- \`mode\`: strict | smart | bypass
- \`allow_release_others\`: Allow releasing other sessions' claims (default: false)
- \`auto_release_stale\`: Auto-release stale claims (default: false)
- \`stale_threshold_hours\`: Hours before claim is stale (default: 2)

## Best Practices

- Claim files early, release when done
- Use descriptive intents when claiming (e.g., "Refactoring auth module")
- Check for messages periodically with \`collab_message_list\`
- Record architectural decisions with \`collab_decision_add\`
`.trim();
