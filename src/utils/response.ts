// Common response utilities for MCP tools
// Reduces duplication and standardizes error handling

import type { McpToolResult } from '../mcp/protocol.js';
import { createToolResult } from '../mcp/protocol.js';
import type { DatabaseAdapter } from '../db/sqlite-adapter.js';
import type { Session } from '../db/types.js';
import { getSession } from '../db/queries.js';

// Standard error codes used across tools
export const ERROR_CODES = {
  INVALID_INPUT: 'INVALID_INPUT',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  SESSION_INVALID: 'SESSION_INVALID',
  CLAIM_NOT_FOUND: 'CLAIM_NOT_FOUND',
  CLAIM_ALREADY_RELEASED: 'CLAIM_ALREADY_RELEASED',
  NOT_OWNER: 'NOT_OWNER',
  TARGET_SESSION_INVALID: 'TARGET_SESSION_INVALID',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// Error response builder - reduces JSON.stringify boilerplate
export function errorResponse(code: ErrorCode, message: string, data?: Record<string, unknown>): McpToolResult {
  return createToolResult(
    JSON.stringify({ error: code, message, ...data }),
    true
  );
}

// Success response builder with optional pretty print
export function successResponse(data: Record<string, unknown>, prettyPrint = false): McpToolResult {
  return createToolResult(
    JSON.stringify(data, null, prettyPrint ? 2 : undefined)
  );
}

// Session validation result
export type SessionValidationResult =
  | { valid: true; session: Session }
  | { valid: false; error: McpToolResult };

// Validate session exists and is active
export async function validateActiveSession(
  db: DatabaseAdapter,
  sessionId: string
): Promise<SessionValidationResult> {
  const session = await getSession(db, sessionId);

  if (!session) {
    return {
      valid: false,
      error: errorResponse(ERROR_CODES.SESSION_NOT_FOUND, 'Session not found'),
    };
  }

  if (session.status !== 'active') {
    return {
      valid: false,
      error: errorResponse(ERROR_CODES.SESSION_INVALID, 'Session not found or inactive.'),
    };
  }

  return { valid: true, session };
}

// Validate session exists (regardless of status)
export async function validateSessionExists(
  db: DatabaseAdapter,
  sessionId: string
): Promise<SessionValidationResult> {
  const session = await getSession(db, sessionId);

  if (!session) {
    return {
      valid: false,
      error: errorResponse(ERROR_CODES.SESSION_NOT_FOUND, 'Session not found'),
    };
  }

  return { valid: true, session };
}

// Common validation error response
export function validationError(message: string): McpToolResult {
  return errorResponse(ERROR_CODES.INVALID_INPUT, message);
}
