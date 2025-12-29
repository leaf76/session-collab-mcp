# Session Collab MCP

A collaborative session management tool for Claude Code to prevent conflicts when multiple sessions work on the same codebase.

## Quick Setup

### 1. Get API Token

1. Go to the dashboard: https://session-collab-mcp.leafxc0903.workers.dev
2. Register or login
3. Create a new API token
4. Save the token to `~/.claude/.env`:

```bash
echo 'MCP_TOKEN="your-token-here"' >> ~/.claude/.env
```

### 2. Copy Hook Scripts

Create the hooks directory and copy scripts from this repository:

```bash
mkdir -p .claude/hooks

# Copy from this repo's .claude/hooks/ directory:
# - session-start.sh  (registers session on conversation start)
# - check-claims.sh   (checks file conflicts before editing)
# - todo-sync.sh      (syncs todo list after updates)

chmod +x .claude/hooks/*.sh
```

Or copy directly from the Dashboard's Setup Guide after logging in.

### 3. Configure Hooks

Create or update `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/session-start.sh my-session-name"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/check-claims.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "TodoWrite",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/todo-sync.sh"
          }
        ]
      }
    ]
  }
}
```

## Hook Descriptions

| Hook | Trigger | Purpose |
|------|---------|---------|
| `session-start.sh` | New conversation starts | Register session with server |
| `check-claims.sh` | Before Edit/Write | Check if file is claimed by another session |
| `todo-sync.sh` | After TodoWrite | Sync todo list to server for visibility |

## How It Works

```
New Conversation
      │
      ▼
SessionStart Hook ──► Register session
      │
      ▼
User requests changes
      │
      ▼
PreToolUse Hook ──► Check for conflicts
      │
      ├── Conflict? ──► Warning message
      │
      ▼
Edit/Write file
      │
      ▼
PostToolUse Hook ──► Sync todo status
```

## MCP Tools

The server provides these MCP tools:

- `collab_session_start` - Register a new session
- `collab_session_end` - End a session
- `collab_session_list` - List all active sessions
- `collab_claim` - Claim files before modifying
- `collab_check` - Check if files are claimed
- `collab_release` - Release claimed files
- `collab_message_send` - Send message to other sessions
- `collab_message_list` - Read messages
- `collab_decision_add` - Record architectural decisions

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MCP_TOKEN` | Yes | API token from dashboard |
| `MCP_URL` | No | Override server URL (default: production) |

## Troubleshooting

### Hook not triggering
- Ensure scripts are executable: `chmod +x .claude/hooks/*.sh`
- Check `.claude/settings.json` syntax
- Restart Claude Code after changing settings

### Token issues
- Verify token in `~/.claude/.env`
- Check token hasn't expired on dashboard
- Ensure `.env` uses correct format: `MCP_TOKEN="..."`

### Session not showing
- Check network connectivity
- Verify token is valid
- Look for error messages in hook output
