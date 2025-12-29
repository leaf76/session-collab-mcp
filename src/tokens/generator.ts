// API Token generator

import { generateRandomBytes, bytesToHex } from '../utils/crypto';

const TOKEN_PREFIX = 'mcp_';
const TOKEN_RANDOM_BYTES = 24; // 192 bits of randomness

/**
 * Generate a new API token
 * Format: mcp_<48 hex characters>
 * Total length: 52 characters
 */
export function generateApiToken(): string {
  const randomBytes = generateRandomBytes(TOKEN_RANDOM_BYTES);
  const randomHex = bytesToHex(randomBytes);
  return `${TOKEN_PREFIX}${randomHex}`;
}

/**
 * Get token prefix for display
 * Shows first 12 characters (mcp_ + 8 hex chars)
 */
export function getTokenPrefix(token: string): string {
  return token.substring(0, 12);
}

/**
 * Validate token format
 */
export function isValidTokenFormat(token: string): boolean {
  // Must start with mcp_ and have 48 hex characters after
  return /^mcp_[a-f0-9]{48}$/.test(token);
}
