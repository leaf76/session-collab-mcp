---
name: collab-start
description: Initialize session collaboration for multi-session conflict prevention. Use this at the start of a conversation or when you need to register a new collaboration session.
allowed-tools: mcp__session-collab__*
---

# Session Collaboration Startup

Initialize session collaboration to prevent conflicts when multiple Claude Code sessions work on the same codebase.

## Required Actions

Execute these steps in order:

### Step 1: Start Session

Call `mcp__session-collab__collab_session_start` with:
- `project_root`: Current working directory
- `name`: A descriptive name based on the task (e.g., "feature-auth", "bugfix-api")

**Important:** Store the `session_id` from the response - you need it for all subsequent calls.

### Step 2: Review Active Sessions

Check the response for:
- Number of active sessions
- Other session names and their last activity time

If other sessions are active, inform the user about potential collaboration.

### Step 3: Check Existing Claims

Call `mcp__session-collab__collab_claims_list` with:
- `status`: "active"
- `project_root`: Current working directory

If there are active claims:
- List which files/symbols are claimed
- Show which session holds each claim
- Display the stated intent

### Step 4: Configure Mode (Optional)

If needed, call `mcp__session-collab__collab_config` with:
- `session_id`: Your session ID
- `mode`: One of:
  - `"strict"`: Always ask user before proceeding with conflicts
  - `"smart"` (default): Auto-proceed with safe content, ask for blocked
  - `"bypass"`: Warn only, don't block

## Output Format

Provide a summary in the user's language:

### Session Collaboration Initialized

| Item | Value |
|------|-------|
| Session ID | `xxx-xxx-xxx` |
| Session Name | `your-session-name` |
| Project Path | `/path/to/project` |
| Active Sessions | N |
| Active Claims | M |

### Other Active Sessions (if any)
- `session-name-1` (last active: X minutes ago)
- `session-name-2` (last active: Y minutes ago)

### Active Claims (if any)
- `file.ts` - claimed by `other-session` for "intent description"

### Reminders
- Always call `collab_check` before editing files
- Use `collab_claim` to reserve files before modification
- Call `collab_release` when done with files
- Call `collab_session_end` when conversation ends
