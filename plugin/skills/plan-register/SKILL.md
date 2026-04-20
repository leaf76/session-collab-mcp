---
name: plan-register
description: Register a plan document for protection using the current v2 protection API.
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

Use `Read` to get the plan content for summary extraction.

### Step 3: Extract Key Information

From the plan content, identify:
- **Title**: The plan's main objective
- **Key Steps**: Major implementation steps (3-5 bullet points)
- **Dependencies**: Any requirements or blockers

### Step 4: Register the Plan

Call `collab_protect` with:
- `action`: `"register"`
- `session_id`: Your session ID
- `file_path`: Path to the plan file
- `type`: `"plan"`
- `title`: Extracted title
- `content_summary`: Concise summary (key steps, goals)

### Step 5: Confirm Registration

Display the registration result.

## Output Format

```text
### Plan Registered

| Item | Value |
|------|-------|
| Title | [plan title] |
| File | [file path] |
| Priority | 95 (high) |
| Pinned | Yes |

### Summary Saved
[Brief summary that will be preserved]

### Protection Active
This plan is now protected from accidental deletion and context-loss mistakes.
```

## Notes

- Plans are registered with very high priority protection
- Plans are pinned so they appear in active memory and protected file listings
- Use `collab_protect` with `action="list"` to inspect protected plans and files
