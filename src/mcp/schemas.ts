// Zod schemas for MCP tool input validation
import { z } from 'zod';

// Common schemas
export const sessionIdSchema = z.string().min(1, 'session_id is required');
export const claimIdSchema = z.string().min(1, 'claim_id is required');
export const filePathSchema = z.string().min(1).refine(
  (path) => !path.includes('..') && !path.includes('\0'),
  { message: 'Path cannot contain path traversal sequences (..) or null bytes' }
);
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
  auto_release_immediate: z.boolean().optional(),
  auto_release_delay_minutes: z.number().min(0).optional(),
});

export const statusSchema = z.object({
  session_id: sessionIdSchema,
});

// Priority schema (0-100, default 50)
export const prioritySchema = z.number().min(0).max(100).default(50);

// Claim tools input schemas
export const claimCreateSchema = z.object({
  session_id: sessionIdSchema,
  files: z.array(filePathSchema).optional(),
  symbols: symbolClaimsArraySchema.optional(),
  intent: z.string().min(1, 'intent is required'),
  scope: claimScopeSchema.optional(),
  priority: z.number().min(0).max(100).optional(),
}).refine(
  (data) => (data.files && data.files.length > 0) || (data.symbols && data.symbols.length > 0),
  { message: 'Either files or symbols must be provided' }
);

export const claimUpdatePrioritySchema = z.object({
  session_id: sessionIdSchema,
  claim_id: claimIdSchema,
  priority: z.number().min(0).max(100),
  reason: z.string().optional(),
});

export const claimCheckSchema = z.object({
  files: filesArraySchema,
  symbols: symbolClaimsArraySchema.optional(),
  session_id: sessionIdSchema,
  exclude_self: z.boolean().optional(),
});

export const claimReleaseSchema = z.object({
  session_id: sessionIdSchema,
  claim_id: claimIdSchema,
  status: claimStatusSchema.default('completed').optional(),
  summary: z.string().optional(),
  force: z.boolean().optional(),
});

// Auto-release schema for releasing claims by file path after edit
export const autoReleaseSchema = z.object({
  session_id: sessionIdSchema,
  file_path: z.string().min(1, 'file_path is required'),
  force: z.boolean().optional(),
});

export const claimListSchema = z.object({
  session_id: z.string().optional(),
  status: z.enum(['active', 'completed', 'abandoned', 'all']).optional(),
  project_root: z.string().optional(),
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
