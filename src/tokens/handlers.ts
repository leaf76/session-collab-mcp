// Token management API handlers

import type { D1Database } from '@cloudflare/workers-types';
import { z } from 'zod';
import { generateApiToken } from './generator';
import { createApiToken, listApiTokens, revokeApiToken } from '../db/auth-queries';
import type { AuthContext } from '../auth/types';

// Request schemas
const CreateTokenRequestSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  scopes: z.array(z.string()).default(['mcp']),
  expires_in_days: z.number().int().min(1).max(365).optional(),
});

interface HandlerContext {
  db: D1Database;
  request: Request;
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function errorResponse(error: string, code: string, status: number, details?: { field: string; message: string }[]): Response {
  return jsonResponse({ error, code, details }, status);
}

/**
 * POST /tokens
 * Create a new API token
 */
export async function handleCreateToken(ctx: HandlerContext, authContext: AuthContext): Promise<Response> {
  const body = await ctx.request.json();
  const parsed = CreateTokenRequestSchema.safeParse(body);

  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    }));
    return errorResponse('Validation failed', 'ERR_VALIDATION', 422, details);
  }

  const { name, scopes, expires_in_days } = parsed.data;

  // Generate token
  const rawToken = generateApiToken();

  // Store token
  const { token } = await createApiToken(ctx.db, {
    user_id: authContext.userId,
    name,
    token: rawToken,
    scopes,
    expires_in_days,
  });

  // Response includes the raw token (only shown once)
  const response = {
    token: {
      id: token.id,
      name: token.name,
      token: rawToken, // Only time raw token is returned
      token_prefix: token.token_prefix,
      scopes: JSON.parse(token.scopes),
      expires_at: token.expires_at,
      created_at: token.created_at,
    },
    warning: 'This token will only be shown once. Store it securely.',
  };

  return jsonResponse(response, 201);
}

/**
 * GET /tokens
 * List all tokens for the authenticated user
 */
export async function handleListTokens(ctx: HandlerContext, authContext: AuthContext): Promise<Response> {
  const tokens = await listApiTokens(ctx.db, authContext.userId);

  const response = {
    tokens,
    total: tokens.length,
  };

  return jsonResponse(response);
}

/**
 * DELETE /tokens/:id
 * Revoke a token
 */
export async function handleRevokeToken(ctx: HandlerContext, authContext: AuthContext, tokenId: string): Promise<Response> {
  const success = await revokeApiToken(ctx.db, tokenId, authContext.userId);

  if (!success) {
    return errorResponse('Token not found', 'ERR_NOT_FOUND', 404);
  }

  return jsonResponse({ message: 'Token revoked successfully' });
}
