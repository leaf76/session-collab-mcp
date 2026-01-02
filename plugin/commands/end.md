---
description: End the current collaboration session and release all claims
---

# End Session Collaboration

Properly terminate the current collaboration session.

## Actions

### 1. Get Current Session Info

If session ID is not known, call `mcp__session-collab__collab_session_list` to find your session.

### 2. Check Unreleased Claims (IMPORTANT)

**Before ending**, call `mcp__session-collab__collab_claims_list` with:
- `session_id`: Your current session ID
- `status`: "active"

This shows all claims that will be released. Review them to decide if they should be marked as "complete" or "abandon".

### 3. End Session

Call `mcp__session-collab__collab_session_end` with:
- `session_id`: Your current session ID
- `release_claims`: "complete" (mark work as done) or "abandon" (if work is incomplete)

## Output Format

First show unreleased claims:

### Unreleased Claims Review

| File/Symbol | Intent | Scope | Created |
|-------------|--------|-------|---------|
| `path/to/file.ts` | Refactoring... | small | 2024-01-15 |

Then confirm session termination:

### Session Ended

| Item | Value |
|------|-------|
| Session ID | `xxx` |
| Session Name | `name` |
| Claims Released | N |
| Status | Completed / Abandoned |

Session collaboration has been terminated. All claims have been released.

## Notes

- **Always review claims before ending** to ensure correct status
- Use "complete" when you finished your work successfully
- Use "abandon" if you need to stop without finishing
- Other sessions will be able to claim the released files
