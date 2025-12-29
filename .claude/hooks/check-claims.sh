#!/bin/bash
# Hook: Check if file is claimed by another session before editing
# Triggered: PreToolUse for Edit/Write tools

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

# Extract file_path from tool_input
FILE_PATH=$(echo "$HOOK_INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

# Skip if no file path
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Read session_id saved by session-start hook
SESSION_ID=""
if [ -f "$SESSION_FILE" ]; then
  SESSION_ID=$(cat "$SESSION_FILE")
fi

# Build files array safely (handles special characters in file paths)
FILES_JSON=$(jq -n --arg f "$FILE_PATH" '[$f]')

# Build the check payload
CHECK_PAYLOAD=$(jq -n \
  --arg session_id "$SESSION_ID" \
  --argjson files "$FILES_JSON" \
  '{
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "collab_check",
      arguments: {
        session_id: (if $session_id == "" then null else $session_id end),
        files: $files
      }
    }
  }')

# Call MCP server to check claims (5 second timeout)
RESPONSE=$(curl -s --max-time 5 -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  ${MCP_TOKEN:+-H "Authorization: Bearer $MCP_TOKEN"} \
  -d "$CHECK_PAYLOAD" 2>/dev/null)

# Parse response to check for conflicts
RESULT_TEXT=$(echo "$RESPONSE" | jq -r '.result.content[0].text // empty' 2>/dev/null)
HAS_CONFLICTS=$(echo "$RESULT_TEXT" | jq -r '.has_conflicts // false' 2>/dev/null)

if [ "$HAS_CONFLICTS" = "true" ]; then
  # Extract conflict details
  CONFLICTS=$(echo "$RESULT_TEXT" | jq -r '.conflicts // []' 2>/dev/null)
  CLAIMED_BY=$(echo "$CONFLICTS" | jq -r '.[0].session_name // "another session"' 2>/dev/null)
  INTENT=$(echo "$CONFLICTS" | jq -r '.[0].intent // "unknown"' 2>/dev/null)

  echo "WARNING: File '$FILE_PATH' is claimed by '$CLAIMED_BY' (intent: $INTENT)"
  echo "Consider coordinating with them before making changes."
  # Exit 0 to allow but with warning, change to exit 1 to block
  exit 0
fi

exit 0
