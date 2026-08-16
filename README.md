# Session Collab MCP

[![npm version](https://img.shields.io/npm/v/session-collab-mcp.svg)](https://www.npmjs.com/package/session-collab-mcp)
[![license](https://img.shields.io/github/license/leaf76/session-collab-mcp)](https://github.com/leaf76/session-collab-mcp/blob/master/LICENSE)
[![Node.js](https://img.shields.io/node/v/session-collab-mcp)](https://www.npmjs.com/package/session-collab-mcp)

Provider-agnostic [MCP](https://modelcontextprotocol.io) server for multi-agent / multi-session work: **claim files**, **short working memory**, **protect paths**, and **detect conflicts**.

Works over `stdio` or HTTP JSON-RPC with Claude Code, Codex, Grok, Cursor, and other MCP clients. Optional Claude Code packaging: [`plugin/`](plugin/).

## Why

**Same machine only** — this is not a remote Git lock. Parallel coding sessions on one OS user overwrite each other because there is no shared “work intent.” This server is a local WIP registry: declare files, check conflicts, persist short notes, protect critical paths, then release.

## Install

**stdio (any MCP client)**

```json
{
  "mcpServers": {
    "session-collab": {
      "command": "npx",
      "args": ["-y", "session-collab-mcp@latest"]
    }
  }
}
```

**HTTP + CLI**

```bash
session-collab-http --host 127.0.0.1 --port 8765
session-collab doctor --base-url http://127.0.0.1:8765
```

MCP-over-HTTP: `POST /mcp`. Convenience REST: `/v1/*` (1:1 with MCP tools). Localhost needs no token; non-local binds require `SESSION_COLLAB_HTTP_TOKEN` and `SESSION_COLLAB_ALLOWED_HOSTS` (or `--allowed-host`). Host/Origin are validated; `/health` uses the same checks (bearer required when a token is set).

**Claude Code plugin**

```text
/plugin marketplace add leaf76/session-collab-mcp
/plugin install session-collab@session-collab-plugins
```

**Global:** `npm install -g session-collab-mcp`

Local repo: `npm run install:local` then point MCP config at `dist/cli.js`.

## Workflow

Use only for non-trivial / multi-session work.

1. `collab_session_start` — same `name`+project **reuses**; `restore_context` default **false**
2. `collab_claim` `action=create` — batch files; atomic claim-or-block; paths normalized to `project_root`. `check` is optional probe-only
3. `collab_memory_save` — short notes only (≤800 chars, rejected if longer; not a vault)
4. `collab_claim` `action=release` then `collab_session_end`

`list` / `status` / claim happy-path are compact unless `detail=true`.

| Mode (`collab_config`) | Behavior |
|------------------------|----------|
| `strict` | Block overlapping claims |
| `smart` (default) | Claim safe files/symbols; queue blocked ones |
| `bypass` | Overlap only with `allow_conflicts=true` |

Prefer symbol-level claims when sharing a file. Overlap returns `waiting_for_coordination` or `partial_claim_created`.

## Tools

| Tool | Purpose |
|------|---------|
| `collab_session_start` / `_end` / `_list` / `_update` | Register, end, list, heartbeat |
| `collab_config` | Conflict mode and auto-release options |
| `collab_status` | Snapshot (counts unless `detail=true`) |
| `collab_claim` | `create`, `check`, `release`, `list` |
| `collab_memory_save` / `_recall` / `_clear` | Working memory (`finding`, `decision`, `state`, `todo`, `important`, `context`) |
| `collab_protect` | `register`, `check`, `list` (plans and created files) |

v2.0 breaking changes: [MIGRATION.md](./MIGRATION.md). Full history: [CHANGELOG.md](./CHANGELOG.md). Security reports: [SECURITY.md](./SECURITY.md).

## Data

SQLite is **per machine / OS user** (WAL, offline). Path order:

1. `SESSION_COLLAB_DB` if set
2. `~/.session-collab/collab.db` if it already exists
3. legacy `~/.claude/session-collab/collab.db` if it already exists
4. otherwise create `~/.session-collab/collab.db`

`collab_session_start` returns `scope: "local-machine"` and `db_path`. Claude Code plugin PreToolUse denies Write/Edit on files claimed by another session (`SESSION_COLLAB_HOOK_DISABLE=1` to skip).

## Development

Node.js 18+. `npm install && npm run build`

```bash
npm run typecheck
npm run lint
npm run test
npm run test:http      # needs a local listen port
npm run test:release
```

Optional legacy bundle: `SESSION_COLLAB_INCLUDE_LEGACY=true npm run build` (not in the v2 tool list).

## Related

- [lazy-desktop-mcp](https://github.com/leaf76/lazy-desktop-mcp)
- [lazy_mobile_mcp](https://github.com/leaf76/lazy_mobile_mcp)
- [lazy-media-mcp](https://github.com/leaf76/lazy-media-mcp)

## License

[MIT](./LICENSE) © leaf76
