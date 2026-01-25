import { defineConfig } from 'tsup';

const legacyEntry = process.env.SESSION_COLLAB_INCLUDE_LEGACY === 'true'
  ? ['src/legacy/legacy-entry.ts']
  : [];

export default defineConfig({
  entry: ['src/cli.ts', 'src/http/cli.ts', 'src/http/client-cli.ts', ...legacyEntry],
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // better-sqlite3 is native module, keep as external
  external: ['better-sqlite3'],
  // Bundle everything else
  noExternal: ['zod'],
  shims: true,
});
