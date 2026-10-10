# 13 — Add the policy engine and enforce it in the dispatcher

**Repo:** .
**Depends on:** 12a
**Owns:**
- module/src/policy/**
- module/test/policy/**
- module/src/ops/stages.ts (insertions only)
- module/src/settings/index.ts (insertions only)
- module/src/tools/document-search.ts
- module/src/tools/document-get.ts
- lang/en.json (insertions under `AGENT_GATEWAY.Policy.*` only)

## Goal
Decide, for every call, allow / ask owner / ask GM / deny by combining the GM's
world policy (the ceiling) with the owner's client policy, which may only
tighten it. Enforce the hard rules (code never auto, player and headless agents
off until enabled) and folder allowlists. This PR is logic and stored settings
only; the UI is 15 and the approval flow is 16.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:77-78 — world ceiling plus owner policy, never more permissive
- docs/plan/specs/2026-10-09-agent-gateway.md:120-134 — layers, policy matrix, defaults, folder allowlists
- module/src/ops/stages.ts — stage order 20 (08)

## Acceptance
- [ ] Decision lattice `allow < ask_owner < ask_gm < deny`; `combine(world, owner)` returns the stricter; property test over all pairs proves the result is never less strict than the world value
- [ ] World policy setting (world scope, GM) stores matrix `{playerAgents, gmAgents} x {read, write, destructive, code}`; defaults: read allow; write ask_owner; destructive ask_gm for player agents, ask_owner for GM agents; code ask_owner (GM) / ask_gm (player)
- [ ] Setting `code` to `allow` at either level is rejected on save and coerced to `ask_owner` on load (tests)
- [ ] World toggles `playerAgentsEnabled` and `headlessAgentsEnabled` default false; a call from a non-GM user's agent while disabled returns `DENIED` with a localized reason naming the setting
- [ ] Owner policy is a client setting with the same matrix; values looser than the world ceiling are ignored
- [ ] Folder allowlist per agent class: when non-empty, `document_search` omits and `document_get` returns `FORBIDDEN` for world documents outside the listed folders (and their subfolders)
- [ ] Policy stage (order 20): `deny` -> `DENIED`; `ask_*` sets `ctx.approval = {approver: 'owner'|'gm'}` and, until an approval stage exists, returns `DENIED` with "approval required"; `allow` continues
- [ ] `npm run verify` and `npm run test:e2e -- --foundry v14` pass (reads still allowed by default for a GM agent)

## Out of scope
- Settings UI (15), rate limits (14), approval queue (16)
- Gateway token scopes (35)
