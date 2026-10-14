# 68 — Add server-mode pairing confirmation

**Repo:** .
**Depends on:** 74, 67
**Status:** MVP B wave 3, after 67 (both edit gateway/src/link/server.ts and module/src/link/client.ts). The friend-test milestone follows it. Split from 36; does not depend on 18. Rewritten 2026-10-14 in the MVP B re-plan; Andrew approved the bootstrap rule (decision c) the same day. It no longer depends on 38: a confirmed GM client is the trusted observer, and headless agents (37, 38) come later.
**Owns:**
- gateway/src/link/** (pairing confirmation and replacement rules only; `grants.ts` is 67's and stays untouched)
- gateway/test/link/pairing-confirm*.test.ts (new)
- gateway/src/store/migrations/011-pairing-verified-role.ts (new)
- gateway/src/store/migrations/index.ts (insertion only: one import and one array entry)
- gateway/src/store/store.ts (insertions only: the `verifiedRole` field on `PairingRow`, its parameter on `createPairing`, and the get and set methods for it)
- gateway/test/store/verified-role.test.ts (new)
- gateway/src/bin/cli.ts (the one-shot `--promote-observer` command only)
- gateway/test/bin/promote-observer.test.ts (new)
- protocol/src/link/messages.ts (insertions only)
- protocol/src/link/errors.ts (insertion only: `PAIRING_REJECTED`)
- module/src/link/client.ts (pairing-confirmation messages only)
- module/src/apps/pairing/** (confirmation prompt only)
- templates/pairing/** (confirmation prompt only)
- module/test/link/pairing-confirm.test.ts (new)
- module/src/main.ts (insert the pairing-confirmation install call only, if the design needs one)
- lang/en.json (insertions under `AGENT_GATEWAY.PairingConfirm.*` only)

## Goal
In server mode (one gateway, many players), stop a player from pairing or connecting as someone else. A first pairing takes effect only once the claimed user's own Foundry client confirms it through a trusted observer. A new pairing for a user who already has one never silently replaces it. This is the impersonation defence the friend test on the VPS (42) needs.

## Context
- docs/plan/tasks/36-consent-and-revocation.md: the original contract. Its server-mode Acceptance items are the source of this task.
- docs/spikes/foundry-socket-identity.md:
  - :1-12 sender ids are attested by Foundry's server, and every proof needs a trusted observer: a paired GM link or a headless agent;
  - :107-111 option (c), a one-time code shown only in the claimed user's client;
  - :113-118 the recommendation: (a) with `User#query`, and (c) for explicit confirmation. Identity comes only from server-set arguments. With no trusted observer the claim stays pending.
- docs/plan/tasks/74-remote-exposure-foundation.md: `config.serverMode` (decision a), per-client keys (decision e), the pairing code only in the operator log when `--public-url` is set (decision d).
- gateway/src/link/server.ts (main at 1a54559):
  - :349-442 `handshake`;
  - :374-391 the pairing-code branch: `codes.consume` (:377), then `store.createPairing` (:383-390) **before** anything else, so the row is active at once;
  - :392-412 the token branch, which since 70 refuses a token from a different origin (:408);
  - :413-425 the `LinkConnection` and `registry.add` (:425);
  - :433-440 `welcome` with the new token.
- gateway/src/link/registry.ts:116-127 `add`: a new connection for the same (world, user) silently replaces and closes the old one (last writer wins).
- gateway/src/app.ts:504-509 `knownIdentities` comes from `store.listActivePairings()`. Follow mode (71) binds and re-binds from it (gateway/src/routing/binding.ts:195-224, :226-236). An active row for an unconfirmed claim would let a follow-mode session bind to it.
- gateway/test/routing/isolation.test.ts (11): the isolation guarantees that must keep passing.
- The role on a link connection is self-claimed. protocol/src/link/messages.ts:22-27 has `hello.user.isGM`, set by the module. gateway/src/link/server.ts:423 copies it into `LinkConnection.info` (`{ userName, isGM: hello.user.isGM }`), and gateway/src/link/registry.ts:41-42 says that field is "display and tool-list hints only, never authority". The token branch (:392-412) checks world, user and origin, never role. A paired player can reconnect with `isGM: true`. That is harmless for tools, because the module enforces real permissions as `game.user`, but it must never make the player an observer.
- gateway/src/store/store.ts:7-18 `PairingRow`, :20-27 `NewPairing`; gateway/src/store/migrations/index.ts:15 the positional array (74 decision h).
- gateway/src/bin/cli.ts:60-111: the read-only schema check and the one-shot `--http-rotate-token` write, the pattern for `--promote-observer`.
- Andrew, 2026-10-14: with `--public-url`, pairing codes go only to the operator's log and console. In server mode with a public URL, holding a code already means the operator handed it out.

## Decisions
Decision (c) was approved by Andrew on 2026-10-14. The others are defaults: follow them unless the PR shows a reason not to, and state the reason in the PR.
- (a) **Pending before the row.** In server mode, a valid code plus `hello` puts the socket into a pending claim, held in memory. `store.createPairing` (:383-390), the token and `registry.add` (:425) all run only on confirmation. A pending claim has no pairing row, so it is absent from `listActivePairings`, `knownIdentities` and follow mode, and it needs no filter there. The code is spent when the claim is made. Pending claims are capped: 16 in total and 2 per client key (74), both named constants. A claim over the cap is refused with `RATE_LIMITED`.
- (b0) **Observer eligibility comes from a gateway record, never from `hello`.** Migration **011** (`011-pairing-verified-role.ts`) adds `pairings.verified_role TEXT` (NULL by default). 68 lands before 38, so 68 takes 011 and 38 moves to 012 (see 74 decision h).
  - A connection is observer-eligible only if its pairing row has `verified_role = 'gm'`, **and** its current `hello.user.isGM` is true, so a GM demoted in Foundry stops being one. A `hello` never sets or raises `verified_role`, and a reconnect never changes it.
  - `verified_role = 'gm'` is set in three ways only:
    1. the bootstrap rule (c), operator-logged;
    2. a confirmation by an already-verified GM observer, where the observer reports the claimed user's role as read from its own client's `game.users`, never from the claimant;
    3. the operator one-shot `foundry-agent-gateway --promote-observer <world id> <user id>`. Like `--http-rotate-token` (cli.ts:60-111), it checks the schema read-only, writes only `verified_role` on that user's active pairings, prints what changed, and refuses when there is no such pairing.
  - Every other pairing has `verified_role` NULL. Provisioned (headless) pairings are written with `'headless'`, which is never eligible.
  - `hello.user.isGM` keeps its current meaning: it selects the tool tier only, and the module enforces real permissions.
- (b) **The observer.** A trusted observer is an open link that is observer-eligible under (b0) and is in the same world. It runs the check with `User#query` where available (spike recommendation (a)), else the socket and code form (option (c)). In either form it reads the replying user only from the server-set argument. The claimed user's own client shows the confirmation prompt. The observer reports the outcome to the gateway over its own link. The gateway accepts the report only from a connection that is observer-eligible under (b0) for that world.
- (c) **Bootstrap. Approved by Andrew, 2026-10-14.** A world with no active pairing at all has no observer. In server mode, the first GM pairing for a world with no active pairing is accepted without an observer, and written with `verified_role = 'gm'`. The operator log gets a line that names the world, the user and the origin. This leans on Andrew's 2026-10-14 decision that codes go only to the operator's log when `--public-url` is set. Any other claim with no observer online stays pending and times out; it is never approved by default. Rejected alternatives: always requiring a headless observer (it would block the friend test until 37 and 38), and an operator CLI approval.
- (d) **Replacement.** A new pairing-code claim for a (world, user) that already has an active pairing is held pending. The origin does not matter, because since 70 a token from a different origin is refused outright (:408), so the only way in is a new code. The existing connection keeps working. The new one replaces it only after confirmation in that user's own connected client, or approval by a GM in a prompt in the GM's client. On denial, or after a timeout of 10 min (named constant), the pending socket is closed with a `PAIRING_REJECTED` error frame.
- (e) **Reconnect.** A reconnect with the same stored token from its own origin still replaces the old connection without prompting, in both modes.
- (f) **Provisioned codes bypass confirmation (68 owns the check; 37 owns minting and use).**
  - 68 changes the code lookup to return the code's kind: `{ kind: 'human' } | { kind: 'provisioned'; worldId; userId; origin } | undefined`. Until 37 lands, `PairingCodes` only returns `human`.
  - In the handshake, in both modes, a `provisioned` code is checked before any pending logic. The `hello` world id, user id and the connection's canonical origin must all equal the code's target. On a match the pairing is accepted at once, with no pending claim and no observer, and written with `verified_role = 'headless'`. On any mismatch the code is spent and the socket is refused with `PAIRING_INVALID`; it is never left pending.
  - The rationale: the gateway minted the code in-process for its own configured agent, so there is no claim to confirm.
  - 68 tests this branch with a stub codes object that returns a `provisioned` result.

## Acceptance
- [ ] Every rule below applies only with `config.serverMode` (74). Without it, the existing link and routing tests pass unchanged.
- [ ] First pairing: a FakeModule presenting a valid code and the GM's user id, with a confirmed GM observer online who does not confirm, is never listed in `registry.list()`. `store.listActivePairings()` has no row for it, and a follow-mode session never binds to it. A session bound to the GM with `--user` still gets `WORLD_OFFLINE`. The pending socket receives no `call` or `event` frame.
- [ ] Confirmation: when the claimed user's client confirms through the observer, the row is created, the socket gets `welcome` with a token, and `registry` lists it (test).
- [ ] A confirmation report from a non-GM connection, or from a GM connection in another world, is ignored. The claim stays pending (test).
- [ ] Forged role: a player's pairing (`verified_role` NULL) reconnects with its valid token and `hello.user.isGM: true`. Its confirmation report for another user's pending claim is ignored, the claim stays pending and then closes with `PAIRING_REJECTED`, and the player's row still has `verified_role` NULL afterwards (test).
- [ ] A verified GM (`verified_role = 'gm'`, `hello.user.isGM: true`) can confirm a claim. The same GM reconnecting with `isGM: false` cannot (test).
- [ ] No reconnect, with any `hello`, changes `verified_role` (test over NULL, `'gm'` and `'headless'` rows).
- [ ] A GM claim confirmed by a verified GM observer, whose report says the user is a GM in the observer's `game.users`, is written with `verified_role = 'gm'`. A claim confirmed for a player is written with NULL (test).
- [ ] `--promote-observer w1 u1` sets `verified_role = 'gm'` on u1's active pairings in w1. It exits 1 when there is none, and exits 1 on a db behind the schema without migrating it (gateway/test/bin/promote-observer.test.ts).
- [ ] Migration `011-pairing-verified-role.ts` is the 11th entry of `MIGRATIONS`, after 35's 010. Existing rows read back as NULL (gateway/test/store/verified-role.test.ts).
- [ ] Provisioned codes, using the stub: a `provisioned` code whose world, user and origin match is accepted at once in server mode with no observer online, and the row has `verified_role = 'headless'` and is never observer-eligible. A mismatch in world, in user or in origin is refused with `PAIRING_INVALID` and creates no pending claim (three tests). A human code in server mode still goes to pending (test).
- [ ] No observer: a claim for a non-GM user in a world with no confirmed GM link stays pending and closes with `PAIRING_REJECTED` after the timeout (injectable clock). It is never approved.
- [ ] Bootstrap, per decision (c) (approved by Andrew, 2026-10-14): the first GM pairing in a world with no active pairing is accepted, and the operator log has the bootstrap line. A second GM claim for the same world is pending.
- [ ] Replacement tests:
  - an existing pairing from origin A, then a new code claim from origin B for the same (world, user);
  - the same from origin A (another browser on the same origin).

  For each, cover approve, deny and timeout. Each asserts that the original connection and its pending calls are untouched until approval, and that on denial or timeout the claimant gets `PAIRING_REJECTED`.
- [ ] A token reconnect from the pairing's own origin replaces the old connection without prompting in both modes (the tests in `gateway/test/routing/**` pass unchanged).
- [ ] Pending caps: a 17th pending claim overall, or a 3rd from one client key, is refused with `RATE_LIMITED` (tests).
- [ ] The confirmation prompt names the world, the user and when the pairing was requested, and has Confirm and Reject buttons. It never shows a pairing code. `module/test/link/pairing-confirm.test.ts` covers both buttons.
- [ ] Local mode keeps the current behaviour. Its trust assumption is a code comment at the pairing branch in `gateway/src/link/server.ts`: "anyone who can reach the link port and holds a valid code can claim any user id; local mode assumes the gateway is reachable only from the owner's machine".
- [ ] Manual check on foundry.local v14 in server mode (through 42's Compose stack if it has landed), with the GM and Player test users. The Player client pairing while claiming the GM's user id is never connected, and a GM re-pair from a second browser needs confirmation. The PR includes the output.
- [ ] `npm run verify` passes.

## Out of scope
- The agents app and GM revocation of other users' tokens (18 and the rest of 36).
- OAuth consent and grants (67).
- Minting provisioned codes and the headless runner (37). 68 adds only the kind-aware lookup and the bypass check.
- Headless agents as observers; provisioned pairings are never eligible.
- Session routing and isolation tests in `gateway/test/routing/**` (11, 20).
- `docs/security.md` (43) and `docs/server-mode.md` (42).
