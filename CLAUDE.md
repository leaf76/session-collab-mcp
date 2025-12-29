# Session Collab MCP

A collaborative session management tool for Claude Code to prevent conflicts when multiple sessions work on the same codebase.

## Zero-Config Setup

### Just Add to `~/.claude.json`:

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

**That's it!** The MCP server includes built-in instructions that tell Claude how to use the collaboration tools automatically.

## What Happens Automatically

Once installed, Claude will:

1. Register a session when conversation starts
2. Check for conflicts before editing files
3. Warn you if another session is working on the same files
4. Clean up when the conversation ends

## MCP Tools Reference

| Tool | Purpose |
|------|---------|
| `collab_session_start` | Register a new session |
| `collab_session_end` | End session and release all claims |
| `collab_session_list` | List active sessions |
| `collab_claim` | Reserve files before modifying |
| `collab_check` | Check if files are claimed by others |
| `collab_release` | Release claimed files |
| `collab_message_send` | Send message to other sessions |
| `collab_message_list` | Read messages |
| `collab_decision_add` | Record architectural decisions |
| `collab_decision_list` | View recorded decisions |

## Data Storage

All data is stored locally in `~/.claude/session-collab/collab.db` (SQLite).

- No remote server required
- No API token needed
- Works offline

## Optional: Hook-Based Enforcement

If you want stricter enforcement (block edits instead of warn), you can configure shell hooks. See `.claude/hooks/` for examples.
