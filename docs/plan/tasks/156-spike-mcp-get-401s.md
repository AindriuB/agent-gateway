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
