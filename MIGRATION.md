# Migration Guide: Session Collaboration MCP

## v2.5.0 — Paths, reuse, compact claims, memory caps

| Area | Change |
|------|--------|
| Paths | Claim paths normalized to `project_root` (absolute ≡ relative). Outside-root / `..` rejected. |
| Start | Reuses active session with same `project_root` + `name` by default (`reuse`, `force_new`). Stale idle default **15 min**. |
| Claim | Prefer **create** (atomic). Happy-path responses compact (`file_count`); conflict paths keep `blocked_files` / compact conflicts. `detail=true` for full payloads. |
| List/status | Summary uses SQL `COUNT` (no claim row loads). |
| Memory | Content capped at **800** chars (truncate + flag). Active recall default **8** items (`max_items` up to 20). |
| Roles | Collab memory = short in-flight notes; long-term prefs → AI-Memory vault. |
| Local install | `npm run install:local` builds + syncs plugin skills into Claude cache when present. |

Restart MCP hosts after upgrade.

## v2.4.0 — Token-efficient defaults

Behavioral defaults changed (opt-in for heavy payloads):

| API | Before | After |
|-----|--------|--------|
| `collab_session_start` | Always restored up to 15 high-priority memories | `restore_context` defaults **false**; set `true` (+ optional `max_restore_items`, default 5) to restore |
| `collab_session_list` | Always included full claims + coordination arrays | Summary/counts by default; `detail=true` for full payloads |
| `collab_status` | Always included full claims + coordination | Counts by default; `detail=true` for full payloads |

Agent policy (skills / AGENTS): start only for non-trivial / multi-session work; skip pure Q&A.

`SERVER_INSTRUCTIONS` was shortened. Restart the MCP process after upgrade so hosts reload tools/instructions.

---

# Migration Guide: Session Collaboration MCP v2.0

## Breaking Changes

This version simplifies the MCP server from 50+ tools to 10 core tools. While this greatly improves maintainability, it introduces breaking changes.

## Tool Mapping

### Removed Tools → New Equivalents

| Old Tool | New Tool | Action |
|----------|----------|--------|
| `collab_claim_create` | `collab_claim` | `action: "create"` |
| `collab_claim_check` | `collab_claim` | `action: "check"` |
| `collab_claim_release` | `collab_claim` | `action: "release"` |
| `collab_claim_list` | `collab_claim` | `action: "list"` |
| `collab_check` | `collab_claim` | `action: "check"` |
| `collab_session_heartbeat` | `collab_status` | - |
| `collab_status_update` | `collab_status` | - |
| `collab_protect_register` | `collab_protect` | `action: "register"` |
| `collab_protect_check` | `collab_protect` | `action: "check"` |
| `collab_protect_list` | `collab_protect` | `action: "list"` |

### Completely Removed Tools

The following tools have been removed without direct replacement:

- `collab_decision_*` - Decision tracking
- `collab_history_*` - Session history  
- `collab_lsp_*` - LSP integration
- `collab_message_*` - Message handling
- `collab_notification_*` - Notifications
- `collab_queue_*` - Task queuing

## Migration Steps

### 1. Update Tool Calls

**Before:**
```typescript
await callTool('collab_claim_create', {
  session_id: 'abc123',
  files: ['src/file.ts'],
  intent: 'Fix bug'
});
```

**After:**
```typescript
await callTool('collab_claim', {
  action: 'create',
  session_id: 'abc123', 
  files: ['src/file.ts'],
  intent: 'Fix bug'
});
```

### 2. Update Response Handling

Session end responses are now simplified:

**Before:**
```json
{
  "success": true,
  "claims_released": {
    "count": 2,
    "status": "completed",
    "details": [...]
  },
  "memory_summary": {...}
}
```

**After:**
```json
{
  "success": true,
  "claims_released": 2,
  "memories_saved": 5,
  "message": "Session ended. 2 claim(s) released."
}
```

### 3. Status Monitoring

Use the new unified `collab_status` tool:

```typescript
const status = await callTool('collab_status', {
  session_id: 'abc123'
});
```

## Compatibility

### Version Requirements
- This is a major version bump (v2.0.0)
- Not backward compatible with v1.x
- Requires client updates

### Optional Compatibility Layer

If you need temporary compatibility, you can create wrapper functions:

```typescript
// Legacy wrapper example
async function legacyClaimCreate(params) {
  return await callTool('collab_claim', {
    action: 'create',
    ...params
  });
}
```

## Testing

Update your test suites to use the new tool names and action parameters. The core functionality remains the same, only the interface has changed.

## Need Help?

- Check the updated README for new API documentation
- Review the tool schemas in `src/mcp/schemas.ts`
- Test with the new tools before deploying to production
