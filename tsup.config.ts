import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
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
