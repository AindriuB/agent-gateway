# 39 — Add Quench in-world integration tests

**Repo:** .
**Depends on:** 22
**Owns:**
- module/src/quench/**
- module/src/main.ts (insert the Quench registration call only)
- docs/testing.md (Quench section only)

## Goal
Exercise the dispatcher, policy, approvals, audit and the player tools inside a
real Foundry client with Quench, so behaviour that unit stubs cannot model
(document permissions, hooks, sockets) is checked on v13 and v14.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:89-91 — Quench in-world integration tests
- docs/testing.md (12)

## Acceptance
- [ ] Batches registered on `quenchReady` only when Quench is active; the production bundle has no Quench import cost when it is absent (dynamic import)
- [ ] Batches: dispatch and guards; policy decisions per category; approval round-trip with self-approval as GM; audit entry and undo of a `journal_write`; each read tool against `test-world` fixtures created and cleaned up by the batch
- [ ] Batches leave the world as found (created documents deleted in `after` hooks)
- [ ] `docs/testing.md` explains installing Quench in the test world and running the batches
- [ ] PR includes the Quench result panel from foundry.local v14; v13 pending if absent

## Out of scope
- Playwright e2e (12)
