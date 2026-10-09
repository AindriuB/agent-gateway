# 30 — Queue writes attempted while the world is offline

**Repo:** .
**Depends on:** 21, 28
**Owns:**
- gateway/src/offline-queue/**
- gateway/test/offline-queue/**
- gateway/src/store/** (new migration only)
- gateway/src/routing/** (offline branch only)
- protocol/src/link/messages.ts (insertions only)
- module/src/approvals/** (accept replayed requests only)

## Goal
When an agent attempts a non-read tool while its world is offline, the gateway
stores the call and returns `pending_approval`; on the next connection it
submits the queued calls, which go through normal policy and approval.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:173 — writes attempted offline queue for approval on next launch
- gateway/src/routing/** (11, 20, 28); module/src/approvals/** (16)

## Acceptance
- [ ] Offline non-read calls are stored in SQLite (args capped by the frame limit) and return `{status:'pending_approval', id}` with text explaining the world is offline
- [ ] On reconnect the gateway sends `queuedCalls [...]`; module submits each as an approval request (never auto-allowed, even if policy is `allow`) and keeps the same id so `approval_status` works across the gap
- [ ] Reads while offline still return `WORLD_OFFLINE`
- [ ] Queue entries expire after 7 days (named constant) and report `expired`
- [ ] Integration test with the fake module client from 11
- [ ] `npm run verify` passes

## Out of scope
- Event buffering (28, 29)
