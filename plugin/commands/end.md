---
description: End the current collaboration session and release all claims
---

# End Session Collaboration

Properly terminate the current collaboration session.

## Actions

### 1. Get Current Session Info

If session ID is not known, call `mcp__session-collab__collab_session_list` to find your session.

### 2. End Session

Call `mcp__session-collab__collab_session_end` with:
- `session_id`: Your current session ID
- `release_claims`: "complete" (mark work as done) or "abandon" (if work is incomplete)

## Output Format

Confirm session termination:

### Session Ended

| Item | Value |
|------|-------|
| Session ID | `xxx` |
| Session Name | `name` |
| Claims Released | N |
| Status | Completed / Abandoned |

Session collaboration has been terminated. All claims have been released.

## Notes

- Use "complete" when you finished your work successfully
- Use "abandon" if you need to stop without finishing
- Other sessions will be able to claim the released files
