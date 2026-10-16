# 111 — Tune the per-principal HTTP session cap, eviction and DELETE rate limiting for ChatGPT

**Repo:** .
**Depends on:** 110
**Status:** BLOCKED on decision. Do not fan out until Andrew has answered "Open decisions" and the
answer is written into this file. 110's live evidence is now in hand (see 110, "Live evidence"),
so the decision does not have to wait for 110's PR.
**Owns:**
- gateway/src/http/limits.ts
- gateway/src/http/server.ts (only the eviction plan and eviction log line at `:430-500`, and the
  per-client rate check on `/mcp` at `:336-339`)
- gateway/test/http/session-churn.test.ts
- gateway/test/http/session-eviction.test.ts (only the assertions the chosen change makes false)
- gateway/test/http/public.test.ts (only the `per-client limits` block at `:195-275`: the
  session-cap assertions that a new cap makes false, and new DELETE or rate cases)
- gateway/test/http/limits.test.ts (only if a constant it asserts changes)

## Goal
Act on 110's findings so that one ChatGPT user's session churn neither breaks calls nor floods the
log, and so that a client's session cleanup is never refused, without loosening the bounds that
protect a public gateway more than the chosen option states.

## Context
- docs/plan/tasks/110-http-session-churn-diagnosis.md, "Live evidence". In summary: 70 evictions
  with a median `idle_ms` of 21,479. 93 of the 132 `/mcp` 404s came within 60 s after an eviction,
  and only 37 were followed by a re-initialize within 5 s. 48 of the 210 DELETEs got 429. The 186
  429s all came from `PUBLIC_CLIENT_RPS = 10`. There were no 503s.
- 110 measured the memory cost at about 30 KB per session.
- gateway/src/http/limits.ts:4 — `PUBLIC_CLIENT_RPS`; `:6` — `MAX_HTTP_SESSIONS_PER_CLIENT = 16`;
  `:8` — `MAX_HTTP_SESSIONS_PER_PRINCIPAL = 4`.
- gateway/src/http/server.ts:145 — `clientRate` is built; `:336-339` — the per-client rate check
  on an authenticated `/mcp` request, which runs before the method is known to be DELETE.
- gateway/src/http/server.ts:430-500 — the eviction plan and log line.
- gateway/test/http/public.test.ts:228-256 — asserts the cap of 4 per principal and 16 per client
  key; `:258-274` — asserts the eleventh request in a second gets 429.
- docs/plan/PLAN.md item 0a (95): the 64 global and 16 per-client caps, and the accepted SSE residual.

## Open decisions
1. **What to change.**
   - A. Raise `MAX_HTTP_SESSIONS_PER_PRINCIPAL` from 4 to 16 (about 30 KB per session, so 16
     sessions cost about 0.5 MB per principal). Raise `MAX_HTTP_SESSIONS_PER_CLIENT` (limits.ts:6)
     to match, so that one principal cannot fill its client key alone and several principals still
     fit behind one egress IP. The global public cap still bounds the total. Rate-limit the eviction
     log line: at most one info line per principal per 10 minutes, with the rest at debug.
   - B. A, plus exempt `DELETE /mcp` on a known session of the same principal from the per-client
     rate limit, or give it a separate allowance, so that session cleanup is never refused with 429.
   - C. B, plus raise `PUBLIC_CLIENT_RPS` for an authenticated OAuth principal, or let it absorb
     bursts (for example a token bucket with a burst above 10).
   - D. Keep the cap at 4 and only quieten the log. **Not recommended:** the evidence shows
     client-visible breakage (404s after evictions, and unreliable recovery).
   - **Recommendation: B.** Decide C separately, because it weakens abuse protection for every
     authenticated client.

## Acceptance (to be finalised with the decision)
- [ ] `MAX_HTTP_SESSIONS_PER_PRINCIPAL` is 16, and session-churn.test.ts asserts that 20
      initializes with no DELETE for one principal give exactly 4 evictions, oldest idle first.
- [ ] `MAX_HTTP_SESSIONS_PER_CLIENT` is raised to the value written here with the decision.
      public.test.ts asserts that one principal stays within its own cap and that the client-key
      cap still refuses with 503 once full.
- [ ] The global public cap still holds. The existing session-eviction tests pass, apart from
      assertions this task deliberately updates, each one named in the PR.
- [ ] A test shows that 50 evictions for one principal within 10 minutes produce at most one
      info-level eviction line, with the rest at debug.
- [ ] Under B: with the per-client rate already exhausted, a `DELETE /mcp` on a live session of
      the same principal returns 200 and the session count drops by one. A POST from the same
      client key in the same second still gets 429. A DELETE carrying an unknown session id still
      gets 404 and is still counted, so a flood of fake DELETEs cannot bypass the limit.
- [ ] Under C only: the new per-principal rate or burst is in limits.ts and asserted in
      public.test.ts.
- [ ] `npm run verify` passes.

## Out of scope
- OAuth, the discovery throttle and consent.
- The SSE-stream eviction residual from 95, unless the change shows it causes client errors (then
  stop and re-plan).
- **Open follow-up, not this task:** 388 of the 718 `GET /mcp` requests got 401. Find out whether
  ChatGPT opens its SSE GET without a bearer token or with an expired one, and whether the
  gateway's 401 and `WWW-Authenticate` reply (server.ts:325-330) is correct for that case. The
  scribe should file this as its own PLAN item.
