# 67 — Add the OAuth consent page and self-service grant revocation

**Repo:** .
**Depends on:** 35, 74
**Status:** MVP B wave 3. It runs before 68 because both edit gateway/src/link/server.ts (after 68's 2026-10-14 rewrite as operator invites, that is the only shared file). Split from 36; does not depend on 18. Amended 2026-10-14 in the MVP B re-plan: no migration; CSRF, anti-framing and Host rules; the pairing code is never shown; the page does not list users (approved by Andrew, 2026-10-14).
**Owns:**
- gateway/src/oauth/consent/**
- gateway/test/oauth/consent/**
- gateway/src/oauth/grants/**
- gateway/test/oauth/grants/**
- gateway/src/oauth/** (replace 35's `AutoDenyConsent` default with the real consent step, and add the revoke path; no other change)
- gateway/src/http/** (mount the consent routes only)
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
  - `Referrer-Policy: no-referrer`;
  - `Cache-Control: no-store`.

  There are no external assets and no inline script.
- **No pairing code.** The consent page, its errors and the redirect never contain a pairing code. The consent code is separate from pairing codes (its own generator and store) and reaches only the chosen user's Foundry client over that user's link.
- **No user enumeration. Approved by Andrew, 2026-10-14.** The original contract listed every connected (world, user) pair on the page. Anyone on the internet can reach the page after an open DCR, so that would publish who is online. Instead the page asks for the world and the Foundry user name. Whether or not that user is connected, it answers with the same text: "If that user is online in that world, a code was sent to their Foundry window". It then shows the code field. Scopes are checkboxes as before.

## Acceptance
- [ ] The user is resolved by Foundry user id, or by recorded name only when exactly one active pairing in that world has that name. A name shared by several pairings, which is possible because the name comes from the module's `hello` and is self-reported (threat T14), resolves to nobody: no code is sent, and the answer is the same text as for an unknown user (test with two pairings named `Gamemaster`).
- [ ] The consent page asks for world, Foundry user and scopes (`read`, `write`, `destructive`, `code`). Approving needs a one-time code delivered only to the chosen user's Foundry client over that user's link connection. The response text and status are identical for a connected user, an unknown user and an offline user (test compares the bodies).
- [ ] The code expires after 5 minutes (named constant). At most 5 wrong entries are allowed (named constant) before the consent request is void, and wrong entries also count in 74's per-client failure bucket. Tests cover expiry, a wrong code, lock-out and success.
- [ ] CSRF: a POST without the cookie, with a mismatched token, with a missing `Origin`, or with `Origin: https://evil.example` gets 403 and approves nothing (four tests).
- [ ] Every consent response carries the headers in the Anti-framing amendment, and a request whose `Host` is not the public host (including `127.0.0.1`) gets 403 (tests).
- [ ] No consent response body, redirect `Location` or link frame sent to the module contains the live pairing code (test reads the live code and searches every response).
- [ ] Granted tokens bind to that (world, user) and its chosen scopes in `oauth_grants`. A test shows that a token granted for one user never reaches another user's connection.
- [ ] Link messages `listGrants`, `grants` and `revokeGrant`: a user's client lists only grants bound to its own (world, user), with client name, scopes and last used. The gateway takes the user from the link connection's binding, never from the message payload: a test sends a forged user id and gets only its own grants.
- [ ] Revocation invalidates the grant's access and refresh tokens at once, and the next MCP call with either gets 401 (test).
- [ ] Grants also die with their pairing: revoking or replacing a (world, user)'s pairing (68's `--revoke-pairing` or invite replacement) revokes that pair's grants through 35's `onPairingRevoked` subscription (35 decision h). This task adds no second path. A test revokes the pairing and asserts that the grants app then lists nothing for that user, and that the old token gets 401.
- [ ] The page is plain server-rendered HTML with no external assets. Untrusted text (the client name from DCR, and the typed world and user) is escaped, tested with a `<script>` client name.
- [ ] A grants app in module settings shows the current user's grants with a Revoke button. `module/test/apps/grants/**` covers list and revoke, strings are localized, and the module sends no grant message to a gateway older than this task's version (test).
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
