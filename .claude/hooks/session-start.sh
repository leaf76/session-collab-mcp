#!/bin/bash
# Hook: Auto-start session collaboration on Claude Code session start

MCP_URL="https://session-collab-mcp.leafxc0903.workers.dev/mcp"
PROJECT_ROOT="$(pwd)"
SESSION_NAME="${1:-claude-session}"

# Read hook input from stdin
HOOK_INPUT=$(cat)

# Extract session source if available
SOURCE=$(echo "$HOOK_INPUT" | jq -r '.source // "startup"' 2>/dev/null)

# Only start on new sessions, not resumes
if [ "$SOURCE" = "resume" ]; then
  exit 0
fi

# Call MCP server to start session
RESPONSE=$(curl -s -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
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
  echo "Session started: $SESSION_ID"
fi

exit 0
