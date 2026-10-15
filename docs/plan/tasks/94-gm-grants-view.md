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

## Amendment 1 (Andrew, 2026-10-15)

Admin replies never carry `lastUsedAt`. `userGrants` uses a reply shape without `lastUsedAt` (a new admin summary type, or the field always null; prefer omitting it). The GM sees client name, scopes and created date only, matching "metadata only" and the player notice. The players' own grants window (task 67) still shows their own last-used time. The first acceptance bullet's "GrantSummary reused unchanged" is amended accordingly. Reason: last-used time to the minute is per-player activity tracking, an audit detail the task excludes.

## Review round 1 — findings

Reviewed HEAD: 9faa95a. The first P2 is settled by Amendment 1. Routed to the implementer:
- Amendment 1;
- P2: a stale-connection test for `listUserGrants`/`revokeUserGrant`;
- P2: a test that the window is shared with invite/pairing messages (fill it with `listPairings`/`listInvites`, then `listUserGrants` is refused);
- P3: a test for the `p.worldId === conn.worldId` clause in the other-admin check.
The headless-owner NOTE goes to the scribe for the privacy docs.

VERDICT: FIX

Note: `origin/claude/task-94` does not exist because the branch has not been pushed. I reviewed the local branch `claude/task-94` (HEAD 9faa95a) against `origin/main`, after a fetch.

FINDINGS
- [P2] gateway/src/link/user-grants.ts:71 (`grants: listGrantSummaries(...)`) — The reply puts every grant's `lastUsedAt` on the wire. That is when the player's AI client last used the gateway, recorded to the minute (`oauth/server.ts:35,207`, `TOUCH_INTERVAL_MS = 60_000`). The Grants tab never shows it, but the admin GM can read it from the socket in devtools.
  route: orchestrator — The task file contradicts itself. Goal and Decision 2 say "metadata only (client name, scopes, created date)", and Out of scope excludes "refresh times or audit details". But the first acceptance item says "`GrantSummary` is reused unchanged", and `GrantSummary` includes `lastUsedAt`. The test at gateway/test/link/user-grants.test.ts (the `toEqual({... lastUsedAt: null})` assertion) fixes that field in place. A per-player activity timestamp is an audit detail, and the player notice ("names, permissions and dates") does not clearly cover it. The planner has to choose: a reply type without `lastUsedAt` (or always `null`), which changes the acceptance wording, or an amended decision that allows it, plus a notice that says so.
  input: The player's MCP client makes a tool call at 14:03; the GM sends `listUserGrants{userId:"p1"}`  →  the reply contains `lastUsedAt: <14:03 epoch ms>`, so the GM can track when the player is active.

- [P2] gateway/src/link/server.ts:540-548 — The stale-connection check on `listUserGrants` and `revokeUserGrant` is not tested, although the acceptance bullet ends "Tested". 93 sets the precedent with a stale test at gateway/test/link/invite-admin.test.ts:236.
  route: implementer
  input: An admin GM's link is replaced by a reconnect, and the old socket sends `revokeUserGrant`  →  if the guard were removed, the old socket would be obeyed and no test would fail.
  proof: With the condition replaced by `if (false)`, gateway/test/link/user-grants.test.ts still passes 9/9.

- [P2] gateway/test/link/user-grants.test.ts:201 — The test named "shares the invite window across list and revoke" only sends user-grant messages, so it never shows that the window is shared with the invite and pairing messages (92's per-connection limit, which the acceptance names).
  route: implementer — Use up part of the window with `listPairings` or `listInvites`, then show that `listUserGrants` is refused.
  input: The handler gets its own 60/min window instead of `takeLinkAdminMessage`  →  a GM gets 60 pairing and 60 user-grant messages per minute instead of 60 in total, and the test still passes.
  proof: With `takeLinkAdminMessage` replaced by a local copy on a separate WeakMap, the file passes 9/9. Removing the rate check completely does fail it (1 failure), so it only guards that some limit exists.

- [P3] gateway/src/link/user-grants.ts:52-55 — No test covers the `p.worldId === conn.worldId` part of the other-admin check. Dropping it fails closed: an admin pairing for the same user id in world B would make world A's admin get FORBIDDEN for that user. It cannot leak anything, but nothing guards it.
  route: implementer
  input: World B has an admin pairing for user `p1`, and world A's admin sends `listUserGrants{userId:"p1"}`  →  with the clause removed, the answer is FORBIDDEN instead of A's grants.
  proof: With the clause removed, the file passes 9/9.

- [NOTE] Mutation results that held (each mutation made a test fail): admin flag removed from `senderIsAdmin`; rate check removed; player notice removed or moved inside `{{#if unavailable}}`; 0.3.0 gate removed from `tabUnavailableReason('grants')`; 0.3.0 gate removed from `manageRequest` for `userGrants`; `forUser` reply match removed; other-admin filter removed from `grantUsers`; `grantsIntro` header removed; `{{clientName}}` changed to `{{{clientName}}}`.
- [NOTE] World and user scope hold. Every read and write uses `(conn.worldId, msg.userId)`, and revoke goes through `revokeOwnGrant`, which checks both world and user. A foreign-world id, a foreign-user id, an unknown id and an already-revoked id all get the same `INVALID_ARGS 'no such grant'`, and the tests cover the world-A/world-B case. Another admin's grants are refused before any read or write, and the rate window is charged before that refusal.
- [NOTE] Unpaired user ids: `listUserGrants` for any id returns only that world's live grants, so nothing crosses worlds. Within its own world the admin can tell FORBIDDEN (another admin) from a list. The pairings tab (93) already shows admin status, so this exposes nothing new.
- [NOTE] Headless agents (task 38): the world's admin GM can list and revoke OAuth grants held under the configured headless user. This matches 93, where `revokePairing` can already revoke that user's pairing and all its grants. However, the notice that the GM can see these apps only appears in the Connected apps window of the user who holds the grants. The headless agent's owner (`owner_user_id`) is a different user and may never see it for grants made through the agent. Worth one line in the scribe's privacy statement.
- [NOTE] gateway/src/link/invite-admin.ts:15-18 — The comment on `MAX_INVITE_MESSAGES_PER_WINDOW` still lists only the invite and pairing messages as sharing the window. The file is outside Owns, so it is left to a later docs or cleanup pass.
- [NOTE] Per-tab failures keep the nav and the `grantsIntro` header, because `blank(tab,'',notice)` keeps `isGrants` set. When a request fails, the user list is cleared until a retry. That is the same as the other tabs.

SCOPE: clean. Every changed path is within Owns. module/src/apps/manage/index.ts imports `grantRows` from module/src/apps/grants/model.ts, but that file is not modified. It is a read-only dependency, not an ownership breach.
