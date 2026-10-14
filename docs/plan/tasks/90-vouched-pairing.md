# 90 — Require an admin GM's vouch to redeem a player invite, and add the admin and gm invite flags

**Repo:** .
**Depends on:** 89
**Owns:**
- e2e/vouch/** (new)
- e2e/vitest.e2e.config.ts (one `include` line for `vouch/**/*.e2e.test.ts` only)
- protocol/src/link/version.ts
- protocol/src/link/errors.ts (insert `PAIRING_UNCONFIRMED` only)
- protocol/src/link/messages.ts (insertions, plus the optional `admin` field on `welcome`)
- protocol/test/link/link.test.ts
- protocol/test/link/vouch.test.ts (new)
- gateway/src/link/attestation.ts (new)
- gateway/src/link/server.ts
- gateway/src/link/invites.ts
- gateway/src/store/store.ts
- gateway/src/store/migrations/013-admin-pairings.ts (new; renumber at merge per docs/conventions.md)
- gateway/src/store/migrations/index.ts (one import and one array entry)
- gateway/test/store/store.test.ts, gateway/test/store/retire-legacy-pairings.test.ts, gateway/test/http/app.test.ts (only the migration-count and slice-index assertions this migration forces)
- gateway/test/store/admin-flag.test.ts (new)
- gateway/test/store/invites.test.ts
- gateway/test/link/attestation.test.ts (new)
- gateway/test/link/invite-flags.test.ts (new)
- gateway/test/link/invites.test.ts, gateway/test/link/invites-app.test.ts, gateway/test/link/invites-replacement.test.ts, gateway/test/link/revocation.test.ts, gateway/test/link/connection-log.test.ts, gateway/test/app/public.test.ts (only to redeem through an admin invite or an attestation where a test redeems a server-mode invite)
- gateway/test/link/helpers.ts (insertions only)
- gateway/test/offline-queue/native-proof.mts, module/test/adapters/generic/native-proof.mts (the protocol version literal only)
- module/src/link/vouch.ts (new)
- module/src/link/client.ts (the `pairingChallenge`, `welcome.admin`, `attest` and `PAIRING_UNCONFIRMED` paths, plus the deps interface)
- module/src/link/runtime.ts (vouch wiring only)
- module/src/link/status-indicator.ts (only the new awaiting-GM state)
- module/src/main.ts (installing the vouch hook only)
- module/src/apps/pairing/index.ts
- templates/pairing/pairing.hbs
- lang/en.json (insertions only)
- module/test/stubs/** (insertions only)
- module/test/link/vouch.test.ts (new)
- module/test/link/client.test.ts

## Goal
Close PLAN "Now #3": in server mode, an invite code alone no longer pairs a player. The player's
module proves who it is by posting a flagged, whispered ChatMessage, whose author Foundry sets on
the server. An admin GM's module, connected over its own link in the same world, reads that
author and vouches for it. The gateway records an operator-set `admin` flag on pairings and
invites, and an operator-set `gm` flag on invites, neither ever derived from `hello.isGM`. An
operator invite flagged `gm` or `admin` pairs directly, as today, because the operator code is
the trust root for GM users, whom vouching cannot prove. This changes the pairing flow, so the
protocol major version goes up and an old module and a new gateway refuse each other with an
actionable message.

## Context
- scratchpad design: `design-gm-management.md` (the agreed design, sections (a) and (b), and RISKS)
- gateway/src/link/server.ts:488-640 (origin/main) — `handshake`: the claim is built from `hello.world.id`/`hello.user.id` (:521-527), server-mode redemption (:536-548), welcome (:631-639), and `isGM: hello.user.isGM` stored on the connection (:620)
- gateway/src/link/server.ts:468-476 — the stale-connection check before acting for a connection. Copy it for `attest`.
- gateway/src/link/invites.ts:95-150 — `pairTarget`, `inTransaction`, `redeemInvite`: the transaction to split into "check and reserve" and "settle after attestation"
- gateway/src/store/migrations/011-invites.ts, gateway/src/store/migrations/index.ts — the migration shape. 012 is held by task 38 (docs/plan/tasks/38-headless-config.md:5).
- gateway/src/store/store.ts:60-130 — `InviteRepository` and `Store`
- gateway/src/link/code-attempts.ts — the per-client failure bucket to charge on a refused vouch
- protocol/src/link/version.ts:4-31 — `PROTOCOL_VERSION` and `checkCompat`
- module/src/link/client.ts:460, 523-535 (origin/main; re-read on 89's merge) — `welcome` and `reject`, including the existing `PROTOCOL_MAJOR_MISMATCH` branch
- docs/testing.md "Multi-user and resilience" — how live suites open two browsers (dev-gm, player1)

## Acceptance
- [ ] **First, before anything else is built (spike), shown by `e2e/vouch/author.e2e.test.ts` on v14, and on v13 or marked "pending homelab instance":** (1) logged in as `player1`, a `ChatMessage.create` with `author` set to dev-gm's id, and separately a raw `game.socket.emit('modifyDocument', …)` create with the same forged `author`, each either fails or produces a stored message whose `author.id` is player1's. The test checks this from the GM's browser after a reload, so the result comes from the server and not from the player's client-side check. (2) A whispered ChatMessage from player1 to the GM users, carrying a module flag, fires `createChatMessage` in the GM's browser, and the GM can then delete it. If either result fails on either version, stop and report to the orchestrator before writing the rest of this task.
- [ ] `PROTOCOL_VERSION` is `7.0.0`. A gateway test shows that a hello with `protocolVersion: '6.0.0'` and a valid invite code gets `reject` `PROTOCOL_MAJOR_MISMATCH`, and that the invite's `used_at` is still NULL afterwards. A module test shows the same reject reaching the existing upgrade-message branch, with the message naming the side to upgrade.
- [ ] The new migration adds `pairings.admin INTEGER NOT NULL DEFAULT 0`, `invites.admin INTEGER NOT NULL DEFAULT 0`, `invites.gm INTEGER NOT NULL DEFAULT 0` and `invites.created_by TEXT` (NULL means the operator; reserved for 92). It is the last `MIGRATIONS` entry. A test migrates a database at the previous version that holds active pairings and invites, and asserts that every row has `admin = 0`, every invite has `gm = 0`, and that all rows survive.
- [ ] `PairingRow.admin`, `InviteRow.admin`, `InviteRow.gm` and `InviteRow.createdBy` are exposed. `createInvite` accepts `admin`, `gm` and `createdBy` (defaults `false`, `false` and `null`). `createInvite` throws, and writes nothing, when `createdBy` is non-null and `admin` or `gm` is true: only the operator can mint an invite that skips the vouch. Tested for both flags. `Store.demotePairing(id): boolean` clears the flag and is the only API that writes `pairings.admin` after creation. No store API sets `admin = 1` on an existing row (asserted by an `rg` over `gateway/src` in the PR description).
- [ ] **isGM never grants admin.** Tests: (a) a hello with `user.isGM: true` that redeems a non-admin invite (with a valid vouch) creates a pairing with `admin = 0` and a welcome with `admin: false`; (b) a connection whose hello says `isGM: true` but whose pairing has `admin = 0` sends a well-formed `attest` for a pending player. The player is not paired, the invite stays unused, and the attester is answered with `error` `FORBIDDEN` (or closed 1008). No other code path reads `hello.user.isGM` to decide admin (`rg -n "isGM" gateway/src` cited in the PR).
- [ ] An admin invite (`admin = 1`) redeems directly, as today, into a pairing with `admin = 1`. The welcome carries `admin: true`. On every later token reconnect, `welcome.admin` reflects the row at that moment.
- [ ] **The vouch is skipped only by an invite flag, never by `hello.isGM`.** The gateway decides from the stored invite row alone: `gm = 1` or `admin = 1` redeems directly at hello; otherwise the vouch flow runs. `hello.user.isGM` is not read for this decision. Tests in `gateway/test/link/invite-flags.test.ts`: (a) a `gm = 1, admin = 0` invite redeems directly with no admin connection live, sends no `pairingChallenge`, and creates a pairing with `admin = 0` and a welcome with `admin: false`; (b) the same holds whether the hello says `isGM: true` or `isGM: false` (the invite flag alone decides); (c) a plain invite (`gm = 0, admin = 0`) whose hello says `isGM: true` still gets a `pairingChallenge` when an admin is live, and `reject` `PAIRING_UNCONFIRMED` with the invite unused when none is; (d) a `gm = 1` invite whose claim does not match the hello is settled as `mismatch` exactly as a plain invite is today.
- [ ] A plain server-mode invite (`gm = 0` and `admin = 0`) that matches the claim is not spent at hello. If no admin connection is live in the claim's world, the hello gets `reject` `PAIRING_UNCONFIRMED` and the invite stays unused. Otherwise the gateway reserves the invite in memory and sends `pairingChallenge{nonce, expiresAt}`, with a nonce of at least 128 random bits and a TTL constant of 120 s. It does not register the socket in the registry and sends no welcome.
- [ ] `attest{nonce, authorId, authorIsGM}` from a connection that passes the stale-connection check, and whose pairing row is active with `admin = 1` (read from the store at the time of the message, not cached), completes the pairing only if all of these hold: the nonce is known and unexpired, the attester's `worldId` equals the pending claim's world, `authorId` equals the invite's `user_id`, and `authorIsGM` is false. On success, one transaction settles the invite as `paired` and creates the pairing (replacing the target's old pairings, as `pairTarget` does). The pending socket then gets a welcome with `pairingToken`. A test covers each failing condition separately.
- [ ] When `authorId` differs from the target, the invite is settled as `mismatch`, the pending socket gets `reject` `PAIRING_INVALID`, and its client key is charged one failure in `code-attempts`. Test: a thief socket holding a leaked code and claiming the target's ids, and a module that attests the thief's real author id, never get a pairing.
- [ ] Cross-world isolation: an admin connection in world B that attests a nonce issued for world A changes nothing (pending socket still pending, invite unused). Tested.
- [ ] When `authorIsGM` is true, the invite is not spent and the pending socket gets `reject` `PAIRING_UNCONFIRMED` with a message that says GM users are paired by the operator with a GM invite (`--invite … --gm`). Tested. This is the path a GM user takes when the operator minted a plain invite for it by mistake.
- [ ] Nonces are single-use: a second `attest` with the same nonce changes nothing. When the pending socket closes or the TTL expires, the reservation is released and the invite stays unused. On expiry, the socket gets `reject` `PAIRING_UNCONFIRMED`. While a code is reserved, a second hello with the same code is refused and does not disturb the first. Each case is tested with an injected clock.
- [ ] Bounds: the pending map is capped by named constants (suggested: 8 per world, 64 in total), and a hello beyond the cap gets `RATE_LIMITED` without spending the invite. `attest` messages are rate-limited per connection (named constant). An unknown-nonce `attest` is ignored, and it is counted toward that limit. Tests hit each cap.
- [ ] Local mode (shared pairing code) and in-memory invites (`inviteProvider`) behave exactly as before. Their existing tests pass unchanged.
- [ ] Module, player side: on `pairingChallenge`, the client enters a new awaiting-GM state, and `vouch.ts` creates one ChatMessage. Its `whisper` is the active GM user ids only, its flag is `agent-gateway.vouch = {nonce}`, and its content carries no nonce, token or code. The pairing window shows a localized "waiting for your GM to confirm" state. A Foundry-stub test asserts the message shape.
- [ ] Module, admin side: only when the last welcome said `admin: true`, a `createChatMessage` hook reads `message.author.id` (never a flag or the content) and the author's `isGM`, sends `attest`, then deletes the message. If the client is not admin, or the flag is missing or malformed, it sends nothing. Stub tests cover admin, non-admin and malformed flags.
- [ ] `PAIRING_UNCONFIRMED` reaches the pairing window as a localized message and does not clear any stored credential. Tested.
- [ ] No nonce, token or code appears in `console.*`, `ui.notifications.*`, rendered window context or chat content. Tests capture these through the challenge, attest and reject paths, and assert that the seeded strings are absent.
- [ ] `npm run verify` passes.

## Out of scope
- Operator CLI flags (`--invite … --admin`, `--invite … --gm`, demote, list output): task 91. This task adds only the store and gateway support.
- Link messages for creating, listing or cancelling invites, or for managing pairings or grants: tasks 92, 93, 94.
- Promoting an existing pairing to admin. This is refused by design, not deferred.
- Changing local mode, the shared pairing code, in-memory headless invites, or the role taken from `hello.isGM` for tool access.
- The `pairings(world_id, user_id)` index (87 follow-up).
- Docs and threat map (scribe; see Notes).

## Decisions (Andrew, 2026-10-14)
1. Design approved. Pairing for non-admin users is GM-vouched through a server-authored whispered ChatMessage. Admin GM status is set only by the operator CLI (`--invite … --admin`) and is never derived from `hello.isGM`. The management app lives inside Foundry for the admin GM, over its existing link, scoped to its own world. The CLI stays as the operator's break-glass. No web UI for now.
2. Grants view: yes. The admin GM sees each player's authorized apps as metadata only (client name, scopes, created date; never tokens) and can revoke them. The UI tells players that their GM can see this.
3. Verified evidence: Foundry v13 BaseChatMessage `#canCreate` (client bundle 13.351, around line 14832) is `if (user.isGM) return true; if (user.id !== doc._source.author) return false;`. A non-GM therefore cannot author as another user, but a GM can, so GM targets cannot be proven by vouching and admin GMs are bootstrapped by the operator only. This task's first acceptance item confirms that the check runs server-side and holds on v14.
- Planner: pending attestations are held in memory and bound to the open socket, not in the migration. A gateway restart drops them, and the invite stays unused.
- Planner: a vouch for a GM author is refused, because a GM can author as anyone. GM users are paired only through an operator invite flagged `gm` or `admin`.

## Decisions (Andrew, 2026-10-14, amendment)
4. A GM account other than the root GM (for example a "ChatGPT" GM user) is paired through an operator invite that is not admin. Vouching still never covers GM targets. A plain operator invite flagged `gm` pairs the GM user directly, with no vouch, at today's trust level: the operator code is the trust root. Only `admin` invites set the admin flag, and only admin pairings get the management capabilities of 92–94.
- Planner: player targets of a plain operator invite (`gm = 0, admin = 0`) still require a GM vouch. Reason: the operator code is a bearer secret that travels through chat, email or a pasted string, and if it leaks the vouch is what makes it worthless without the target's own Foundry session. Skipping the vouch for players would bring T1/T3 back for every player invite. The GM exception exists only because vouching cannot prove a GM, not because the code is more trusted.
- Planner: the gateway cannot tell a GM target from a player at invite time or at hello, because `isGM` is client-asserted. The operator states it when minting (`--gm`), the flag is stored on the invite, and the gateway skips the vouch only for invites flagged `gm` or `admin`. A hello that claims `isGM: true` never skips it, and a `gm` invite is not refused when the hello says `isGM: false`: the hello is not consulted either way, so there is one input to reason about. Minting `--gm` for a player is an operator error that removes that player's vouch; 91's help text says so.
- Planner: `admin` implies the vouch skip on its own; the gateway accepts `admin = 1, gm = 0` rows and treats them the same. 91 sets both on `--admin`.
- Planner: invites with a non-null `created_by` (92's delegated invites) can never carry `gm` or `admin`. The store enforces this, so a compromised admin GM cannot mint a vouch-free code.

## Notes for the scribe
- Threat map (docs/plan/mvp-b-threats.md): T1/T3 and the "Foundry cannot prove identity" residual. A leaked player code now fails without the target's own Foundry session. The remaining residuals are the per-world admin bootstrap code, and a compromised admin GM or co-GM, either of which can falsely vouch within its own world.
- docs/architecture.md "Pairing" and "Operator invites": the vouch flow, `PAIRING_UNCONFIRMED`, the admin and gm invite flags, and protocol 7.0.0. Module and gateway must be upgraded together, and existing GMs need an admin invite (task 91) before players can pair. Additional GM users (for example a "ChatGPT" GM) are paired with `--invite … --gm`, without a vouch.
- Threat map: a leaked `gm` or `admin` code still pairs without the target's session; these are the operator-trust-root residuals. A leaked plain player code does not.
