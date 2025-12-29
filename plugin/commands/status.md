---
description: Show current session collaboration status including active sessions, claims, and your session info
---

# Session Collaboration Status

Display the current state of session collaboration.

## Actions

### 1. List Active Sessions

Call `mcp__session-collab__collab_session_list` with:
- `project_root`: Current working directory
- `include_inactive`: false

### 2. List Active Claims

Call `mcp__session-collab__collab_claims_list` with:
- `status`: "active"
- `project_root`: Current working directory

### 3. Check Messages

Call `mcp__session-collab__collab_message_list` with:
- `session_id`: Current session ID (if available)
- `unread_only`: true

## Output Format

Provide a clear status report:

### Session Collaboration Status

#### Your Session
| Item | Value |
|------|-------|
| Session ID | `xxx` or "Not started" |
| Session Name | `xxx` |
| Status | Active / Not initialized |

#### Active Sessions (N total)
| Session | Name | Last Active |
|---------|------|-------------|
| `id-1` | name-1 | X min ago |
| `id-2` | name-2 | Y min ago |

#### Active Claims (M total)
| File/Symbol | Session | Intent | Scope |
|-------------|---------|--------|-------|
| `src/file.ts` | session-1 | "description" | medium |

#### Unread Messages
- From `session-x`: "message content"

### Quick Actions
- Start session: Call `collab_session_start`
- Check file: Call `collab_check` with file path
- Claim file: Call `collab_claim` with file path and intent
- End session: Call `collab_session_end`
