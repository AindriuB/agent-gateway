# 68 — Add operator invites for server mode

**Repo:** .
**Depends on:** 35, 74, 67 (67 only for merge order: both edit gateway/src/link/server.ts)
**Status:** MVP B wave 3, after 67. The two now share only gateway/src/link/server.ts (67 inserts message routing in the post-handshake switch; 68 changes the handshake), so they are serialized. The friend-test milestone follows it. Rewritten 2026-10-14: Andrew chose operator invites (Model I) over the observer design after a threat review. The filename is kept for history; the observer, bootstrap, role-sync and prompt design of earlier drafts is withdrawn.
**Owns:**
- gateway/src/link/server.ts (the server-mode invite branch of the handshake, the open-socket guard, the revocation sweep, and the hello field caps' effects only)
- gateway/src/link/invites.ts (new: invite codes, hashing, the transactional redeem)
- gateway/src/link/revocation.ts (new: the sweep that closes revoked live connections)
- gateway/src/link/pairing-codes.ts (switching the shared code off in server mode only)
- gateway/src/link/code-attempts.ts (counting failed invites with the existing buckets only, if needed)
- gateway/test/link/invites*.test.ts and gateway/test/link/revocation*.test.ts (new)
- gateway/src/store/migrations/011-invites.ts (new)
- gateway/src/store/migrations/index.ts (insertion only: one import and one array entry)
- gateway/src/store/store.ts (insertions only: the invite repository and `revokePairingsFor(worldId, userId)`; 35 already passes the revoked row to `onPairingRevoked` listeners)
- gateway/test/store/invites.test.ts (new)
- gateway/src/bin/cli.ts (the one-shot `--invite`, `--revoke-pairing`, `--cancel-invite`, `--list-invites` and `--list-pairings` commands only)
- gateway/test/bin/invite-cli.test.ts (new)
- gateway/src/app.ts (start and stop the revocation sweep with the primary only)
- protocol/src/link/messages.ts (allowed edit to existing lines: length caps on `HelloMessage` `world.id`, `user.id`, `user.name` and `auth.code`; no other change)
- protocol/test/link/hello-caps.test.ts (new)
- module/src/apps/pairing/** and templates/pairing/** (the "Copy my ids" line only)
- module/test/apps/pairing-ids.test.ts (new)
- lang/en.json (insertions under `AGENT_GATEWAY.Pairing.CopyIds.*` only)

## Goal
In server mode (one gateway, many players on the internet), only the operator decides who may pair as whom. The operator runs `--invite <world> <user>`, which prints a single-use code bound to exactly that Foundry world and user, and gives it to that person. The link accepts a code in server mode only if it is a live invite whose target matches the `hello` exactly. Re-pairing needs a new invite, which revokes the old pairing. Revocation is an operator command that closes a live connection. Local mode is unchanged.

## Context
- **Andrew, 2026-10-14:** server-mode pairing uses operator invites (Model I). The threat review found that the observer design's trust root was the claimant's own `hello`:
  - T1: the bootstrap rule trusted a forgeable `isGM`, so any code holder could become the root GM;
  - T3: world ids are self-asserted;
  - T4: the confirmation protocol was never specified;
  - and T7-T15 and T21 (see the threat map in WAVES.md).
- gateway/src/link/server.ts (main at 1a54559):
  - :349-442 `handshake`;
  - :374-391 the pairing-code branch: `codes.consume` (:377), then `store.createPairing` (:383-390), with the user name from `hello` (:388);
  - :392-412 the token branch, with origin binding from 70 (:406-408);
  - :413-425 the connection and `registry.add`; :423 copies `hello.user.isGM` (a tool-tier hint only);
  - :433-440 `welcome`; :201-203 `send` drops a frame silently when the socket is not OPEN.
- gateway/src/link/pairing-codes.ts:1-40: the one shared rotating code. gateway/src/app.ts:432-441 and :497 issue it, and print it with `writeStatus` (:438).
- gateway/src/store/store.ts:
  - :29-48 the `Store` interface; :34 `onPairingRevoked(listener: () => void)`;
  - :105-110 the listener set; :126-130 `revokePairing` fires listeners with no arguments;
  - :74-80 `openStore` (WAL from 74).

  The listeners today are gateway/src/events/buffer.ts:60 and gateway/src/offline-queue/service.ts:46.
- gateway/src/bin/cli.ts:60-111: the read-only schema check and the one-shot `--http-rotate-token` write, the pattern for every new command.
- gateway/src/routing/sanitize.ts:3-16 `safeText`: strips C0 and C1 controls (ESC included) and caps output at 80 characters.
- protocol/src/link/messages.ts:11-38 `HelloMessage`: `world.id`, `user.id`, `user.name` and `auth.code` are unbounded `z.string()` today.
- module/src/apps/pairing/index.ts:84-104 reads the code field and calls `getLinkClient().pair(code)`; templates/pairing/pairing.hbs.
- docs/plan/tasks/35-gateway-oauth.md: `store.revokePairing` revokes that (world, user)'s OAuth grants through `onPairingRevoked`.
- docs/plan/tasks/74-remote-exposure-foundation.md: per-client buckets (decision e), `config.serverMode` (decision a), migration numbers (decision h).

## Decisions
- (a) **Model I, chosen by Andrew on 2026-10-14.** The earlier approval of bootstrap rule (c) (2026-10-14) is **withdrawn** because of T1. These are removed, not deferred:
  - pending claims;
  - observers;
  - `verified_role`;
  - role sync and the roster;
  - `--promote-observer` and `--demote-observer`;
  - the bootstrap rule;
  - confirmation prompts.

  GM-attested self-onboarding (Model O) is deferred to a possible future task, which is not created here.
- (b) **Invites.**
  - `foundry-agent-gateway --invite <world id> <user id> [--ttl <duration>] [--origin <origin>]` is a one-shot command, like `--http-rotate-token`. It checks the schema read-only, then writes one row and prints the code once on stdout. The code is never logged and never stored.
  - The code is 12 characters from the pairing alphabet, in three groups of four (`INVITE_CODE_PATTERN`, about 59 bits).
  - The TTL defaults to 24 h (`INVITE_TTL_MS`), and `--ttl` accepts `30m`, `12h` or `7d`, up to 7 days.
  - `--origin`, when given, pins the browser origin. Otherwise the first origin that redeems the invite wins, as in 70.
  - Migration **011** (`011-invites.ts`) adds an `invites` table: id, code_hash (UNIQUE, sha256), world_id, user_id, origin or NULL, created_at, expires_at, used_at, cancelled_at, result (`paired`, `mismatch`, `expired` or `cancelled`), pairing_id. The redeem check refuses any invite with `used_at` or `cancelled_at` set. 68 lands before 38, so 68 takes 011 and 38 keeps 012 (74 decision h).
- (c) **Redeeming in server mode.** The shared rotating code is off: `PairingCodes` issues nothing, no `Pairing code:` line is printed, and the 74 pairing hint is absent. In the handshake, a `pairingCode` hello is checked as an invite:
  1. If the socket is not OPEN, stop: nothing is read or written, and the invite is not consumed.
  2. In one `BEGIN IMMEDIATE` transaction:
     - look up the invite by code hash;
     - refuse it when unknown, used or expired;
     - mark it used;
     - compare `hello.world.id` and `hello.user.id` with the target exactly, and the origin when pinned;
     - on a mismatch, commit the invite as spent (`result = 'mismatch'`) and refuse with `PAIRING_INVALID`;
     - on a match, revoke any active pairing for the target (decision d), and `createPairing` with the connection's origin and a sanitized name (decision f).
  3. In the same synchronous tick, `registry.add` and send `welcome` with the token.

  Everything is synchronous (`node:sqlite`), so two sockets presenting one invite cannot both win. Every refusal counts in 74's per-client and global failed-code buckets. The refusal message to the peer is the same for unknown, used, expired and mismatched invites.
- (d) **Re-pairing and replacement.** A lost token or a new device needs a new invite. Redeeming an invite for a (world, user) that already has an active pairing revokes the old rows in the same transaction. The old token then gets `PAIRING_INVALID`, its live connection is closed (decision e), and `onPairingRevoked` fires with each revoked row, so 35's listener revokes that (world, user)'s OAuth grants and tokens.
- (e) **Revocation.**
  - `foundry-agent-gateway --revoke-pairing <world id> <user id>` is a one-shot that calls `store.revokePairingsFor(world, user)`. That sets `revoked_at` on the active rows, and fires `onPairingRevoked` in the CLI process, so the grants are revoked at once in the database. In the same transaction it **cancels every unused database invite for that target** (sets `cancelled_at`, with `result = 'cancelled'`). A leaked or forgotten invite therefore cannot re-pair the person just removed. In-memory headless invites are not touched; 37 and 38 handle those (the live agent check and `dropAgent`).
  - `foundry-agent-gateway --cancel-invite <world id> <user id>` cancels every unused database invite for that target in one transaction and leaves pairings alone. It prints how many it cancelled, and exits 1 when there were none. Cancelling by target was chosen over cancelling by id: the operator already thinks in targets (the same arguments as `--invite` and `--revoke-pairing`), a target normally has one live invite, and nothing has to be copied from a listing. `--list-invites` still shows each invite's short row id (never the code) so the operator can tell several invites for one target apart.
  - A running gateway runs a **periodic sweep** every 5 s (`REVOCATION_SWEEP_MS`), not a per-frame check. Each sweep calls `isPairingActive` for each live connection, which is at most one indexed lookup per connection. For a revoked one it sends `reject` `PAIRING_INVALID`, closes the socket with 1008, and fires the in-process `onPairingRevoked` listeners with the row, so the events and queue state drop it.
  - A per-frame check was rejected: it would add a database read to every event frame. Five seconds of lag is acceptable because OAuth tokens are checked against the database on every request (35), so the remote side is cut off at once.
  - `--list-invites` prints the invite's row id, target, created, expiry and status (`live`, `paired`, `mismatch`, `expired` or `cancelled`). `--list-pairings` prints world, user, sanitized name, origin, created and revoked. Neither prints a code, a token or a hash.
- (f) **Names and caps (F8).**
  - `HelloMessage` caps `world.id` and `user.id` at 64 characters, `user.name` at 100, and `auth.code` at 64. This is an allowed edit of existing schema lines; the module never sends longer values. Over-long frames fail validation and are refused as invalid.
  - The name recorded at pairing is display-only: it goes through `safeText` and is stored at most 100 characters long. Identity is always the ids.
  - Every new log line passes untrusted text (ids, names, origins) through `safeText`.
- (g) **The pairing app's "Copy my ids" line.** It shows this browser's world id and user id (from `game.world.id` and `game.user.id`) with a copy button, so a player can send them to the operator for `--invite`. It is visible in both modes, and the strings are localized.
- (h) **Local mode is unchanged:** the shared code, its display and the 70/71 behaviour stay. Its trust assumption is a code comment at the pairing branch: "anyone who can reach the link port and holds the code can claim any user id; local mode assumes the gateway is reachable only from the owner's machine. Server mode uses operator invites instead."
- (i) **Headless (37). The local-mode part is a planner decision accepted in plan review, 2026-10-14.** 37 mints in-memory invites of the same shape (target world, user and origin; single use; 2 min), and they are redeemed by this same handshake path. 68 makes the redeem path accept an invite source that is either the database or an in-memory provider, and tests it with a stub provider. There is no separate bypass branch. Database invites are checked in server mode only. In-memory provider invites are checked in both modes, before the shared local code, so a headless agent can also start unattended in local mode.

## Acceptance
Invites:
- [ ] `--invite w1 u1` prints one code matching `INVITE_CODE_PATTERN` on stdout and nothing else secret. The `invites` row holds its sha256, the target, and an expiry 24 h ahead. `--ttl 30m` and `--ttl 7d` work, and `--ttl 8d` exits 2 (gateway/test/bin/invite-cli.test.ts).
- [ ] Server mode: an invite for (w1,u1) redeemed by a FakeModule saying hello as (w1,u1) pairs it. The row records the connection's origin, and `welcome` carries a token.
- [ ] A wrong world, a wrong user, and (with `--origin`) a wrong origin are each refused with `PAIRING_INVALID`, and the invite is spent: a second, correct attempt with the same code is also refused (three tests).
- [ ] An expired invite (injectable clock), a used invite and an unknown code are refused with the same peer message, and each counts in 74's failed-code buckets (tests).
- [ ] Concurrency: two sockets present the same invite in the same tick. Exactly one gets `welcome`, the other gets `PAIRING_INVALID`, and there is exactly one new pairing row (test).
- [ ] Open-socket guard: a socket that closes before the redeem leaves the invite unused and creates no row (test).
- [ ] Server mode issues no shared code: no `Pairing code:` line on stderr, and a code from `PairingCodes` is refused (test).

Replacement and revocation:
- [ ] Replacement: (w1,u1) is paired and connected. A new invite for (w1,u1) is redeemed from another origin. The old row is revoked, the old connection is closed, and the old token's reconnect gets `PAIRING_INVALID`. An OAuth grant and token for (w1,u1) (seeded through 35's repository) are revoked, and that access token gets 401 (test).
- [ ] `--revoke-pairing w1 u1` against a running gateway: the live connection for (w1,u1) receives `reject` `PAIRING_INVALID` and is closed within `REVOCATION_SWEEP_MS` plus 1 s, its grants are revoked, and its token cannot reconnect (test with a short sweep interval).
- [ ] An unused invite for (w1,u1), issued before `--revoke-pairing w1 u1`, is refused afterwards with `PAIRING_INVALID`, and its row shows `cancelled` (test).
- [ ] An unused invite for (w1,u1) is refused after `--cancel-invite w1 u1`. The (w1,u1) pairing, if any, stays active, and an unused invite for (w1,u2) still pairs (test).
- [ ] `--cancel-invite` with no unused invite for the target exits 1 and changes nothing (test).
- [ ] `--list-invites` shows `cancelled` for both cases above, plus each invite's row id (test).
- [ ] `--list-invites` and `--list-pairings` print no code, token or hash. The test greps their output for the issued code and for every `code_hash` and `token_hash`.

Safety:
- [ ] The invite code never appears in the gateway's stderr, in any MCP result or notice, or in `/status`. The test captures all of them during an invite flow and searches for the code.
- [ ] `HelloMessage` refuses a `world.id` or `user.id` of 65 characters, a `user.name` of 101, and an `auth.code` of 65 (protocol/test/link/hello-caps.test.ts). A name containing `\x1b[31m` and a newline is stored and logged without control characters (test).
- [ ] Every new log line in this diff goes through `safeText` (reviewer checks the diff; one test with an ANSI user id in a refused hello asserts there is no ESC byte on stderr).

Local mode and headless seam:
- [ ] Without `--server-mode`, the existing link, pairing and routing tests pass unchanged, and a database invite code is not accepted (local mode uses the shared code, plus in-memory provider invites, decision i).
- [ ] A stub in-memory invite provider with target (w1,agent,origin O) pairs a matching hello in server mode, and a hello for another user or origin is refused and spends it (test of the decision (i) seam).

Module:
- [ ] The pairing app shows the world id and user id with a copy button. `module/test/apps/pairing-ids.test.ts` asserts the text and the copied value, and the strings are under `AGENT_GATEWAY.Pairing.CopyIds.*`.

Overall:
- [ ] Manual check on foundry.local v14 in server mode, through 42's Compose stack if it has landed, with the GM and Player test users:
  - the operator invites each user, and each pairs;
  - the Player redeeming the GM's invite while logged in as Player is refused, and the invite is spent;
  - `--revoke-pairing` disconnects the Player.

  The PR includes the output.
- [ ] `npm run verify` passes.

## Out of scope
- Model O (GM-attested self-onboarding): a possible future task, not created here.
- The headless runner and minting its invites (37).
- OAuth consent and the grants UI (67); 35 owns the grant revocation listener.
- Changing local-mode pairing.
- docs/security.md (43) and docs/server-mode.md (42).

## History
- 2026-10-13: split from 36 as server-mode pairing confirmation (observer design).
- 2026-10-14: rewritten as operator invites (Model I, Andrew). The bootstrap rule's approval was withdrawn (T1), and observers, `verified_role`, role sync and prompts were removed.
