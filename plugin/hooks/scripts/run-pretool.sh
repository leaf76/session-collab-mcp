#!/bin/sh
# PreToolUse / SessionStart helper. Prefer a local bin; fall back to npx.
if [ "${SESSION_COLLAB_HOOK_DISABLE:-}" = "1" ]; then
  echo '{"continue":true}'
  exit 0
fi

if command -v session-collab-pretool >/dev/null 2>&1; then
  exec session-collab-pretool
fi

exec npx -y -p session-collab-mcp@latest session-collab-pretool
