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
   - Or use \`collab_auto_release\` after Edit/Write to release individual files

6. **On conversation end**: Call \`collab_session_end\` to clean up

## Auto-Release (NEW in 0.7.1)

Automatically release claims after editing:

### Immediate Release
After Edit/Write, call \`collab_auto_release\` with:
- \`session_id\`: Your session ID
- \`file_path\`: The file you just edited
- \`force\`: (optional) Force release for medium/large scope claims

**Behavior by scope:**
- \`small\`: Auto-releases immediately
- \`medium/large\`: Requires \`force=true\` or \`auto_release_immediate\` config

### Stale Claim Cleanup
Claims are automatically cleaned up when:
- Session has \`auto_release_stale: true\` in config
- Claim exceeds \`stale_threshold_hours\` (default: 2 hours)

### Configuration
Use \`collab_config\` to enable auto-release:
\`\`\`json
{
  "session_id": "...",
  "auto_release_immediate": true,
  "auto_release_stale": true,
  "stale_threshold_hours": 2,
  "auto_release_delay_minutes": 5
}
\`\`\`

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

## Reference Tracking & Impact Analysis

Store and query symbol references for smart conflict detection:

### collab_store_references

Persist LSP reference data for future impact queries:

\`\`\`
1. Claude: LSP.findReferences("validateToken")
2. Claude: collab_store_references({
     session_id: "...",
     references: [{
       source_file: "src/auth.ts",
       source_symbol: "validateToken",
       references: [
         { file: "src/api/users.ts", line: 15 },
         { file: "src/api/orders.ts", line: 23 }
       ]
     }]
   })
\`\`\`

### collab_impact_analysis

Check if modifying a symbol would affect files claimed by others:

\`\`\`
Claude: collab_impact_analysis({
  session_id: "...",
  file: "src/auth.ts",
  symbol: "validateToken"
})

Response: {
  risk_level: "high",
  reference_count: 3,
  affected_files: ["src/api/users.ts", "src/api/orders.ts"],
  affected_claims: [{ session_name: "other-session", intent: "..." }],
  message: "HIGH RISK: 1 active claim on referencing files"
}
\`\`\`

### Risk Levels

- **high**: Other sessions have claims on files that reference this symbol
- **medium**: Many references (>10) but no active claims conflict
- **low**: Few references, no conflicts

## Priority System

Claims have priority levels (0-100):
- **Critical (90-100)**: Urgent production fixes
- **High (70-89)**: Important features
- **Normal (40-69)**: Regular work (default: 50)
- **Low (0-39)**: Nice-to-have changes

Set priority when claiming:
\`\`\`json
{
  "session_id": "...",
  "files": ["src/critical-bug.ts"],
  "intent": "Fix production crash",
  "priority": 95
}
\`\`\`

Use \`collab_claim_update_priority\` to escalate urgent work.

## Claim Queue

When blocked by another claim, join the waiting queue:

1. **Join queue**: \`collab_queue_join\` with the blocked claim's ID
2. **Check notifications**: \`collab_notifications_list\` for \`queue_ready\` notification
3. **When notified**: Proceed with your work

Higher priority claims are served first within the queue.

Queue tools:
- \`collab_queue_join\`: Join waiting queue for a blocked claim
- \`collab_queue_leave\`: Leave the queue if no longer needed
- \`collab_queue_list\`: View queue status

## Notifications

Check \`collab_notifications_list\` periodically for:
- **claim_released**: Claim you waited for is now available
- **queue_ready**: You're next in queue, proceed with your work
- **conflict_detected**: Someone claimed files you're interested in
- **session_message**: Direct message from another session

Mark notifications as read with \`collab_notifications_mark_read\`.

## Audit History

Use \`collab_history_list\` to debug coordination issues:
- Track session starts/ends
- View claim creation/release history
- Identify conflict patterns
- Monitor queue activity

Filter by session, action type, or date range. Entries auto-deleted after 7 days.

## Working Memory (Context Persistence)

Persist important context to survive Claude's automatic compaction/summarization.

### When to Use

- **Findings**: Important discoveries during investigation
- **Decisions**: Choices made and their rationale
- **State**: Current status, file paths, variable values
- **Context**: General context that should be remembered

### Save Important Context

\`\`\`
collab_memory_save({
  session_id: "...",
  category: "finding",
  key: "auth_bug_root_cause",
  content: "JWT validation skipped in middleware due to order issue",
  priority: 80,
  pinned: true
})
\`\`\`

### Recall Context

\`\`\`
collab_memory_recall({
  session_id: "...",
  category: "finding"  // optional filter
})
\`\`\`

### Get Active Memories

Get all pinned + high-priority memories for context restoration:

\`\`\`
collab_memory_active({
  session_id: "...",
  priority_threshold: 70
})
\`\`\`

### Memory Categories

- **finding**: Discovered facts, root causes, patterns
- **decision**: Architectural choices, implementation decisions
- **state**: Current file, line number, tracking variables
- **todo**: Pending work items, follow-ups
- **important**: Critical information that must not be lost
- **context**: General context for understanding

### Priority Levels

- **90-100**: Critical - always recall
- **70-89**: High - recall by default
- **50-69**: Normal - recall on demand
- **0-49**: Low - background context

### Pinned Memories

Pin critical memories to ensure they are always loaded:

\`\`\`
collab_memory_pin({
  session_id: "...",
  key: "root_cause",
  pinned: true
})
\`\`\`

### Memory Tools

| Tool | Purpose |
|------|---------|
| \`collab_memory_save\` | Save important context |
| \`collab_memory_recall\` | Retrieve saved memories |
| \`collab_memory_update\` | Update existing memory |
| \`collab_memory_clear\` | Clear memories |
| \`collab_memory_pin\` | Pin/unpin a memory |
| \`collab_memory_stats\` | Get memory statistics |
| \`collab_memory_active\` | Get all active memories |

## Plan & File Protection

Protect important files (plans, session-created files) from accidental deletion or overwriting.

### Register Plans

After creating a plan document, register it for protection:

\`\`\`
collab_plan_register({
  session_id: "...",
  file_path: "docs/implementation-plan.md",
  title: "Auth System Refactor Plan",
  content_summary: "1. Migrate to JWT\\n2. Add refresh tokens\\n3. Update middleware",
  status: "approved"
})
\`\`\`

Plans are automatically:
- **Pinned** (always appear in active memory)
- **High priority** (95/100)
- **Protected** from deletion warnings

### Plan Status Lifecycle

\`\`\`
draft → approved → in_progress → completed → archived
                                     ↓
                              (Protection reduced)
                              (Priority: 50 → 30)
                              (Unpinned)
\`\`\`

Update plan status as work progresses:

\`\`\`
collab_plan_update_status({
  session_id: "...",
  file_path: "docs/implementation-plan.md",
  status: "completed",
  summary: "All tasks completed. JWT auth implemented."
})
\`\`\`

### Register Created Files

Track important files created during the session:

\`\`\`
collab_file_register({
  session_id: "...",
  file_path: "src/auth/jwt-validator.ts",
  file_type: "code",
  description: "New JWT validation utility"
})
\`\`\`

### Check Before Deleting

Before deleting any file, check if it's protected:

\`\`\`
collab_file_check_protected({
  session_id: "...",
  file_path: "docs/implementation-plan.md"
})

// Response:
{
  protected: true,
  reason: "plan",
  warning: "⚠️ This file is protected (plan). Confirm before deleting."
}
\`\`\`

### Protection Tools

| Tool | Purpose |
|------|---------|
| \`collab_plan_register\` | Register a plan for protection |
| \`collab_plan_update_status\` | Update plan status |
| \`collab_plan_get\` | Get plan info |
| \`collab_plan_list\` | List all plans |
| \`collab_file_register\` | Register created file |
| \`collab_file_list_created\` | List created files |
| \`collab_file_check_protected\` | Check if file is protected |
| \`collab_file_list_protected\` | List all protected files |

### Why This Matters

When Claude's context is compacted:
- Important plan details may be lost
- Session-created files might be forgotten
- Claude might accidentally delete recently created files

With protection:
- Plans are pinned in working memory
- Created files are tracked
- Deletion triggers warnings
- Context survives summarization

## Best Practices

- **Prefer symbol-level claims** for focused changes (single function/class)
- **Use file-level claims** for large refactors affecting many symbols
- **Use LSP validation** when unsure about symbol names
- **Check references** before modifying widely-used symbols
- **Set appropriate priority** for urgent work (95+ for production fixes)
- **Check notifications** when waiting for blocked claims
- **Save important findings** to working memory as you discover them
- **Pin critical context** that must survive compaction
- Claim early, release when done
- Use descriptive intents (e.g., "Refactoring validateToken for JWT support")
`.trim();
