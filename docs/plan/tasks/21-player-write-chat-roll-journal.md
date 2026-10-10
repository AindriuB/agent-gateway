# 21 — Add player write tools chat_post, roll_formula and journal_write

**Repo:** .
**Depends on:** 17, 19, 20d, 20e
**Owns:**
- protocol/src/tools/chat-post.ts
- protocol/src/tools/roll-formula.ts
- protocol/src/tools/journal-write.ts
- protocol/src/tools/index.ts (insertions only)
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
- module/src/audit/** `ctx.snapshot` (19); approvals (16, 17)
- These are core tools: add them to `protocol/src/tools/index.ts` `TOOLS` and `module/src/tools/index.ts` `HANDLERS` as before; `module/src/ops/core-tools.ts` (20c) registers them through the same registry path as pack tools, and `checkToolDefinition(…, 'core')` (20b) must pass for each (the 20b test sweeps `TOOLS`)

## Acceptance
- [ ] `module/src/tools/_write.ts` exports `defineWriteHandler({targets(args), run(ctx)})` which snapshots targets via `ctx.snapshot` before `run`; documented in a file header comment
- [ ] `chat_post` (player, write): args `content` (markdown, max 4000 chars), optional `speakerActorUuid` the user owns, optional `whisperTo` user names; sets `flags['agent-gateway'].ai = true` and renders a visible "AI" badge via `renderChatMessageHTML`; no setting can remove it (test greps settings for any marker toggle)
- [ ] `roll_formula` (player, write): args `formula`, optional `flavor`, optional `toChat` (default true); returns total and terms; invalid formula -> `INVALID_ARGS`
- [ ] `journal_write` (player, write): create a page in a journal the user owns or append to an owned page; args `journalUuid`, optional `pageUuid`, `title`, `markdown`; converts markdown to HTML
- [ ] With default policy, each call goes to the owner approval dialog; approved calls create audit entries with snapshots
- [ ] Guards pass; manual check on foundry.local v14 shows the AI badge on a posted message (screenshot)

## Out of scope
- Token and combat tools (22); GM tools (23-26)
- Exposing `defineWriteHandler` to packs through the pack API (a later pack API minor)
