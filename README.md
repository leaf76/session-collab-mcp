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
3. **Communicate** - Send messages between sessions
4. **Release** - Free files when done

## Installation

### Zero-Config Setup

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

That's it! The MCP server includes built-in instructions that Claude follows automatically.

### Manual Installation

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

### Symbol-Level Claims

Fine-grained conflict detection at the function/class level:

```
Session A claims: validateToken() in auth.ts
Session B wants: refreshToken() in auth.ts
Result: No conflict! Different symbols in same file.
```

### LSP Integration

Works with Claude Code's LSP tools for:

- Accurate symbol validation (no typos in claims)
- Impact analysis (know which files reference your changes)
- Smart prioritization (focus on low-impact changes first)

### Conflict Handling Modes

Configure behavior with `collab_config`:

| Mode | Behavior |
|------|----------|
| `strict` | Always ask user, never bypass |
| `smart` (default) | Auto-proceed with safe content, ask for blocked |
| `bypass` | Proceed despite conflicts (warn only) |

## MCP Tools Reference

### Session Management

| Tool | Purpose |
|------|---------|
| `collab_session_start` | Register a new session |
| `collab_session_end` | End session and release all claims |
| `collab_session_list` | List active sessions |
| `collab_session_heartbeat` | Update session heartbeat |
| `collab_status_update` | Share current work status |
| `collab_config` | Configure conflict handling mode |

### Claims (File/Symbol Locking)

| Tool | Purpose |
|------|---------|
| `collab_claim` | Reserve files or symbols before modifying |
| `collab_check` | Check if files/symbols are claimed by others |
| `collab_release` | Release claimed files/symbols |
| `collab_claims_list` | List all WIP claims |

### Inter-Session Communication

| Tool | Purpose |
|------|---------|
| `collab_message_send` | Send message to other sessions |
| `collab_message_list` | Read messages |

### Architectural Decisions

| Tool | Purpose |
|------|---------|
| `collab_decision_add` | Record design decisions |
| `collab_decision_list` | View recorded decisions |

### LSP Integration (Advanced)

| Tool | Purpose |
|------|---------|
| `collab_analyze_symbols` | Analyze LSP symbols for conflict detection |
| `collab_validate_symbols` | Validate symbol names before claiming |
| `collab_store_references` | Store LSP reference data for impact tracking |
| `collab_impact_analysis` | Analyze impact of modifying a symbol |

## Usage Examples

### Basic Workflow

```
# Session A starts working
collab_session_start(project_root="/my/project", name="feature-auth")
collab_claim(files=["src/auth.ts"], intent="Adding JWT support")

# Session B checks before editing
collab_check(files=["src/auth.ts"])
# Result: "src/auth.ts is being worked on by 'feature-auth' - Adding JWT support"

# Session A finishes
collab_release(claim_id="...", status="completed", summary="Added JWT validation")
```

### Symbol-Level Claims

```
# Claim specific functions only
collab_claim(
  symbols=[{file: "src/auth.ts", symbols: ["validateToken", "refreshToken"]}],
  intent="Refactoring token validation"
)

# Other sessions can still work on other functions in the same file
```

### Impact Analysis

```
# Before modifying a widely-used function
collab_impact_analysis(file="src/utils.ts", symbol="formatDate")
# Result: {
#   risk_level: "high",
#   reference_count: 15,
#   affected_files: ["src/api/...", "src/components/..."],
#   message: "HIGH RISK: This symbol is referenced in 15 locations"
# }
```

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
│   ├── 0001_init.sql           # Core tables
│   ├── 0002_auth.sql           # Auth tables
│   ├── 0002_session_status.sql # Session status
│   ├── 0003_config.sql         # Session config
│   ├── 0004_symbols.sql   # Symbol-level claims
│   └── 0005_references.sql # Reference tracking
├── src/
│   ├── cli.ts             # CLI entry point
│   ├── constants.ts       # Version and constants
│   ├── db/                # Database layer
│   │   ├── queries.ts     # SQL queries
│   │   └── sqlite-adapter.ts
│   ├── mcp/               # MCP protocol implementation
│   │   ├── protocol.ts    # JSON-RPC handling
│   │   ├── server.ts      # Main MCP server
│   │   └── tools/         # Tool implementations
│   │       ├── session.ts # Session management
│   │       ├── claim.ts   # File/symbol claims
│   │       ├── message.ts # Inter-session messaging
│   │       ├── decision.ts# Decision logging
│   │       └── lsp.ts     # LSP integration
│   └── utils/
└── package.json
```

## Changelog

### v0.5.0

- Add reference tracking and impact analysis (Phase 3)
- Add symbol-level claims and LSP integration
- Fix SQLite WAL sync for multi-process MCP servers
- Add `collab_config` tool for conflict handling modes

## License

MIT
