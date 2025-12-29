// Cryptographic utilities

/**
 * Generate UUID v4
 */
export function generateId(): string {
  return crypto.randomUUID();
}
