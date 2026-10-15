# 98 — Route OAuth consent for a headless agent to its owner

**Repo:** .
**Depends on:** 38, 43 (38 for `headless_agents.owner_user_id` and the stored-agent lookup; 43 for the headless.md and security.md lines this task updates)
**Status:** Planned 2026-10-15. A follow-up from task 43's code review (43 Amendment 2, Andrew). Remote OAuth clients cannot reach a headless agent today; 43 documents that and names this task.
**Owns:**
- gateway/src/oauth/consent/** (target resolution, `deliver`, and the code-page / message-page text for headless targets)
- gateway/src/oauth/server.ts (passing the headless lookup through to `ConsentPages` only)
- gateway/src/http/server.ts (the `oauth?.attach?.(...)` wiring line only)
- gateway/src/app.ts (handing the existing `isConfiguredAgent` / `storedRow` / `headlessOwner` lookups to the OAuth wiring only)
- protocol/src/link/messages.ts (`ConsentCodeMessage`: one optional field, insertion only)
- protocol/test/link/link.test.ts (insertions only)
- module/src/apps/grants/index.ts (`showConsentCode` only)
- lang/en.json (new `AGENT_GATEWAY.Consent.*` keys, insertions only)
- gateway/test/oauth/consent/** (new cases; rig.ts extended, not rewritten)
- module/test/apps/grants/grants.test.ts (insertions only)
- docs/guides/headless.md and docs/security.md (only the lines 43 Amendment 2 added saying remote OAuth cannot reach a headless agent yet)

## Goal
Let a remote OAuth client (claude.ai, ChatGPT, Gemini) be granted access to a headless agent's identity. When the consent page names a (world, user) that is a stored headless agent with an owner (`headless add --owner`, task 38), the consent code goes to the owner's link connection, never to the agent's, and the owner types it on the page to approve. If the agent has no owner, or the owner is not connected, the consent page says so plainly instead of sending a code nobody can see.

## Context
- gateway/src/oauth/consent/index.ts:
  - ~245-259: the code request; `resolve` picks the target from `activePairedUsers(world)` (by id, or by a name exactly one pairing has), then `deliver`; the comment "Same body and status whoever was named, or whether they are online" is the current anti-enumeration rule;
  - ~263-276 `resolve`: returns `{ worldId, userId, pairingId }`;
  - ~278-297 `deliver`: sends `consentCode` to `registry.get(target.worldId, target.userId)` only, and rebinds `target.pairingId` to that connection's `agentId`. For a headless agent that connection is the runner's Chromium, so the code is never seen;
  - ~313 `verify`: the grant is refused unless `pairingActive(target.pairingId)`;
  - ~62-71 `ConsentWiring` (`registry`, `failures`), set by `attach` (~125), called from gateway/src/http/server.ts:154 and passed through gateway/src/oauth/server.ts:164-200.
- gateway/src/app.ts:~240-256: `isConfiguredAgent` (flag/env agent), `storedRow`, `isActiveAgent`, `headlessOwner` (returns `undefined` for the flag/env agent; otherwise the stored row's `ownerUserId`). Reuse these; do not add a second lookup.
- gateway/src/headless/config/repository.ts and gateway/src/store/migrations/013-headless-agents.ts: `headless_agents.owner_user_id` (task 38, nullable).
- gateway/src/store/store.ts:~140, ~450 `revokePairingsFor`: called by `headless add` and `remove` (gateway/src/headless/config/commands.ts:129, 149). It revokes the (world, user)'s pairings and OAuth grants, so a grant made for an agent before `add` does not survive it. A grant made after `add` through this task is bound to the agent's pairing, so it ends when the runner's pairing is revoked or replaced.
- module/src/apps/grants/index.ts:~37-49 `showConsentCode`: a DialogV2 prompt showing client name, code and scopes; strings `AGENT_GATEWAY.Consent.*` in lang/en.json:254-258. Today the prompt says "{client} is asking to connect to Foundry as you".
- protocol/src/link/messages.ts:~217-223 `ConsentCodeMessage` (strict object).
- docs/plan/done/37-headless-runner.md decision (d): the agent user is not for humans; its pairings come only from gateway-minted invites. This task must not add another way for a human to act as the agent's link connection; it only lets the owner approve a grant.
- docs/plan/done/38-headless-config.md: `--owner` is a routing hint for ask-owner approvals, not a permission. This task widens what the owner routes (consent codes too) but the owner still gains no permission of their own.
- docs/plan/tasks/43-user-docs.md Amendment 2: the doc lines this task updates.

## Decisions
- (a) **The flag/env agent is not supported.** It has no owner field (`headlessOwner` returns `undefined` for it). Recommendation: refuse, with the same "no owner" page as (b); the message says to configure the agent as a stored agent with `headless add ... --owner <id>`. Adding an owner flag for the flag/env agent is out of scope.
- (b) **The consent page reveals that the target is a headless agent.** Today the page gives the same body whoever was named, to avoid telling a visitor who is online. For a headless target the user must know where the code went, or the flow cannot be finished. Recommendation: for a headless target only, the code page says "This user is a headless agent; the code was sent to its owner in Foundry". It refuses with a message page when there is no owner ("This user is a headless agent with no owner, so no one can approve it. Ask the operator to set one with `headless add --owner`.") or the owner is not connected ("This user is a headless agent; its owner is not connected to Foundry right now. Ask them to open Foundry and try again."). The leak is limited to "this (world, user) is a headless agent and whether its owner is online", for a visitor who already has a registered client and knows the world and user ids. Non-headless targets keep the identical page and status they have today. If Andrew prefers no leak, the alternative is the same page for all targets with the owner's dialog as the only signal; the implementer asks before choosing it.
- (c) **The grant is bound to the agent, not the owner.** The target stays the agent's (world, user, pairingId); `deliver` must not rebind `pairingId` to the owner's connection. The owner's dialog names the agent ("{client} is asking to connect to Foundry as headless agent {agent}"), via one optional field on `consentCode` (e.g. `forAgent: { userId, name }`), so the owner cannot mistake it for a request to act as themselves. The agent must already have an active pairing (its runner has paired); otherwise `resolve` finds no target, as today.
- (d) **43's docs are updated here.** This task owns only the headless.md and security.md lines 43 Amendment 2 added; it replaces "not yet" with how it works (owner required, owner online, code shown to the owner) and keeps the explicit-binding note for local sessions. No other part of 43's docs changes.

## Acceptance
- [ ] Test (gateway/test/oauth/consent): for a stored headless agent with owner O, both connected, requesting a code for the agent sends exactly one `consentCode` to O's connection and none to the agent's connection; the message carries the agent field from decision (c).
- [ ] Test: the code entered on the page creates a grant whose (world, user) is the agent's and whose pairing is the agent's active pairing (not O's); a session using that grant's token acts as the agent (the tool call's resolved identity is the agent's userId).
- [ ] Test: stored agent with no owner: no `consentCode` is sent to anyone, the page is the "no owner" message from decision (b), and no code hash is stored (entering any code fails).
- [ ] Test: stored agent whose owner is not connected: no `consentCode` is sent, the page is the "owner not connected" message.
- [ ] Test: the flag/env agent as target: no `consentCode` is sent; the page is the "no owner" message naming `headless add --owner`.
- [ ] Test: revoking the agent's pairing (e.g. `revokePairingsFor`) between code delivery and entry makes the code fail, as `verify` already does for normal users.
- [ ] Test: for a normal (non-headless) user, the existing consent tests pass unchanged, and the response body and status for "named user online", "named user offline" and "unknown user" are still identical to each other.
- [ ] Module test (module/test/apps/grants): `showConsentCode` with the agent field renders the "as headless agent {agent}" prompt, escaped; without it renders today's prompt.
- [ ] Protocol test: `consentCode` with and without the optional agent field parses; an unknown extra field is still rejected.
- [ ] docs/guides/headless.md and docs/security.md: the "not yet" lines from 43 Amendment 2 now describe owner-routed consent, its two refusals, and that the flag/env agent is not supported; `grep -n "task 98" docs/guides/headless.md docs/security.md` is empty.
- [ ] `npm run verify` passes.

## Out of scope
- An owner for the flag/env agent (new flag or env var).
- Letting the owner act as the agent, or pair as the agent: the agent user stays not-for-humans (37 decision (d)).
- Changing `revokePairingsFor`, or making grants survive `headless add`/`remove`.
- The anti-enumeration behaviour for non-headless targets.
- The ask-owner approval routing itself (38) and the grants management view (94).
- Any other part of 43's docs, and docs/compatibility.md's manual checklists.
