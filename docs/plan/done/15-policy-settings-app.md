# 15 — Add the world and owner policy settings app

**Repo:** .
**Status:** Complete; merged in PR #55 (`d62dc36`), with atomic world publication follow-up 15a merged in PR #57. Native UI evidence and later offline fixes are recorded in HISTORY.
**Depends on:** 13, 14
**Owns:**
- module/src/apps/policy/**
- templates/policy/**
- module/test/apps/policy/**
- module/src/settings/index.ts (insertions only)
- styles/agent-gateway.css (policy section only)
- lang/en.json (insertions under `AGENT_GATEWAY.PolicyApp.*` only)

## Goal
Give the GM one ApplicationV2 to edit the world policy matrix, agent toggles,
folder allowlists and default rate limits, and give every user a view to tighten
their own owner policy within the ceiling.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:120-134 — what is configurable
- docs/plan/specs/2026-10-09-agent-gateway.md:108-109 — management UI lives in the module settings app
- module/src/policy/** (13), module/src/ratelimit/** (14)

## Acceptance
- [ ] Settings menu entry opens the app; GMs see world matrix, toggles, folder allowlists (folder picker over world folders), default rate limits; non-GMs see the ceiling read-only and an editable owner matrix
- [ ] Options looser than the ceiling are disabled in the owner matrix; `code` never offers `allow`
- [ ] Saving writes through the 13/14 setting APIs; invalid input is rejected with a localized notification, not saved
- [ ] Unit test renders the template context for GM and player and checks disabled options
- [ ] Manual check on foundry.local v14 as GM and as a player; screenshots in PR; v13 pending if absent

## Out of scope
- Agent list, pause, revoke, per-agent overrides (18)
- Offline event reading setting (29)
