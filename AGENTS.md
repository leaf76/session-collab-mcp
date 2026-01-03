# AGENTS.md - Session Collab MCP

**Generated:** 2026-01-03 | **Branch:** master

## Overview

TypeScript MCP server for Claude Code. Two modes:
- **Lite Mode** (single session): Context persistence, 13 tools
- **Full Mode** (multi-session): Collaboration + conflict detection, 50+ tools

Mode auto-detected by active session count in `detectServerMode()`.

## Structure

```
src/
├── cli.ts              # Entry: stdio JSON-RPC server
├── constants.ts        # Version + 487-line server instructions
├── db/
│   ├── queries.ts      # 2000+ lines SQL (GROUP_CONCAT with |||)
│   ├── sqlite-adapter.ts
│   ├── types.ts        # All type definitions
│   └── __tests__/      # In-memory SQLite tests
├── mcp/
│   ├── protocol.ts     # JSON-RPC types
│   ├── schemas.ts      # Zod validation (all inputs)
│   ├── server.ts       # Tool routing by prefix
│   └── tools/          # 10 files, 50+ MCP tools ← see tools/AGENTS.md
├── utils/
│   ├── crypto.ts       # generateId()
│   └── response.ts     # errorResponse(), successResponse()
├── migrations/         # 12 SQL files, versioned schema
└── plugin/             # Claude Code plugin (hooks, skills, commands)
```

## Where to Look

| Task | Location |
|------|----------|
| Add MCP tool | `src/mcp/tools/` + register in `server.ts` |
| Add schema | `src/mcp/schemas.ts` (Zod) |
| Add DB query | `src/db/queries.ts` |
| Add type | `src/db/types.ts` |
| Error codes | `src/utils/response.ts` → ERROR_CODES |
| Test pattern | `src/db/__tests__/test-helper.ts` |

## Commands

```bash
npm run build        # tsup (bundles all except better-sqlite3)
npm run typecheck    # tsc --noEmit (strict, noUnusedLocals)
npm run lint         # eslint
npm run test         # vitest

# Single test
npx vitest run src/db/__tests__/queries.test.ts
npx vitest run -t "should create a new session"
```

## Conventions

### Imports (ESM, .js required)

```typescript
import type { DatabaseAdapter } from '../db/sqlite-adapter.js';  // Types first
import { createClaim } from '../db/queries.js';                   // Values second
```

### Naming

| Context | Style | Example |
|---------|-------|---------|
| Variables/Functions | camelCase | `sessionId`, `createClaim` |
| Types/Interfaces | PascalCase | `ClaimStatus`, `SessionConfig` |
| Constants | UPPER_SNAKE | `ERROR_CODES`, `DEFAULT_SESSION_CONFIG` |
| DB columns/API | snake_case | `session_id`, `project_root` |

### Input Validation (Mandatory)

```typescript
const validation = validateInput(claimCreateSchema, args);
if (!validation.success) return validationError(validation.error);
const { session_id, files } = validation.data;
```

### Error Handling

```typescript
import { errorResponse, successResponse, ERROR_CODES } from '../../utils/response.js';

return errorResponse(ERROR_CODES.SESSION_NOT_FOUND, 'Session not found');
return successResponse({ claim_id: claim.id, status: 'created' });
```

### Database Queries

```typescript
// Parameterized only - NEVER string concat
await db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').bind(id, name).run();

// Multi-value columns: GROUP_CONCAT with |||
GROUP_CONCAT(cf.file_path, '|||') as file_paths
// Split: result.file_paths?.split('|||') ?? []
```

## Testing

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, TestDatabase } from './test-helper.js';

describe('Feature', () => {
  let db: TestDatabase;
  beforeEach(() => { db = createTestDatabase(); });
  afterEach(() => { db.close(); });

  it('should <behavior> when <condition>', async () => {
    // Arrange → Act → Assert
  });
});
```

## Anti-Patterns (FORBIDDEN)

1. **Type suppression**: `as any`, `@ts-ignore`, `@ts-expect-error`
2. **SQL injection**: String concatenation in queries
3. **Missing validation**: All MCP inputs need Zod schema
4. **Raw error strings**: Use ERROR_CODES constants
5. **Missing .js**: Local imports must include `.js` extension
6. **Sync DB calls**: Always await database operations
7. **Empty catch**: `catch(e) {}` - must handle or rethrow

## Architecture Notes

- **Dual distribution**: npm package + Claude Code plugin
- **SQLite WAL mode**: Multi-process safe at `~/.claude/session-collab/collab.db`
- **Tool routing**: By name prefix (`collab_session_*`, `collab_claim_*`)
- **Native module**: `better-sqlite3` external, all else bundled
