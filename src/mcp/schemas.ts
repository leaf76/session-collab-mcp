// Zod schemas for MCP tool input validation
import { z } from 'zod';

// Common schemas
export const sessionIdSchema = z.string().min(1, 'session_id is required');
export const claimIdSchema = z.string().min(1, 'claim_id is required');
export const filePathSchema = z.string().min(1);
export const filesArraySchema = z.array(filePathSchema).min(1, 'At least one file is required');

// Symbol claim schema
export const symbolClaimSchema = z.object({
  file: z.string().min(1),
  symbols: z.array(z.string().min(1)).min(1),
  symbol_type: z.enum(['function', 'class', 'method', 'variable', 'block', 'other']).optional(),
});

export const symbolClaimsArraySchema = z.array(symbolClaimSchema);

// Claim scope schema
export const claimScopeSchema = z.enum(['small', 'medium', 'large']).default('medium');

// Claim status schema
export const claimStatusSchema = z.enum(['completed', 'abandoned']);

// Session tools input schemas
export const sessionStartSchema = z.object({
  project_root: z.string().min(1, 'project_root is required'),
  name: z.string().optional(),
  machine_id: z.string().optional(),
});

export const sessionEndSchema = z.object({
  session_id: sessionIdSchema,
  release_claims: z.enum(['complete', 'abandon']).default('abandon'),
});

export const sessionListSchema = z.object({
  include_inactive: z.boolean().optional(),
  project_root: z.string().optional(),
});

export const sessionHeartbeatSchema = z.object({
  session_id: sessionIdSchema,
  current_task: z.string().optional(),
  todos: z.array(z.object({
    content: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed']),
  })).optional(),
});

export const statusUpdateSchema = z.object({
  session_id: sessionIdSchema,
  current_task: z.string().optional(),
  todos: z.array(z.object({
    content: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed']),
  })).optional(),
});

export const configSchema = z.object({
  session_id: sessionIdSchema,
  mode: z.enum(['strict', 'smart', 'bypass']).optional(),
  allow_release_others: z.boolean().optional(),
  auto_release_stale: z.boolean().optional(),
  stale_threshold_hours: z.number().min(0).optional(),
});

// Claim tools input schemas
export const claimCreateSchema = z.object({
  session_id: sessionIdSchema,
  files: z.array(filePathSchema).optional(),
  symbols: symbolClaimsArraySchema.optional(),
  intent: z.string().min(1, 'intent is required'),
  scope: claimScopeSchema.optional(),
}).refine(
  (data) => (data.files && data.files.length > 0) || (data.symbols && data.symbols.length > 0),
  { message: 'Either files or symbols must be provided' }
);

export const claimCheckSchema = z.object({
  files: filesArraySchema,
  symbols: symbolClaimsArraySchema.optional(),
  session_id: z.string().optional(),
});

export const claimReleaseSchema = z.object({
  session_id: sessionIdSchema,
  claim_id: claimIdSchema,
  status: claimStatusSchema,
  summary: z.string().optional(),
  force: z.boolean().optional(),
});

export const claimListSchema = z.object({
  session_id: z.string().optional(),
  status: z.enum(['active', 'completed', 'abandoned', 'all']).optional(),
  project_root: z.string().optional(),
});

// Message tools input schemas
export const messageSendSchema = z.object({
  from_session_id: sessionIdSchema,
  to_session_id: z.string().optional(),
  content: z.string().min(1, 'content is required'),
});

export const messageListSchema = z.object({
  session_id: sessionIdSchema,
  unread_only: z.boolean().optional(),
  mark_as_read: z.boolean().optional(),
});

// Decision tools input schemas
export const decisionAddSchema = z.object({
  session_id: sessionIdSchema,
  category: z.enum(['architecture', 'naming', 'api', 'database', 'ui', 'other']).optional(),
  title: z.string().min(1, 'title is required'),
  description: z.string().min(1, 'description is required'),
});

export const decisionListSchema = z.object({
  category: z.enum(['architecture', 'naming', 'api', 'database', 'ui', 'other']).optional(),
  limit: z.number().min(1).max(100).optional(),
});

// LSP tools input schemas
// Using z.ZodType to properly type recursive schema
type LspSymbol = {
  name: string;
  kind: number;
  range?: { start: { line: number; character: number }; end: { line: number; character: number } };
  children?: LspSymbol[];
};

export const lspSymbolSchema: z.ZodType<LspSymbol> = z.object({
  name: z.string(),
  kind: z.number(),
  range: z.object({
    start: z.object({ line: z.number(), character: z.number() }),
    end: z.object({ line: z.number(), character: z.number() }),
  }).optional(),
  children: z.lazy(() => z.array(lspSymbolSchema)).optional(),
});

export const analyzeSymbolsSchema = z.object({
  session_id: sessionIdSchema,
  files: z.array(z.object({
    file: z.string(),
    symbols: z.array(lspSymbolSchema),
  })),
  check_symbols: z.array(z.string()).optional(),
  references: z.array(z.object({
    symbol: z.string(),
    file: z.string(),
    references: z.array(z.object({
      file: z.string(),
      line: z.number(),
      context: z.string().optional(),
    })),
  })).optional(),
});

export const validateSymbolsSchema = z.object({
  file: z.string().min(1),
  symbols: z.array(z.string().min(1)),
  lsp_symbols: z.array(lspSymbolSchema),
});

export const storeReferencesSchema = z.object({
  session_id: sessionIdSchema,
  references: z.array(z.object({
    source_file: z.string(),
    source_symbol: z.string(),
    references: z.array(z.object({
      file: z.string(),
      line: z.number(),
      context: z.string().optional(),
    })),
  })),
  clear_existing: z.boolean().optional(),
});

export const impactAnalysisSchema = z.object({
  session_id: sessionIdSchema,
  file: z.string().min(1),
  symbol: z.string().min(1),
});

// Helper function to validate and return parsed data or error result
export function validateInput<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
  return { success: false, error: errors };
}
