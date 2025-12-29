#!/bin/bash
# Hook: Auto-start session collaboration on Claude Code session start

# Load token from .env file if exists
if [ -f "$HOME/.claude/.env" ]; then
  source "$HOME/.claude/.env"
fi

MCP_URL="https://session-collab-mcp.leafxc0903.workers.dev/mcp"
MCP_TOKEN="${MCP_TOKEN:-}"
PROJECT_ROOT="$(pwd)"
SESSION_NAME="${1:-claude-session}"
SESSION_FILE="/tmp/claude-session-collab-id-$(id -u)"

# Read hook input from stdin
HOOK_INPUT=$(cat)

# Extract session source if available
SOURCE=$(echo "$HOOK_INPUT" | jq -r '.source // "startup"' 2>/dev/null)

# Only start on new sessions, not resumes
if [ "$SOURCE" = "resume" ]; then
  exit 0
fi

# Skip if token not configured
if [ -z "$MCP_TOKEN" ]; then
  exit 0
fi

# Build auth header if token is available
AUTH_HEADER=""
if [ -n "$MCP_TOKEN" ]; then
  AUTH_HEADER="-H \"Authorization: Bearer $MCP_TOKEN\""
fi

# Call MCP server to start session (5 second timeout)
RESPONSE=$(curl -s --max-time 5 -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  ${AUTH_HEADER:+-H "Authorization: Bearer $MCP_TOKEN"} \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"id\": 1,
    \"method\": \"tools/call\",
    \"params\": {
      \"name\": \"collab_session_start\",
      \"arguments\": {
        \"project_root\": \"$PROJECT_ROOT\",
        \"name\": \"$SESSION_NAME\"
      }
    }
  }" 2>/dev/null)

# Extract session_id from response for logging
SESSION_ID=$(echo "$RESPONSE" | jq -r '.result.content[0].text // empty' 2>/dev/null | jq -r '.session_id // empty' 2>/dev/null)

if [ -n "$SESSION_ID" ]; then
  # Save session_id for other hooks to use
  echo "$SESSION_ID" > "$SESSION_FILE"
  echo "Session started: $SESSION_ID"
fi

exit 0
