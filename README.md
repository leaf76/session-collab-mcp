# Session Collab MCP

[![npm version](https://img.shields.io/npm/v/session-collab-mcp.svg)](https://www.npmjs.com/package/session-collab-mcp)
[![license](https://img.shields.io/github/license/leaf76/session-collab-mcp)](https://github.com/leaf76/session-collab-mcp/blob/master/LICENSE)
[![Node.js](https://img.shields.io/node/v/session-collab-mcp)](https://www.npmjs.com/package/session-collab-mcp)

**Provider-agnostic Model Context Protocol (MCP) collaboration server** for multi-agent and multi-session workflows: claim files, persist working memory, protect critical paths, and prevent parallel coding-agent conflicts.

Works with Claude Code, Codex, Grok, Cursor, and any MCP client over `stdio` or HTTP JSON-RPC. Optional Claude Code plugin packaging lives under [`plugin/`](plugin/).

**Keywords:** MCP server, multi-agent collaboration, session conflict prevention, file claims, working memory, Claude Code, Codex.

## Problem

When using parallel coding-agent sessions or multi-agent workflows:

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

## Positioning

`session-collab-mcp` has two layers:

- **Core server**: provider-agnostic MCP server over stdio or HTTP JSON-RPC
- **Optional integrations**: provider-specific packaging such as the Claude Code plugin in [`plugin/`](plugin/)

The core server should be the default mental model. Claude Code is one integration target, not the product boundary.

## Installation

### Option 1: Generic MCP Client over stdio

Use this with any MCP client that can launch a local stdio server:

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

The exact config wrapper depends on your MCP client, but the server contract is the same.

### Option 2: HTTP Server + CLI

Use this when your client prefers MCP over HTTP JSON-RPC or when you want a generic shell-friendly wrapper:

```bash
# Start HTTP server
session-collab-http --host 127.0.0.1 --port 8765

# CLI wrapper (convenience REST client)
session-collab health
session-collab tools
session-collab doctor
session-collab call --name collab_session_start --args '{"project_root":"/repo","name":"demo"}'
```

For MCP-over-HTTP clients, use `POST /mcp` with JSON-RPC requests. The `/v1/*` endpoints are a convenience REST facade for lightweight automation and shell usage.

### Option 3: Claude Code Plugin (Optional Integration)

Install as a Claude Code plugin only if Claude Code is your MCP client and you want automatic server setup, hooks, and skills:

```bash
# Add marketplace
/plugin marketplace add leaf76/session-collab-mcp

# Install plugin
/plugin install session-collab@session-collab-plugins
```

The plugin includes:
- **MCP Server**: Automatically configured
- **Hooks**: SessionStart, Stop, and PreCompact reminders
- **Skills**: `collab-start` for full initialization
- **Commands**: `/session-collab:status` and `/session-collab:end`

### Option 4: Global Installation

```bash
npm install -g session-collab-mcp
```

## Features

### Guided Session Workflow

The MCP tools give you a stable collaboration workflow across providers:

1. Start with `collab_session_start` only for non-trivial / multi-session work (`restore_context` defaults **false**; same `name`+project **reuses** session)
2. Reserve files with **`collab_claim(action="create")`** in one batch (atomic claim-or-block; paths normalized to project_root). `check` is optional probe-only
3. Update progress with `collab_session_update` sparingly (milestones)
4. Save **short** findings/decisions with `collab_memory_save` (≤800 chars; not a long-term vault)
5. Release with `collab_claim(action="release")`
6. End with `collab_session_end`

Token-friendly defaults: list/status/claim happy-path are **compact** unless `detail=true`.

### Local MCP + plugin skills

```bash
npm run install:local   # build dist + sync plugin skills/commands into Claude cache
```

Point your MCP config at `dist/cli.js` (this repo). Restart the host after install.

### Working Memory

Context persistence that survives context compaction:

- **Findings**: Bug root causes, investigation results
- **Decisions**: Architectural choices, design decisions
- **State**: Current implementation status
- **Todos**: Action items and tasks
- **Important**: Critical information to preserve
- **Context**: Background context for the session

### File Protection

Guard important plan files or created files from accidental deletion:

- Register a protected plan with `collab_protect(action="register", type="plan", ...)`
- Register a created file with `collab_protect(action="register", type="file", ...)`
- Check protection status before deleting or replacing a file

### Conflict Handling Modes

Configure behavior with `collab_config`:

| Mode | Behavior |
|------|----------|
| `strict` | Block conflicting claims and require user coordination before editing |
| `smart` (default) | Claim non-conflicting files or symbols, queue blocked files, and expose coordination requests |
| `bypass` | Allow overlapping claims only with `allow_conflicts=true`, and return a warning |

In `smart` mode, prefer symbol-level claims when working inside a file that another session has claimed. Same-file work can proceed when claimed symbols do not overlap. If overlap cannot be proven safe, `collab_claim(action="create")` returns `waiting_for_coordination` or `partial_claim_created` with:

- `claimed_files`: files reserved by the caller
- `safe_files`: files that can be edited now
- `blocked_files`: files that need coordination first
- `coordination_requests`: queue entries visible through `collab_status` and `collab_session_list`

### Auto-Release Options

| Option | Default | Description |
|--------|---------|-------------|
| `auto_release_immediate` | `false` | Auto-release claims after Edit/Write |
| `auto_release_stale` | `false` | Auto-release claims exceeding threshold |
| `stale_threshold_hours` | `2` | Hours before claim is considered stale |
| `auto_release_delay_minutes` | `5` | Grace period for stale release |

## MCP Tools Reference

### Session Management

| Tool | Purpose |
|------|---------|
| `collab_session_start` | Register a session (`restore_context` / `max_restore_items` optional; restore off by default) |
| `collab_session_end` | End session and release all claims |
| `collab_session_list` | List sessions (summary by default; `detail=true` for full claims/coordination) |
| `collab_session_update` | Update heartbeat, current task, todos, and progress |
| `collab_config` | Configure session behavior |
| `collab_status` | Session status (counts by default; `detail=true` for full payloads) |

### Claims (1 unified tool)

| Tool | Actions |
|------|---------|
| `collab_claim` | `create`, `check`, `release`, `list` (check: `exclude_self` defaults to true; create follows `collab_config(mode)`) |

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

### HTTP API (v1)

`/v1/*` endpoints map 1:1 to MCP tools and return JSON responses with `trace_id` on failures:

- `POST /v1/sessions/start` → `collab_session_start`
- `POST /v1/sessions/end` → `collab_session_end`
- `POST /v1/sessions/update` → `collab_session_update`
- `GET /v1/sessions` → `collab_session_list`
- `POST /v1/config` → `collab_config`
- `GET /v1/status` → `collab_status`
- `POST /v1/claims` → `collab_claim` (create)
- `POST /v1/claims/check` → `collab_claim` (check)
- `POST /v1/claims/release` → `collab_claim` (release)
- `GET /v1/claims` → `collab_claim` (list)
- `POST /v1/memory/save` → `collab_memory_save`
- `POST /v1/memory/recall` → `collab_memory_recall`
- `POST /v1/memory/clear` → `collab_memory_clear`
- `POST /v1/protect/register` → `collab_protect` (register)
- `POST /v1/protect/check` → `collab_protect` (check)
- `GET /v1/protect/list` → `collab_protect` (list)
- `POST /v1/tools/call` / `GET /v1/tools` (generic access)

### MCP over HTTP

- `POST /mcp` accepts JSON-RPC `initialize`, `tools/list`, and `tools/call` requests
- `GET /mcp` currently returns a clear "stream not supported" response instead of pretending to be full Streamable HTTP SSE
- Localhost binds enforce Host and Origin validation
- Non-local binds require both `SESSION_COLLAB_HTTP_TOKEN` and an allowed-host list via `SESSION_COLLAB_ALLOWED_HOSTS` or repeated `--allowed-host`

## Usage Examples

### Basic Workflow

```bash
# Session A starts working
collab_session_start(project_root="/my/project", name="feature-auth")
collab_claim(session_id="session-a", action="create", files=["src/auth.ts"], intent="Adding JWT support")
collab_session_update(session_id="session-a", current_task="Adding JWT support")

# Session B checks before editing
collab_claim(session_id="session-b", action="check", files=["src/auth.ts"])
# Result: "CONFLICT: src/auth.ts is claimed by 'feature-auth'"

# create in smart mode queues blocked files instead of editing over the owner
collab_claim(session_id="session-b", action="create", files=["src/auth.ts"], intent="Coordinated auth work")
# Result: status="waiting_for_coordination", blocked_files=["src/auth.ts"]

# If only a different symbol is needed, claim that symbol explicitly
collab_claim(
  session_id="session-b",
  action="create",
  symbols=[{ file="src/auth.ts", symbols=["refreshToken"], symbol_type="function" }],
  intent="Update refresh token"
)
# Result: status="created" if no claimed symbol overlaps

# If you want to include your own claims in the check
collab_claim(session_id="session-a", action="check", files=["src/auth.ts"], exclude_self=false)

# Session A finishes
collab_claim(session_id="session-a", action="release", claim_id="...")
```

### Working Memory

```bash
# Save a finding
collab_memory_save(
  session_id="abc123",
  category="finding",
  key="auth_bug_root_cause",
  content="Missing token validation in refresh flow",
  priority=80
)

# Recall active memories
collab_memory_recall(session_id="abc123", active=true)
```

### File Protection

```bash
# Protect a plan document
collab_protect(
  action="register",
  session_id="abc123",
  type="plan",
  file_path="docs/feature-plan.md",
  title="Feature plan",
  content_summary="Steps, risks, and rollout notes"
)

# Check before editing
collab_protect(
  action="check",
  session_id="abc123",
  file_path="docs/feature-plan.md"
)
# Result: "Protected (plan). Confirm before deleting."
```

### Status Monitoring

```bash
# Get session status
collab_status(session_id="abc123")
# Result: {
#   session: { id: "abc123", name: "feature-auth", status: "active" },
#   claims: [...],
#   other_sessions: 1,
#   message: "Session active. 2 claim(s), 5 memories."
# }
```

## Migration from v1.x

Version 2.0 introduces breaking changes with a simplified API. See [MIGRATION.md](./MIGRATION.md) for detailed migration instructions.

### Key Changes

- **Tool Consolidation**: 50+ tools → 10 core tools
- **Action-Based Interface**: Single tools with multiple actions
- **Simplified Responses**: Cleaner, flatter response formats
- **Removed Features**: LSP integration, messaging, notifications, queuing

## Data Storage

All data is stored locally in `~/.claude/session-collab/collab.db` (SQLite).

- No remote server required
- Localhost HTTP usage works without an API token
- Non-local HTTP binds require `SESSION_COLLAB_HTTP_TOKEN`
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

### Legacy Build (Optional)

Legacy schemas/queries are kept out of the default bundle. To include a legacy entry for compatibility:

```bash
SESSION_COLLAB_INCLUDE_LEGACY=true npm run build
```

Maintenance note: legacy exports are for backward compatibility only and are not exposed in the v2 tool list.

### Scripts

```bash
npm run build        # Build with tsup
npm run start        # Start the MCP server
npm run start:dev    # Start in development mode
npm run typecheck    # Run TypeScript type checking
npm run lint         # Run ESLint
npm run test         # Run tests with Vitest
npm run test:http    # Run HTTP integration tests
npm run test:release # Run release gate: typecheck, lint, tests, HTTP tests, npm pack dry-run
```

### HTTP Integration Tests

HTTP integration tests require a local listen port. Enable them with:

```bash
npm run test:http
```

### HTTP CLI Doctor

When using the HTTP server, validate the running server with:

```bash
session-collab doctor --base-url http://127.0.0.1:8765
```

### Historical Notes

The changelog entries below document historical milestones, including tools and workflows that were removed before the current v2 API. Treat the tool tables and examples above as the source of truth for the current public surface.

### Project Structure

```
session-collab-mcp/
├── bin/                    # Executable entry point
├── migrations/             # SQLite migration files
├── plugin/                 # Optional Claude Code integration
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

### v2.5.0

- Normalize claim paths to `project_root` (absolute ≡ relative; reject traversal)
- Session start reuses same `name`+project by default (`force_new` to skip); idle stale default 15 minutes
- Prefer atomic `collab_claim` create; compact happy-path responses (`detail` for full payloads)
- `list`/`status` summary uses SQL counts; memory content capped (800 chars) with smaller active recall default
- Token-conscious skills/`SERVER_INSTRUCTIONS`; collab memory vs AI-Memory role split
- Add `npm run install:local` to build and sync plugin skills into Claude cache

### v2.4.0

- `restore_context` defaults false on start; `list`/`status` summary unless `detail=true`
- Shorten server instructions; non-trivial-only collab-start guidance

### v2.3.1

- Add `collab_session_update` for heartbeat, current task, todo, and progress reporting
- Enrich `collab_session_list` with current task and active claim summaries
- Make `collab_claim(action="create")` respect `collab_config(mode)` with smart coordination by default
- Add `session-collab doctor` for HTTP server health and tool-surface checks
- Add `npm run test:http` and `npm run test:release` release gates
- Update dev test tooling to clear npm audit findings

### v2.1.0

- Add HTTP server + CLI wrapper for universal AI CLI usage
- Add HTTP API endpoints and utils tests
- Add legacy entry for deprecated schemas/queries (optional build)
- Improve claim conflict accuracy and release summaries
- Expand test coverage across MCP tools and DB flows

### v2.0.0 (Breaking)

- **Major Simplification**: Reduced from 50+ tools to 10 core tools
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

## Related

- [lazy-desktop-mcp](https://github.com/leaf76/lazy-desktop-mcp) — desktop computer-use MCP
- [lazy_mobile_mcp](https://github.com/leaf76/lazy_mobile_mcp) — Android/iOS mobile automation MCP
- [lazy-media-mcp](https://github.com/leaf76/lazy-media-mcp) — image/video prep for AI vision

## License

[MIT](./LICENSE) © leaf76
