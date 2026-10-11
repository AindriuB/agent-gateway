# 24 — Add GM tools token_manage, combat_manage and scene_control

**Repo:** .
**Depends on:** 23, 20d, 20e
**Owns:**
- protocol/src/tools/token-manage.ts
- protocol/src/tools/combat-manage.ts
- protocol/src/tools/scene-control.ts
- protocol/src/tools/index.ts (insertions only)
- module/src/tools/token-manage.ts
- module/src/tools/combat-manage.ts
- module/src/tools/scene-control.ts
- module/src/tools/index.ts (insertions only)
- module/src/tools/_scene.ts (shared bounded arguments, trusted GM and canonical document guards only)
- module/src/ops/context.ts (new dispatcher-owned preparation/category helper only)
- module/src/ops/types.ts (preparation hook/context types only)
- module/src/ops/dispatch.ts (core preparation lifecycle and category binding only)
- module/src/policy/stage.ts (base/effective category policy meet only)
- module/src/ratelimit/stage.ts (effective category bucket selection only)
- module/src/approvals/stage.ts (effective category forwarding only)
- module/src/approvals/manager.ts (category-bound grants and base/effective policy recheck only)
- module/src/audit/stage.ts (effective category recording only)
- module/src/compat/index.ts (narrow audited native scene/combat adapters only)
- module/test/compat/gm-scene.test.ts
- protocol/test/tools/rules/validate.test.ts (three new canonical argument examples only)
- module/test/tools/gm-scene/**
- module/test/stubs/** (insertions only)

## Goal
Let the GM's agent run the table's mechanics: place, hide and remove tokens,
manage the combat tracker and switch or adjust scenes, using v14 Scene Levels
only when the compat layer reports them.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:151-153 — GM tools
- docs/plan/specs/2026-10-09-agent-gateway.md:68-71 — v14-only features only when present
- module/src/compat/** `hasSceneLevels()` (04)

- These are core tools: add them to `protocol/src/tools/index.ts` `TOOLS` and `module/src/tools/index.ts` `HANDLERS` as before; `module/src/ops/core-tools.ts` (20c) registers them through the same registry path as pack tools, and `checkToolDefinition(…, 'core')` (20b) must pass for each (the 20b test sweeps `TOOLS`)
## Acceptance
- [ ] `token_manage` (gm, write): action enum place|hide|show|remove; `remove` is escalated to the destructive category through a `ctx.escalate('destructive')` call added to the dispatcher context, so policy re-evaluates before running; the escalated category is looked up and re-checked through the registry (20c), and `escalate` only ever makes a call stricter (a test calls `ctx.escalate('read')` from a write tool and gets `INTERNAL`)
- [ ] `combat_manage` (gm, write): action enum start|end|next_turn|previous_turn|next_round|add_combatants|remove_combatants|roll_initiative
- [ ] `scene_control` (gm, write): action enum activate|view|set_darkness|set_level; `set_level` returns `INVALID_ARGS` "requires Foundry v14 Scene Levels" when `hasSceneLevels()` is false (tested on both generations)
- [ ] Guards and `npm run verify` pass; separately approved native acceptance on v13/v14 records actual effects, audit persistence and exact fixture cleanup. No native writes are authorized by offline implementation alone.

## Dispatcher preparation and authority
- A trusted core handler may provide a bounded, synchronous, pure preparation hook. The dispatcher invokes it once on parsed arguments before any policy, rate, approval, audit or execution stage. The hook classifies the action and calls `ctx.escalate('destructive')`; it performs no document reads, native calls, snapshots, writes or approval requests. Packs cannot install this core capability through caller data.
- `token_manage.remove`, `combat_manage.end` and `combat_manage.remove_combatants` escalate from their canonical registry base `write` to `destructive`. Other actions remain `write`. The dispatcher verifies canonical registry identity/metadata and binds one immutable effective category for the complete call. Escalation is closed after preparation, including retained callbacks; unknown categories, downgrade, non-core attempts and late escalation fail closed with `INTERNAL`. Do not mutate registry metadata, advertised schemas or the public pack API.
- Policy admission and delayed approval rechecks apply the stricter result of the base `write` and effective `destructive` cells; independently configured destructive permission must never relax write permission. Test write ask/destructive allow, write deny/destructive allow and write allow/destructive ask. Preserve trusted current user/owner and registry rechecks after approval.
- Rate, approval display and audit use the effective category. Write and destructive share the existing write bucket: charge once, retaining its existing limits. Bind session approval grants to effective category as well as existing identities; a write grant cannot approve a destructive action. Static tools retain their existing semantics.
- Test the actual dispatcher and SDK after `listTools`: a destructive call delayed beyond the manager pending threshold returns valid `pending_approval`, performs no premature mutation, then resumes exactly once after approval with one correctly classified audit. Denial and post-approval policy tightening prevent execution. No nested approval request inside an already executing audited handler and no handler replay to escalate.

## Bounded inputs and native behavior
All schemas are closed, action-specific, bounded objects; no raw JSON, arbitrary formulas, update options or caller-supplied identity/ownership metadata. All tools require the actual current Foundry GM and canonical world documents. Recheck current user, collection identity, parent, permissions and relevant state after every await and synchronously before mutation, including after native hooks. Protect the audit journal and its ancestors/descendants. Await native operations and pass `ctx.callOptions` to every explicit document mutation; validate returned canonical documents and actual persisted effects, with honest partial failure.

### Tokens
- `place` takes `sceneUuid`, world `actorUuid`, finite signed pixel `x`/`y`, optional boolean `hidden` and finite bounded `rotation` (0 through 360). Coordinates describe token top-left and must fit the actual native scene rectangle and native token footprint. Obtain native prototype/system defaults through `actor.getTokenDocument` with the explicit canonical scene, then create one Token through that scene. Do not overwrite native dimensions or accept broad token configuration.
- `hide`, `show`, `remove` take one `tokenUuid`, resolved through its canonical Scene parent. Snapshot before update/delete. Removal refuses while any canonical world combatant references that token: native token deletion otherwise launches unawaited cross-combat deletions without audit options. Remove those combatants explicitly first. Bound traversal and fail closed on incomplete/ambiguous collections.

### Combat
- Every action takes an explicit existing `combatUuid`; do not implicitly create an encounter or use a client's viewed combat as authority. `add_combatants` takes 1–20 unique `tokenUuids` from that encounter's bound scene. `remove_combatants` and `roll_initiative` take 1–20 unique `combatantUuids` with that exact canonical parent. Validate all IDs before mutation, reject duplicates/missing entries and verify exact native returned sets (systems may filter creates).
- `start`, `next_turn`, `previous_turn`, `next_round` use bounded native-equivalent compatibility adapters which preserve the supported generation's skip-defeated, rollover, combat hooks and world-time semantics while forwarding audit options. Fresh guards run after hooks. Do not silently call native methods which discard options. Disclose actual world-time and lifecycle effects; no unchanged-time or universal Undo promise. Unsupported native/system behavior fails closed rather than silently substituting semantics.
- `end` explicitly deletes the selected encounter with audit options after destructive approval; never invoke the native confirmation modal. Native deletion can change local viewed combat and refresh effects; these consequences must be disclosed and validated, not presented as a single reversible field update.
- `roll_initiative` has a usable bounded core-native adapter: prepare selected combatants' native rolls without implicit tracker or chat writes, then explicitly apply audited combatant updates. Do not call native tracker methods that discard options, silently skip selected IDs or create chat. Preserve the supported adapter's native initiative metadata, finite totals and fresh canonical combatant/actor checks after each await. This tool deliberately creates no automatic initiative chat message.
- PF2e is a separate system adapter, never a core-formula fallback. Its live `actor.initiative.roll` is not a safe pure preparer: even `updateTracker:false/createMessage:false` permits rule hooks, and native `StatisticCheck.roll` re-reads live rules after an await. A pre-roll rule predicate alone is insufficient. PF2e returns `INVALID_ARGS` with an explicit unsupported-automation explanation unless a bounded detached native Statistic adapter is verified on both generations: independently constructed unregistered in-memory Actor from bounded source; no constructor/preparation world, tracker or effect writes; detached Actor/statistic/rules identities; complete empty prepared rules; direct detached `initiative.statistic.roll` (never `initiative.roll`/`fromActor` fallback); disabled message/dialog creation; no caller item/DC/target/origin/action/callback/options; hidden roll visibility retained; finite native Roll and verified initiative statistic/tiebreak metadata. Revalidate original live identities/state before audited updates. Targeted regressions must prove live-rule changes during evaluation cannot enter the detached roll. If any native detachment or purity condition is unverified, retain explicit fail-closed PF2e behavior and document that limitation; do not suppress rules or mutate live/global objects. Core initiative and all other actions proceed independently of this optional system adapter.

### Scenes
- Every action takes a canonical `sceneUuid`. `set_darkness` additionally takes `darkness` in [0,1], honors native darkness locks and writes the generation's native darkness field with audit options.
- `activate` is a global scene activation and can deactivate the prior active scene/change connected views. Predeclare and snapshot affected active-scene documents, use an audited native-equivalent adapter and validate the final activation result; disclose global view consequences. `view` changes only the calling GM client's view and validates native completion (loading/no-canvas refusal is not success).
- `set_level` additionally takes a nonempty bounded `levelId` (at most 100 characters), resolves an actual level on that scene, and changes the calling client's scene/level view only. Gate strictly through `hasSceneLevels()` and preserve the exact unsupported error above. No level creation/update or invented v13 fallback.

## Audit, tests and native validation limits
- Use the existing mutation helper/audit pipeline, awaited before snapshots and create intents. Combat/Combatant and transient view/target effects remain explicitly view-only where the existing Undo allowlist does not support them; do not expand Undo authority for these tools or fabricate snapshots for local view changes.
- Native-shaped v13/v14 adapter tests cover options, hooks/time, all-defeated/empty progression, canonical state changes during awaits/hooks, refused/partial native results, token removal cascade refusal, explicit initiative no-chat behavior, activation consequences and feature absence. Real dispatcher tests cover fresh GM checks, destructive policy/rate/approval/audit category and session-grant isolation.
- Later live fixture planning must enumerate global scene activation, world-time, effect refresh and personal view consequences and obtain explicit approval before writing. Use only returned disposable fixture UUIDs, retain audit entries and restore approved fixture/personal state; do not claim arbitrary campaign state can be transactionally rolled back.

## Out of scope
- Player token and combat tools (22)
- Tables, playlists, notify (25)
