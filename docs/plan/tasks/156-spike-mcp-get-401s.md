# 156 — Spike: why does ChatGPT get 401 on `GET /mcp`?

**Repo:** .
**Depends on:** none
**Status:** Ready. Spike: the deliverable is findings and a recommendation. No product change.
**Owns:**
- spikes/mcp-get-401/** (new: findings.md plus any probe scripts)
- gateway/test/http/mcp-get-401.test.ts (new, optional: a test that pins the behaviour found)

## Goal
In task 110's live sample, 388 of 718 `GET /mcp` requests returned 401, almost all from ChatGPT's
MCP client (`codex-mcp-client`). Nobody knows why. Find out whether the client opens its SSE GET
without a bearer token, with an expired or revoked one, or with one the gateway wrongly refuses,
and whether the 401 with `WWW-Authenticate` the gateway sends is the right reply. Recommend what,
if anything, to change.

## Context
- docs/plan/done/110-http-session-churn-diagnosis.md:28-56: the live sample (counts, durations,
  client name) and the "Live evidence" note on how it was collected read-only.
- docs/plan/HISTORY-INDEX.md row for 110, then that `HISTORY.md` entry by heading; PLAN.md section
  0f "Follow-ups from wave 1" states the open question.
- gateway/src/http/server.ts:315-340: the auth path. `offered` (a bearer was sent), the
  failed-auth limiter (429 when limited), `authenticate(req)`, the discovery limiter for no-token
  requests, and the 401 with `www-authenticate`. Note which branch produces each status.
- gateway/src/http/limits.ts: `PUBLIC_CLIENT_RPS` and the failed-auth window.
- The OAuth token lifetime and refresh path in gateway/src/oauth/** (find where access tokens expire
  and how a refresh is handled), and the MCP spec's Authorization and Streamable HTTP sections on
  what a server returns for an unauthenticated or expired-token GET.
- Evidence sources: the deployed gateway's log and Caddy access log for the sampled window and, if
  needed, a new read-only sample (ask the orchestrator; it is gathered by the operator's Mac
  session). Caddy redacts credential headers by default, so record only whether an `Authorization`
  header was present, never its value. If the logs cannot tell "no token" from "bad token", say
  so and say what log line would.

## Acceptance
- [ ] spikes/mcp-get-401/findings.md states, with counts from the logs: how many of the 401 GETs
      carried an `Authorization` header and how many did not; their timing relative to the same
      client's `initialize`, token issue or refresh, and session eviction (404) events; and whether
      a POST on the same session succeeded just before or after.
- [ ] It names the cause (or the ranked candidates, each with the evidence for and against) and
      the code path in gateway/src/http/server.ts that answers it, by `path:line`.
- [ ] It says whether the current reply (401 plus `WWW-Authenticate: Bearer resource_metadata=...`)
      matches the MCP spec for that case, quoting the spec section.
- [ ] It ends with one recommendation: no change, a named and scoped gateway change (files, why,
      risk), or a diagnostic log field to add first. Any change is described, not made.
- [ ] If a pinning test is added, it lives only in gateway/test/http/mcp-get-401.test.ts and passes.
- [ ] No tokens, cookies, client secrets, IP addresses or personal paths in the findings.
- [ ] `git diff --stat` touches only the owned paths.
- [ ] `npm run verify` passes.

## Out of scope
- Any edit under `gateway/src/**`, `module/**` or `protocol/**`, including log lines.
- The session caps and rate limits (tasks 95, 110, 111; option C stays declined).
- docs/** (scribe records the findings).

## Review round 1 — findings

1. **[P3] The 429 sentence contradicts task 110.** spikes/mcp-get-401/findings.md:32-33. Rewrite it as a hedged hypothesis, and list all three 429 sources: the failed-auth limiter (bearer present), the discovery limiter (no bearer, server.ts:331-335) and `PUBLIC_CLIENT_RPS` (authenticated only). Add the 429 body text to "Sample to gather", since it tells the sources apart.
2. **[P3] Two citations are off by one.** `authenticate` is at gateway/src/oauth/server.ts:206, not 207. The `WWW-Authenticate` header is set at gateway/src/http/server.ts:337 (the block runs 337-341), not 338.
3. **[Data] Add the orchestrator's log sample.** This answers acceptance item 1. It comes from the hosted gateway's Caddy access logs, last 96 h, gathered read-only on 2026-10-19 as counts only (no header values were read or printed):
   - `/mcp` by method and status: GET 401 = 2333, GET 200 = 97, GET 404 = 38, GET 429 = 43, GET 308 = 3, GET with no status (cancelled) = 91; POST 200 = 781, POST 202 = 136, POST 401 = 533, POST 400 = 20, POST 429 = 57, POST 404 = 2; DELETE 200 = 108, DELETE 401 = 4, DELETE 404 = 1.
   - Of the 2333 GET 401s, 2331 had NO Authorization header and only 2 had one. 2327 had no `Mcp-Session-Id`. The user agent was `codex-mcp-client` for all 2333.
   - For the 2 GET 401s that carried a header, the time since the same client IP's last successful POST to the token endpoint was under 55 min for one and 55-65 min for the other.
   Conclusion to record: the 401s are ChatGPT's client opening the GET stream without a bearer token, not token expiry. Per the findings' own rule ("if the sample shows no header was sent, make no change"), recommend no gateway change. At most, optionally make the discovery 401 cheaper or quieter.

## Review round 2 — findings

1. **[STYLE] Two headings run past 100 columns.** findings.md:64 and :72: wrap them at 100 columns, like the rest of the file.
2. **[P3] The 429 body text can't separate all three sources.** findings.md:56-58 and :136-137: the discovery limiter and `PUBLIC_CLIENT_RPS` both reply `too many requests`. Say that the body text together with whether an `Authorization` header was present tells the three apart, not the body text alone.
3. **[P3] Stale text contradicts the new conclusion.** Candidate 2's "Against" still says "unproven either way" (:74-75); line 58 says the sample is "below" when it is above; and "Pinned behaviour" (:148) still refers to "the recommended change", although the recommendation is now no change. Update all three.
