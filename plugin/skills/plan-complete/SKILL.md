---
name: plan-complete
description: Mark a plan as completed and archive it. Use this when you've finished implementing all items in a plan document.
allowed-tools: mcp__session-collab__*
---

# Plan Completion

Mark a plan document as completed and optionally archive it.

## When to Use

- All tasks in the plan have been implemented
- User confirms the plan is complete
- Moving on to a new phase of work

## Required Actions

### Step 1: Identify the Plan

Ask the user or check the session's registered plans:

```
collab_plan_list with session_id
```

### Step 2: Verify Completion

Before marking complete, verify:
- [ ] All todo items are done
- [ ] Code changes are committed
- [ ] Tests pass (if applicable)

### Step 3: Update Plan Status

Call `collab_plan_update_status` with:
- `session_id`: Your session ID
- `file_path`: Path to the plan file
- `status`: "completed"
- `summary`: Brief summary of what was achieved

### Step 4: Confirm with User

Display the result and ask if they want to:
1. **Keep the plan file** - Just update status, file remains
2. **Archive the plan** - Reduce protection, move to lower priority
3. **Delete the plan file** - Remove from filesystem (requires confirmation)

### Step 5: Archive if Requested

If archiving, call `collab_plan_update_status` again with:
- `status`: "archived"

## Output Format

```
### Plan Completed ✅

| Item | Value |
|------|-------|
| Plan | `[plan title]` |
| File | `[file path]` |
| Status | Completed → [Archived/Kept] |

### Summary
[What was achieved]

### Next Steps
- [ ] Delete plan file? (optional)
- [ ] Start new plan?
```

## Status Lifecycle

```
draft → approved → in_progress → completed → archived
                                     ↓
                              (Protection reduced)
                              (Lower priority in memory)
                              (Excluded from active recall)
```

## Notes

- **completed**: Plan stays in memory with reduced priority (50), unpinned
- **archived**: Very low priority (30), excluded from active memory recall
- Plans are never auto-deleted, only manually by user request
