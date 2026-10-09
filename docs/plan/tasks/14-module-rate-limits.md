# 14 — Add per-category rate limits enforced in the module

**Repo:** .
**Depends on:** 13
**Owns:**
- module/src/ratelimit/**
- module/test/ratelimit/**
- module/src/ops/stages.ts (insertions only)
- module/src/settings/index.ts (insertions only)
- lang/en.json (insertions under `AGENT_GATEWAY.RateLimit.*` only)

## Goal
Bound how fast any agent can act, authoritatively in the module: per-category
limits configurable per agent class by the GM, with an optional per-agent
override.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:128-131 — rate limits per category, per role with per-agent override, defaults about 60 reads/min and 10 writes/min
- module/src/ops/stages.ts — stage order 30

## Acceptance
- [ ] Sliding one-minute window per `(agentId, bucket)`; buckets `read` and `write`; `destructive` and `code` count against `write`
- [ ] Defaults 60 read/min and 10 write/min for both agent classes, stored in a world setting; per-agent overrides stored in the same setting keyed by agentId
- [ ] Exceeding returns `RATE_LIMITED` with structured `retryAfterSeconds` (integer, >=1)
- [ ] Rejected calls (policy deny, invalid args) do not consume budget; stage order 30 runs after policy
- [ ] Fake-clock tests for window edges, override precedence and bucket mapping
- [ ] `npm run verify` passes

## Out of scope
- Gateway self-protection limit (34)
- UI for the limits (15) and per-agent overrides (18)
