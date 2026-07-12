// Path normalization for claim conflict detection
// Always store claim paths relative to project_root with forward slashes.

import path from 'node:path';

export class PathNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathNormalizationError';
  }
}

/** Resolve and strip trailing separators from a project root. */
export function normalizeProjectRoot(projectRoot: string): string {
  if (!projectRoot || projectRoot.includes('\0')) {
    throw new PathNormalizationError('project_root is invalid');
  }
  return path.resolve(projectRoot);
}

/**
 * Normalize a claim file path relative to project_root.
 * Absolute paths under the root become relative; outside the root is rejected.
 * Glob patterns (`*`, `?`) are preserved after normalization of the non-glob prefix.
 */
export function normalizeClaimPath(filePath: string, projectRoot: string): string {
  if (!filePath || filePath.includes('\0')) {
    throw new PathNormalizationError('file path is invalid');
  }
  if (filePath.includes('..')) {
    throw new PathNormalizationError(`path traversal not allowed: ${filePath}`);
  }

  const root = normalizeProjectRoot(projectRoot);
  const trimmed = filePath.trim();
  if (!trimmed) {
    throw new PathNormalizationError('file path is empty');
  }

  // Glob-only patterns stay as-is (normalized separators)
  if (trimmed.startsWith('**') || trimmed === '*' || trimmed.startsWith('*/')) {
    return trimmed.split(path.sep).join('/');
  }

  let absolute: string;
  if (path.isAbsolute(trimmed)) {
    absolute = path.normalize(trimmed);
  } else {
    absolute = path.normalize(path.join(root, trimmed));
  }

  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PathNormalizationError(
      `path is outside project_root: ${filePath}`
    );
  }

  // Empty relative means the project root itself — not a useful claim path
  if (!relative || relative === '.') {
    throw new PathNormalizationError(`path must be a file under project_root: ${filePath}`);
  }

  return relative.split(path.sep).join('/');
}

export function normalizeClaimPaths(files: string[], projectRoot: string): string[] {
  const normalized = files.map((f) => normalizeClaimPath(f, projectRoot));
  return Array.from(new Set(normalized));
}

export function normalizeSymbolClaims<T extends { file: string; symbols: string[]; symbol_type?: string }>(
  symbols: T[],
  projectRoot: string
): T[] {
  return symbols.map((s) => ({
    ...s,
    file: normalizeClaimPath(s.file, projectRoot),
  }));
}
