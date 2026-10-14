# 92 — Let an admin GM create, list and cancel player invites over its link

**Repo:** .
**Depends on:** 90
**Owns:**
- protocol/src/link/messages.ts (insertions only)
- protocol/test/link/invite-admin.test.ts (new)
- gateway/src/link/invite-admin.ts (new)
- gateway/src/link/server.ts (dispatch cases for the new messages only)
- gateway/src/link/invites.ts (redemption refusal for delegated invites only)
- gateway/src/store/store.ts (`InviteRepository` world-scoped queries only)
- gateway/test/link/invite-admin.test.ts (new)
- gateway/test/store/invites.test.ts

## Goal
An admin GM can mint, list and cancel invites for player users of its own world without the
operator. Every message is world-scoped by the connection's binding and checked against the
store's admin flag. Delegated invites are capped and rate-limited. They can never make an admin
or displace one. The vouch from 90 still applies when a delegated invite is redeemed.

## Context
- scratchpad design: `design-gm-management.md` (b)
- gateway/src/link/grants.ts:1-25 and gateway/src/link/server.ts:468-476 — the pattern to copy: the identity comes from the connection, the message names no world, and the stale-connection check runs before the handler
- gateway/src/link/invites.ts — `createInvite`, `parseTtl`, `MAX_INVITE_TTL_MS`, `INVITE_TTL_MS`
- gateway/src/store/store.ts:60-70, 221-240 — `InviteRepository` and its prepared statements
- protocol/src/link/messages.ts:178-231 — `listGrants`/`grants` request/response shape with `requestId`

## Acceptance
- [ ] New strict messages: `createInvite{requestId, userId, ttlMs?}`, `listInvites{requestId}`, `cancelInvite{requestId, inviteId}`, with replies `inviteCreated{requestId, inviteId, code, expiresAt}` and `invites{requestId, invites:[{id, userId, createdAt, expiresAt, status}]}`, and `error` with `requestId`. None of them carries a world id. A protocol test shows that an extra `worldId` key fails to parse, and a gateway test shows the socket is closed 1008 when such a message is sent.
- [ ] Each message passes the stale-connection check, then reads the sender's pairing row from the store. A row that is not active with `admin = 1` gets `FORBIDDEN` with no store change. Tests: a non-admin connection whose hello says `isGM: true` is refused for all three messages, and a connection demoted between two messages is refused on the second.
- [ ] `createInvite` creates an invite with `world_id = conn.worldId`, `admin = 0` and `created_by = <sender's pairing id>`. The code appears only in that one `inviteCreated` reply, and the store keeps only its hash. `ttlMs` defaults to `INVITE_TTL_MS` and is refused with `INVALID_ARGS` above `MAX_INVITE_TTL_MS` or at or below 0. Tested.
- [ ] `createInvite` for a `userId` that holds an active admin pairing in this world gets `FORBIDDEN`. When a delegated invite (`created_by` not NULL) is redeemed, it is refused (`PAIRING_INVALID`, invite settled `mismatch`) if the target holds an active admin pairing at that moment. Both are tested. Operator invites are unaffected.
- [ ] Caps, as named constants with tests that hit each: at most 20 unused, unexpired invites per world (`RATE_LIMITED` beyond that); at most 10 `createInvite` per connection per 10 minutes; at most 60 of all three messages per connection per minute. A refused create writes nothing.
- [ ] Cross-world isolation, tested with admin GMs in world A and world B on one gateway: B's `listInvites` never contains A's invites, and B's `cancelInvite` with A's invite id returns the same `error` as an unknown id and leaves A's invite unused.
- [ ] `listInvites` returns only `world_id = conn.worldId` rows, never a code or hash. A test seeds a known code and asserts it is absent from the serialized reply.
- [ ] `cancelInvite` cancels one unused invite in the sender's world by id and replies with the updated `invites` list.
- [ ] A delegated invite redeemed by the target still goes through 90's vouch. An integration test covers create, then redeem, then `pairingChallenge`, then attest by an admin, then welcome.
- [ ] `npm run verify` passes.

## Out of scope
- Module UI (93).
- Pairing and grant management messages (93, 94).
- The CLI (91). An all-worlds query over the link is refused by design.
- Building the one-paste `wss://…#CODE` string: the GM's module composes it from its own gateway URL in 93.
- Docs (scribe).

## Decisions (Andrew, 2026-10-14)
1. Design approved. Pairing for non-admin users is GM-vouched through a server-authored whispered ChatMessage. Admin GM status is set only by the operator CLI (`--invite … --admin`) and is never derived from `hello.isGM`. The management app lives inside Foundry for the admin GM, over its existing link, scoped to its own world. The CLI stays as the operator's break-glass. No web UI for now.
2. Grants view: yes. The admin GM sees each player's authorized apps as metadata only (client name, scopes, created date; never tokens) and can revoke them. The UI tells players that their GM can see this.
3. Verified evidence: Foundry v13 `BaseChatMessage#canCreate` lets a GM author as anyone, so GM targets cannot be proven by vouching. Admin GMs are bootstrapped by the operator only, and a delegated invite can never create one.

## Notes for the scribe
- Threat map: delegated invites, their caps, and the blast radius of a compromised admin GM, which is limited to its own world.
- docs/architecture.md "Operator invites": add delegated invites and `created_by`.

## Amendment 1 (Andrew, 2026-10-14): bound the invites table

1. The create limit is keyed by the creating pairing id (`conn.agentId`), not by the connection object, so it survives reconnects. Keep it bounded in memory: cap the number of tracked pairing keys and evict expired windows. Keep the existing 10 per 10 minutes.
2. Minimum `ttlMs` for a delegated invite is 10 minutes. A smaller value gets INVALID_ARGS.
3. Prune invite rows that are settled (paired or mismatch), cancelled, or expired, and older than 30 days, on the gateway's existing periodic sweep. Rows that are unused and unexpired are never pruned. Owns widens to the store prune query and to the minimal wiring needed to call it from the existing sweep; name the files you touch.
Reason: a compromised admin GM could loop create/cancel or 1 ms invites across reconnects and grow the table without limit. Disk growth affects every world.

## Review round 1 — findings

Reviewed HEAD: 6f03a26. Routed to the implementer:
- P2: a test for the `completeVouchedInvite` admin-target check, covering the target becoming admin between challenge and attest;
- P3: a test for the stale-connection check on the invite messages;
- the P2 on table growth, as decided in Amendment 1.

VERDICT: FIX

FINDINGS
- [P2] gateway/test/link/invite-admin.test.ts:174-218 — Nothing tests the admin-target check in `completeVouchedInvite` (gateway/src/link/invites.ts:225-228). That check is the one that matters most. A delegated invite is never `gm` or `admin`, so `redeemInvite` always returns `vouch`, and the pairing is actually written only in `completeVouchedInvite`. The race this check closes is "the target becomes admin between the challenge and the attest", and no test covers it.
  route: implementer
  input: admin GM A creates a delegated invite for user U. U redeems and gets `pairingChallenge`. The operator then pairs U as admin. A attests. With the check removed, `pairTarget` revokes U's new admin pairing and replaces it with a non-admin one, so a delegated invite displaces an admin.
  proof: replaced the `completeVouchedInvite` check with `if (false)`. All 187 tests in gateway/test/link plus test/store/invites.test.ts still passed. The matching mutation in `redeemInvite` (line 180) was killed.

- [P2] gateway/src/link/invite-admin.ts:23,113-127 — Delegated invite rows can grow without limit. The store never prunes them, and three things let an admin keep adding rows:
  1. The per-world cap counts only invites that are unused, uncancelled and unexpired.
  2. `ttlMs` accepts 1.
  3. The per-connection create window lives in a WeakMap keyed on the connection, and the token-reconnect hello path (gateway/src/link/server.ts, the `findPairingByHash` branch) has no rate limit.
  route: orchestrator — the per-connection create cap in Acceptance is met as written. Bounding total rows needs a decision the task does not make: a retention or prune policy, a per-world lifetime or row cap, a minimum ttl, or a per-pairing (not per-connection) create window. This also bears on the spec's "blast radius limited to its own world" claim, because disk growth affects the whole gateway.
  input: an admin GM loops: reconnect with its token, send 10 `createInvite{ttlMs:1}` (or create 10 and cancel 10), and repeat. Every create succeeds because expired and cancelled rows drop out of `countUnusedForWorld` and each new connection gets fresh windows. Each loop adds 10 permanent `invites` rows, with nothing bounding the loop rate except reconnect speed.

- [P3] gateway/src/link/server.ts:505-514 — No test covers the stale-connection check on the three invite messages.
  route: implementer
  input: removing the `break` after `ws.close(1008, 'stale invite connection')`, so a replaced connection's request still reaches the handler, is not detected.
  proof: that mutation survived; 187 tests passed. The damage is limited because `senderIsAdmin` re-reads the store row, so this is P3.

- [NOTE] gateway/src/link/invite-admin.ts:88-91 — The FORBIDDEN check runs before the rate limiter, so a non-admin connection can send these messages without limit. Each costs one indexed `getPairing` read and nothing is written, which is the same exposure `listGrants` already has.
- [NOTE] gateway/src/link/invite-admin.ts:104 and the list reply — An admin GM can list and cancel invites the operator minted in its world, including `--admin` or `gm` invites for another admin GM. That fits the Acceptance wording ("one unused invite in the sender's world") and stays within its world. The scribe should list it in the threat map.
- [NOTE] gateway/src/link/invite-admin.ts:33-42 duplicates `LinkServer.isAdmin` (gateway/src/link/server.ts:749-758). The two are identical today. They will drift if either changes.
- [NOTE] gateway/src/link/invite-admin.ts:141 — `catch {}` maps every failure to INTERNAL and logs nothing. The code is never logged, which is what the task asks for, but unexpected store errors leave no trace either.

Checked and found clean:
- **World and admin scope.** Admin status comes only from the store row: active, admin, and matching world and user. No message carries a world (strict schemas). `createInvite` hard-codes `world_id = conn.worldId`, `admin` and `gm` to false, and `createdBy = conn.agentId`.
- **Cross-world.** `cancelInWorld` returns the same error, with the same query shape, for a foreign, used or unknown id. `listForWorld` is filtered by world.
- **Admin targets.** The create-time check and the redeem-time check are both scoped to the world. An attest whose author is a GM is already refused by task 90's `authorIsGM` path, so GM targets are covered.
- **The code.** It appears only in `inviteCreated`. It is not in the list reply and not in any log.
- **Memory.** The `all` and `creates` arrays are bounded at 60 and 10 per connection, and the WeakMap entries are freed with the connection.
- **Protocol.** `ErrorMessage.requestId` is optional and is only sent in reply to the new request types, so existing clients are unaffected.

Mutation runs: 15 mutations against the guards in a scratch copy. 13 were killed, among them dropping `row.admin`, dropping `revokedAt`, the world filters in cancel and list, the redeem admin check, the create admin check, the cap off-by-one, setting `createdBy` to null, the create and all-message limits, ttl 0 being accepted, an admin check that ignores the world, and a count that ignores expiry. Two survived; they are the two test findings above.

SCOPE: clean

## Review round 2 — findings (external review on PR #147)

Reviewed HEAD: d1120d8. In-spec, routed to the implementer. Fix: every open invite (unused, uncancelled, unexpired; at most 20 by the per-world cap) is always in the list, and history fills the remaining slots up to MAX_LISTED_INVITES.

[P2] Keep open invitations discoverable when limiting history — gateway/src/store/store.ts:271
The query limits active and historical invitations together to the newest 100. After creating a long-lived invite and then creating and cancelling 100 newer invites, the original remains redeemable and counts toward the 20-open limit but disappears from every listInvites response. There is no pagination or filter, and cancellation requires the invite ID. An administrator reconnecting without the original response therefore cannot discover or cancel it through the link. Include all open invites before limiting history, or provide pagination.

## Amendment 2 (Andrew, 2026-10-15) and review round 3 — findings (external review on PR #147)

Reviewed HEAD: 7386723.

[P2] Keep open-invite listings within the protocol response limit — gateway/src/store/store.ts:277
With 201 unused, unexpired operator invitations, the query returns all 201 despite the requested limit of 100. Operator creation has no open-invite cap. listReply sends the entire result, but InvitesMessage permits only 200 entries, causing parseLinkMessage to reject the response. Listing and cancellation replies become unusable for that world.

Decision: cap open invites per world for every source. The operator path (the CLI `--invite`, including `--gm` and `--admin`, and anything else that calls `createInvite` without `createdBy`) refuses a new invite when the world already has 100 open invites (unused, uncancelled, unexpired). The delegated cap stays at 20. With every open invite listed and at most 100 history rows, a reply then holds at most 100 + 100 = 200 entries, within InvitesMessage's limit. Also clamp the `listForWorld` LIMIT so a reply can never exceed the protocol maximum (defence in depth for rows that predate the cap). Reason: this keeps every open invite discoverable without changing the protocol.
Owns widens to: the operator-invite cap in gateway/src/link/invites.ts `createInvite` (or the store's create) and its error path in gateway/src/bin/cli.ts, which must exit non-zero with a clear message, plus their tests (gateway/test/bin/invite-cli.test.ts and the store and invites tests).
