# Session Collab Plugin

Claude Code plugin for multi-session collaboration - prevents conflicts when multiple sessions work on the same codebase.

## Features

- **Automatic MCP Server**: Installs `session-collab-mcp` automatically
- **SessionStart Hook**: Reminds to initialize session at conversation start
- **PreToolUse Hook**: Reminds to check conflicts before editing files
- **Skills**: `collab-start` skill for comprehensive session initialization
- **Commands**: `/session-collab:status` and `/session-collab:end`

## Installation

### From Marketplace (after publishing)

```bash
/plugin marketplace add your-username/session-collab-plugins
/plugin install session-collab@session-collab-plugins
```

### Local Development

```bash
claude --plugin-dir ./plugin
```

## Components

### MCP Server

Automatically starts `session-collab-mcp` which provides:

| Tool | Purpose |
|------|---------|
| `collab_session_start` | Register a new session |
| `collab_session_end` | End session and release claims |
| `collab_check` | Check for conflicts before editing |
| `collab_claim` | Reserve files/symbols |
| `collab_release` | Release claims when done |
| `collab_message_send` | Send messages to other sessions |

### Hooks

| Event | Action |
|-------|--------|
| `SessionStart` | Remind to call `collab_session_start` |
| `PreToolUse (Edit\|Write)` | Remind to check conflicts |

### Commands

| Command | Description |
|---------|-------------|
| `/session-collab:status` | Show current session status |
| `/session-collab:end` | End session and release claims |

### Skills

| Skill | Description |
|-------|-------------|
| `collab-start` | Full session initialization workflow |

## Workflow

1. **Start**: Session automatically prompted at conversation start
2. **Check**: Before editing, check for conflicts with `collab_check`
3. **Claim**: Reserve files with `collab_claim`
4. **Edit**: Make your changes
5. **Release**: Free files with `collab_release`
6. **End**: Terminate session with `collab_session_end`

## Data Storage

SQLite database at `~/.claude/session-collab/collab.db`

- Uses WAL mode for multi-process safety
- No remote server required
- Works offline

## License

MIT
