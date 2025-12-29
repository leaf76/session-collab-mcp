// Authentication middleware

import type { D1Database } from '../db/sqlite-adapter.js';
import { verifyJwt } from './jwt';
import { getApiTokenByHash, updateApiTokenLastUsed } from '../db/auth-queries';
import { sha256, timingSafeEqual } from '../utils/crypto';
import type { AuthContext } from './types';

export interface Env {
  DB: D1Database;
  JWT_SECRET?: string;
  API_TOKEN?: string; // Legacy single token support
}

/**
 * Validate authentication from request
 * Supports three modes:
 * 1. JWT (Bearer ey...) - for web UI
 * 2. API Token (Bearer mcp_...) - for MCP requests
 * 3. Legacy (Bearer <API_TOKEN>) - backward compatibility
 */
export async function validateAuth(request: Request, env: Env): Promise<AuthContext | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7); // Remove 'Bearer '

  // 1. Try API Token authentication (mcp_xxx)
  if (token.startsWith('mcp_')) {
    return await validateApiToken(token, env.DB);
  }

  // 2. Try JWT authentication (starts with eyJ for base64 encoded JSON)
  if (token.startsWith('eyJ') && env.JWT_SECRET) {
    return await validateJwtToken(token, env.JWT_SECRET);
  }

  // 3. Try legacy API_TOKEN (backward compatibility)
  if (env.API_TOKEN && timingSafeEqual(token, env.API_TOKEN)) {
    return {
      type: 'legacy',
      userId: 'legacy',
      scopes: ['mcp'],
    };
  }

  return null;
}

/**
 * Validate API Token
 */
async function validateApiToken(token: string, db: D1Database): Promise<AuthContext | null> {
  const tokenHash = await sha256(token);
  const apiToken = await getApiTokenByHash(db, tokenHash);

  if (!apiToken) {
    return null;
  }

  // Update last used timestamp (fire and forget)
  updateApiTokenLastUsed(db, apiToken.id).catch(() => {});

  return {
    type: 'api_token',
    userId: apiToken.user_id,
    tokenId: apiToken.id,
    scopes: JSON.parse(apiToken.scopes),
  };
}

/**
 * Validate JWT Token
 */
async function validateJwtToken(token: string, secret: string): Promise<AuthContext | null> {
  const payload = await verifyJwt(token, secret);

  if (!payload || payload.type !== 'access') {
    return null;
  }

  return {
    type: 'jwt',
    userId: payload.sub,
  };
}

/**
 * Check if auth context has required scope
 */
export function hasScope(authContext: AuthContext, requiredScope: string): boolean {
  // JWT users have all scopes
  if (authContext.type === 'jwt') {
    return true;
  }

  // Legacy token has mcp scope
  if (authContext.type === 'legacy') {
    return requiredScope === 'mcp';
  }

  // API Token - check scopes
  return authContext.scopes?.includes(requiredScope) ?? false;
}

/**
 * Create unauthorized response
 */
export function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({
      error: 'Unauthorized',
      code: 'ERR_UNAUTHORIZED',
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
}

/**
 * Create forbidden response
 */
export function forbiddenResponse(message = 'Insufficient permissions'): Response {
  return new Response(
    JSON.stringify({
      error: message,
      code: 'ERR_FORBIDDEN',
    }),
    {
      status: 403,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
}
