---
name: plan-register
description: Register a plan document for protection. Use this after creating a plan file to ensure it won't be accidentally deleted.
allowed-tools: mcp__session-collab__*, Read
---

# Plan Registration

Register a plan document to protect it from accidental deletion during context compaction.

## When to Use

- After creating a new plan document
- When starting to implement a plan
- When you want to ensure a document survives context summarization

## Required Actions

### Step 1: Identify the Plan File

Get the plan file path. If not provided, ask the user.

### Step 2: Read the Plan Content

Use `Read` tool to get the plan content for summary extraction.

### Step 3: Extract Key Information

From the plan content, identify:
- **Title**: The plan's main objective
- **Key Steps**: Major implementation steps (3-5 bullet points)
- **Dependencies**: Any requirements or blockers

### Step 4: Register the Plan

Call `collab_plan_register` with:
- `session_id`: Your session ID
- `file_path`: Path to the plan file
- `title`: Extracted title
- `content_summary`: Concise summary (key steps, goals)
- `status`: "draft" or "approved" (based on context)

### Step 5: Confirm Registration

Display the registration result.

## Output Format

```
### Plan Registered 🛡️

| Item | Value |
|------|-------|
| Title | `[plan title]` |
| File | `[file path]` |
| Status | [draft/approved] |
| Priority | 95 (high) |
| Pinned | ✅ Yes |

### Summary Saved
[Brief summary that will be preserved]

### Protection Active
This plan is now protected from:
- Accidental deletion
- Context compaction loss
- Overwriting without warning
```

## Notes

- Plans are registered with **priority 95** (very high)
- Plans are **pinned** to ensure they appear in active memory
- Status can be updated later with `/plan-complete`
- Use `collab_plan_list` to see all registered plans
