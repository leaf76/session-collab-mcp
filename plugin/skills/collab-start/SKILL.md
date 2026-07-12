---
name: collab-start
description: Initialize session collaboration for multi-session conflict prevention. Use for non-trivial edits or when parallel sessions may touch the same repo — not for pure Q&A/chat.
allowed-tools: mcp__session-collab__*
---

# Session Collaboration Startup

Prevent file conflicts when multiple agent sessions work on the same codebase. **Token-conscious by default.**

## Roles (do not mix)

| Store | Use for |
|-------|---------|
| **session-collab memory** | Short in-flight notes for *this* repo/session (finding/decision/state). Content capped. |
| **AI-Memory vault** (`~/AI-Memory`) | Durable cross-provider prefs, profile, project decisions |

Do **not** dump transcripts into collab memory.

## When to run

**Do start** when any of:
- You will edit files in a shared project
- Multiple agents/sessions may work on the same repo
- User asks to coordinate, claim files, or resume collab context

**Skip entirely** for pure Q&A, explanations, planning with no edits, greetings.

## Required Actions (when starting)

### Step 1: Start (or reuse) Session

Call `collab_session_start` with:
- `project_root`: repo you will edit
- `name`: stable descriptive name (enables **reuse** of same name+project)
- `restore_context`: **false by default** — set true only for prior highlights
- `force_new`: true only if you must not reuse

Store `session_id`. Note `reused` in the response.

### Step 2: Light awareness

From start response only (`active_sessions`).  
If `active_sessions > 1` and you need who holds files: `collab_session_list` **without** `detail` first.

### Step 3: Claims — prefer atomic **create**

Before modifying files:
1. **`collab_claim` `action=create`** with **all target files in one call** (paths absolute or relative — server normalizes to project_root)
2. If blocked: do **not** edit `blocked_files`; coordinate or wait
3. `action=check` is **optional probe-only** — do not double-trip check→create by default

Batch files. Prefer symbols when sharing a file safely.

### Step 4: Memory (optional)

- Short finding/decision only
- Skip for trivial sessions

### Step 5: Config (optional)

`collab_config` only if non-default mode needed (`strict` / `smart` / `bypass`).

## While working

| Action | Guidance |
|--------|----------|
| Heartbeat | `collab_session_update` on milestones only |
| Status / list | default summary; `detail=true` only for conflicts |
| Release | when a unit of work finishes |
| End | `collab_session_end` if you started a session |

## Output (keep short)

| Item | Value |
|------|-------|
| Session ID | `xxx` |
| Reused | yes/no |
| Active sessions | N |

### Reminders
- create is enough to claim; check is optional
- Paths are normalized — same file won't miss conflicts via abs/rel mismatch
- If blocked, stop and do not overwrite the other session's work
