# 21 — Add player write tools chat_post, roll_formula and journal_write

**Repo:** .
**Depends on:** 17, 19, 20d, 20e
**Owns:**
- protocol/src/tools/chat-post.ts
- protocol/src/tools/roll-formula.ts
- protocol/src/tools/journal-write.ts
- protocol/src/tools/index.ts (insertions only)
- protocol/test/tools/rules/validate.test.ts (insertions only: canonical example-map entries for `chat_post`, `roll_formula` and `journal_write`)
- module/src/tools/chat-post.ts
- module/src/tools/roll-formula.ts
- module/src/tools/journal-write.ts
- module/src/tools/index.ts (insertions only)
- module/test/tools/player-writes/**
- module/test/stubs/** (insertions only)
- module/src/tools/_write.ts
- lang/en.json (insertions under `AGENT_GATEWAY.Tools.*` only)
- styles/agent-gateway.css (chat marker section only)

## Goal
Ship the first write tools and, with them, the shared write-handler helper
(snapshot, target declaration, result shape) every later write tool uses.
Agent chat messages always carry a visible, non-configurable AI marker.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:140-141 — AI marker on agent chat, not configurable
- docs/plan/specs/2026-10-09-agent-gateway.md:143-150 — tool list
- module/src/audit/stage.ts (19) — `snapshot`, `intendCreate`, `created`, `callOptions`; the first snapshot of a UUID wins
- module/src/audit/guard.ts — audit-journal/page protection; approvals (16, 17)
- examples/hello-pack/scripts/main.js — bounded browser-local canonical-page append queue; reuse the pattern without claiming cross-browser atomicity
- These are core tools: add them to `protocol/src/tools/index.ts` `TOOLS` and `module/src/tools/index.ts` `HANDLERS` as before; `module/src/ops/core-tools.ts` (20c) registers them through the same registry path as pack tools, and `checkToolDefinition(…, 'core')` (20b) must pass for each (the 20b test sweeps `TOOLS`)

## Acceptance
- [ ] `module/src/tools/_write.ts` exports `defineWriteHandler({targets(args), run(ctx)})` which snapshots targets via `ctx.snapshot` before `run`; documented in a file header comment
- [ ] `chat_post` (player, write): args `content` (markdown, max 4000 chars), optional `speakerActorUuid` the user owns, optional `whisperTo` user names; sets `flags['agent-gateway'].ai = true` and renders a visible "AI" badge via `renderChatMessageHTML`; no setting can remove it (test greps settings for any marker toggle)
- [ ] `roll_formula` (player, write): args `formula`, optional `flavor`, optional `toChat` (default true); returns total and terms; invalid formula -> `INVALID_ARGS`
- [ ] `journal_write` (player, write): create a page in a journal the user owns or append to an owned page; args `journalUuid`, optional `pageUuid`, `title`, `markdown`; converts markdown to HTML
- [ ] With default policy, each call goes to the owner approval dialog; approved calls create audit entries with snapshots
- [ ] Write handlers fail closed before any mutation if required audit capabilities (`snapshot`, `intendCreate`, `created`, `callOptions`) are absent. Updates await `ctx.snapshot` on the actual target before mutation and pass `ctx.callOptions` to every Foundry write. Page creation awaits `ctx.intendCreate(journal)` before create, then `ctx.created(newPage.uuid, journal)` after create; chat/roll chat-message creates likewise declare intent and record the created UUID. Never snapshot a nonexistent created UUID as an existing target or substitute a whole-journal snapshot for the created page. `toChat: false` still follows write policy/audit but has no world mutation target
- [ ] Resolve the current user from trusted `game.users` identity and recheck journal/page ownership after approval and asynchronous preparation, immediately before mutation. Reject a page whose canonical parent is not the requested journal, non-text/unsupported page formats and audit-log journals/pages; do not rely on caller-provided ownership or stale pre-approval permission state
- [ ] Same-page appends serialize snapshot, fresh content read and replacement update together in a bounded queue keyed by canonical page identity; queued calls recheck identity/permissions after waits. Failures release queue capacity and unrelated pages can proceed independently. This protects only this browser instance; other browsers/manual edits are not atomic. Duplicate resolution of one approval causes one mutation; separate MCP submissions/retries are not promised exactly-once execution
- [ ] Markdown conversion sanitizes or escapes raw HTML, unsafe script URLs and injected event handlers. Validate bounded roll formula/work and reject invalid or excessive formulas before evaluation. Both `chat_post` and chat-producing `roll_formula` outputs receive the immutable AI flag and visible badge; verify the native chat render hook on v13 and v14 rather than assuming the v14 hook exists on both
- [ ] Dispatcher integration tests cover GM and owner-player creates/appends, meaningful audit/undo target records, missing audit capabilities, permission changes while awaiting approval, parent/format/audit-target rejection, append races/queue bounds, duplicate approval resolution, hostile markdown, roll bounds and immutable markers
- [ ] Guards pass. Before live writes, prepare exact tool names, arguments and target documents for Andrew's approval; then exercise the default policy through the real approval dialog without bypassing it. Check native chat/roll AI markers on available v13 and v14, record screenshots, and use owner-approved test fixtures only

## Out of scope
- Token and combat tools (22); GM tools (23-26)
- Exposing `defineWriteHandler` to packs through the pack API (a later pack API minor)
