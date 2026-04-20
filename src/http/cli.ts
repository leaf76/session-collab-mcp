#!/usr/bin/env node
// HTTP server for Session Collaboration MCP

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createLocalDatabase, getDefaultDbPath } from '../db/sqlite-adapter.js';
import { startHttpServer } from './server.js';
import { loadMigrationsFromDir } from '../db/migrations.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadMigrations(): string[] {
  const migrationsDir = join(__dirname, '..', '..', 'migrations');
  return loadMigrationsFromDir(migrationsDir);
}

function parseArgs(): { dbPath?: string; host: string; port: number; allowedHosts: string[] } {
  const args = process.argv.slice(2);
  let dbPath: string | undefined;
  let host = '127.0.0.1';
  let port = 8765;
  const allowedHosts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const value = args[i + 1];
    if (args[i] === '--db' && value) {
      dbPath = value;
      i++;
    } else if (args[i] === '--host' && value) {
      host = value;
      i++;
    } else if (args[i] === '--port' && value) {
      port = Number(value);
      i++;
    } else if (args[i] === '--allowed-host' && value) {
      allowedHosts.push(value);
      i++;
    }
  }

  return { dbPath, host, port, allowedHosts };
}

async function main(): Promise<void> {
  const { dbPath, host, port, allowedHosts } = parseArgs();
  const db = createLocalDatabase(dbPath);
  const apiToken = process.env.SESSION_COLLAB_HTTP_TOKEN;
  const envAllowedHosts = (process.env.SESSION_COLLAB_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((hostEntry) => hostEntry.trim())
    .filter(Boolean);

  try {
    const migrations = loadMigrations();
    db.initSchema(migrations);
  } catch (error) {
    if (!(error instanceof Error && error.message.includes('already exists'))) {
      console.error('Warning: Migration error:', error);
    }
  }

  await startHttpServer(db, {
    host,
    port,
    apiToken,
    allowedHosts: [...envAllowedHosts, ...allowedHosts],
  });
  console.error(`Session Collab HTTP Server running at http://${host}:${port}`);
  console.error(`Database: ${dbPath ?? getDefaultDbPath()}`);
  console.error(`MCP endpoint: POST /mcp`);
  console.error(`Convenience REST API: /v1/*`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
