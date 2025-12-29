// Authentication API handlers

import type { D1Database } from '@cloudflare/workers-types';
import { hashPassword, verifyPassword, validatePasswordStrength } from './password';
import { createAccessToken, createRefreshToken, verifyJwt, getTokenExpiry } from './jwt';
import {
  createUser,
  getUserByEmail,
  getUserById,
  updateUserLastLogin,
  updateUserPassword,
  updateUserProfile,
  toUserPublic,
  createRefreshToken as createRefreshTokenDb,
  getRefreshTokenByHash,
  revokeRefreshToken,
  revokeAllUserRefreshTokens,
} from '../db/auth-queries';
import { sha256 } from '../utils/crypto';
import {
  RegisterRequestSchema,
  LoginRequestSchema,
  RefreshRequestSchema,
  UpdateProfileRequestSchema,
  ChangePasswordRequestSchema,
  type AuthResponse,
  type UserResponse,
  type AuthContext,
} from './types';

interface HandlerContext {
  db: D1Database;
  jwtSecret: string;
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
 * POST /auth/register
 */
export async function handleRegister(ctx: HandlerContext): Promise<Response> {
  const body = await ctx.request.json();
  const parsed = RegisterRequestSchema.safeParse(body);

  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    }));
    return errorResponse('Validation failed', 'ERR_VALIDATION', 422, details);
  }

  const { email, password, display_name } = parsed.data;

  // Validate password strength
  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    return errorResponse(passwordError, 'ERR_WEAK_PASSWORD', 422, [{ field: 'password', message: passwordError }]);
  }

  // Check if email already exists
  const existingUser = await getUserByEmail(ctx.db, email);
  if (existingUser) {
    return errorResponse('Email already registered', 'ERR_EMAIL_EXISTS', 409, [{ field: 'email', message: 'Email already registered' }]);
  }

  // Create user
  const passwordHash = await hashPassword(password);
  const user = await createUser(ctx.db, {
    email,
    password_hash: passwordHash,
    display_name,
  });

  // Create tokens
  const accessToken = await createAccessToken(user.id, ctx.jwtSecret);
  const refreshToken = await createRefreshToken(user.id, ctx.jwtSecret);
  const refreshTokenHash = await sha256(refreshToken);
  const { refreshToken: refreshExpiry } = getTokenExpiry();

  // Store refresh token
  await createRefreshTokenDb(ctx.db, {
    user_id: user.id,
    token_hash: refreshTokenHash,
    expires_at: new Date(Date.now() + refreshExpiry * 1000).toISOString(),
    user_agent: ctx.request.headers.get('User-Agent') ?? undefined,
    ip_address: ctx.request.headers.get('CF-Connecting-IP') ?? undefined,
  });

  const response: AuthResponse = {
    user: toUserPublic(user),
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: getTokenExpiry().accessToken,
  };

  return jsonResponse(response, 201);
}

/**
 * POST /auth/login
 */
export async function handleLogin(ctx: HandlerContext): Promise<Response> {
  const body = await ctx.request.json();
  const parsed = LoginRequestSchema.safeParse(body);

  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    }));
    return errorResponse('Validation failed', 'ERR_VALIDATION', 422, details);
  }

  const { email, password } = parsed.data;

  // Find user
  const user = await getUserByEmail(ctx.db, email);
  if (!user) {
    return errorResponse('Invalid email or password', 'ERR_INVALID_CREDENTIALS', 401);
  }

  // Verify password
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return errorResponse('Invalid email or password', 'ERR_INVALID_CREDENTIALS', 401);
  }

  // Update last login
  await updateUserLastLogin(ctx.db, user.id);

  // Create tokens
  const accessToken = await createAccessToken(user.id, ctx.jwtSecret);
  const refreshToken = await createRefreshToken(user.id, ctx.jwtSecret);
  const refreshTokenHash = await sha256(refreshToken);
  const { refreshToken: refreshExpiry } = getTokenExpiry();

  // Store refresh token
  await createRefreshTokenDb(ctx.db, {
    user_id: user.id,
    token_hash: refreshTokenHash,
    expires_at: new Date(Date.now() + refreshExpiry * 1000).toISOString(),
    user_agent: ctx.request.headers.get('User-Agent') ?? undefined,
    ip_address: ctx.request.headers.get('CF-Connecting-IP') ?? undefined,
  });

  const response: AuthResponse = {
    user: toUserPublic(user),
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: getTokenExpiry().accessToken,
  };

  return jsonResponse(response);
}

/**
 * POST /auth/refresh
 */
export async function handleRefresh(ctx: HandlerContext): Promise<Response> {
  const body = await ctx.request.json();
  const parsed = RefreshRequestSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse('Invalid request', 'ERR_VALIDATION', 422);
  }

  const { refresh_token } = parsed.data;

  // Verify JWT
  const payload = await verifyJwt(refresh_token, ctx.jwtSecret);
  if (!payload || payload.type !== 'refresh') {
    return errorResponse('Invalid refresh token', 'ERR_INVALID_TOKEN', 401);
  }

  // Check if refresh token is in database (not revoked)
  const refreshTokenHash = await sha256(refresh_token);
  const storedToken = await getRefreshTokenByHash(ctx.db, refreshTokenHash);
  if (!storedToken) {
    return errorResponse('Refresh token has been revoked', 'ERR_TOKEN_REVOKED', 401);
  }

  // Get user
  const user = await getUserById(ctx.db, payload.sub);
  if (!user) {
    return errorResponse('User not found', 'ERR_USER_NOT_FOUND', 404);
  }

  // Revoke old refresh token
  await revokeRefreshToken(ctx.db, storedToken.id);

  // Create new tokens
  const accessToken = await createAccessToken(user.id, ctx.jwtSecret);
  const newRefreshToken = await createRefreshToken(user.id, ctx.jwtSecret);
  const newRefreshTokenHash = await sha256(newRefreshToken);
  const { refreshToken: refreshExpiry } = getTokenExpiry();

  // Store new refresh token
  await createRefreshTokenDb(ctx.db, {
    user_id: user.id,
    token_hash: newRefreshTokenHash,
    expires_at: new Date(Date.now() + refreshExpiry * 1000).toISOString(),
    user_agent: ctx.request.headers.get('User-Agent') ?? undefined,
    ip_address: ctx.request.headers.get('CF-Connecting-IP') ?? undefined,
  });

  const response: AuthResponse = {
    user: toUserPublic(user),
    access_token: accessToken,
    refresh_token: newRefreshToken,
    expires_in: getTokenExpiry().accessToken,
  };

  return jsonResponse(response);
}

/**
 * POST /auth/logout
 */
export async function handleLogout(ctx: HandlerContext, authContext: AuthContext): Promise<Response> {
  // Revoke all refresh tokens for user
  await revokeAllUserRefreshTokens(ctx.db, authContext.userId);

  return jsonResponse({ message: 'Logged out successfully' });
}

/**
 * GET /auth/me
 */
export async function handleGetMe(ctx: HandlerContext, authContext: AuthContext): Promise<Response> {
  const user = await getUserById(ctx.db, authContext.userId);
  if (!user) {
    return errorResponse('User not found', 'ERR_USER_NOT_FOUND', 404);
  }

  const response: UserResponse = toUserPublic(user);
  return jsonResponse(response);
}

/**
 * PUT /auth/me
 */
export async function handleUpdateMe(ctx: HandlerContext, authContext: AuthContext): Promise<Response> {
  const body = await ctx.request.json();
  const parsed = UpdateProfileRequestSchema.safeParse(body);

  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    }));
    return errorResponse('Validation failed', 'ERR_VALIDATION', 422, details);
  }

  await updateUserProfile(ctx.db, authContext.userId, parsed.data);

  const user = await getUserById(ctx.db, authContext.userId);
  if (!user) {
    return errorResponse('User not found', 'ERR_USER_NOT_FOUND', 404);
  }

  const response: UserResponse = toUserPublic(user);
  return jsonResponse(response);
}

/**
 * PUT /auth/password
 */
export async function handleChangePassword(ctx: HandlerContext, authContext: AuthContext): Promise<Response> {
  const body = await ctx.request.json();
  const parsed = ChangePasswordRequestSchema.safeParse(body);

  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    }));
    return errorResponse('Validation failed', 'ERR_VALIDATION', 422, details);
  }

  const { current_password, new_password } = parsed.data;

  // Validate new password strength
  const passwordError = validatePasswordStrength(new_password);
  if (passwordError) {
    return errorResponse(passwordError, 'ERR_WEAK_PASSWORD', 422, [{ field: 'new_password', message: passwordError }]);
  }

  // Get user
  const user = await getUserById(ctx.db, authContext.userId);
  if (!user) {
    return errorResponse('User not found', 'ERR_USER_NOT_FOUND', 404);
  }

  // Verify current password
  const valid = await verifyPassword(current_password, user.password_hash);
  if (!valid) {
    return errorResponse('Current password is incorrect', 'ERR_INVALID_PASSWORD', 401, [{ field: 'current_password', message: 'Current password is incorrect' }]);
  }

  // Update password
  const newPasswordHash = await hashPassword(new_password);
  await updateUserPassword(ctx.db, authContext.userId, newPasswordHash);

  // Revoke all refresh tokens (force re-login)
  await revokeAllUserRefreshTokens(ctx.db, authContext.userId);

  return jsonResponse({ message: 'Password changed successfully. Please login again.' });
}
