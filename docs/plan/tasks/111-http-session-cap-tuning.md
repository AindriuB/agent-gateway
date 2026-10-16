# 111 — Tune the per-principal HTTP session cap or eviction for ChatGPT

**Repo:** .
**Depends on:** 110
**Status:** BLOCKED on decision. Do not fan out until 110 has reported and Andrew has answered
"Open decisions", and the answer is written into this file.
**Owns:**
- gateway/src/http/limits.ts
- gateway/src/http/server.ts (the eviction plan and the eviction log line only)
- gateway/test/http/session-churn.test.ts
- gateway/test/http/session-eviction.test.ts (only the assertions the chosen change makes false)

## Goal
Act on 110's findings so that one ChatGPT user does not churn sessions in a way that breaks calls
or floods the log, without loosening the bounds that protect a public gateway.

## Context
- 110's findings.
- gateway/src/http/limits.ts:5-8; gateway/src/http/server.ts:430-500.
- docs/plan/PLAN.md item 0a (95): the 64 global and 16 per-client caps, and the accepted SSE residual.

## Open decisions
1. **What to change.** (Option text to be confirmed against 110's numbers.)
   - A. Keep the cap at 4. Log evictions of sessions idle longer than a threshold at debug level,
     plus one info summary line per principal per 10 minutes. Choose this if 110 shows no client errors.
   - B. Raise `MAX_HTTP_SESSIONS_PER_PRINCIPAL` (for example to 8) and keep the 16 per-client and
     64 global caps. Choose this if 110 shows 404s on sessions that were still in use.
   - C. Keep 4, but evict only sessions idle for at least N seconds, and refuse with 503 otherwise.
     This is safer for in-use sessions, but brings back 95's 503 symptom under bursts.
   - **Recommendation: A if 110 finds no client-visible errors, otherwise B.** C reintroduces the
     failure 95 fixed.

## Acceptance (to be finalised with the decision)
- [ ] The chosen constant or rule is in place, and session-churn.test.ts asserts the new behaviour
      (for example, eight initializes evict exactly N).
- [ ] Per-client (16) and global (64) caps still hold (the existing session-eviction tests pass,
      apart from assertions this task deliberately updates, each named in the PR).
- [ ] Under A: a test shows that 50 evictions in 10 minutes produce at most one info line plus debug lines.
- [ ] `npm run verify` passes.

## Out of scope
- OAuth, discovery throttle, consent.
- The SSE-stream eviction residual from 95, unless 110 shows it is the cause of client errors (then
  stop and re-plan).
