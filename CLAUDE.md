# Session Collab MCP

AI Context Persistence & Multi-Session Collaboration for Claude Code.

## What It Does

- Persist important context across conversations (`collab_memory_save`, `collab_memory_recall`)
- Coordinate parallel sessions by claiming files and detecting conflicts (`collab_claim`)
- Protect critical files from accidental changes (`collab_protect`)
- Provide a quick status snapshot for the current session (`collab_status`)

## Installation

### Option 1: Claude Code Plugin (Recommended)

```bash
# Add marketplace
/plugin marketplace add leaf76/session-collab-mcp

# Install plugin
/plugin install session-collab@session-collab-plugins
```

### Option 2: MCP Server Only

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

## Quick Start

```
1. collab_session_start    # Register session
2. collab_memory_recall    # Restore saved context (active=true)
3. ... work ...
4. collab_memory_save      # Save important findings (pinned=true)
5. collab_session_end      # Clean up
```

## Core Tools (10)

| Tool | Purpose |
|------|---------|
| `collab_session_start` | Register session |
| `collab_session_end` | End session |
| `collab_memory_save` | Save important context |
| `collab_memory_recall` | Retrieve saved context |
| `collab_memory_clear` | Clear memories |
| `collab_claim` | Create/check/release/list claims |
| `collab_protect` | Register/check/list protected files |
| `collab_session_list` | List active sessions |
| `collab_config` | Configure session behavior |
| `collab_status` | Get session status summary |

## Memory Categories

| Category | Use For |
|----------|---------|
| `finding` | Discovered facts, root causes |
| `decision` | Architectural choices |
| `state` | Current tracking info |
| `todo` | Action items |
| `important` | Critical context |
| `context` | General background |

## Development

```bash
npm install          # Install dependencies
npm run build        # Build with tsup
npm run typecheck    # Type check
npm run test         # Run tests
```

## Data Storage

SQLite database at `~/.claude/session-collab/collab.db`
- WAL mode for multi-process safety
- No remote server required
- Works offline

## License

MIT
