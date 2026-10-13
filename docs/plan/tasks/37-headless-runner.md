# 37 — Add the headless runner

**Repo:** .
**Depends on:** 16
**Status:** MVP B (after A). B order 2; its Owns are disjoint from 34's, so it may run alongside 34.
**Owns:**
- gateway/src/headless/**
- gateway/test/headless/**
- gateway/package.json (`playwright-core` dependency only)
- protocol/src/link/messages.ts (insertions only)
- module/src/link/client.ts (headless flag only)
- package-lock.json

## Goal
Let the gateway run an agent without anyone's browser open: launch Chromium via
`playwright-core`, log into Foundry as a dedicated agent user, and follow the
world's lifecycle by polling `/api/status`. It never launches worlds.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:105-108 — headless runner behaviour
- docs/plan/specs/2026-10-09-agent-gateway.md:79-80 — headless requests are relayed to owner or GM (16)

## Acceptance
- [ ] Browser discovery prefers system Chrome, then Edge, then a downloaded Chromium (download location under the gateway data dir); the chosen executable is logged
- [ ] Polls `<foundryUrl>/api/status` every 15 s; when a world is active, opens `/join`, logs in as the configured user, waits for the module's link to connect; when the world goes down or status fails three times, closes the browser
- [ ] Never calls setup or admin endpoints (test asserts only `/api/status`, `/join` and `/game` are requested)
- [ ] Headless sessions are marked: the runner sets a session-storage flag before load that the module reads, and the module sends `headless: true` in `hello`; the module sets `ctx.agent.headless`
- [ ] Integration test against a stub HTTP server simulating status transitions
- [ ] Manual run against foundry.local v14: headless agent joins `test-world`, `world_info` works; log in PR

## Out of scope
- Credential storage, CLI subcommands, world toggle enforcement (38)
- Docker packaging (42)
