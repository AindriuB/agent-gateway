# 36 — Add the OAuth consent page, token revocation and server-mode pairing confirmation

**Repo:** .
**Depends on:** 18, 67, 68, 35b
**Status:** Deferred beyond B, with 18. Split on 2026-10-13: the consent page and self-service grant revocation moved to 67, and server-mode pairing confirmation moved to 68 (both MVP B).
**Owns:**
- gateway/src/oauth/consent/**
- gateway/test/oauth/consent/**
- protocol/src/link/messages.ts (insertions only)
- module/src/apps/agents/** (OAuth tokens and pending-pairing sections only)
- templates/agents/** (OAuth tokens and pending-pairing sections only)
- lang/en.json (insertions under `AGENT_GATEWAY.Tokens.*` and `AGENT_GATEWAY.PairingConfirm.*` only)
- gateway/src/link/** (pairing confirmation and replacement rules only)
- gateway/test/link/**
- gateway/src/config/** (`--server-mode` only)
- module/src/link/client.ts (pairing-confirmation messages only)
- module/src/apps/pairing/** (confirmation prompt only)
- templates/pairing/** (confirmation prompt only)
- module/test/link/pairing-confirm.test.ts
- module/src/main.ts (insert the pairing-confirmation install call only, if the chosen design needs one)

## Goal
Show a consent page where the human picks the world, the Foundry user and the
scopes for a remote client, and let them see and revoke those grants from inside
Foundry's agents app.

In server mode (one gateway, many players), stop a player from pairing or
connecting as someone else: a first pairing takes effect only once the paired
user's own Foundry client confirms it, and a pairing from a different browser
never silently replaces an existing one.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:103-104 — consent page (world, Foundry user, scopes); revocable from inside Foundry
- docs/plan/specs/2026-10-09-agent-gateway.md:108-109 — gateway serves only the consent and status pages
- gateway/src/oauth/** (35); module/src/apps/agents/** (18)
- docs/spikes/foundry-socket-identity.md (10b) — what Foundry can prove about a user's identity, and the recommended proof; the confirmation design here follows it
- gateway/src/link/server.ts:180-200 — first pairing trusts the `hello` world/user ids; stored tokens are bound on reconnect
- gateway/src/link/registry.ts:115-125 — a new connection for the same (world, user) silently replaces the old one
- gateway/test/routing/isolation.test.ts (11) — isolation guarantees that must keep passing
- docs/plan/tasks/35b-gateway-audit-trail.md — if 35 has no revoke path, record the `oauth_revoke` audit event by calling 35b's exported `recordAuth` where tokens are revoked

## Acceptance
- [ ] Consent page lists connected (world, user) pairs and scope checkboxes; approval requires the user to enter a one-time code shown in that Foundry user's client (proves control of the Foundry session); CSRF-protected form
- [ ] Granted tokens bind to that (world, user); link messages `listGrants` / `grants` / `revokeGrant` let the agents app show client name, scopes, last used, and revoke
- [ ] Revocation invalidates access and refresh tokens immediately (test)
- [ ] Page is plain server-rendered HTML with no external assets
- [ ] Manual check: MCP Inspector OAuth flow through the consent page against foundry.local v14; screenshots in PR
- [ ] `--server-mode` config flag (default off = local mode); server-mode rules below apply only when it is set
- [ ] Server mode, first pairing: a valid code plus `hello` puts the connection in a pending state. It is not added to `LinkRegistry` and receives no `call` or event frames until the claimed user's own Foundry client confirms it, using the mechanism the 10b doc recommends. Test: a fake client presenting a valid code and the GM's user id, with no confirmation, is never listed and a session bound to the GM still gets `WORLD_OFFLINE`
- [ ] Server mode, existing pairing: a new pairing (a code) or a connection with a different token for a (world, user) that already has a token from another browser is held pending. The existing connection keeps working. The new one replaces it only after explicit re-pair confirmation in that user's client or GM approval in the agents app; on denial or a timeout of 10 min (named constant) the pending connection is closed with a `PAIRING_REJECTED` error frame. Test covers approve, deny and timeout, each asserting the original connection and its pending calls are untouched until approval
- [ ] Reconnect with the same stored token still replaces the old connection without prompting in both modes (tests in `gateway/test/routing/**` pass unchanged)
- [ ] The confirmation prompt in the module names the world, the user and when the pairing was requested, and has Confirm and Reject buttons; `module/test/link/pairing-confirm.test.ts` covers both
- [ ] Local mode keeps the current behaviour; the trust assumption ("anyone who can reach the link port and holds a valid code can claim any user id; local mode assumes the gateway is reachable only from the owner's machine") is written as a code comment at the pairing branch in `gateway/src/link/server.ts` and recorded in the PR for 43 to carry into `docs/security.md`
- [ ] Manual check on foundry.local v14 with the GM and Player test users (server mode): the Player client pairing while claiming the GM's user id is never connected; a GM re-pair from a second browser needs confirmation; PR includes the output

## Out of scope
- Client-specific setup guides (43)
- Writing `docs/security.md` (43) or `docs/server-mode.md` (42)
- Session routing and isolation tests in `gateway/test/routing/**` (11, 20)

## MVP split (2026-10-13)
Depends was `35, 18, 10b, 37, 35b`. 67 covers this file's consent page, grant listing and revocation of a user's own grants. 68 covers `--server-mode`, first-pairing and re-pairing confirmation, and the local-mode trust comment. What remains here waits for 18: a GM revoking other users' grants or tokens (including while that user is offline), grant and pending-pairing sections inside 18's agents app, and the `oauth_revoke` audit event (35b). Re-scope this file before starting it.
