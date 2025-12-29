# Session Collab MCP

MCP server for Claude Code session collaboration - prevents conflicts when multiple sessions work on the same codebase.

## Quick Start

Add to `~/.claude.json`:

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

## What Happens Automatically

Once installed, Claude will:

1. Register a session when conversation starts
2. Check for conflicts before editing files
3. Claim files/symbols before making changes
4. Warn you if another session is working on the same files or symbols
5. Clean up when the conversation ends

## Key Features

- **Symbol-Level Claims**: Fine-grained conflict detection at function/class level
- **LSP Integration**: Validate symbols and analyze impact with LSP data
- **Reference Tracking**: Understand impact of changes across the codebase
- **Conflict Modes**: strict / smart (default) / bypass

## Development

```bash
npm install          # Install dependencies
npm run build        # Build with tsup
npm run start:dev    # Start in dev mode (tsx)
npm run typecheck    # Type check
npm run test         # Run tests
```

## Project Structure

```
src/
├── cli.ts              # Entry point
├── constants.ts        # Version info
├── db/                 # SQLite database layer
│   ├── queries.ts      # SQL queries
│   └── sqlite-adapter.ts
├── mcp/
│   ├── protocol.ts     # JSON-RPC protocol
│   ├── server.ts       # MCP server
│   └── tools/          # Tool implementations
│       ├── session.ts  # Session management
│       ├── claim.ts    # File/symbol claims
│       ├── message.ts  # Messaging
│       ├── decision.ts # Decision logging
│       └── lsp.ts      # LSP integration
└── utils/
```

## MCP Tools Reference

### Session Management

| Tool | Purpose |
|------|---------|
| `collab_session_start` | Register a new session |
| `collab_session_end` | End session and release all claims |
| `collab_session_list` | List active sessions |
| `collab_session_heartbeat` | Update session heartbeat |
| `collab_status_update` | Update current task and todos |
| `collab_config` | Configure conflict handling mode |

### Claim Management

| Tool | Purpose |
|------|---------|
| `collab_claim` | Reserve files or symbols before modifying |
| `collab_check` | Check if files/symbols are claimed by others |
| `collab_release` | Release claimed files/symbols |
| `collab_claims_list` | List all active claims |

### LSP Integration

| Tool | Purpose |
|------|---------|
| `collab_analyze_symbols` | Analyze LSP symbols for conflict detection |
| `collab_validate_symbols` | Validate symbol names before claiming |
| `collab_store_references` | Store symbol reference data |
| `collab_impact_analysis` | Analyze impact of modifying a symbol |

### Communication

| Tool | Purpose |
|------|---------|
| `collab_message_send` | Send message to other sessions |
| `collab_message_list` | Read messages |
| `collab_decision_add` | Record architectural decisions |
| `collab_decision_list` | View recorded decisions |

## Data Storage

SQLite database at `~/.claude/session-collab/collab.db`

- Uses WAL mode for multi-process safety
- Migrations in `migrations/` directory
- No remote server required
- Works offline
