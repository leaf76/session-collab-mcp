#!/usr/bin/env node
// Minimal HTTP client wrapper for Session Collab HTTP API

type Args = {
  baseUrl: string;
  command: string;
  name?: string;
  args?: string;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let baseUrl = 'http://127.0.0.1:8765';
  let command = argv[0] ?? 'help';
  let name: string | undefined;
  let args: string | undefined;

  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--base-url' && argv[i + 1]) {
      baseUrl = argv[i + 1];
      i++;
    } else if (argv[i] === '--name' && argv[i + 1]) {
      name = argv[i + 1];
      i++;
    } else if (argv[i] === '--args' && argv[i + 1]) {
      args = argv[i + 1];
      i++;
    }
  }

  return { baseUrl, command, name, args };
}

function printHelp(): void {
  console.log(`Usage:
  session-collab health [--base-url URL]
  session-collab tools [--base-url URL]
  session-collab call --name TOOL --args JSON [--base-url URL]

Examples:
  session-collab health
  session-collab tools
  session-collab call --name collab_session_start --args '{"project_root":"/repo","name":"demo"}'
`);
}

async function main(): Promise<void> {
  const { baseUrl, command, name, args } = parseArgs();

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'health') {
    const res = await fetch(`${baseUrl}/health`);
    console.log(await res.text());
    return;
  }

  if (command === 'tools') {
    const res = await fetch(`${baseUrl}/v1/tools`);
    console.log(await res.text());
    return;
  }

  if (command === 'call') {
    if (!name) {
      console.error('Missing --name');
      process.exit(1);
    }
    const parsedArgs = args ? JSON.parse(args) : {};
    const res = await fetch(`${baseUrl}/v1/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, args: parsedArgs }),
    });
    console.log(await res.text());
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

main().catch((error) => {
  console.error('Fatal error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
