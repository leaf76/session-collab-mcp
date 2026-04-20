# Session Collab Plugin

Claude Code integration for the `session-collab-mcp` server.

Use this plugin only when your MCP client is Claude Code. The core server itself is provider-agnostic and can be used from any MCP client that supports stdio or HTTP JSON-RPC.

## Features

- Automatic Claude Code plugin wiring for the MCP server
- Context persistence across conversations
- Conflict avoidance with file/symbol claims
- Protected files and session status summary

## Installation

```bash
# Add marketplace
/plugin marketplace add leaf76/session-collab-mcp

# Install plugin
/plugin install session-collab@session-collab-plugins
```

If you are not using Claude Code, use the root project README instead and connect to the MCP server over stdio or `POST /mcp`.

## Quick Start

```
1. collab_session_start    # Register session
2. collab_memory_recall    # Restore saved context (active=true)
3. ... work ...
4. collab_memory_save      # Save important findings
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

## Commands

| Command | Description |
|---------|-------------|
| `/session-collab:status` | Show current session status |
| `/session-collab:end` | End session and release claims |

## Data Storage

SQLite database at `~/.claude/session-collab/collab.db`
- WAL mode for multi-process safety
- Works offline

## License

MIT
