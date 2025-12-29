#!/usr/bin/env node
// Local MCP server for session collaboration
// Runs via stdio, stores data in ~/.claude/session-collab/collab.db

import { createInterface } from 'readline';
import { createLocalDatabase, getDefaultDbPath } from './db/sqlite-adapter.js';
import { handleMcpRequest, getMcpTools } from './mcp/server.js';
import { VERSION, SERVER_NAME, SERVER_INSTRUCTIONS } from './constants.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load migrations
function loadMigrations(): string[] {
  const migrationsDir = join(__dirname, '..', 'migrations');
  return [
    readFileSync(join(migrationsDir, '0001_init.sql'), 'utf-8'),
    readFileSync(join(migrationsDir, '0002_auth.sql'), 'utf-8'),
    readFileSync(join(migrationsDir, '0003_config.sql'), 'utf-8'),
  ];
}

// Parse command line arguments
function parseArgs(): { dbPath?: string } {
  const args = process.argv.slice(2);
  let dbPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db' && args[i + 1]) {
      dbPath = args[i + 1];
      i++;
    }
  }

  return { dbPath };
}

// JSON-RPC response helpers
function jsonRpcResponse(id: number | string | null, result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function jsonRpcError(id: number | string | null, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

async function main(): Promise<void> {
  const { dbPath } = parseArgs();
  const db = createLocalDatabase(dbPath);

  // Initialize schema
  try {
    const migrations = loadMigrations();
    db.initSchema(migrations);
  } catch (error) {
    // Schema might already exist, that's fine
    if (!(error instanceof Error && error.message.includes('already exists'))) {
      console.error('Warning: Migration error:', error);
    }
  }

  // Log startup to stderr (stdout is for JSON-RPC)
  console.error(`Session Collab MCP Server (local)`);
  console.error(`Database: ${dbPath ?? getDefaultDbPath()}`);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line) => {
    if (!line.trim()) return;

    try {
      const request = JSON.parse(line);
      const { id, method, params } = request;

      // Handle MCP protocol methods
      switch (method) {
        case 'initialize': {
          const response = jsonRpcResponse(id, {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: SERVER_NAME,
              version: VERSION,
            },
            instructions: SERVER_INSTRUCTIONS,
          });
          console.log(response);
          break;
        }

        case 'notifications/initialized': {
          // No response needed for notifications
          break;
        }

        case 'tools/list': {
          const tools = getMcpTools();
          const response = jsonRpcResponse(id, { tools });
          console.log(response);
          break;
        }

        case 'tools/call': {
          const result = await handleMcpRequest(
            db,
            params.name,
            params.arguments ?? {}
          );
          const response = jsonRpcResponse(id, result);
          console.log(response);
          break;
        }

        default: {
          const errorResponse = jsonRpcError(id, -32601, `Method not found: ${method}`);
          console.log(errorResponse);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorResponse = jsonRpcError(null, -32700, `Parse error: ${errorMessage}`);
      console.log(errorResponse);
    }
  });

  rl.on('close', () => {
    db.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
