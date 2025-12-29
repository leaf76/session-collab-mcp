#!/bin/bash
# Hook: Sync TodoWrite updates to session collaboration
# Triggered: After TodoWrite tool is used

# Load token from .env file if exists
if [ -f "$HOME/.claude/.env" ]; then
  source "$HOME/.claude/.env"
fi

MCP_URL="https://session-collab-mcp.leafxc0903.workers.dev/mcp"
MCP_TOKEN="${MCP_TOKEN:-}"
PROJECT_ROOT="$(pwd)"
SESSION_FILE="/tmp/claude-session-collab-id-$(id -u)"

# Skip if token not configured
if [ -z "$MCP_TOKEN" ]; then
  exit 0
fi

# Read hook input from stdin
HOOK_INPUT=$(cat)

# Extract todos from tool_input
TODOS=$(echo "$HOOK_INPUT" | jq -c '.tool_input.todos // []' 2>/dev/null)

# Skip if no todos
if [ "$TODOS" = "[]" ] || [ -z "$TODOS" ]; then
  exit 0
fi

# Find the in_progress task as current_task
CURRENT_TASK=$(echo "$TODOS" | jq -r 'map(select(.status == "in_progress")) | .[0].content // empty' 2>/dev/null)

# Read session_id saved by session-start hook
SESSION_ID=""
if [ -f "$SESSION_FILE" ]; then
  SESSION_ID=$(cat "$SESSION_FILE")
fi

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Convert todos to the format expected by collab_status_update
TODOS_FORMATTED=$(echo "$TODOS" | jq -c '[.[] | {content: .content, status: .status}]' 2>/dev/null)

# Build the update payload
UPDATE_PAYLOAD=$(jq -n \
  --arg session_id "$SESSION_ID" \
  --arg current_task "$CURRENT_TASK" \
  --argjson todos "$TODOS_FORMATTED" \
  '{
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "collab_status_update",
      arguments: {
        session_id: $session_id,
        current_task: (if $current_task == "" then null else $current_task end),
        todos: $todos
      }
    }
  }')

# Call MCP server to update status (5 second timeout)
curl -s --max-time 5 -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  ${MCP_TOKEN:+-H "Authorization: Bearer $MCP_TOKEN"} \
  -d "$UPDATE_PAYLOAD" > /dev/null 2>&1

exit 0
