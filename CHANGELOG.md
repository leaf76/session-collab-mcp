# Changelog

## v2.6.0

- Same-machine scope on session start (`scope`, `db_path`); DB path via `SESSION_COLLAB_DB` with unbranded default and legacy fallback
- Claude Code PreToolUse denies Write/Edit when another session holds the claim
- Reject oversized `collab_memory_save` instead of truncating
- Run HTTP integration tests in default `npm test` and CI

## v2.5.1

- Require Host/Origin (and bearer token when configured) on `/health`
- Stop returning internal exception messages on HTTP 500
- Pin GitHub Actions to commit SHAs; add CodeQL, Dependabot, and production `npm audit` in CI
- Shorten README; move history to this file

## v2.5.0

- Normalize claim paths to `project_root` (absolute ≡ relative; reject traversal)
- Session start reuses same `name`+project by default (`force_new` to skip); idle stale default 15 minutes
- Prefer atomic `collab_claim` create; compact happy-path responses (`detail` for full payloads)
- `list`/`status` summary uses SQL counts; memory content capped (800 chars) with smaller active recall default
- Token-conscious skills/`SERVER_INSTRUCTIONS`; collab memory vs AI-Memory role split
- Add `npm run install:local` to build and sync plugin skills into Claude cache

## v2.4.0

- `restore_context` defaults false on start; `list`/`status` summary unless `detail=true`
- Shorten server instructions; non-trivial-only collab-start guidance

## v2.3.1

- Add `collab_session_update` for heartbeat, current task, todo, and progress reporting
- Enrich `collab_session_list` with current task and active claim summaries
- Make `collab_claim(action="create")` respect `collab_config(mode)` with smart coordination by default
- Add `session-collab doctor` for HTTP server health and tool-surface checks
- Add `npm run test:http` and `npm run test:release` release gates
- Update dev test tooling to clear npm audit findings

## v2.1.0

- Add HTTP server + CLI wrapper for universal AI CLI usage
- Add HTTP API endpoints and utils tests
- Add legacy entry for deprecated schemas/queries (optional build)
- Improve claim conflict accuracy and release summaries
- Expand test coverage across MCP tools and DB flows

## v2.0.0 (Breaking)

- **Major Simplification**: Reduced from 50+ tools to 10 core tools
- **Action-Based Design**: Unified tools with action parameters
- **Removed Features**: LSP integration, messaging, notifications, queuing, decision tracking
- **Improved Performance**: Faster startup and reduced complexity
- **Better Testing**: Comprehensive test coverage for all tool actions
- **Migration Guide**: Detailed upgrade path from v1.x

## v0.8.0

- Add working memory system for context persistence (`collab_memory_*` tools)
- Add plan protection (`collab_plan_register`, `collab_plan_update_status`)
- Add file protection (`collab_file_register`, `collab_file_check_protected`)
- Memory categories: finding, decision, state, todo, important, context
- Pinned memories survive context compaction
- Plan lifecycle: draft → approved → in_progress → completed → archived

## v0.7.1

- Add `collab_auto_release` tool for releasing claims after editing
- Add auto-release config options: `auto_release_immediate`, `auto_release_stale`
- Add `cleanupStaleClaims()` for automatic stale claim cleanup
- Add PostToolUse hook to remind auto-release after Edit/Write

## v0.7.0

- Add priority system for claims (0-100 with levels: critical/high/normal/low)
- Add claim queue system (`collab_queue_join`, `collab_queue_leave`, `collab_queue_list`)
- Add notification system (`collab_notifications_list`, `collab_notifications_mark_read`)
- Add audit history tracking (`collab_history_list`)
- Add `collab_claim_update_priority` for escalating urgent work

## v0.6.0

- Optimize database queries with composite indexes
- Extract shared utilities (crypto, response builders)
- Remove unused auth and token modules
- Use precompiled JS for 15x faster startup
- Fix GROUP_CONCAT delimiter for multi-value queries
- Add unified Zod validation across tools

## v0.5.0

- Add reference tracking and impact analysis (Phase 3)
- Add symbol-level claims and LSP integration
- Fix SQLite WAL sync for multi-process MCP servers
- Add `collab_config` tool for conflict handling modes
