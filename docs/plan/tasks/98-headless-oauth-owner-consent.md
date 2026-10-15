# 98 — Route OAuth consent for a headless agent to its owner

**Repo:** .
**Depends on:** 38, 43 (both merged; main 28f95e7. 38 for `headless_agents.owner_user_id` and the stored-agent lookup; 43 for the headless.md, security.md and README lines this task updates)
**Status:** Planned 2026-10-15. A follow-up from task 43's code review (43 Amendment 2, Andrew). Remote OAuth clients cannot reach a headless agent today; 43 documents that and names this task. Decision (b) decided by Andrew 2026-10-15; refreshed against main 28f95e7.
**Owns:**
- gateway/src/oauth/consent/** (target resolution, `deliver`, and the headless lookup on `ConsentWiring`; the page renderers are not changed, decision (b))
- gateway/src/oauth/server.ts (passing the headless lookup through `attach` to `ConsentPages` only)
- gateway/src/http/server.ts (the `attach?(...)` wiring type at :46 and the `oauth?.attach?.(...)` call at :154 only)
- gateway/src/app.ts (handing the existing `isActiveAgent` / `headlessOwner` lookups to the OAuth wiring only)
- protocol/src/link/messages.ts (`ConsentCodeMessage`: one optional field, insertion only)
- protocol/test/link/link.test.ts (insertions only)
- module/src/apps/grants/index.ts (`showConsentCode` only)
- lang/en.json (new `AGENT_GATEWAY.Consent.*` keys, insertions only)
- gateway/test/oauth/consent/** (new cases; rig.ts extended, not rewritten)
- module/test/apps/grants/grants.test.ts (insertions only)
- docs/guides/headless.md (section 3 only: the intro sentence at :108, the remote OAuth table row at :122, the closing sentence of :124 and the paragraph at :126; and the "except remote OAuth" clause at :242)
- docs/security.md (only the remote-OAuth sentences at the end of :80 and of :125, the "owner is a routing hint" bullet at :123 (add consent codes to what it routes), plus one new bullet after :125 for decision (e))
- README.md (only the closing "remote OAuth ... task 98" clause of :39)

## Goal
Let a remote OAuth client (claude.ai, ChatGPT, Gemini) be granted access to a headless agent's identity. When the consent page names a (world, user) that is a stored headless agent with an owner (`headless add --owner`, task 38), the consent code goes to the owner's link connection, never to the agent's, and the owner types it on the page to approve. The page itself looks exactly as it does today for any target, so it never reveals that the target is a headless agent, whether it has an owner, or whether the owner is online.

## Context
- gateway/src/oauth/consent/index.ts (main 28f95e7):
  - :250-260: the code request; `resolve` picks the target, a code hash is stored whenever there is a target, then `deliver`; :259 "Same body and status whoever was named, or whether they are online." is the anti-enumeration rule this task keeps for every target (decision (b));
  - :264-276 `resolve`: from `activePairedUsers(world)`, by id or by a name exactly one pairing has; returns `{ worldId, userId, pairingId }`. A headless agent is found here once its runner has paired;
  - :278-298 `deliver`: sends `consentCode` to `registry.get(target.worldId, target.userId)` only, and at :284 rebinds `target.pairingId` to that connection's `agentId`. For a headless agent that connection is the runner's Chromium, so the code is never seen;
  - :300, :313 `verify`: the grant is refused unless `pairingActive(target.pairingId)`;
  - :63-71 `ConsentWiring` (`registry`, `failures`), set by `attach` (:125); the wiring comes from gateway/src/http/server.ts:46 (type) and :154 (call), through gateway/src/oauth/server.ts:196-198 `attach`.
- gateway/src/app.ts:237-255: `isConfiguredAgent` (flag/env agent), `storedRow`, `isActiveAgent`, `headlessOwner` (`undefined` for the flag/env agent and for a stored row with no owner; otherwise the row's `ownerUserId`). Already passed as `isHeadlessAgent` / `headlessOwner` at :777-778 for ask-owner routing. Reuse these; do not add a second lookup.
- gateway/src/headless/config/repository.ts and gateway/src/store/migrations/013-headless-agents.ts: `headless_agents.owner_user_id` (task 38, nullable).
- gateway/src/store/store.ts:140, :450 `revokePairingsFor`: called by `headless add` and `remove` (gateway/src/headless/config/commands.ts:129, :149). It revokes the (world, user)'s pairings and OAuth grants. docs/plan/done/68-server-mode-pairing-confirmation.md: re-pairing as a user revokes the old pairing and its grants, in one transaction (68 decision (j)). See decision (e).
- module/src/apps/grants/index.ts:37-50 `showConsentCode`: a DialogV2 prompt with client name, code and scopes; strings `AGENT_GATEWAY.Consent.*` at lang/en.json:254-258. Today it says "{client} is asking to connect to Foundry as you".
- protocol/src/link/messages.ts:216-223 `ConsentCodeMessage` (strict object).
- Docs 43 added, which this task rewrites once the path works:
  - docs/guides/headless.md:108 ("except the compose form and the remote OAuth row, which were not run"), :122 (table row "Remote OAuth clients ... | No, not yet | Not run: it cannot work until task 98"), :124 last sentence ("Remote use waits for task 98"), :126 (the "cannot use a headless agent yet ... planned as task 98" paragraph), :242 ("Every row ... was run except remote OAuth and ...");
  - docs/security.md:123 ("`--owner` sends the agent's ask-owner approvals to that Foundry user"; now consent codes too), :80 (closing sentences: "Remote OAuth was not run and cannot work until task 98; the table ... names task 98"), :125 ("remote OAuth was not run and cannot work until task 98");
  - README.md:39 ("remote OAuth was not run and cannot work until task 98").
- docs/plan/done/37-headless-runner.md decision (d): the agent user is not for humans; its pairings come only from gateway-minted invites. This task must not add another way for a human to act as the agent's link connection; it only lets the owner approve a grant.
- docs/plan/done/38-headless-config.md: `--owner` is a routing hint for ask-owner approvals, not a permission. This task widens what the owner routes (consent codes too) but the owner still gains no permission of their own.
- docs/plan/done/43-user-docs.md Amendment 2: why the doc lines above exist.

## Decisions
- (a) **The flag/env agent is not supported.** It has no owner field (`headlessOwner` returns `undefined` for it). It is treated as a headless agent with no owner (decision (b)): nothing is delivered, and the page is the same as for anyone else. The docs say a headless agent reached by remote OAuth must be a stored agent added with `headless add ... --owner <id>`. Adding an owner flag for the flag/env agent is out of scope.
- (b) **Uniform response (Andrew, 2026-10-15).** The consent page's body and status stay exactly as today whoever is named and whether they are online (the rule at consent/index.ts:259). The page never reveals that the target is a headless agent, whether it has an owner, or whether the owner is connected. For a headless agent with an owner, the code is delivered to the owner's link connection instead of the agent's. With no owner, or an owner who is not connected, nothing is delivered and the page looks the same as for an offline user. No new page text or page variants are added.
- (c) **The grant is bound to the agent, not the owner.** The target stays the agent's (world, user, pairingId); `deliver` must not rebind `pairingId` to the owner's connection (the :284 rebind applies only when the code goes to the target's own connection). The owner's Foundry dialog names the agent ("{client} is asking to connect to Foundry as headless agent {agent}"), via one optional field on `consentCode` (e.g. `forAgent: { userId, name }`), so the owner cannot mistake it for a request to act as themselves. That field goes only to the owner's connection and never appears on the consent page. The agent must already have an active pairing (its runner has paired); otherwise `resolve` finds no target, as today.
- (d) **43's docs are updated here.** This task rewrites only the lines listed in Context. headless.md and security.md say: remote OAuth reaches a headless agent only if it is a stored agent added with `--owner` (the flag/env agent is not supported, decision (a)); the code is shown in the owner's Foundry window, so the owner must be connected to Foundry to receive it; if no code arrives, the page gives no hint why (decision (b)). The explicit-binding note for local sessions stays. The table row for remote OAuth gets the result of an actual run (see Acceptance). No other part of 43's docs changes.
- (e) **A grant made through this task ends when the agent re-pairs.** The grant is bound to the agent's pairing at approval time (decision (c)), and re-pairing revokes the old pairing and its grants by design (`revokePairingsFor` on `headless add`/`remove`, task 38; redeeming a new invite for the same user, task 68). So a runner that pairs again (after `headless add`, a takeover by another gateway, or loss of its profile's pairing token) ends every remote grant for that agent, and the owner has to approve again. Recommendation: keep this, and document it in headless.md and security.md. Making a grant survive re-pairing would need a grant bound to the identity rather than the pairing, which weakens 68's "revoke the pairing, revoke its grants" guarantee; that is out of scope. If a run shows the runner re-pairs in normal operation (e.g. on every gateway restart), stop and report before shipping, because the feature would then be unusable without more work.

## Acceptance
- [ ] Test (gateway/test/oauth/consent): for a stored headless agent with owner O, both connected, requesting a code for the agent sends exactly one `consentCode` to O's connection and none to the agent's connection; the message carries the agent field from decision (c).
- [ ] Test: the code entered on the page creates a grant whose (world, user) is the agent's and whose pairing is the agent's active pairing (not O's); a session using that grant's token acts as the agent (the tool call's resolved identity is the agent's userId).
- [ ] Test (indistinguishability): the code-request response has the same status and a byte-identical body (after removing the per-request CSRF/nonce values the page already varies on, if any) for each of: a normal online user, a normal offline user, a headless agent with an online owner, a headless agent with no owner, a headless agent with an offline owner, the flag/env agent, and an unknown user. The same holds for the wrong-code response on `verify` across those targets.
- [ ] Test: stored agent with no owner, stored agent whose owner is offline, and the flag/env agent: no `consentCode` is sent to any connection (owner's or agent's), and entering any code fails.
- [ ] Test: revoking the agent's pairing (e.g. `revokePairingsFor`) between code delivery and entry makes the code fail, as `verify` already does for normal users.
- [ ] Test: re-pairing the agent (new pairing for the same (world, user)) after a grant is made revokes that grant (decision (e)).
- [ ] Test: for a normal (non-headless) user, the existing consent tests in gateway/test/oauth/consent pass unchanged.
- [ ] Module test (module/test/apps/grants): `showConsentCode` with the agent field renders the "as headless agent {agent}" prompt, escaped; without it renders today's prompt.
- [ ] Protocol test: `consentCode` with and without the optional agent field parses; an unknown extra field is still rejected.
- [ ] Run (manual, Foundry v14, server mode with a public URL, a stored agent with `--owner` and the owner logged in): a remote OAuth client (name which one: claude.ai, ChatGPT, Gemini, or a scripted client using the gateway's registration and authorization endpoints) completes consent with the code from the owner's dialog and a tool call answers as the agent. The headless.md table row for remote OAuth is replaced with this run's client, result ("**Yes**" or "No") and what happened; the :108 and :242 statements no longer say the remote OAuth row was not run.
- [ ] docs/guides/headless.md and docs/security.md: say the agent must be a stored agent with `--owner` (flag/env agent not supported), the owner must be connected to Foundry to receive the code, and a grant ends when the agent re-pairs (decision (e)); README.md:39 no longer says remote OAuth cannot work. `grep -n "task 98" README.md docs/guides/headless.md docs/security.md` is empty.
- [ ] `npm run verify` passes.

## Out of scope
- An owner for the flag/env agent (new flag or env var).
- Any change to the consent page's text, status or variants (decision (b)).
- Letting the owner act as the agent, or pair as the agent: the agent user stays not-for-humans (37 decision (d)).
- Changing `revokePairingsFor`, or making grants survive re-pairing, `headless add` or `remove` (decision (e)).
- The ask-owner approval routing itself (38) and the grants management view (94).
- Any other part of 43's docs, and docs/compatibility.md's manual checklists.
