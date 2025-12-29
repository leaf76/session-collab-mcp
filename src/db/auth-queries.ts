// Database queries for authentication

import type { DatabaseAdapter } from './sqlite-adapter.js';
import type { User, UserPublic, ApiToken, ApiTokenPublic, RefreshToken } from './types';
import { generateId, sha256 } from '../utils/crypto';

// ============ User Queries ============

export async function createUser(
  db: DatabaseAdapter,
  params: {
    email: string;
    password_hash: string;
    display_name?: string;
  }
): Promise<User> {
  const id = generateId();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`
    )
    .bind(id, params.email.toLowerCase(), params.password_hash, params.display_name ?? null, now, now)
    .run();

  return {
    id,
    email: params.email.toLowerCase(),
    password_hash: params.password_hash,
    display_name: params.display_name ?? null,
    created_at: now,
    updated_at: now,
    last_login_at: null,
    status: 'active',
  };
}

export async function getUserByEmail(db: DatabaseAdapter, email: string): Promise<User | null> {
  const result = await db.prepare('SELECT * FROM users WHERE email = ? AND status = ?').bind(email.toLowerCase(), 'active').first<User>();
  return result ?? null;
}

export async function getUserById(db: DatabaseAdapter, id: string): Promise<User | null> {
  const result = await db.prepare('SELECT * FROM users WHERE id = ? AND status = ?').bind(id, 'active').first<User>();
  return result ?? null;
}

export async function updateUserLastLogin(db: DatabaseAdapter, id: string): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').bind(now, now, id).run();
}

export async function updateUserPassword(db: DatabaseAdapter, id: string, password_hash: string): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').bind(password_hash, now, id).run();
  return result.meta.changes > 0;
}

export async function updateUserProfile(
  db: DatabaseAdapter,
  id: string,
  params: { display_name?: string }
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?').bind(params.display_name ?? null, now, id).run();
  return result.meta.changes > 0;
}

export function toUserPublic(user: User): UserPublic {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    created_at: user.created_at,
  };
}

// ============ API Token Queries ============

export async function createApiToken(
  db: DatabaseAdapter,
  params: {
    user_id: string;
    name: string;
    token: string; // raw token, will be hashed
    scopes?: string[];
    expires_in_days?: number;
  }
): Promise<{ token: ApiToken; raw_token: string }> {
  const id = generateId();
  const now = new Date().toISOString();
  const tokenHash = await sha256(params.token);
  const tokenPrefix = params.token.substring(0, 12); // "mcp_" + first 8 chars
  const scopes = JSON.stringify(params.scopes ?? ['mcp']);
  const expiresAt = params.expires_in_days ? new Date(Date.now() + params.expires_in_days * 24 * 60 * 60 * 1000).toISOString() : null;

  await db
    .prepare(
      `INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, scopes, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, params.user_id, params.name, tokenHash, tokenPrefix, scopes, expiresAt, now)
    .run();

  return {
    token: {
      id,
      user_id: params.user_id,
      name: params.name,
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
      scopes,
      last_used_at: null,
      expires_at: expiresAt,
      created_at: now,
      revoked_at: null,
    },
    raw_token: params.token,
  };
}

export async function getApiTokenByHash(db: DatabaseAdapter, tokenHash: string): Promise<ApiToken | null> {
  const result = await db
    .prepare('SELECT * FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(tokenHash)
    .first<ApiToken>();

  if (!result) return null;

  // Check expiration
  if (result.expires_at && new Date(result.expires_at) < new Date()) {
    return null;
  }

  return result;
}

export async function listApiTokens(db: DatabaseAdapter, userId: string): Promise<ApiTokenPublic[]> {
  const result = await db
    .prepare('SELECT * FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC')
    .bind(userId)
    .all<ApiToken>();

  return result.results.map(toApiTokenPublic);
}

export async function revokeApiToken(db: DatabaseAdapter, id: string, userId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ?').bind(now, id, userId).run();
  return result.meta.changes > 0;
}

export async function updateApiTokenLastUsed(db: DatabaseAdapter, id: string): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').bind(now, id).run();
}

export function toApiTokenPublic(token: ApiToken): ApiTokenPublic {
  return {
    id: token.id,
    name: token.name,
    token_prefix: token.token_prefix,
    scopes: JSON.parse(token.scopes),
    last_used_at: token.last_used_at,
    expires_at: token.expires_at,
    created_at: token.created_at,
  };
}

// ============ Refresh Token Queries ============

export async function createRefreshToken(
  db: DatabaseAdapter,
  params: {
    user_id: string;
    token_hash: string;
    expires_at: string;
    user_agent?: string;
    ip_address?: string;
  }
): Promise<RefreshToken> {
  const id = generateId();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at, user_agent, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, params.user_id, params.token_hash, params.expires_at, now, params.user_agent ?? null, params.ip_address ?? null)
    .run();

  return {
    id,
    user_id: params.user_id,
    token_hash: params.token_hash,
    expires_at: params.expires_at,
    created_at: now,
    revoked_at: null,
    user_agent: params.user_agent ?? null,
    ip_address: params.ip_address ?? null,
  };
}

export async function getRefreshTokenByHash(db: DatabaseAdapter, tokenHash: string): Promise<RefreshToken | null> {
  const result = await db
    .prepare('SELECT * FROM refresh_tokens WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(tokenHash)
    .first<RefreshToken>();

  if (!result) return null;

  // Check expiration
  if (new Date(result.expires_at) < new Date()) {
    return null;
  }

  return result;
}

export async function revokeRefreshToken(db: DatabaseAdapter, id: string): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?').bind(now, id).run();
  return result.meta.changes > 0;
}

export async function revokeAllUserRefreshTokens(db: DatabaseAdapter, userId: string): Promise<number> {
  const now = new Date().toISOString();
  const result = await db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now, userId).run();
  return result.meta.changes;
}

// ============ Cleanup Queries ============

export async function cleanupExpiredTokens(db: DatabaseAdapter): Promise<{ apiTokens: number; refreshTokens: number }> {
  const now = new Date().toISOString();

  // Mark expired API tokens as revoked
  const apiResult = await db
    .prepare("UPDATE api_tokens SET revoked_at = ? WHERE expires_at < ? AND revoked_at IS NULL")
    .bind(now, now)
    .run();

  // Mark expired refresh tokens as revoked
  const refreshResult = await db
    .prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE expires_at < ? AND revoked_at IS NULL")
    .bind(now, now)
    .run();

  return {
    apiTokens: apiResult.meta.changes,
    refreshTokens: refreshResult.meta.changes,
  };
}
