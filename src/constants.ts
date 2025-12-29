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

3. **Follow the \`recommendation\` from collab_check automatically**:
   - \`proceed_all\`: All files/symbols safe. Edit them without asking user.
   - \`proceed_safe_only\`: Some content blocked. Edit ONLY safe files/symbols, skip blocked. No need to ask user.
   - \`abort\`: All content blocked. Inform user and suggest coordination.

4. **For significant changes**: Call \`collab_claim\` before starting work

5. **When done**: Call \`collab_release\` with YOUR session_id to free them

6. **On conversation end**: Call \`collab_session_end\` to clean up

## Symbol-Level Claims (Fine-Grained)

Use symbol-level claims when modifying specific functions/classes, allowing other sessions to work on different parts of the same file.

**Claim specific symbols:**
\`\`\`json
{
  "symbols": [
    { "file": "src/auth.ts", "symbols": ["validateToken", "refreshToken"] }
  ],
  "intent": "Refactoring token validation"
}
\`\`\`

**Check specific symbols:**
\`\`\`json
{
  "files": ["src/auth.ts"],
  "symbols": [
    { "file": "src/auth.ts", "symbols": ["validateToken"] }
  ]
}
\`\`\`

**Conflict levels:**
- \`file\`: Whole file is claimed (no symbols specified)
- \`symbol\`: Only specific functions/classes are claimed

**Example scenario:**
- Session A claims \`validateToken\` in auth.ts
- Session B wants to modify \`refreshToken\` in auth.ts
- → No conflict! Session B can proceed.

## Auto-Decision Rules

When \`collab_check\` returns:
- \`can_edit: true\` → Proceed with safe content automatically
- \`can_edit: false\` → Stop and inform user about blocked content

For symbol-level checks, use \`symbol_status.safe\` and \`symbol_status.blocked\`.

## Permission Rules

- You can ONLY release claims that belong to YOUR session
- To release another session's claim, you must ask the user and they must explicitly confirm
- Use \`force=true\` in \`collab_release\` only after user explicitly confirms

## Conflict Handling Modes

Configure your session behavior with \`collab_config\`:

- **"strict"**: Always ask user, never bypass or auto-release
- **"smart"** (default): Auto-proceed with safe content, ask for blocked
- **"bypass"**: Proceed despite conflicts (just warn, don't block)

## LSP Integration (Advanced)

For precise symbol validation and impact analysis, use LSP tools:

### Workflow with LSP

1. **Get symbols from LSP**: Use \`LSP.documentSymbol\` to get actual symbols in a file
2. **Validate before claiming**: Use \`collab_validate_symbols\` to verify symbol names
3. **Analyze conflicts with context**: Use \`collab_analyze_symbols\` for enhanced conflict detection

### collab_validate_symbols

Validate symbol names exist before claiming:

\`\`\`
1. Claude: LSP.documentSymbol("src/auth.ts")
2. Claude: collab_validate_symbols({
     file: "src/auth.ts",
     symbols: ["validateToken", "refreshTokne"],  // typo!
     lsp_symbols: [/* LSP output */]
   })
3. Response: { invalid_symbols: ["refreshTokne"], suggestions: { "refreshTokne": ["refreshToken"] } }
\`\`\`

### collab_analyze_symbols

Enhanced conflict detection with LSP data:

\`\`\`
1. Claude: LSP.documentSymbol("src/auth.ts")
2. Claude: LSP.findReferences("validateToken")
3. Claude: collab_analyze_symbols({
     session_id: "...",
     files: [{ file: "src/auth.ts", symbols: [/* LSP symbols */] }],
     references: [{ symbol: "validateToken", file: "src/auth.ts", references: [...] }]
   })
4. Response: {
     can_edit: true,
     recommendation: "proceed_safe_only",
     symbols: [
       { name: "validateToken", conflict_status: "blocked", impact: { references_count: 5, affected_files: [...] } },
       { name: "refreshToken", conflict_status: "safe" }
     ]
   }
\`\`\`

### Benefits of LSP Integration

- **Accurate symbol names**: No typos in claims
- **Impact awareness**: Know which files will be affected by changes
- **Smart prioritization**: Focus on low-impact changes first

## Best Practices

- **Prefer symbol-level claims** for focused changes (single function/class)
- **Use file-level claims** for large refactors affecting many symbols
- **Use LSP validation** when unsure about symbol names
- **Check references** before modifying widely-used symbols
- Claim early, release when done
- Use descriptive intents (e.g., "Refactoring validateToken for JWT support")
`.trim();
