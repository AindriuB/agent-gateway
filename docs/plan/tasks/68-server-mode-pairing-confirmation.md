# 68 — Add server-mode pairing confirmation

**Repo:** .
**Depends on:** 38, 67
**Status:** MVP B (after A). B order 6, after 38 and 67; 42 waits for it. Split from 36; does not depend on 18.
**Owns:**
- gateway/src/link/** (pairing confirmation and replacement rules only; `grants.ts` is 67's)
- gateway/test/link/**
- gateway/src/config/** (`--server-mode` only)
- protocol/src/link/messages.ts (insertions only)
- module/src/link/client.ts (pairing-confirmation messages only)
- module/src/apps/pairing/** (confirmation prompt only)
- templates/pairing/** (confirmation prompt only)
- module/test/link/pairing-confirm.test.ts
- module/src/main.ts (insert the pairing-confirmation install call only, if the design needs one)
- lang/en.json (insertions under `AGENT_GATEWAY.PairingConfirm.*` only)

## Goal
In server mode (one gateway, many players), stop a player from pairing or
connecting as someone else. A first pairing takes effect only once the claimed
user's own Foundry client confirms it, and a pairing from a different browser
never silently replaces an existing one. This is the impersonation defence the
Docker image (42) needs.

## Context
- docs/plan/tasks/36-consent-and-revocation.md — the original contract; its server-mode Acceptance items are the source of this task
- docs/spikes/foundry-socket-identity.md:1-12,106-120 — attested sender ids; the trusted observer (the GM's paired link or a headless agent); option (a) with `User#query`, option (c) for explicit confirmation; a claim with no trusted observer online stays pending
- gateway/src/link/server.ts:180-200 — first pairing trusts the `hello` world/user ids; stored tokens are bound on reconnect
- gateway/src/link/registry.ts:115-125 — a new connection for the same (world, user) silently replaces the old one
- gateway/test/routing/isolation.test.ts (11) — isolation guarantees that must keep passing
- gateway/src/headless/** (37, 38) — a headless agent is a trusted observer and logs in as its own user

## Acceptance
- [ ] `--server-mode` config flag (default off = local mode); every rule below applies only when it is set
- [ ] First pairing: a valid code plus `hello` puts the connection in a pending state. It is not added to `LinkRegistry` and receives no `call` or event frames until the claimed user's own Foundry client confirms it, using the 10b recommendation and reading identity only from server-set arguments. Test: a fake client presenting a valid code and the GM's user id, with no confirmation, is never listed, and a session bound to the GM still gets `WORLD_OFFLINE`
- [ ] With no trusted observer online the claim stays pending and times out; it is never approved by default (test)
- [ ] Existing pairing: a new code, or a connection with a different token, for a (world, user) that already has a token from another browser is held pending. The existing connection keeps working. The new one replaces it only after confirmation in that user's client or approval by a GM in a prompt in the GM's client; on denial or a timeout of 10 min (named constant) the pending connection is closed with a `PAIRING_REJECTED` error frame. Tests cover approve, deny and timeout, each asserting the original connection and its pending calls are untouched until approval
- [ ] Reconnect with the same stored token still replaces the old connection without prompting in both modes (tests in `gateway/test/routing/**` pass unchanged)
- [ ] The confirmation prompt names the world, the user and when the pairing was requested, and has Confirm and Reject buttons; `module/test/link/pairing-confirm.test.ts` covers both
- [ ] Local mode keeps the current behaviour; its trust assumption ("anyone who can reach the link port and holds a valid code can claim any user id; local mode assumes the gateway is reachable only from the owner's machine") is a code comment at the pairing branch in `gateway/src/link/server.ts`
- [ ] Manual check on foundry.local v14 in server mode with the GM and Player test users: the Player client pairing while claiming the GM's user id is never connected; a GM re-pair from a second browser needs confirmation; PR includes the output
- [ ] `npm run verify` passes

## Out of scope
- The agents app and GM revocation of other users' tokens (18 and the rest of 36)
- OAuth consent and grants (67)
- Session routing and isolation tests in `gateway/test/routing/**` (11, 20)
- `docs/security.md` (43) and `docs/server-mode.md` (42)
