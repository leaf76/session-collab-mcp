---
name: plan-complete
description: Record plan completion using the current v2 API surface.
allowed-tools: mcp__session-collab__*
---

# Plan Completion

Record that a protected plan has been completed. The current v2 API does not expose direct plan status transitions, so completion is tracked via working memory while the protected plan entry remains available.

## When to Use

- All tasks in the plan have been implemented
- User confirms the plan is complete
- Moving on to a new phase of work

## Required Actions

### Step 1: Identify the Plan

Ask the user or check the session's protected plans:

```text
collab_protect with action="list" and session_id
```

### Step 2: Verify Completion

Before recording completion, verify:
- [ ] All todo items are done
- [ ] Code changes are committed
- [ ] Tests pass (if applicable)

### Step 3: Save Completion Summary

Call `collab_memory_save` with:
- `session_id`: Your session ID
- `category`: `"state"`
- `key`: A stable key such as `plan_complete:<file_path>`
- `content`: Brief summary of what was achieved
- `priority`: `80`
- `pinned`: `true`

### Step 4: Confirm with User

Display the result and ask if they want to:
1. **Keep the plan file protected** - Leave the protection entry as-is
2. **Clear the completion note later** - Use `collab_memory_clear` when the note is no longer needed
3. **Delete the plan file** - Remove from filesystem only with explicit confirmation

### Step 5: Optional Cleanup

If the user no longer needs the completion note, call `collab_memory_clear` with:
- `session_id`: Your session ID
- `key`: The completion key you saved in Step 3

## Output Format

```text
### Plan Completion Recorded

| Item | Value |
|------|-------|
| Plan | [plan title] |
| File | [file path] |
| Status | Completion recorded |

### Summary
[What was achieved]

### Next Steps
- Keep the plan protected or delete it explicitly later
- Clear the completion note when it is no longer useful
```

## Notes

- The protected plan entry remains available through `collab_protect`
- Completion state is recorded in working memory, not in a separate plan-status tool
- Plans are never auto-deleted, only manually by user request
