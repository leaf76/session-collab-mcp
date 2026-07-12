#!/usr/bin/env node
/**
 * Sync local plugin skills/commands into Claude plugin cache when present,
 * so skill docs match the built dist/cli.js runtime.
 *
 * Usage (from repo root): npm run install:local
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const pluginSrc = join(root, 'plugin');
const cacheRoot = join(homedir(), '.claude', 'plugins', 'cache', 'session-collab-plugins', 'session-collab');

function copyIfExists(from, to) {
  if (!existsSync(from)) return false;
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
  return true;
}

console.log('session-collab install:local');
console.log('  dist built via npm run build (prerequisite)');
console.log(`  source plugin: ${pluginSrc}`);

if (!existsSync(join(root, 'dist', 'cli.js'))) {
  console.error('  error: dist/cli.js missing — run npm run build first');
  process.exit(1);
}

let synced = 0;
if (existsSync(cacheRoot)) {
  for (const entry of readdirSync(cacheRoot)) {
    const versionDir = join(cacheRoot, entry);
    if (!statSync(versionDir).isDirectory()) continue;
    if (copyIfExists(join(pluginSrc, 'skills'), join(versionDir, 'skills'))) {
      console.log(`  synced skills → ${versionDir}/skills`);
      synced++;
    }
    if (copyIfExists(join(pluginSrc, 'commands'), join(versionDir, 'commands'))) {
      console.log(`  synced commands → ${versionDir}/commands`);
      synced++;
    }
    if (copyIfExists(join(pluginSrc, 'hooks'), join(versionDir, 'hooks'))) {
      console.log(`  synced hooks → ${versionDir}/hooks`);
      synced++;
    }
  }
} else {
  console.log('  no Claude plugin cache found (ok if you only use MCP dist)');
}

// Optional: copy collab-start command into ~/.claude/commands if present
const userCmd = join(homedir(), '.claude', 'commands', 'collab-start.md');
const srcSkillHint = join(pluginSrc, 'skills', 'collab-start', 'SKILL.md');
if (existsSync(dirname(userCmd)) && existsSync(srcSkillHint)) {
  // Keep a thin command file pointing at non-trivial-only start
  const { writeFileSync } = await import('node:fs');
  writeFileSync(
    userCmd,
    `---
description: Start session collaboration (non-trivial / multi-session only)
allowed-tools:
  - mcp__session-collab__collab_session_start
---

Call \`mcp__session-collab__collab_session_start\` **only** for non-trivial edits or parallel-session risk. Skip pure Q&A/chat.

Args:
- project_root: repo to edit
- name: stable name (enables reuse)
- restore_context: false by default
- force_new: true only to skip reuse

Prefer \`collab_claim\` action=create (atomic). Do not chain check→create by default.
`,
    'utf8'
  );
  console.log(`  wrote ${userCmd}`);
  synced++;
}

console.log(`  done (${synced} sync step(s)). Restart MCP hosts to load new dist.`);
