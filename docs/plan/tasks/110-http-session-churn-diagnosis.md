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

## Live evidence (aindriub.app, 2026-10-16 07:00-08:45Z, collected read-only by the operator's Mac session)
This is a second sample, separate from the 0.3.0 playtest log. It answers parts of findings 1 and 2
below. The implementer cites it and does not need to collect it again.

- **Client.** `codex-mcp-client/0.162.0-alpha.17.2` (ChatGPT's MCP client) sent 1808 of the 1812
  `/mcp` requests. The others were `Claude-User` (2) and `python-httpx` (2).
- **Evictions.** 70 `reason=principal-cap` evictions. `idle_ms`: min 24, median 21,479, max 328,565.
- **404s.** `/mcp` returned 132 404s (GET 114, DELETE 13, POST 5). 93 of them came within 60 s after
  an eviction. Only 37 of the 132 were followed within 5 s by a fresh `initialize` from the same
  client, so recovery is unreliable.
- **Initialize rate.** 288 `initialize` calls over 27 active minutes (per active minute: min 2,
  median 7, max 46).
- **DELETE.** 210 `DELETE /mcp`: 149 returned 200, 48 returned 429, 13 returned 404. The client does
  close its sessions, but a DELETE refused with 429 likely leaves the session open, and that session
  counts against the cap.
- **GET (SSE).** 718 `GET /mcp`: 388 returned 401, 188 returned 200, 114 returned 404, 28 returned
  429. Durations: median 0 s, max 621.6 s.
- **429s.** 186 in total (POST 158, DELETE 48, GET 28), all from the per-client limit
  `PUBLIC_CLIENT_RPS = 10` (gateway/src/http/limits.ts:4). There were no 503s.
- **Conclusion.** Evictions are visible to the client: 404s follow evictions, and recovery is
  unreliable. The per-client rate limiter and the per-principal session cap make each other worse,
  because refused DELETEs leave sessions open and so drive more evictions.

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

## Review round 1 — findings

Reviewed HEAD: fb429d3db6a0163a664ba98a1e667801e82822c4

- [P2] gateway/test/http/session-churn.test.ts:237-252 — "a session with a POST in flight is not evicted" still passes when the in-flight guard is removed. Request start sets `e.lastActive = this.now()` (gateway/src/http/server.ts:349), so s[0] becomes most-recently-active and s[1] is the LRU victim with or without `e.inFlight > 0` in pickVictim (server.ts:482). Fix hint: after `until(() => gate.held.length === 1)`, touch s[1..3] (park those calls too or release in order) so s[0] is least-recently-active while still in flight; then a missing guard evicts s[0]. Proof: removing `e.inFlight > 0 ||` at server.ts:482 leaves 4/4 passing. route: implementer
- [P3, optional] gateway/test/http/session-churn.test.ts:185 — `req.on('error', () => undefined);` right before `req.on('error', reject);` is dead; delete it. route: implementer
- [NOTE, optional] gateway/test/http/session-churn.test.ts:234 — `stream.close()` only runs if every earlier assertion passes; a failure leaves the SSE request open into afterEach. Test-failure hygiene only.

## Findings 3-4 (implementer report, 2026-10-16)

3. Spec: MCP Streamable HTTP transport, "Session Management" (2025-03-26 and 2025-06-18). On a 404 to a request that carries `Mcp-Session-Id`, the client MUST start a new session with a fresh `initialize`. Clients SHOULD send DELETE when they are done with a session. Our 404 body `unknown session` (server.ts:348) complies. Live evidence: ChatGPT re-initialized after only 37 of 132 404s.
4. Memory: about 30 KB of heap per extra initialized session (in-process, 200 sessions, forced GC; a lab figure). A cap of 16 per principal is about 0.5 MB per principal. Recommendation for 111: raise the cap and rate-limit the eviction log line. Andrew chose option B on 2026-10-16.
