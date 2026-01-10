# Session Collab MCP

[![npm version](https://img.shields.io/npm/v/session-collab-mcp.svg)](https://www.npmjs.com/package/session-collab-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Model Context Protocol (MCP) server for Claude Code that prevents conflicts when multiple sessions work on the same codebase simultaneously.

## Problem

When using parallel Claude Code sessions or the parallel-dev workflow:

- Session A is refactoring some code
- Session B doesn't know and thinks the code "has issues" - deletes or reverts it
- Session A's work disappears

**Root cause**: No synchronization mechanism for "work intent" between sessions.

## Solution

Session Collab MCP provides a **Work-in-Progress (WIP) Registry** that allows sessions to:

1. **Declare** - Announce which files you're about to modify
2. **Check** - Verify no other session is working on the same files
3. **Persist** - Save context that survives context compaction
4. **Protect** - Guard critical files from accidental changes
5. **Release** - Free files when done

## Installation

### Option 1: Claude Code Plugin (Recommended)

Install as a Claude Code plugin for automatic MCP server setup, hooks, and skills:

```bash
# Add marketplace
/plugin marketplace add leaf76/session-collab-mcp

# Install plugin
/plugin install session-collab@session-collab-plugins
```

The plugin includes:
- **MCP Server**: Automatically configured
- **Hooks**: SessionStart and PreToolUse reminders
- **Skills**: `collab-start` for full initialization
- **Commands**: `/session-collab:status` and `/session-collab:end`

### Option 2: MCP Server Only

Add to your `~/.claude.json`:

```json
{
  "mcpServers": {
    "session-collab": {
      "command": "npx",
      "args": ["-y", "session-collab-mcp@latest"]
    }
  }
}
```

### Option 3: Global Installation

```bash
npm install -g session-collab-mcp
```

## Features

### Automatic Session Management

Once installed, Claude will:

1. Register a session when conversation starts
2. Check for conflicts before editing files
3. Warn you if another session is working on the same files
4. Clean up when the conversation ends

### Working Memory

Context persistence that survives context compaction:

- **Findings**: Bug root causes, investigation results
- **Decisions**: Architectural choices, design decisions
- **State**: Current implementation status
- **Todos**: Action items and tasks
- **Important**: Critical information to preserve
- **Context**: Background context for the session

### File Protection

Guard critical files from accidental changes:

- Register protected files with reasons and priorities
- Automatic conflict detection for protected files
- Configurable protection levels

### Conflict Handling Modes

Configure behavior with `collab_config`:

| Mode | Behavior |
|------|----------|
| `strict` | Always ask user, never bypass |
| `smart` (default) | Auto-proceed with safe content, ask for blocked |
| `bypass` | Proceed despite conflicts (warn only) |

### Auto-Release Options

| Option | Default | Description |
|--------|---------|-------------|
| `auto_release_immediate` | `false` | Auto-release claims after Edit/Write |
| `auto_release_stale` | `false` | Auto-release claims exceeding threshold |
| `stale_threshold_hours` | `2` | Hours before claim is considered stale |
| `auto_release_delay_minutes` | `5` | Grace period for stale release |

## MCP Tools Reference

### Session Management (4 tools)

| Tool | Purpose |
|------|---------|
| `collab_session_start` | Register a new session |
| `collab_session_end` | End session and release all claims |
| `collab_session_list` | List active sessions |
| `collab_config` | Configure session behavior |

### Claims (1 unified tool)

| Tool | Actions |
|------|---------|
| `collab_claim` | `create`, `check`, `release`, `list` |

### Working Memory (3 tools)

| Tool | Purpose |
|------|---------|
| `collab_memory_save` | Save context (upsert) |
| `collab_memory_recall` | Recall context |
| `collab_memory_clear` | Clear memories |

### Protection (1 unified tool)

| Tool | Actions |
|------|---------|
| `collab_protect` | `register`, `check`, `list` |

### Status Monitoring

| Tool | Purpose |
|------|---------|
| `collab_status` | Unified session status |

## Usage Examples

### Basic Workflow

```bash
# Session A starts working
collab_session_start(project_root="/my/project", name="feature-auth")
collab_claim(action="create", files=["src/auth.ts"], intent="Adding JWT support")

# Session B checks before editing
collab_claim(action="check", files=["src/auth.ts"])
# Result: "CONFLICT: src/auth.ts is claimed by 'feature-auth'"

# Session A finishes
collab_claim(action="release", claim_id="...")
```

### Working Memory

```bash
# Save a finding
collab_memory_save(
  category="finding",
  key="auth_bug_root_cause",
  content="Missing token validation in refresh flow",
  priority=80
)

# Recall active memories
collab_memory_recall(active=true, priority_threshold=70)
```

### File Protection

```bash
# Protect critical file
collab_protect(
  action="register",
  file_path="src/core/auth.ts",
  reason="Core authentication logic",
  priority=95
)

# Check before editing
collab_protect(
  action="check",
  file_paths=["src/core/auth.ts"]
)
# Result: "BLOCKED: File is protected - Core authentication logic"
```

### Status Monitoring

```bash
# Get session status
collab_status(session_id="abc123")
# Result: {
#   session: { id: "abc123", name: "feature-auth", status: "active" },
#   claims: [...],
#   active_memories: 5,
#   message: "Session active. 2 claim(s), 5 memories."
# }
```

## Migration from v1.x

Version 2.0 introduces breaking changes with a simplified API. See [MIGRATION.md](./MIGRATION.md) for detailed migration instructions.

### Key Changes

- **Tool Consolidation**: 50+ tools → 9 core tools
- **Action-Based Interface**: Single tools with multiple actions
- **Simplified Responses**: Cleaner, flatter response formats
- **Removed Features**: LSP integration, messaging, notifications, queuing

## Data Storage

All data is stored locally in `~/.claude/session-collab/collab.db` (SQLite).

- No remote server required
- No API token needed
- Works offline
- Uses WAL mode for multi-process safety

## Development

### Prerequisites

- Node.js 18+
- npm or yarn

### Setup

```bash
npm install
npm run build
```

### Scripts

```bash
npm run build        # Build with tsup
npm run start        # Start the MCP server
npm run start:dev    # Start in development mode
npm run typecheck    # Run TypeScript type checking
npm run lint         # Run ESLint
npm run test         # Run tests with Vitest
```

### Project Structure

```
session-collab-mcp/
├── bin/                    # Executable entry point
├── migrations/             # SQLite migration files
├── plugin/                 # Claude Code Plugin
├── src/
│   ├── cli.ts             # CLI entry point
│   ├── constants.ts       # Version and server instructions
│   ├── db/                # Database layer
│   ├── mcp/               # MCP protocol implementation
│   │   ├── tools/         # Tool implementations
│   │   │   ├── session.ts # Session management
│   │   │   ├── claim.ts   # File/symbol claims
│   │   │   ├── memory.ts  # Working memory
│   │   │   └── protection.ts # File protection
│   │   └── ...
│   └── utils/
└── package.json
```

## Changelog

### v2.0.0 (Breaking)

- **Major Simplification**: Reduced from 50+ tools to 9 core tools
- **Action-Based Design**: Unified tools with action parameters
- **Removed Features**: LSP integration, messaging, notifications, queuing, decision tracking
- **Improved Performance**: Faster startup and reduced complexity
- **Better Testing**: Comprehensive test coverage for all tool actions
- **Migration Guide**: Detailed upgrade path from v1.x

### v0.8.0

- Add working memory system for context persistence (`collab_memory_*` tools)
- Add plan protection (`collab_plan_register`, `collab_plan_update_status`)
- Add file protection (`collab_file_register`, `collab_file_check_protected`)
- Memory categories: finding, decision, state, todo, important, context
- Pinned memories survive context compaction
- Plan lifecycle: draft → approved → in_progress → completed → archived

### v0.7.1

- Add `collab_auto_release` tool for releasing claims after editing
- Add auto-release config options: `auto_release_immediate`, `auto_release_stale`
- Add `cleanupStaleClaims()` for automatic stale claim cleanup
- Add PostToolUse hook to remind auto-release after Edit/Write

### v0.7.0

- Add priority system for claims (0-100 with levels: critical/high/normal/low)
- Add claim queue system (`collab_queue_join`, `collab_queue_leave`, `collab_queue_list`)
- Add notification system (`collab_notifications_list`, `collab_notifications_mark_read`)
- Add audit history tracking (`collab_history_list`)
- Add `collab_claim_update_priority` for escalating urgent work

### v0.6.0

- Optimize database queries with composite indexes
- Extract shared utilities (crypto, response builders)
- Remove unused auth and token modules
- Use precompiled JS for 15x faster startup
- Fix GROUP_CONCAT delimiter for multi-value queries
- Add unified Zod validation across tools

### v0.5.0

- Add reference tracking and impact analysis (Phase 3)
- Add symbol-level claims and LSP integration
- Fix SQLite WAL sync for multi-process MCP servers
- Add `collab_config` tool for conflict handling modes

## License

MIT
