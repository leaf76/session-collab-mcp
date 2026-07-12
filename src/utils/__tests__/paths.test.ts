import { describe, it, expect } from 'vitest';
import {
  normalizeClaimPath,
  normalizeClaimPaths,
  normalizeProjectRoot,
  PathNormalizationError,
} from '../paths.js';

describe('path normalization', () => {
  const root = '/Users/me/project';

  it('normalizes project root', () => {
    expect(normalizeProjectRoot('/Users/me/project/')).toBe('/Users/me/project');
  });

  it('converts absolute paths under root to relative', () => {
    expect(normalizeClaimPath('/Users/me/project/src/a.ts', root)).toBe('src/a.ts');
  });

  it('normalizes relative paths', () => {
    expect(normalizeClaimPath('src/a.ts', root)).toBe('src/a.ts');
    expect(normalizeClaimPath('./src/a.ts', root)).toBe('src/a.ts');
  });

  it('treats absolute and relative forms as the same path', () => {
    const paths = normalizeClaimPaths(
      ['src/a.ts', '/Users/me/project/src/a.ts', './src/a.ts'],
      root
    );
    expect(paths).toEqual(['src/a.ts']);
  });

  it('rejects path traversal', () => {
    expect(() => normalizeClaimPath('../secret', root)).toThrow(PathNormalizationError);
    expect(() => normalizeClaimPath('src/../../etc/passwd', root)).toThrow(PathNormalizationError);
  });

  it('rejects paths outside project root', () => {
    expect(() => normalizeClaimPath('/tmp/other.ts', root)).toThrow(PathNormalizationError);
  });
});
