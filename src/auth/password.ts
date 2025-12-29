// Password hashing using PBKDF2-SHA256 (Web Crypto API)

import { bytesToHex, hexToBytes, timingSafeEqual } from '../utils/crypto';

const ITERATIONS = 100000;
const SALT_LENGTH = 16;
const HASH_LENGTH = 256; // bits

/**
 * Hash a password using PBKDF2-SHA256
 * Format: pbkdf2:sha256:<iterations>$<salt_hex>$<hash_hex>
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);

  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    HASH_LENGTH
  );

  const saltHex = bytesToHex(salt);
  const hashHex = bytesToHex(new Uint8Array(hash));

  return `pbkdf2:sha256:${ITERATIONS}$${saltHex}$${hashHex}`;
}

/**
 * Verify a password against a stored hash
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = stored.match(/^pbkdf2:sha256:(\d+)\$([a-f0-9]+)\$([a-f0-9]+)$/);
  if (!match) {
    return false;
  }

  const [, iterStr, saltHex, storedHashHex] = match;
  const iterations = parseInt(iterStr, 10);
  const salt = hexToBytes(saltHex);

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);

  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    key,
    HASH_LENGTH
  );

  const hashHex = bytesToHex(new Uint8Array(hash));

  return timingSafeEqual(hashHex, storedHashHex);
}

/**
 * Validate password strength
 * Returns null if valid, error message if invalid
 */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) {
    return 'Password must be at least 8 characters';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must contain at least one lowercase letter';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least one number';
  }
  return null;
}
