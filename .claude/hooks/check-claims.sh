#!/bin/bash
# Hook: Check file claims before editing
# Triggered: PreToolUse for Edit/Write tools
#
# Checks if files are claimed by other sessions before allowing modifications.
# Queries local SQLite database directly - no token required.

DB_PATH="$HOME/.claude/session-collab/collab.db"
SESSION_FILE="/tmp/claude-session-collab-id-$(id -u)"

# Read hook input from stdin
HOOK_INPUT=$(cat)

# Extract file path from tool_input
FILE_PATH=$(echo "$HOOK_INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

# Skip if no file path or database doesn't exist
if [ -z "$FILE_PATH" ] || [ ! -f "$DB_PATH" ]; then
  exit 0
fi

# Get current session ID
SESSION_ID=""
if [ -f "$SESSION_FILE" ]; then
  SESSION_ID=$(cat "$SESSION_FILE")
fi

# Escape single quotes for SQL safety
escape_sql() {
  echo "$1" | sed "s/'/''/g"
}

SESSION_ID_ESCAPED=$(escape_sql "$SESSION_ID")
FILE_PATH_ESCAPED=$(escape_sql "$FILE_PATH")

# Query for conflicting claims directly from SQLite
# Find active claims from other sessions that include this file
CONFLICTS=$(sqlite3 "$DB_PATH" "
  SELECT s.name, c.intent
  FROM claims c
  JOIN sessions s ON c.session_id = s.id
  WHERE c.status = 'active'
    AND s.status = 'active'
    AND c.session_id != '${SESSION_ID_ESCAPED}'
    AND c.files LIKE '%\"${FILE_PATH_ESCAPED}\"%'
  LIMIT 5;
" 2>/dev/null)

if [ -n "$CONFLICTS" ]; then
  echo "⚠️  CONFLICT WARNING: File may be claimed by another session"
  echo ""
  echo "$CONFLICTS" | while IFS='|' read -r session_name intent; do
    echo "  - $session_name: $intent"
  done
  echo ""
  echo "Consider coordinating with the other session before proceeding."
fi

exit 0
