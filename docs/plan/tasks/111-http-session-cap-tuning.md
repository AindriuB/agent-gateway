# 111 — Tune the per-principal HTTP session cap, eviction and DELETE rate limiting for ChatGPT

**Repo:** .
**Depends on:** 110
**Status:** Ready. Andrew chose option B (Amendment 1). 110's live evidence (see 110, "Live
evidence") satisfies the dependency on 110; this task does not wait for 110's PR.
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

## Acceptance
- [ ] `MAX_HTTP_SESSIONS_PER_PRINCIPAL` is 16, and session-churn.test.ts asserts that 20
      initializes with no DELETE for one principal give exactly 4 evictions, oldest idle first.
- [ ] `MAX_HTTP_SESSIONS_PER_CLIENT` is 32. public.test.ts asserts that one principal stays within its own cap and that the client-key
      cap still refuses with 503 once full.
- [ ] The global public cap still holds. The existing session-eviction tests pass, apart from
      assertions this task deliberately updates, each one named in the PR.
- [ ] A test shows that 50 evictions for one principal within 10 minutes produce at most one
      info-level eviction line, with the rest at debug.
- [ ] With the per-client rate already exhausted, a `DELETE /mcp` on a live session of
      the same principal returns 200 and the session count drops by one. A POST from the same
      client key in the same second still gets 429. A DELETE carrying an unknown session id still
      gets 404 and is still counted, so a flood of fake DELETEs cannot bypass the limit.
- [ ] `PUBLIC_CLIENT_RPS` is unchanged at 10, and the eleventh non-DELETE request in a second still
      gets 429 (public.test.ts:258-274 passes unmodified).
- [ ] `npm run verify` passes.

## Out of scope
- OAuth, the discovery throttle and consent.
- The SSE-stream eviction residual from 95, unless the change shows it causes client errors (then
  stop and re-plan).
- **Open follow-up, not this task:** 388 of the 718 `GET /mcp` requests got 401. Find out whether
  ChatGPT opens its SSE GET without a bearer token or with an expired one, and whether the
  gateway's 401 and `WWW-Authenticate` reply (server.ts:330-334) is correct for that case. The
  scribe should file this as its own PLAN item.
- **Declined for now, follow-up:** option C, a higher request rate or burst allowance for an
  authenticated OAuth principal. It weakens abuse protection for every authenticated client;
  revisit only if 429s on non-DELETE requests persist after B ships. The scribe should file it as
  its own PLAN item.

## Amendment 1 (2026-10-16, decided by Andrew)
Option B. `MAX_HTTP_SESSIONS_PER_PRINCIPAL` 4 → 16; `MAX_HTTP_SESSIONS_PER_CLIENT` (limits.ts:6)
16 → 32; the eviction log line is rate-limited (one info line per principal per 10 minutes, the
rest at debug); `DELETE /mcp` on a known session of the same principal is exempt from the
per-client rate limit (server.ts:336-339). Option C is declined for now and recorded under Out of
scope as a follow-up. Acceptance is now unconditional, Status is Ready (110's live evidence
satisfies the dependency), and the 401 reference in the follow-up note is corrected to
server.ts:330-334. Reason: B fixes the client-visible breakage 110 measured (404s after
evictions, 429 on DELETE) without weakening the per-client rate limit for every authenticated
client, which C would.

## Orchestrator note (2026-10-16): Owns extended

The implementer stopped at two files outside Owns. Both are mechanical consequences of Amendment 1 and are added to Owns:
- gateway/test/mcp/session-listeners.test.ts:128 — asserts `sessionCount <= 4` after 50 opens for one principal. Change only that assertion to use MAX_HTTP_SESSIONS_PER_PRINCIPAL.
- gateway/src/app.ts (where HttpServer is constructed, about :969) — wire the new optional `logDebug` option to the logger's debug channel, so suppressed eviction lines go to debug instead of being dropped. One option line only.
Also: grep README.md and docs/ for the old "4 per principal" or "16 per client" figures and list any hits in the report. Don't edit docs; the scribe updates them at record time.

## Amendment 2 (2026-10-16, decided by Andrew)

Code review found that the global public cap, MAX_HTTP_SESSIONS_PUBLIC = 64 (gateway/src/config/index.ts:329), now fits only 4 principals at the new per-principal cap of 16. A global-cap victim is picked only from the requesting principal's own sessions, so a fifth principal's first initialize gets 503. Andrew chose to raise MAX_HTTP_SESSIONS_PUBLIC to 256: 16 principals at full quota, as before, about 7.7 MB at ~30 KB per session. Owns adds gateway/src/config/index.ts (that constant and its comment at :328 only) and any test asserting the old 64. Acceptance adds: a test showing a fifth principal at full quota is admitted, and the global cap still holds at 256.

## Review round 1 — findings

Reviewed HEAD: the branch head after the orchestrator-note commit.

- [P3] gateway/test/http/session-churn.test.ts — the 10-minute eviction-log window isn't tested. Mutating server.ts `if (last === undefined || t - last >= EVICTION_LOG_WINDOW_MS)` to `if (last === undefined)` leaves every test passing. Advance the clock past EVICTION_LOG_WINDOW_MS and assert a second info line. route: implementer
- [P3] gateway/test/http/public.test.ts:232 — `maxSessions: 64 → 80` is unnecessary (at most 49 sessions open). Revert it, or set it to the new production value if Amendment 2 makes that natural. route: implementer
- [P3] gateway/test/http/session-eviction.test.ts:233, 311, 326, 337 — the added `setup({ maxSessions: 64 })` repeats the default; use plain `setup()` unless Amendment 2 changes the default. public.test.ts:251 and session-eviction.test.ts:236 still say "a fifth is refused" and name a principal `fifth`, when it is now the third. route: implementer
