// Legacy schemas for deprecated tools (not exposed in v2 tool list).

import { z } from 'zod';
import { sessionIdSchema, claimIdSchema, claimScopeSchema } from './schemas.js';

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

// Audit history schemas
export const historyListSchema = z.object({
  session_id: z.string().optional(),
  action: z.enum([
    'session_started', 'session_ended',
    'claim_created', 'claim_released', 'conflict_detected',
    'queue_joined', 'queue_left', 'priority_changed',
  ]).optional(),
  entity_type: z.enum(['session', 'claim', 'queue']).optional(),
  entity_id: z.string().optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  limit: z.number().min(1).max(500).optional(),
});

// Claim queue schemas
export const queueJoinSchema = z.object({
  session_id: sessionIdSchema,
  claim_id: claimIdSchema,
  intent: z.string().min(1, 'intent is required'),
  priority: z.number().min(0).max(100).optional(),
  scope: claimScopeSchema.optional(),
});

export const queueLeaveSchema = z.object({
  session_id: sessionIdSchema,
  queue_id: z.string().min(1, 'queue_id is required'),
});

export const queueListSchema = z.object({
  claim_id: z.string().optional(),
  session_id: z.string().optional(),
});

// Notification schemas
export const notificationListSchema = z.object({
  session_id: sessionIdSchema,
  unread_only: z.boolean().optional(),
  type: z.enum(['claim_released', 'queue_ready', 'conflict_detected', 'session_message']).optional(),
  limit: z.number().min(1).max(100).optional(),
});

export const notificationMarkReadSchema = z.object({
  session_id: sessionIdSchema,
  notification_ids: z.array(z.string().min(1)).min(1, 'At least one notification_id is required'),
});
