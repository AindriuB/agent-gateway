# 67 — Add the OAuth consent page and self-service grant revocation

**Repo:** .
**Depends on:** 35, 74
**Status:** MVP B wave 3. It runs before 68 because both edit gateway/src/link/server.ts (after 68's 2026-10-14 rewrite as operator invites, that is the only shared file). Split from 36; does not depend on 18. Amended 2026-10-14 in the MVP B re-plan: no migration; CSRF, anti-framing and Host rules; the pairing code is never shown; the page does not list users (approved by Andrew, 2026-10-14).
**Owns:**
- gateway/src/oauth/consent/**
- gateway/test/oauth/consent/**
- gateway/src/oauth/grants/**
- gateway/test/oauth/grants/**
- gateway/src/oauth/** (replace 35's `AutoDenyConsent` default with the real consent step, add the revoke path, and add the token retention sweep from the Amendments, which runs from inside the OAuth server; no other change)
- gateway/src/http/** (mount the consent routes only)
- gateway/test/http/oauth-flow.test.ts (only: replace 35's "shipped default is auto-deny" test with one asserting that the consent page renders; approved by Andrew, 2026-10-14, review round 1)
- gateway/src/link/grants.ts (new: handles the grant and consent-code link messages)
- gateway/src/link/server.ts (insertions only: route the grant and consent messages to `grants.ts`)
- protocol/src/link/messages.ts (insertions only)
- module/src/apps/grants/**
- templates/grants/**
- module/test/apps/grants/**
- module/src/link/client.ts (grant and consent-code messages only)
- module/src/settings/index.ts (insertions only: register the grants menu)
- lang/en.json (insertions under `AGENT_GATEWAY.Consent.*` and `AGENT_GATEWAY.Grants.*` only)
- styles/agent-gateway.css (grants section only)

## Goal
Let a remote MCP client (claude.ai, ChatGPT, the Gemini app) finish OAuth. On a consent page the human names the world and the Foundry user, picks the scopes, and proves control of that user's Foundry session with a one-time code shown only in that user's Foundry client. Then let each Foundry user see and revoke the grants bound to them from their own client. Without this, 35's consent step denies every authorization.

## Context
- docs/plan/tasks/36-consent-and-revocation.md: the original contract. Its first five Acceptance items are the source of this task.
- docs/plan/tasks/35-gateway-oauth.md, decisions (a) and (g): the `oauth_grants` table in migration 010, and the `ConsentStep` interface with its auto-deny default.
- docs/plan/tasks/74-remote-exposure-foundation.md:
  - decision (b), the public Host allowlist;
  - decision (d), the pairing code is never shown to a remote client;
  - decision (e), per-client keys and bounded buckets;
  - decision (h), the migration numbers.
- docs/spikes/foundry-socket-identity.md:107-111 option (c): a one-time code shown only in the claimed user's client. :113-118: identity only from server-set arguments.
- docs/plan/PLAN.md, the "Deferred beyond B", 18 item: why revoking another user's grants is not here.
- docs/conventions.md#shared-insertion-only-files: `protocol/src/link/messages.ts`, `lang/en.json`, `module/src/settings/index.ts` and `styles/agent-gateway.css`.
- gateway/src/link/server.ts:275-345 the per-message switch for authenticated connections, where the new message types are routed; :343-344 closes the socket on an unexpected type.
- module/src/link/client.ts:363-368 the client ignores a frame that does not parse, so an older module ignores the new gateway messages. An older gateway closes the socket on a message type it does not know (gateway/src/link/server.ts:228-251). The module must not send `listGrants` or `revokeGrant` to a gateway whose `welcome.gatewayVersion` predates this task.
- gateway/src/status/page.ts:15 `escapeHtml`: reuse it.

## Amendments (2026-10-14)
- **Storage.** Grants live in 35's migration 010 (`oauth_grants`, with tokens linked by `grant_id`). This task adds no migration. If it finds it needs one, it stops and reports first, because the array in gateway/src/store/migrations/index.ts is positional and 011 is reserved for 68 and 012 for 38 (74 decision h).
- **Host.** The consent routes answer only when `Host` is the public URL's host (74's allowlist). Any other Host gets 403, loopback included, so the page is never served on a rebinding name.
- **CSRF.** Each consent request gets a random request id and a CSRF token. The token goes in a `__Host-` prefixed cookie (`Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`) and in a hidden form field. A POST is accepted only when the two match, the request id is live, and `Origin` is exactly the public origin. A missing `Origin` is refused.
- **Anti-framing and assets.** Every consent response sets:
  - `X-Frame-Options: DENY`;
  - `Content-Security-Policy: default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`;
  - `Referrer-Policy: same-origin`;
  - `Cache-Control: no-store`.

  There are no external assets and no inline script.

  Review round 1 changes (Andrew, 2026-10-14):
  - **Referrer-Policy is `same-origin`, not `no-referrer`.** Under `no-referrer`, Chrome sends `Origin: null` on the same-origin consent POST, so the strict CSRF `Origin` check refused every real approval (a code reviewer reproduced this in Chrome 155). The strict `Origin` check in the CSRF amendment stays as written.
  - **CSP `form-action` on approval-capable responses.** Chrome checks `form-action` on every redirect hop, so `form-action 'self'` blocked the 302 to the client after the grant and code were already written. On any consent response that can lead to the 302 to the client, `form-action` is `'self'` plus the origin of that request's registered (already exact-matched) `redirect_uri`, computed per request. Every other CSP directive is unchanged.
- **No pairing code.** The consent page, its errors and the redirect never contain a pairing code. The consent code is separate from pairing codes (its own generator and store) and reaches only the chosen user's Foundry client over that user's link.
- **No user enumeration. Approved by Andrew, 2026-10-14.** The original contract listed every connected (world, user) pair on the page. Anyone on the internet can reach the page after an open DCR, so that would publish who is online. Instead the page asks for the world and the Foundry user name. Whether or not that user is connected, it answers with the same text: "If that user is online in that world, a code was sent to their Foundry window". It then shows the code field. Scopes are checkboxes as before.
- **Approval is never a bare GET (from 35's code review, Andrew 2026-10-14).** 35's `GET /authorize` mints a grant whenever the consent step approves. So the real consent step must never approve during a GET. Approval is a state change and happens only on the POST covered by the CSRF amendment, or an equivalent protection.
- **Token retention (from 35's code review, Andrew 2026-10-14).** 35 never deletes rows from `oauth_codes`, `oauth_tokens` or revoked `oauth_grants`. This task adds a bounded retention sweep, using no migration, that deletes:
  - expired codes;
  - access and refresh tokens that expired or were revoked, once they are past their TTL;
  - revoked grants that have no live tokens.

  Each sweep run deletes at most a named-constant number of rows, so storage cannot grow without limit and a single run cannot do unbounded work.

## Acceptance
- [ ] The user is resolved by Foundry user id, or by recorded name only when exactly one active pairing in that world has that name. A name shared by several pairings, which is possible because the name comes from the module's `hello` and is self-reported (threat T14), resolves to nobody: no code is sent, and the answer is the same text as for an unknown user (test with two pairings named `Gamemaster`).
- [ ] The consent page asks for world, Foundry user and scopes (`read`, `write`, `destructive`, `code`). Approving needs a one-time code delivered only to the chosen user's Foundry client over that user's link connection. The response text and status are identical for a connected user, an unknown user and an offline user (test compares the bodies).
- [ ] The code expires after 5 minutes (named constant). At most 5 wrong entries are allowed (named constant) before the consent request is void, and wrong entries also count in 74's per-client failure bucket. Tests cover expiry, a wrong code, lock-out and success.
- [ ] CSRF: a POST without the cookie, with a mismatched token, with a missing `Origin`, or with `Origin: https://evil.example` gets 403 and approves nothing (four tests).
- [ ] Every consent response carries the headers in the Anti-framing amendment, including `Referrer-Policy: same-origin` and, on responses that can lead to the 302 to the client, `form-action 'self' <origin of that request's registered redirect_uri>` with every other CSP directive unchanged. A request whose `Host` is not the public host (including `127.0.0.1`) gets 403 (tests).
- [ ] Regression guard for the `Origin: null` failure: a test asserts the exact `Referrer-Policy: same-origin` header on the consent page, or drives the approval POST without hand-setting `Origin`, so a return to `no-referrer` fails a test.
- [ ] No consent response body, redirect `Location` or link frame sent to the module contains the live pairing code (test reads the live code and searches every response).
- [ ] Granted tokens bind to that (world, user) and its chosen scopes in `oauth_grants`. A test shows that a token granted for one user never reaches another user's connection.
- [ ] Link messages `listGrants`, `grants` and `revokeGrant`: a user's client lists only grants bound to its own (world, user), with client name, scopes and last used. The gateway takes the user from the link connection's binding, never from the message payload: a test sends a forged user id and gets only its own grants.
- [ ] Revocation invalidates the grant's access and refresh tokens at once, and the next MCP call with either gets 401 (test).
- [ ] Grants also die with their pairing: revoking or replacing a (world, user)'s pairing (68's `--revoke-pairing` or invite replacement) revokes that pair's grants through 35's `onPairingRevoked` subscription (35 decision h). This task adds no second path. A test revokes the pairing and asserts that the grants app then lists nothing for that user, and that the old token gets 401.
- [ ] The page is plain server-rendered HTML with no external assets. Untrusted text (the client name from DCR, and the typed world and user) is escaped, tested with a `<script>` client name.
- [ ] A grants app in module settings shows the current user's grants with a Revoke button. `module/test/apps/grants/**` covers list and revoke, strings are localized, and the module sends no grant message to a gateway older than this task's version (test). Known residual, accepted by Andrew 2026-10-14: every build reports `0.1.0`, so `GRANTS_MIN_GATEWAY_VERSION` cannot tell a pre-67 gateway apart; nothing is published, so gateway and module are updated together. The module test must not claim the gate guards pre-67 gateways: remove the `'0.0.9'` and `rc1` assertions, or relabel them as tests of the version comparison only. Capability negotiation in `welcome` is out of scope here (a go-public prerequisite).
- [ ] A `GET /authorize`, with any query (including a valid pending consent request id), never creates an `oauth_grants` row or issues a code. Only the CSRF-checked POST approves (test counts grant rows before and after the GET).
- [ ] Retention sweep: with an injectable clock, a run deletes expired codes, expired or revoked tokens past their TTL, and revoked grants with no live tokens. It keeps live tokens, their grants, and revoked rows still within TTL. A run deletes at most the named per-run cap, and the rest goes on the next run (tests).
- [ ] No new file under gateway/src/store/migrations/.
- [ ] Manual check: the MCP Inspector OAuth flow through the consent page against foundry.local v14, with the gateway's `--public-url` set (through 42's Compose stack if it has landed). Screenshots in the PR.
- [ ] `npm run verify` passes.

## Out of scope
- A GM revoking another user's grants, or revoking while that user is offline (18 and the rest of 36).
- The agents app (18).
- Server-mode operator invites and pairing revocation (68).
- Audit-trail entries for consent or revocation (35b).
- Client setup guides (43).
- Any migration (see Amendments).

## Review round 1 — findings
- [P2] gateway/src/oauth/ (absent) — The token retention sweep is not implemented. `oauth_codes`, expired or revoked `oauth_tokens`, and revoked `oauth_grants` are still never deleted. The only `DELETE FROM oauth_*` is 35's client cleanup at repository.ts:202. route: implementer. The "Token retention" amendment and Owns specify it. Input: a long-lived client refreshing its token adds token rows on each rotation, so the table grows without limit.
- [P3, optional] gateway/src/oauth/server.ts:218-235 and :357 — Some JSON responses on `/authorize/consent` lack the consent headers: the 429 from the rate limit, the 413 from readBody, and the 405 for GET. They are written by `json()` without X-Frame-Options, CSP or Referrer-Policy. The anti-framing amendment says every consent response carries them. Input: 31 POSTs in a minute from one client key give a 429 without those headers.
- [NOTE for tests] Add a test that counts `oauth_grants` rows around a `GET /authorize` with a live consent request id (no grant is written before approval), plus retention-sweep tests.

## Review round 2 — findings

- [P3] gateway/src/oauth/consent/index.ts:297-298 — `verify` creates the grant for the `p.target` resolved when the code was sent and never checks again that the pairing is still active. A grant can therefore be created after that pairing was revoked or replaced, and it gets past the `onPairingRevoked` sweep. route: implementer. Re-run `activePairedUsers(target.worldId)` (or an equivalent check) in `verify` before `finish`, and treat a miss as a wrong code. This brings the code in line with the acceptance item "Grants also die with their pairing". Input: send a code to (w1, bob) at t=0. At t=60s bob's pairing is replaced, so `revokeGrantsFor` finds nothing. At t=90s the code is typed in. → a live `oauth_grants` row for (w1, bob) is created after the replacement.
- [NOTE, cheap] gateway/src/oauth/server.ts:250-258 — `sweepIfDue` swallows every error without logging, so a sweep that keeps failing stops retention with no sign of it. Log the failure through the gateway's existing logger at warn level, with no secrets and rate-limited by the existing interval.

## Review round 3 — findings

- [P3, carried from round 2: NOT FIXED for the replaced case] gateway/src/oauth/consent/index.ts:278-281 — The round 2 re-check matches on (worldId, userId) only. It catches a revoked pairing but not a replaced one. route: implementer. Store the pairing id the code was sent over in `p.target`. In `verify`, check that this exact pairing is still active, using a pairing-id query added to the oauth repository (inside Owns `gateway/src/oauth/**`), and treat a miss as a wrong code, on the same path, status, body and counters as a wrong code. Add a test for the replaced case. Input: send a code to (w1, u1), then `createPairing` a new pairing for (w1, u1) and `revokePairing` the old one, then verify with the code. → today: 302 and a live `oauth_grants` row. Expected: 400 wrong-code page and zero grant rows.

## Review round 4 — findings

Round 4 approved by Andrew, 2026-10-14, beyond the usual three-round cap, for this finding only.

- [P3, carried from round 3: NOT FIXED when a user holds several active pairings] gateway/src/oauth/consent/index.ts:242 and :251-254 — `resolve` binds `p.target.pairingId` to the newest active pairing, but `deliver` sends the code over whatever connection `registry.get(worldId, userId)` returns, and that connection can be authenticated by an older pairing (`LinkConnection.agentId` is the pairing id, gateway/src/link/server.ts:483-490). route: implementer. In `deliver`, set `p.target.pairingId = conn.agentId`, the pairing the code was actually sent over. Drop the newest-wins choice in `resolve` if it is no longer needed. Add a test with two active pairings for (w1, u1). Input: pairing P1 connects. P2 is created for (w1, u1) without revoking P1. A code is sent for u1, delivered over P1. `revokePairing(P1)`. Verify with the code. → today: 302 and one live grant. Expected: 400 and zero grant rows. The reverse case, revoking P2 while P1 stays live, must then accept the right code.
