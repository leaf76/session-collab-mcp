// JWT utilities using Web Crypto API (HS256)

import { base64UrlEncode, base64UrlDecode } from '../utils/crypto';

export interface JwtPayload {
  sub: string; // user_id
  iat: number; // issued at (unix timestamp)
  exp: number; // expires at (unix timestamp)
  type: 'access' | 'refresh';
}

const JWT_ALGORITHM = 'HS256';
const ACCESS_TOKEN_EXPIRY = 15 * 60; // 15 minutes
const REFRESH_TOKEN_EXPIRY = 7 * 24 * 60 * 60; // 7 days

/**
 * Sign a JWT using HS256
 */
export async function signJwt(payload: JwtPayload, secret: string): Promise<string> {
  const header = { alg: JWT_ALGORITHM, typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`));

  return `${encodedHeader}.${encodedPayload}.${base64UrlEncode(signature)}`;
}

/**
 * Verify and decode a JWT
 * Returns null if invalid or expired
 */
export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  // Verify signature
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);

  // Decode signature from base64url
  const signatureStr = base64UrlDecode(encodedSignature);
  const signature = new Uint8Array(signatureStr.length);
  for (let i = 0; i < signatureStr.length; i++) {
    signature[i] = signatureStr.charCodeAt(i);
  }

  const valid = await crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`));

  if (!valid) {
    return null;
  }

  // Decode and parse payload
  try {
    const payloadStr = base64UrlDecode(encodedPayload);
    const payload = JSON.parse(payloadStr) as JwtPayload;

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Create an access token
 */
export async function createAccessToken(userId: string, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: userId,
    iat: now,
    exp: now + ACCESS_TOKEN_EXPIRY,
    type: 'access',
  };
  return signJwt(payload, secret);
}

/**
 * Create a refresh token
 */
export async function createRefreshToken(userId: string, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: userId,
    iat: now,
    exp: now + REFRESH_TOKEN_EXPIRY,
    type: 'refresh',
  };
  return signJwt(payload, secret);
}

/**
 * Get token expiry times
 */
export function getTokenExpiry(): { accessToken: number; refreshToken: number } {
  return {
    accessToken: ACCESS_TOKEN_EXPIRY,
    refreshToken: REFRESH_TOKEN_EXPIRY,
  };
}
