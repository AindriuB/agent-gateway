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
