# 88 — Stop counting credential-free /mcp discovery requests as failed auth

**Repo:** .
**Depends on:** none
**Status:** Bug, confirmed live on the VPS (Andrew, 2026-10-14). Caddy logs show codex-mcp-client sending bursts of about 10 credential-free `/mcp` requests a second, and every one gets 429. This blocks ChatGPT/Codex sign-in and can block Claude re-auth from the same IP. It is independent of 86 and 87: neither owns any file under `gateway/src/http/` or `gateway/test/http/`.
**Owns:**
- gateway/src/http/server.ts. Only the `/mcp` authentication block of `HttpServer.handle()` (origin/main :296-310, from the `failedAuth.limited` check through the 401 return), one new private field and its construction in the constructor (:120-133), and the import list from `./limits.js` (:16-24). The `/status` branch (:252-293), the OAuth `attach` wiring (:141) and everything after the 401 stay as they are.
- gateway/src/http/limits.ts. Insertions only: two constants, `MAX_DISCOVERY_PER_CLIENT` and `DISCOVERY_WINDOW_MS`, and one class, a fixed-window per-key counter (suggested name `CountWindows`). Existing constants and classes are not edited.
- gateway/test/http/discovery-throttle.test.ts (new).
- gateway/test/http/limits.test.ts. Insertions only: a cap/eviction case for the new class, next to the existing `FailureWindows and RateWindows never exceed their cap` case.
- gateway/test/http/public.test.ts. Only the two tests listed under "Existing tests that pin the old behaviour" below. No other edits and no new cases.

## Goal
`HttpServer.handle()` (the issue calls it GatewayHttpServer; the class is `HttpServer`) checks the failed-auth bucket before it authenticates. It then records every `/mcp` request that has no principal as a failure, including a request with no `Authorization` header at all. A standard MCP client's first, credential-free request is how it gets the 401 with `WWW-Authenticate: Bearer resource_metadata="…"`, so ten discovery probes in a minute (`MAX_FAILED_AUTH_PER_CLIENT`, gateway/src/http/limits.ts:2) lock every client behind that IP out of the OAuth challenge. After this task, a request without credentials gets the discovery 401 from its own bounded throttle, and a request with bad credentials keeps the existing lockout exactly.

## Decisions (made here; Andrew may override)
- **(a) "Offered a credential" means `req.headers.authorization !== undefined`.** This is the same test the `/status` branch already uses (gateway/src/http/server.ts:257). An empty, non-Bearer or garbled `Authorization` header counts as offered. It is malformed, so it takes the failure path, as the bug report requires.
- **(b) The new `/mcp` auth flow, in this order:**
  1. Offered: unchanged. If `failedAuth.limited` then 429 `too many failed attempts` with `retry-after`. Otherwise authenticate, and on no principal `failedAuth.record` then the 401 challenge.
  2. Not offered, and `failedAuth.limited(client)`: go straight to the discovery path. **`authenticate` is not called.**
  3. Not offered, and not locked out: call `authenticate(req)`. A principal continues as today. Production auth reads only the bearer (:144-147), so this is always `undefined` in production. The call is kept so the `authenticate` test seam, which tests use with `x-principal` and with no-header principals (public.test.ts "caps sessions…", "caps the request rate…"), keeps working. No principal goes to the discovery path, and `failedAuth` is not recorded.
  4. Discovery path: if the discovery counter is over its limit for this client, answer 429 `too many requests` with `retry-after` set to the seconds left in the window, and no `WWW-Authenticate`. Otherwise count the request and send the existing 401 with the existing `WWW-Authenticate` value (the same `Bearer resource_metadata="…"` or `Bearer`).
- **(c) A locked-out client that sends no credentials still gets the discovery 401.** This is safe because the 401 carries no information about any credential: it is the same fixed answer for every caller, and step 2 never calls `authenticate`, so a lockout still stops all guessing. It matters because the client most likely to be locked out is one holding a stale or revoked token. Its way back is to drop the token and start OAuth discovery again, and a 429 there would trap it until the window expires and send it straight back into the same loop. The discovery throttle (d) still bounds it.
- **(d) Discovery limit: 120 per client key per 60 s window (`MAX_DISCOVERY_PER_CLIENT = 120`, `DISCOVERY_WINDOW_MS = 60_000`).**
  - Why so generous: a single sign-in takes 1-3 credential-free requests. The observed Codex burst is about 10 a second. Several MCP clients often share one NAT IP (Claude, Codex and ChatGPT on one home connection). 120 a minute absorbs about 12 seconds of the observed burst rate, or a dozen clients re-discovering at once.
  - Why it is still bounded: each answer is a fixed 401 with no body parse, no authentication and no store access. 120 a minute caps one key at 2 a second on average, well under the `PUBLIC_CLIENT_RPS` (10 a second) already allowed to authenticated callers.
  - Memory: use a fixed-window counter (`{ start, count }` per key, O(1) per key), not `FailureWindows`, which stores one timestamp per event (120 × 10 000 keys). It sits behind a `BoundedMap` capped at `MAX_TRACKED_CLIENTS`, like the other per-client maps.
- **(e) Other auth paths are left alone.** The same bug does not apply to them:
  - `/status` already records a failure only when a credential was offered (:257-269).
  - The OAuth `/register`, `/token` and `/authorize` endpoints use their own per-route windows (gateway/src/oauth/server.ts:310-313; gateway/test/http/oauth-limits.test.ts:13-46). They are not `failedAuth`.
  - The consent page shares `failedAuth` through `attach` (gateway/src/oauth/consent/index.ts:127). It records only a wrong code that was typed in (:301-324), which is a real failed credential, so the shared bucket is correct there.
  - The link's pairing-code attempts use their own counter (gateway/src/link/code-attempts.ts).

## Context
- gateway/src/http/server.ts:296-310 (origin/main). The block being fixed.
- gateway/src/http/server.ts:252-271. The `/status` branch, which already splits offered from not offered. Follow its shape.
- gateway/src/http/limits.ts:69-93. `RateWindows`, the fixed-window shape to copy, generalised to a configurable window and max.
- gateway/test/http/public.test.ts:28 (`setup`) and :195-213. The harness and the existing lockout test, which uses an injected `now`.
- gateway/test/http/oauth-limits.test.ts:1-30 and gateway/test/oauth/helpers.ts. The OAuth `rig` (`r.login`, `r.mcp`, `XFF`), for the end-to-end case with a real access token.
- docs/conventions.md. Test naming and the fast/slow split; the new test is a fast test.

## Acceptance
- [ ] **Discovery is not a failure.** In gateway/test/http/discovery-throttle.test.ts, using the OAuth rig with `trustProxy: true` and an injected clock that advances at least 1 s between requests (paced, so no per-second limit applies), 11 or more credential-free `POST /mcp` requests from one `x-forwarded-for` key each get 401 with a `www-authenticate` header containing `resource_metadata=`. Then `r.login` followed by an `initialize` from the same key with the issued access token gets 200, not 429.
- [ ] **Invalid-token lockout unchanged.** In the same file, 10 `/mcp` requests with `authorization: Bearer wrong` from one key get 401, the 11th gets 429 with `retry-after`, and a valid token from that key also gets 429 within the window. Moving the clock past 60 s restores 401 for a wrong token.
- [ ] **Malformed credential is a failure.** An `authorization` header that is empty or not `Bearer …` (for example `Basic abc`), sent 10 times, leads to 429 on the 11th, just as a wrong bearer does.
- [ ] **Locked-out client still gets the challenge.** After a key is locked out by 10 wrong bearers, a credential-free request from that key gets 401 with `resource_metadata=`, not 429. A test with a spy `authenticate` (the `setup` seam) shows `authenticate` is not called for that request.
- [ ] **Discovery throttle is bounded.** With the clock held fixed, `MAX_DISCOVERY_PER_CLIENT` credential-free requests from one key get 401, the next gets 429 with `retry-after`, another key in the same window still gets 401, and advancing the clock past `DISCOVERY_WINDOW_MS` restores 401. The test imports the constant; it does not hard-code 120.
- [ ] **Discovery does not feed the lockout.** After `MAX_DISCOVERY_PER_CLIENT` credential-free requests, one wrong bearer from the same key gets 401, not 429.
- [ ] `rg -n "MAX_DISCOVERY_PER_CLIENT = 120|DISCOVERY_WINDOW_MS = 60_000" gateway/src/http/limits.ts` finds both. The new class has a cap test in gateway/test/http/limits.test.ts showing its `size` never exceeds the cap given.
- [ ] `git diff origin/main -- gateway/src/http/server.ts` touches only the ranges named in Owns.
- [ ] **Existing tests that pin the old behaviour.** Only these two change, and each change is named in the PR description:
  - gateway/test/http/public.test.ts `keys by the TCP peer without --trust-proxy` (:215-221). It sends no `Authorization` header, so its 10 requests no longer count as failures. Add `authorization: 'Bearer nope'` to its headers; the assertion (`429` for the 11th, regardless of `x-forwarded-for`) stays.
  - gateway/test/http/public.test.ts `a client key at the failed-auth limit gets 429 even with a valid credential` (:324-333). Its "credential" is an `x-secret` header with no `Authorization`, so its bad attempts become discovery requests. Add an `authorization` header to `go` so the attempts count as offered; the assertions stay.

  Every other existing test passes unchanged, in particular gateway/test/http/oauth-limits.test.ts, gateway/test/oauth/consent/consent.test.ts:162-176 and gateway/test/link/invites-app.test.ts:196-211. If any other test fails because it pins the old behaviour, stop and report it rather than editing it.
- [ ] `npm run verify` passes.

## Out of scope
- The `/status` branch, the OAuth `/register`, `/token` and `/authorize` limits, the consent page's use of the shared bucket, and the link's pairing-code attempts (decision (e)).
- Changing `MAX_FAILED_AUTH_PER_CLIENT`, `FAILED_AUTH_WINDOW_MS`, `PUBLIC_CLIENT_RPS` or the per-client session cap.
- Putting a `WWW-Authenticate` header on any 429.
- Logging or metrics for discovery or lockout events. That is 87's territory (connect/disconnect logging) and a separate decision.
- gateway/src/app.ts, gateway/src/link/**, gateway/src/mcp/** and gateway/src/bin/cli.ts, which tasks 86 and 87 own.
- Caddy configuration and deploy docs.
