# 94 — Show the admin GM each player's authorized apps, and let it revoke them

**Repo:** .
**Depends on:** 93
**Owns:**
- protocol/src/link/messages.ts (insertions only)
- protocol/test/link/user-grants.test.ts (new)
- gateway/src/link/user-grants.ts (new)
- gateway/src/link/server.ts (dispatch cases for the new messages only)
- gateway/src/oauth/grants/index.ts (only if a world-scoped helper is needed; insertions only)
- gateway/test/link/user-grants.test.ts (new)
- module/src/apps/manage/** (a Grants tab)
- templates/manage/**
- module/src/apps/grants/index.ts (the player-facing visibility notice only)
- templates/grants/grants.hbs (the player-facing visibility notice only)
- module/src/link/client.ts (request methods and reply handling for the new messages only)
- lang/en.json (insertions only)
- styles/agent-gateway.css (the manage section only)
- module/test/apps/manage/**
- module/test/apps/grants/grants.test.ts (insertions only)
- module/test/link/client.test.ts (insertions only)

## Goal
The admin GM sees, for each user in its own world, the OAuth apps that user has authorized, as
metadata only (client name, scopes, created date), and can revoke them. Players are told in
their own Connected apps window that their GM can see this list.

## Context
- scratchpad design: `design-gm-management.md` (c) "Grants per user"
- gateway/src/oauth/grants/index.ts:4-40 — `GrantSummary`, `listGrantSummaries(repo, worldId, userId)`, `revokeOwnGrant(repo, worldId, userId, grantId, now)`
- gateway/src/link/grants.ts — the self-service handler. Leave it unchanged.
- gateway/src/link/pairing-admin.ts (93) — the admin check, the rate limit, and the "other admin" rule to reuse
- module/src/apps/manage/** (93) — the tab structure
- module/src/apps/grants/index.ts, templates/grants/grants.hbs — the player's self-service window

## Acceptance
- [ ] New strict messages: `listUserGrants{requestId, userId}`, which replies `userGrants{requestId, userId, grants:[GrantSummary]}`, and `revokeUserGrant{requestId, userId, grantId}`, which replies with the updated `userGrants`. Neither carries a world id. The protocol test rejects an extra `worldId`, and `GrantSummary` is reused unchanged.
- [ ] Both pass the stale-connection check and read the sender's admin flag from the store. A non-admin sender (including one whose hello says `isGM: true`) gets `FORBIDDEN`. Both count toward 92's per-connection rate limit. Tested.
- [ ] They act only on `(conn.worldId, userId)`. A test with grants for the same user id in worlds A and B shows that A's admin sees and revokes only A's grants, and that B's grant id sent from A gets the same `error` as an unknown id and stays active.
- [ ] Targeting a user who holds an active admin pairing other than the sender gets `FORBIDDEN` for both list and revoke. Tested.
- [ ] The reply carries only `GrantSummary` fields. A test seeds known access and refresh token strings and a client secret, serializes the reply, and asserts that none of them appears.
- [ ] Module: the manage app gains a Grants tab. It lists users in the world who have a pairing, and for a selected user it shows client name, scopes and created date with a revoke action. The tab header carries a localized line saying this is metadata only and that players are told the GM can see it. Escaping is tested with a hostile client name.
- [ ] The player's Connected apps window shows a localized line saying their GM can see which apps they have authorized (never tokens). A test asserts that the line is rendered.
- [ ] `npm run verify` passes.

## Out of scope
- Changing self-service `listGrants`/`revokeGrant` or OAuth token storage.
- Showing tokens, secrets, refresh times or audit details. Metadata only, by decision.
- Cross-world or operator views.
- The privacy statement and docs (scribe).

## Decisions (Andrew, 2026-10-14)
1. Design approved. Pairing for non-admin users is GM-vouched through a server-authored whispered ChatMessage. Admin GM status is set only by the operator CLI (`--invite … --admin`) and is never derived from `hello.isGM`. The management app lives inside Foundry for the admin GM, over its existing link, scoped to its own world. The CLI stays as the operator's break-glass. No web UI for now.
2. Grants view: yes. The admin GM sees each player's authorized apps as metadata only (client name, scopes, created date; never tokens) and can revoke them. The UI tells players that their GM can see this.
3. Verified evidence: Foundry v13 `BaseChatMessage#canCreate` lets a GM author as anyone, so admin status comes from the operator only.

## Notes for the scribe
- Privacy statement (from 65's docs): the admin GM can see the metadata of each player's authorized apps (client name, scopes, created date) and can revoke them. Tokens are never shown.
- Threat map: this is a new exposure, scoped to one world and gated by admin.
