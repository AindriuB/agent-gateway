# 68 — Add operator invites for server mode

**Repo:** .
**Depends on:** 35, 74, 67 (all merged at c64dd18)
**Status:** MVP B wave 3, after 67 and before 75. The friend-test milestone follows it. Rewritten 2026-10-14: Andrew chose operator invites (Model I) over the observer design after a threat review. The filename is kept for history; the observer, bootstrap, role-sync and prompt design of earlier drafts is withdrawn. Refreshed against main c64dd18 (after 35 and 67): line references re-checked, and 35's two review notes and 67's consent-code binding carried in as decisions (j), (k) and (l).
**Overlap with 75:** 75 (docs/plan/tasks/75-consent-page-footer.md) also edits gateway/src/bin/cli.ts (two `parseArgs` options, two `loadConfig` flags, two `USAGE` entries) and gateway/src/app.ts (two values forwarded into `new OAuthServer({...})`, :591 today). 68 runs first and 75 rebases on it. Keep 68's edits localised so that rebase stays trivial: put the new commands in their own functions (or a new module) called from one dispatch block next to the `--http-rotate-token` and `--backup` branches (cli.ts:212-225), add the new `parseArgs` options and `USAGE` lines as one group rather than interleaving them, and do not touch the `startHttp` / `OAuthServer` block in app.ts (:587-597).
**Owns:**
- gateway/src/link/server.ts (the handshake (:420-518), the server-mode invite branch, the open-socket guard, the revocation sweep, the hello field caps' effects, insertions to `LinkServerOptions` (:52-91) for `serverMode` and the invite source, and the `CodeAttempts` setup (:125-136) so that server mode always uses the per-client and global buckets, decision (c). 67's post-handshake routing (:401-409) is not 68's and stays as it is)
- gateway/src/link/invites.ts (new: invite codes, hashing, the transactional redeem)
- gateway/src/link/revocation.ts (new: the sweep that closes revoked live connections)
- gateway/src/link/pairing-codes.ts (switching the shared code off in server mode only)
- gateway/src/link/code-attempts.ts (counting failed invites with the existing buckets only, if needed)
- gateway/test/link/invites*.test.ts and gateway/test/link/revocation*.test.ts (new)
- gateway/src/store/migrations/011-invites.ts (new)
- gateway/src/store/migrations/index.ts (insertion only: one import and one array entry)
- gateway/src/store/store.ts (insertions: the invite repository, `revokePairingsFor(worldId, userId)`, and a way for the sweep to fire the in-memory `onPairingRevoked` listeners for an already-revoked row. Allowed edits to existing lines, decision (j): remove 35's built-in oauth listener (:116-121) and move its `oauth.revokeGrantsFor` call into `revokePairing`'s transaction; make `revokePairing` (:146-153) one `BEGIN IMMEDIATE` transaction that revokes the row and its grants together, with the in-memory listeners fired after `COMMIT` and isolated from each other; update the `onPairingRevoked` doc comment (:36) to say listeners are in-memory effects that run after commit)
- gateway/test/store/invites.test.ts and gateway/test/store/revoke-listeners.test.ts (new)
- gateway/src/bin/cli.ts (the one-shot `--invite`, `--revoke-pairing`, `--cancel-invite`, `--list-invites` and `--list-pairings` commands only, plus what they need from `parseArgs`; see "Overlap with 75")
- gateway/test/bin/invite-cli.test.ts (new)
- gateway/src/app.ts (start and stop the revocation sweep with the primary, and the server-mode switch-off of the shared code, its log lines and its hint only; see "Overlap with 75")
- protocol/src/link/messages.ts (allowed edit to existing lines: length caps on `HelloMessage` `world.id`, `user.id`, `user.name` and `auth.code`; no other change)
- protocol/test/link/hello-caps.test.ts (new)
- module/src/apps/pairing/** and templates/pairing/** (the "Copy my ids" line only)
- module/test/apps/pairing-ids.test.ts (new)
- lang/en.json (insertions under `AGENT_GATEWAY.Pairing.CopyIds.*` only)
- gateway/test/http/app.test.ts, gateway/test/store/retire-legacy-pairings.test.ts and gateway/test/store/store.test.ts (migration-count and slice-index assertions forced by migration 011 only; standing rule, Andrew 2026-10-14, the same rule 35 used for 010. Today these are store.test.ts:146 `toHaveLength(10)`, store.test.ts:170 and retire-legacy-pairings.test.ts:47 `user_version: 10`)

## Goal
In server mode (one gateway, many players on the internet), only the operator decides who may pair as whom. The operator runs `--invite <world> <user>`, which prints a single-use code bound to exactly that Foundry world and user, and gives it to that person. The link accepts a code in server mode only if it is a live invite whose target matches the `hello` exactly. Re-pairing needs a new invite, which revokes the old pairing. Revocation is an operator command that closes a live connection. Local mode is unchanged.

## Context
- **Andrew, 2026-10-14:** server-mode pairing uses operator invites (Model I). The threat review found that the observer design's trust root was the claimant's own `hello`:
  - T1: the bootstrap rule trusted a forgeable `isGM`, so any code holder could become the root GM;
  - T3: world ids are self-asserted;
  - T4: the confirmation protocol was never specified;
  - and T7-T15 and T21 (see the threat map in WAVES.md).
- gateway/src/link/server.ts (main at c64dd18):
  - :52-91 `LinkServerOptions`. It has no `serverMode` field today; `isPublic` (:122, :127) comes from `publicUrl` only. 68 adds the server-mode switch.
  - :125-136 the `CodeAttempts` buckets: per-client and public global limits only when `publicUrl` is set, the default single bucket otherwise.
  - :263-265 `send` drops a frame silently when the socket is not OPEN; :266-269 `reject`.
  - :401-409 67's `listGrants` / `revokeGrant` routing, which closes a connection that is no longer the registry's current one for its (world, user).
  - :420-518 `handshake`;
  - :446-466 the pairing-code branch: the rate-limit check (:448), `codes.consume` (:450), then `store.createPairing` (:456-463), with the user name from `hello` (:461 and :464), then `onCodePaired` (:465);
  - :466-485 the token branch, with origin binding from 70 (:480-482);
  - :486-499 the connection and `registry.add`; :497 copies `hello.user.isGM` (a tool-tier hint only);
  - :507-515 `welcome`.
- gateway/src/link/registry.ts:116-124 `add` closes a stale duplicate connection for the same (world, user).
- gateway/src/link/pairing-codes.ts:34-114 `PairingCodes`, the one shared rotating code.
- gateway/src/app.ts (the shared code in `startPrimary`, from :433):
  - :446-449 `linesFor`, which prints `Pairing code:` (:447) through `writeStatus`;
  - :463-473 the `PairingCodes` instance; :494-496 `onCodePaired` re-issues a code in public mode; :497-515 `onOriginRejected`, which re-issues on a refused token (:499) and adds code hints to the refusal line (:503-511);
  - :537 `thisCodes.issue('startup')`; :552-559 74's `pairingHint`, replaced by `askOperator` in public mode;
  - :199-221 `stop()` and :319-337 `teardown()`, where `codes?.stop()` runs (:204, :322); the sweep must stop in both;
  - :530-535 the store, `EventBuffer` and `OfflineQueue` are created after `link.listen()`.
- gateway/src/store/store.ts:
  - :31-51 the `Store` interface; :35 `isPairingActive`; :36-37 `onPairingRevoked(listener: (pairing: PairingRow) => void)` (35 passes the revoked row);
  - :77-97 `openStore`: `busy_timeout = 5000` (:85) and WAL from 74 (:86-92);
  - :99 the listener set; :116-121 35's built-in listener, which calls `oauth.revokeGrantsFor(worldId, userId)` in whichever process revokes. 68 moves this call into the revoke transaction (decision j), so the set holds only in-memory listeners;
  - :146-153 `revokePairing` runs its `UPDATE` with no transaction, then fires the listeners in a plain `for` loop, so a throwing listener skips the rest (decision j).

  The in-memory listeners are gateway/src/events/buffer.ts:60 and gateway/src/offline-queue/service.ts:46. 35's tests that must still pass unchanged: gateway/test/http/oauth-binding.test.ts:96-124 (`revokePairing` revokes that (world, user)'s grants and tokens and no others; listeners receive the revoked row), gateway/test/oauth/atomicity.test.ts:91-126, gateway/test/oauth/grants/grants.test.ts:84 and gateway/test/oauth/consent/consent.test.ts:188-257.
- gateway/src/oauth/repository.ts:190-204 35's `tx`: a `SAVEPOINT oauth_tx` that nests in a caller's transaction. Outside one it starts a deferred transaction (decision k). OAuth access tokens are not re-checked against the pairing: grants die only through `revokeGrantsFor`, which revokes by (world, user), not by pairing. So it runs inside the pairing revoke's transaction, never as a listener (decision j), and never from the sweep (decision e).
- gateway/src/oauth/consent/index.ts:257-263 67's `deliver` binds the pending consent to the pairing of the connection that receives the code (`conn.agentId`), and :290-292 refuses the code unless `repo.pairingActive(pairingId)` (repository.ts:235-236, :315). gateway/test/oauth/consent/rig.ts is the rig for driving a consent flow in a test (read it, do not edit it).
- gateway/src/bin/cli.ts:
  - :72-87 `schemaProblem`, the read-only schema check; :143-172 `rotate`, the one-shot write pattern every new command follows; :89-141 `backup`;
  - :174-203 `parseArgs` with `strict: true` and no `allowPositionals`, so `<world id> <user id>` positionals are refused today;
  - :212-225 the one-shot dispatch, before `loadConfig`.
- gateway/src/routing/sanitize.ts:10-16 `safeText`: replaces C0 and C1 controls (ESC included) with U+FFFD and caps output at 80 characters.
- protocol/src/link/messages.ts:11-38 `HelloMessage`: `world.id`, `user.id`, `user.name` and `auth.code` are unbounded `z.string()` today.
- module/src/apps/pairing/index.ts:80-103 `onSubmit` reads the code field (:83) and calls `getLinkClient().pair(code)` (:88-89); templates/pairing/pairing.hbs.
- gateway/src/store/migrations/index.ts:1-27: ten migrations, so 011 is the next free number (PLAN.md: 011 is 68's, 012 is 38's).
- docs/plan/done/35-gateway-oauth.md, docs/plan/done/67-oauth-consent-and-grants.md, and docs/plan/done/74-remote-exposure-foundation.md (per-client buckets, decision e; `config.serverMode`, decision a; migration numbers, decision h).

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
- (c) **Redeeming in server mode.** The shared rotating code is off: `PairingCodes` issues nothing (including the re-issues on `onCodePaired` and on a refused token, app.ts:494-499), no `Pairing code:` line is printed, the refusal line carries no code hint, and the 74 pairing hint is absent. In the handshake, a `pairingCode` hello is checked as an invite:
  1. If the socket is not OPEN, stop: nothing is read or written, and the invite is not consumed.
  2. In one `BEGIN IMMEDIATE` transaction:
     - look up the invite by code hash;
     - refuse it when unknown, used or expired;
     - mark it used;
     - compare `hello.world.id` and `hello.user.id` with the target exactly, and the origin when pinned;
     - on a mismatch, commit the invite as spent (`result = 'mismatch'`) and refuse with `PAIRING_INVALID`;
     - on a match, revoke any active pairing for the target (decision d), and `createPairing` with the connection's origin and a sanitized name (decision f).
  3. In the same synchronous tick, `registry.add` and send `welcome` with the token.

  Everything is synchronous (`node:sqlite`), so two sockets presenting one invite cannot both win. Every refusal counts in 74's failed-code buckets. **Andrew, 2026-10-14:** in server mode these are always the per-client and global buckets (`MAX_FAILED_CODE_ATTEMPTS_PER_CLIENT` and `MAX_FAILED_CODE_ATTEMPTS_PUBLIC`), whether or not `--public-url` is set. Today the `CodeAttempts` setup (server.ts:125-136) picks them only from `publicUrl`; 68 makes it pick them when `publicUrl` is set or server mode is on. Local mode without `--public-url` keeps the single default bucket. The refusal message to the peer is the same for unknown, used, expired and mismatched invites.
- (d) **Re-pairing and replacement.** A lost token or a new device needs a new invite. Redeeming an invite for a (world, user) that already has an active pairing revokes the old rows in the same transaction. The old token then gets `PAIRING_INVALID`, its live connection is closed (decision e; `registry.add` also closes a duplicate for the same target), and that (world, user)'s OAuth grants and tokens are revoked in the same transaction (decision j). After `COMMIT`, the in-memory `onPairingRevoked` listeners fire with each revoked row.
- (e) **Revocation.**
  - `foundry-agent-gateway --revoke-pairing <world id> <user id>` is a one-shot that calls `store.revokePairingsFor(world, user)`. That sets `revoked_at` on the active rows and revokes the target's OAuth grants and tokens, so the remote side is cut off at once in the database. In the same transaction it **cancels every unused database invite for that target** (sets `cancelled_at`, with `result = 'cancelled'`). A leaked or forgotten invite therefore cannot re-pair the person just removed. In-memory headless invites are not touched; 37 and 38 handle those (the live agent check and `dropAgent`).
  - `foundry-agent-gateway --cancel-invite <world id> <user id>` cancels every unused database invite for that target in one transaction and leaves pairings alone. It prints how many it cancelled, and exits 1 when there were none. Cancelling by target was chosen over cancelling by id: the operator already thinks in targets (the same arguments as `--invite` and `--revoke-pairing`), a target normally has one live invite, and nothing has to be copied from a listing. `--list-invites` still shows each invite's short row id (never the code) so the operator can tell several invites for one target apart.
  - A running gateway runs a **periodic sweep** every 5 s (`REVOCATION_SWEEP_MS`), not a per-frame check. Each sweep calls `isPairingActive` for each live connection, which is at most one indexed lookup per connection. For a revoked one it sends `reject` `PAIRING_INVALID`, closes the socket with 1008, and fires only the in-memory `onPairingRevoked` listeners (events, queue) with the row, so their state drops it. **Andrew, 2026-10-14:** the sweep never touches grants. Whichever process revoked the pairing already revoked its grants in the same transaction, and grants are keyed by (world, user), so a sweep that revoked them could remove a grant made after a re-pair inside the sweep window.
  - A per-frame check was rejected: it would add a database read to every event frame. Five seconds of lag is acceptable because OAuth tokens are checked against the database on every request (35), so the remote side is cut off at once.
  - `--list-invites` prints the invite's row id, target, created, expiry and status (`live`, `paired`, `mismatch`, `expired` or `cancelled`). `--list-pairings` prints world, user, sanitized name, origin, created and revoked. Neither prints a code, a token or a hash.
- (f) **Names and caps (F8).**
  - `HelloMessage` caps `world.id` and `user.id` at 64 characters, `user.name` at 100, and `auth.code` at 64. This is an allowed edit of existing schema lines; the module never sends longer values. Over-long frames fail validation and are refused as invalid.
  - The name recorded at pairing is display-only: it goes through `safeText` and is stored at most 100 characters long. Identity is always the ids.
  - Every new log line passes untrusted text (ids, names, origins) through `safeText`.
- (g) **The pairing app's "Copy my ids" line.** It shows this browser's world id and user id (from `game.world.id` and `game.user.id`) with a copy button, so a player can send them to the operator for `--invite`. It is visible in both modes, and the strings are localized.
- (h) **Local mode is unchanged:** the shared code, its display and the 70/71 behaviour stay. Its trust assumption is a code comment at the pairing branch: "anyone who can reach the link port and holds the code can claim any user id; local mode assumes the gateway is reachable only from the owner's machine. Server mode uses operator invites instead."
- (i) **Headless (37). The local-mode part is a planner decision accepted in plan review, 2026-10-14.** 37 mints in-memory invites of the same shape (target world, user and origin; single use; 2 min), and they are redeemed by this same handshake path. 68 makes the redeem path accept an invite source that is either the database or an in-memory provider, and tests it with a stub provider. There is no separate bypass branch. Database invites are checked in server mode only. In-memory provider invites are checked in both modes, before the shared local code, so a headless agent can also start unattended in local mode.
- (j) **Grant revocation is transactional; listeners are in-memory and isolated (from 35's review; Andrew, 2026-10-14).**
  - Grant revocation is not a listener. On every path that revokes a pairing (`revokePairing`, replacement in the redeem, and `--revoke-pairing` through `revokePairingsFor`), `oauth.revokeGrantsFor(worldId, userId)` runs inside the same transaction as the pairing revoke. Both happen or neither does.
  - `revokePairing` becomes one `BEGIN IMMEDIATE ... COMMIT` transaction. The redeem and `revokePairingsFor` already hold their own `BEGIN IMMEDIATE`, so they call a shared internal step that revokes the rows and the grants without opening another transaction (35's `SAVEPOINT` in `revokeGrantsFor` nests). On any error the transaction rolls back: the pairing stays active and the grants stay as they were. Then `revokePairing` throws, the redeem is refused with `INTERNAL`, and the CLI exits 1 saying nothing changed.
  - The remaining `onPairingRevoked` listeners are in-memory only (events, queue). They fire after `COMMIT`, with the revoked row. Each is isolated: it runs even if an earlier one throws, and each error is logged through the store's `warn` (one line, with the message through `safeText` and nothing from the row beyond world and user ids). A throwing listener never undoes the commit, and `revokePairing` still returns `true`.
- (k) **CLI writes take the write lock first (from 35's review).** Every write path of the new CLI commands (`--invite`, `--revoke-pairing`, `--cancel-invite`) runs inside `BEGIN IMMEDIATE ... COMMIT`. Then `busy_timeout` (store.ts:85) covers the lock wait, and the oauth `SAVEPOINT` (repository.ts:194) nests in it instead of opening a deferred transaction that can fail with `SQLITE_BUSY_SNAPSHOT` against a running gateway. On any error the command issues `ROLLBACK` and reports the original error, never one raised by the rollback. If the lock is still held after the timeout, the command exits 1 saying the database is busy and nothing changed.
- (l) **67's consent codes stay bound to the delivering pairing.** A consent code is accepted only while the pairing it was delivered over (`conn.agentId`) is active (consent/index.ts:263, :292). Replacement and revocation keep this working because they revoke the old row in the database, not only close the socket, so a code delivered over the old connection fails. After a replacement, `registry.get(world, user)` is the new connection, so new codes go to the new pairing.

## Acceptance
Invites:
- [ ] `--invite w1 u1` prints one code matching `INVITE_CODE_PATTERN` on stdout and nothing else secret. The `invites` row holds its sha256, the target, and an expiry 24 h ahead. `--ttl 30m` and `--ttl 7d` work, and `--ttl 8d` exits 2 (gateway/test/bin/invite-cli.test.ts).
- [ ] Server mode: an invite for (w1,u1) redeemed by a FakeModule saying hello as (w1,u1) pairs it. The row records the connection's origin, and `welcome` carries a token.
- [ ] A wrong world, a wrong user, and (with `--origin`) a wrong origin are each refused with `PAIRING_INVALID`, and the invite is spent: a second, correct attempt with the same code is also refused (three tests).
- [ ] An expired invite (injectable clock), a used invite and an unknown code are refused with the same peer message, and each counts in 74's failed-code buckets (tests).
- [ ] Server mode with no `--public-url`: failed invite attempts use the per-client and global buckets. With `trustProxy` on and two `X-Forwarded-For` client addresses (as gateway/test/link/public.test.ts:32 does), one client that has made `MAX_FAILED_CODE_ATTEMPTS_PER_CLIENT` failed attempts gets `RATE_LIMITED`, while the second client can still redeem a valid invite (test).
- [ ] Concurrency: two sockets present the same invite in the same tick. Exactly one gets `welcome`, the other gets `PAIRING_INVALID`, and there is exactly one new pairing row (test).
- [ ] Open-socket guard: a socket that closes before the redeem leaves the invite unused and creates no row (test).
- [ ] Server mode issues no shared code: no `Pairing code:` line on stderr (also not after a successful pairing or a refused token), no code in a refusal line, and a code from `PairingCodes` is refused (test).

Replacement and revocation:
- [ ] Replacement: (w1,u1) is paired and connected. A new invite for (w1,u1) is redeemed from another origin. The old row is revoked, the old connection is closed, and the old token's reconnect gets `PAIRING_INVALID`. An OAuth grant and token for (w1,u1) (seeded through 35's repository) are revoked, and that access token gets 401 (test).
- [ ] Consent after replacement (decision l): a consent code is delivered to (w1,u1) over the old connection, the replacement invite is redeemed, and then that code is submitted. It is refused and no grant is created. A code requested after the replacement is delivered to the new connection and is accepted (test, through gateway/test/oauth/consent/rig.ts or the same wiring).
- [ ] Consent after revocation: a consent code is delivered to (w1,u1), `--revoke-pairing w1 u1` runs, and then that code is submitted. It is refused and no grant is created (test).
- [ ] `--revoke-pairing w1 u1` against a running gateway: the live connection for (w1,u1) receives `reject` `PAIRING_INVALID` and is closed within `REVOCATION_SWEEP_MS` plus 1 s, its grants are revoked, and its token cannot reconnect (test with a short sweep interval).
- [ ] The sweep never touches grants: (w1,u1) is revoked with `--revoke-pairing`, re-paired with a new invite and given a new grant, all before the next sweep. After the sweep closes the old connection, the new grant and its token are still live (test with a long sweep interval, triggered by hand).
- [ ] An unused invite for (w1,u1), issued before `--revoke-pairing w1 u1`, is refused afterwards with `PAIRING_INVALID`, and its row shows `cancelled` (test).
- [ ] An unused invite for (w1,u1) is refused after `--cancel-invite w1 u1`. The (w1,u1) pairing, if any, stays active, and an unused invite for (w1,u2) still pairs (test).
- [ ] `--cancel-invite` with no unused invite for the target exits 1 and changes nothing (test).
- [ ] `--list-invites` shows `cancelled` for both cases above, plus each invite's row id (test).
- [ ] `--list-invites` and `--list-pairings` print no code, token or hash. The test greps their output for the issued code and for every `code_hash` and `token_hash`.

Grant revocation, listeners and locking (decisions j and k):
- [ ] A grant-revocation failure rolls back the pairing revoke: with `oauth.revokeGrantsFor` made to fail (for example by dropping `oauth_tokens`, as gateway/test/oauth/atomicity.test.ts:82-89 does), `revokePairing` throws and the pairing stays active. `--revoke-pairing w1 u1` exits 1, and the pairing and its unused invites are unchanged. A replacement redeem is refused with `INTERNAL`, the old pairing stays active, and the invite stays unused (gateway/test/store/revoke-listeners.test.ts and gateway/test/link/invites*.test.ts).
- [ ] gateway/test/store/revoke-listeners.test.ts: with three in-memory `onPairingRevoked` listeners and the first one throwing, `revokePairing` still calls the second and third with the revoked row, returns `true`, writes one warn line naming the failure, and the row stays revoked with its grants revoked (the commit is not undone). The same holds for `revokePairingsFor` and for the sweep's notification.
- [ ] store.ts registers no oauth listener: `revokedListeners` holds only listeners added through `onPairingRevoked` (reviewer checks the diff). 35's existing tests pass unchanged, including gateway/test/http/oauth-binding.test.ts:96-124 and gateway/test/oauth/atomicity.test.ts:91-126.
- [ ] Concurrent writer: while a second process or worker holds a write transaction (`BEGIN IMMEDIATE`) on the same database for about 500 ms, `--invite`, `--revoke-pairing` and `--cancel-invite` each wait and then succeed, writing the expected rows (gateway/test/bin/invite-cli.test.ts). A reviewer can see `BEGIN IMMEDIATE` around every CLI write path in the diff.

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
- [ ] The diff touches only the files in Owns. In gateway/src/app.ts it leaves the `startHttp` / `OAuthServer` block alone, and in gateway/src/link/server.ts it leaves 67's routing at :401-409 alone.
- [ ] Manual check on foundry.local v14 in server mode, through 42's Compose stack, with the GM and Player test users:
  - the operator invites each user, and each pairs;
  - the Player redeeming the GM's invite while logged in as Player is refused, and the invite is spent;
  - `--revoke-pairing` disconnects the Player.

  The PR includes the output.
- [ ] `npm run verify` passes.

## Out of scope
- Model O (GM-attested self-onboarding): a possible future task, not created here.
- The headless runner and minting its invites (37).
- OAuth consent and the grants UI (67). gateway/src/oauth/** is not 68's to edit: 68 calls 35's `revokeGrantsFor` as it is, from store.ts, and leaves its `tx` helper alone.
- Strengthening 35's listener-ordering test in gateway/test/oauth/atomicity.test.ts:91-126 (a 35 follow-up outside Owns).
- The consent-page footer, `--privacy-url` and `--source-url` (75).
- Changing local-mode pairing.
- docs/security.md (43) and docs/server-mode.md (42), and the README bullets from 42's follow-ups.

## History
- 2026-10-13: split from 36 as server-mode pairing confirmation (observer design).
- 2026-10-14: rewritten as operator invites (Model I, Andrew). The bootstrap rule's approval was withdrawn (T1), and observers, `verified_role`, role sync and prompts were removed.
- 2026-10-14: refreshed against main c64dd18 after 35 and 67. Line references re-checked; decisions (j) listener isolation and (k) CLI `BEGIN IMMEDIATE` carried in from 35's review; decision (l) and two acceptance lines for 67's consent-code binding; the overlap with 75 noted.
- 2026-10-14: Andrew's answers recorded. Grant revocation runs inside the pairing revoke's transaction on every path, and 35's oauth listener moves into `revokePairing` (j). The sweep fires only the in-memory listeners and never touches grants (e). Server mode always uses the per-client and global failed-code buckets (c).
