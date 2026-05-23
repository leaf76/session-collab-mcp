#!/usr/bin/env node
// Minimal HTTP client wrapper for Session Collab HTTP API

type Args = {
  baseUrl: string;
  command: string;
  name?: string;
  args?: string;
};

const REQUIRED_TOOLS = [
  'collab_session_start',
  'collab_session_end',
  'collab_session_list',
  'collab_session_update',
  'collab_config',
  'collab_status',
  'collab_claim',
  'collab_memory_save',
  'collab_memory_recall',
  'collab_memory_clear',
  'collab_protect',
];

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
  session-collab doctor [--base-url URL]
  session-collab call --name TOOL --args JSON [--base-url URL]

Examples:
  session-collab health
  session-collab tools
  session-collab doctor
  session-collab call --name collab_session_start --args '{"project_root":"/repo","name":"demo"}'
`);
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = process.env.SESSION_COLLAB_HTTP_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function fetchText(url: string, init: RequestInit = {}): Promise<{ status: number; text: string }> {
  const headers = {
    ...getHeaders(),
    ...(init.headers as Record<string, string> | undefined),
  };
  const res = await fetch(url, { ...init, headers });
  return { status: res.status, text: await res.text() };
}

async function runDoctor(baseUrl: string): Promise<void> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  try {
    const health = await fetchText(`${baseUrl}/health`);
    checks.push({
      name: 'health',
      ok: health.status === 200,
      detail: health.text,
    });
  } catch (error) {
    checks.push({
      name: 'health',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const tools = await fetchText(`${baseUrl}/v1/tools`);
    const body = JSON.parse(tools.text) as { data?: { tools?: Array<{ name: string }> } };
    const toolNames = new Set(body.data?.tools?.map((tool) => tool.name) ?? []);
    const missingTools = REQUIRED_TOOLS.filter((tool) => !toolNames.has(tool));
    checks.push({
      name: 'tools',
      ok: tools.status === 200 && missingTools.length === 0,
      detail: missingTools.length > 0 ? `Missing tools: ${missingTools.join(', ')}` : `${toolNames.size} tools available`,
    });
  } catch (error) {
    checks.push({
      name: 'tools',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const ok = checks.every((check) => check.ok);
  console.log(JSON.stringify({ ok, base_url: baseUrl, checks }, null, 2));
  if (!ok) {
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const { baseUrl, command, name, args } = parseArgs();

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'health') {
    const res = await fetchText(`${baseUrl}/health`);
    console.log(res.text);
    return;
  }

  if (command === 'tools') {
    const res = await fetchText(`${baseUrl}/v1/tools`);
    console.log(res.text);
    return;
  }

  if (command === 'doctor') {
    await runDoctor(baseUrl);
    return;
  }

  if (command === 'call') {
    if (!name) {
      console.error('Missing --name');
      process.exit(1);
    }
    const parsedArgs = args ? JSON.parse(args) : {};
    const res = await fetchText(`${baseUrl}/v1/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, args: parsedArgs }),
    });
    console.log(res.text);
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
