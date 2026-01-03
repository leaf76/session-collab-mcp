# Session Collab Plugin

Claude Code plugin for AI context persistence and multi-session collaboration.

## Features

- **Lite Mode**: Context persistence for single sessions (13 tools)
- **Full Mode**: Collaboration tools for multi-session work (50+ tools)
- **Auto-Detection**: Mode switches automatically based on active sessions

## Installation

```bash
# Add marketplace
/plugin marketplace add leaf76/session-collab-mcp

# Install plugin
/plugin install session-collab@session-collab-plugins
```

## Quick Start

```
1. collab_session_start    # Register session
2. collab_memory_active    # Restore saved context
3. ... work ...
4. collab_memory_save      # Save important findings
5. collab_session_end      # Clean up
```

## Core Tools (Lite Mode)

| Tool | Purpose |
|------|---------|
| `collab_session_start` | Register session |
| `collab_session_end` | End session |
| `collab_memory_save` | Save important context |
| `collab_memory_recall` | Retrieve saved context |
| `collab_memory_active` | Get pinned + high-priority memories |
| `collab_plan_register` | Protect plan documents |

## Multi-Session Tools (Full Mode)

When multiple sessions are detected:
- `collab_claim` / `collab_check` / `collab_release`
- `collab_queue_*` / `collab_notifications_*`
- `collab_message_*`

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
