# 110 — Measure HTTP session churn from ChatGPT and whether eviction hurts it (spike)

**Repo:** .
**Depends on:** none
**Status:** Ready. Spike: its deliverable is the findings below plus tests that pin today's behaviour. No limit or eviction change.
**Owns:**
- gateway/test/http/session-churn.test.ts (new)

## Goal
In 40 minutes of the 0.3.0 playtest the gateway logged 53 `http session evicted: principal=oauth
reason=principal-cap` lines for one OAuth principal. The per-principal cap is 4, and the most
likely cause is ChatGPT opening a new MCP session often without deleting the old ones. Find out
whether these evictions ever break a client call (a 404 on a session the client still uses) or are
harmless clean-up, and whether the cap or the LRU rule suits ChatGPT's pattern.

## Context
- gateway/src/http/limits.ts:8 — `MAX_HTTP_SESSIONS_PER_PRINCIPAL = 4`; :6 — 16 per client key.
- gateway/src/http/server.ts:430-471 — plan-then-evict at `initialize`; never evicts a session
  with a request in flight (`:95`).
- gateway/src/http/server.ts:489-500 — the eviction log line, including `idle_ms`.
- gateway/src/http/server.ts:217-220 — idle sweep after `idleMs`.
- gateway/src/http/server.ts:348 — a request on an unknown or evicted session gets
  `404 unknown session`.
- gateway/test/http/session-eviction.test.ts — task 95's tests; read, do not edit.
- docs/plan/PLAN.md item 0a (95) — the accepted residual: a session whose only open request is its
  GET SSE stream can be evicted.

## Acceptance
- [ ] session-churn.test.ts pins today's behaviour for one principal. Eight `initialize` calls
      with no DELETE give exactly four evictions, oldest-idle first. A POST on an evicted session id
      gets 404 with body `unknown session`. A session with an open GET SSE stream and no POST is
      evictable (the 95 residual), and one with a POST in flight is not.
- [ ] The findings, delivered in the PR description and the implementer's report (the scribe
      records them), contain all of these:
  1. From the playtest gateway log (ask the orchestrator to get it from Andrew): the `idle_ms`
     distribution of the 53 evictions (min, median, max), and whether any `404 unknown session`
     or a client-visible error followed an eviction for the same principal within 60 s.
  2. ChatGPT's observed session pattern: sessions opened per conversation or per tool call, whether
     it sends DELETE, and whether it keeps a GET SSE stream open. Use the access log or the
     gateway's debug log; say which source was used.
  3. What the MCP Streamable HTTP spec says a client must do on a 404 for its session (re-initialize),
     with the spec section, and whether ChatGPT was seen doing it.
  4. A recommendation for task 111: leave the cap and quieten the log; raise the cap to a stated
     number; or change the eviction rule (for example, prefer sessions idle longer than N s). Give
     the memory cost per extra session, measured or cited.
- [ ] `npm run verify` passes.

## Out of scope
- Changing limits.ts, server.ts or the log line (task 111).
- The discovery throttle (88) and per-client limits other than how they interact with this cap.
