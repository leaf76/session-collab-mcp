# Session Collab MCP

AI Context Persistence & Multi-Session Collaboration for Claude Code.

## What It Does

**Single Session (Lite Mode)**: Persist important context across conversations
- Save findings, decisions, and state with `collab_memory_save`
- Restore context with `collab_memory_active`
- Protect plan documents from accidental deletion

**Multiple Sessions (Full Mode)**: Coordinate parallel work
- Claim files/symbols before editing
- Detect and prevent conflicts
- Queue system for blocked resources

The server **automatically detects** which mode to use based on active session count.

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
2. collab_memory_active    # Restore saved context
3. ... work ...
4. collab_memory_save      # Save important findings (pinned=true)
5. collab_session_end      # Clean up
```

## Lite Mode Tools (Single Session)

| Tool | Purpose |
|------|---------|
| `collab_session_start` | Register session |
| `collab_session_end` | End session |
| `collab_memory_save` | Save important context |
| `collab_memory_recall` | Retrieve saved context |
| `collab_memory_active` | Get pinned + high-priority memories |
| `collab_plan_register` | Protect plan documents |
| `collab_decision_add` | Log architectural decisions |

## Full Mode Tools (Multi-Session)

When multiple sessions are detected, additional tools become available:

| Category | Tools |
|----------|-------|
| Claim | `collab_claim`, `collab_check`, `collab_release`, `collab_auto_release` |
| Queue | `collab_queue_join`, `collab_queue_leave`, `collab_queue_list` |
| Notify | `collab_notifications_list`, `collab_notifications_mark_read` |
| LSP | `collab_analyze_symbols`, `collab_validate_symbols`, `collab_impact_analysis` |
| Message | `collab_message_send`, `collab_message_list` |

## Memory Categories

| Category | Use For |
|----------|---------|
| `finding` | Discovered facts, root causes |
| `decision` | Architectural choices |
| `state` | Current tracking info |
| `important` | Critical context |

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
