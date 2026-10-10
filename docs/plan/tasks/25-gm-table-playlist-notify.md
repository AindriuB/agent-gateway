# 25 — Add GM tools table_roll, playlist_control and notify

**Repo:** .
**Depends on:** 23, 20d, 20e
**Owns:**
- protocol/src/tools/table-roll.ts
- protocol/src/tools/playlist-control.ts
- protocol/src/tools/notify.ts
- protocol/src/tools/index.ts (insertions only)
- module/src/tools/table-roll.ts
- module/src/tools/playlist-control.ts
- module/src/tools/notify.ts
- module/src/tools/index.ts (insertions only)
- module/test/tools/gm-ambience/**
- module/test/stubs/** (insertions only)

## Goal
Round out the GM tool set with rollable tables, music control and on-screen
notifications to players.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:151-153 — GM tools
- module/src/tools/_write.ts (21)

- These are core tools: add them to `protocol/src/tools/index.ts` `TOOLS` and `module/src/tools/index.ts` `HANDLERS` as before; `module/src/ops/core-tools.ts` (20c) registers them through the same registry path as pack tools, and `checkToolDefinition(…, 'core')` (20b) must pass for each (the 20b test sweeps `TOOLS`)
## Acceptance
- [ ] `table_roll` (gm, write): args `tableUuid`, optional `toChat` (default true), optional `rollMode`; returns result text and drawn document uuids
- [ ] `playlist_control` (gm, write): action enum play|stop|next|set_volume with `playlistUuid`, optional `soundUuid`, `volume` 0..1
- [ ] `notify` (gm, write): args `message` (max 300 chars), `level` info|warn|error, optional `users`; message is prefixed with the AI marker text from `lang/en.json`
- [ ] Guards pass; manual check on foundry.local v14

## Out of scope
- Scene, token, combat tools (24)
