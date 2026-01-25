#!/usr/bin/env node
// HTTP server for Session Collaboration MCP

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createLocalDatabase, getDefaultDbPath } from '../db/sqlite-adapter.js';
import { startHttpServer } from './server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadMigrations(): string[] {
  const migrationsDir = join(__dirname, '..', '..', 'migrations');
  return [
    readFileSync(join(migrationsDir, '0001_init.sql'), 'utf-8'),
    readFileSync(join(migrationsDir, '0002_auth.sql'), 'utf-8'),
    readFileSync(join(migrationsDir, '0003_config.sql'), 'utf-8'),
    readFileSync(join(migrationsDir, '0004_symbols.sql'), 'utf-8'),
    readFileSync(join(migrationsDir, '0005_references.sql'), 'utf-8'),
    readFileSync(join(migrationsDir, '0006_composite_indexes.sql'), 'utf-8'),
  ];
}

function parseArgs(): { dbPath?: string; host: string; port: number } {
  const args = process.argv.slice(2);
  let dbPath: string | undefined;
  let host = '127.0.0.1';
  let port = 8765;

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
    }
  }

  return { dbPath, host, port };
}

async function main(): Promise<void> {
  const { dbPath, host, port } = parseArgs();
  const db = createLocalDatabase(dbPath);

  try {
    const migrations = loadMigrations();
    db.initSchema(migrations);
  } catch (error) {
    if (!(error instanceof Error && error.message.includes('already exists'))) {
      console.error('Warning: Migration error:', error);
    }
  }

  await startHttpServer(db, { host, port });
  console.error(`Session Collab HTTP Server running at http://${host}:${port}`);
  console.error(`Database: ${dbPath ?? getDefaultDbPath()}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
