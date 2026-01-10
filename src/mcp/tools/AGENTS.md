# AGENTS.md - MCP Tools

4 files implementing 9 MCP tools. Simplified action-based design.

## Structure

| File | Domain | Tools |
|------|--------|-------|
| session.ts | Session lifecycle | start, end, list, config |
| claim.ts | File claims | claim (action: create/check/release/list) |
| memory.ts | Working memory | save, recall, clear |
| protection.ts | Protection | protect (action: register/check/list) |

## Implementation Pattern

```typescript
// 1. Tool definitions array
export const claimTools: McpTool[] = [
  {
    name: 'collab_claim',
    description: 'Reserve files before modifying',
    inputSchema: { type: 'object', properties: {...}, required: [...] },
  },
];

// 2. Handler function with switch routing
export async function handleClaimTool(
  db: DatabaseAdapter, name: string, args: Record<string, unknown>
): Promise<McpToolResult> {
  switch (name) {
    case 'collab_claim': {
      const validation = validateInput(claimCreateSchema, args);
      if (!validation.success) return validationError(validation.error);
      const { session_id, files, intent } = validation.data;
      const result = await createClaim(db, { session_id, files, intent });
      return successResponse({ claim_id: result.claim.id });
    }
    default:
      return createToolResult(`Unknown tool: ${name}`, true);
  }
}
```

## Adding a New Tool

1. **Schema** in `../schemas.ts`
2. **Tool def** in tools array with `collab_` prefix
3. **Case** in handler switch
4. **Routing** in `../server.ts` (if new prefix)

## Tool Routing (in server.ts)

```typescript
if (name.startsWith('collab_session_')) → handleSessionTool
if (name.startsWith('collab_claim') || name === 'collab_check') → handleClaimTool
if (name.startsWith('collab_message_')) → handleMessageTool
// ... etc
```

## Common Patterns

```typescript
// Session validation (most tools need this)
const sessionResult = await validateActiveSession(db, sessionId);
if (!sessionResult.valid) return sessionResult.error;

// Ownership check
if (claim.session_id !== sessionId) {
  return errorResponse(ERROR_CODES.NOT_OWNER, 'Not your claim');
}

// Audit logging
await logAuditEvent(db, {
  session_id, action: 'claim_created', entity_type: 'claim',
  entity_id: claim.id, metadata: { files, intent },
});
```

## Required Imports

```typescript
import type { DatabaseAdapter } from '../../db/sqlite-adapter.js';
import type { McpTool, McpToolResult } from '../protocol.js';
import { validateInput } from '../schemas.js';
import { errorResponse, successResponse, validationError } from '../../utils/response.js';
```
