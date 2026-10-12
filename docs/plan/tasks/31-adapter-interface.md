# 31 — Add the system adapter interface and adapter tools

**Repo:** .
**Depends on:** 21, 20d, 20e
**Status:** Source verified at `76a111cad1ea292fe33f6b79902e896fa4b01698`: build/lint, 3,580 fast / 2,227 slow tests and both independent reviews passed. Source merged in PR #82 (head `1d4743b`, main `783ba3a`); bounded native validation is accepted as recorded below; this contract stays active pending validation publication/merge. Dependencies are merged. No further Task31 native writes are authorized by this record.
**Owns:**
- module/src/adapters/index.ts
- module/src/adapters/types.ts
- module/src/adapters/generic/**
- module/test/adapters/generic/**
- module/test/adapters/contract.ts
- protocol/src/tools/actor-summary.ts
- protocol/src/tools/actions-list.ts
- protocol/src/tools/action-perform.ts
- protocol/src/tools/inventory.ts
- protocol/src/tools/conditions.ts
- protocol/src/tools/index.ts (insertions only)
- module/src/tools/actor-summary.ts
- module/src/tools/actions-list.ts
- module/src/tools/action-perform.ts
- module/src/tools/inventory.ts
- module/src/tools/conditions.ts
- module/src/tools/index.ts (insertions only)
- module/src/tools/_adapters.ts (shared canonical Actor access and bounded result handling only)
- module/src/ops/context.ts (trusted core conditions read-to-write classification only)
- module/test/ops/context.test.ts (conditions classification/preparation boundaries only)
- module/test/tools/adapters/** (five-tool permission, dispatch, audit and pack-API invariance checks)
- protocol/test/tools/adapters/** (five-tool schema, bounds and registration checks)
- protocol/test/tools/rules/validate.test.ts (five valid adapter examples only, preserving exhaustive assertions)

## Goal
Define the system adapter interface and the five adapter tools that call it,
with a generic fallback adapter for unsupported systems and a shared contract
test suite every concrete adapter must pass.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:159-161 — adapter interface: actorSummary, listActions, performAction, inventorySemantics, conditions
- docs/plan/specs/2026-10-09-agent-gateway.md:143-150 — adapter tools are available to all roles
- module/src/tools/_write.ts (21)
- These are core tools: add them to `protocol/src/tools/index.ts` `TOOLS` and `module/src/tools/index.ts` `HANDLERS` as before; `module/src/ops/core-tools.ts` (20c) registers them through the same registry path as pack tools, and `checkToolDefinition(…, 'core')` (20b) must pass for each (the 20b test sweeps `TOOLS`)
- Adapters are **not** tool packs (decided 2026-10-10): an adapter implements a fixed interface behind fixed core tool names, so the AI sees the same five tools on every system. Making each adapter a pack would namespace them per system (`dnd5e-actor_summary`), hide the abstraction the two v1 adapters exist to test, and add an install step to the five-minute setup. Adapters stay internal in v1 and are not reachable through `game.modules.get('agent-gateway').api`

## Acceptance
- [x] `types.ts` declares `SystemAdapter {systemId, actorSummary(actor), listActions(actor), performAction(actor, actionId, options), inventorySemantics(actor), conditions(actor, change?)}` with result types that stay within conservative schema rules and a separate internal trusted execution context for mutation methods
- [x] `index.ts` selects the adapter by `game.system.id` from a registry; unknown systems get the generic adapter (summary from name/img/type, empty actions, `action_perform` returns `INVALID_ARGS` "not supported for <system>")
- [x] Tools: `actor_summary` (read), `actions_list` (read), `action_perform` (write), `inventory` (read), `conditions` (read when no change requested; change escalates to write via `ctx.escalate`); all player role; actor must be owned (or GM)
- [x] `contract.ts` exports a test suite taking an adapter and fixtures; the generic adapter passes it
- [x] Guards pass, including tool-count
- [x] `Object.keys(game.modules.get('agent-gateway').api)` is unchanged by this task (test), so no adapter surface leaks into the pack API
- [x] `npm run verify` passes

## Out of scope
- dnd5e (32) and pf2e (33) implementations
- A public `registerAdapter` for third-party systems (open question for Andrew; v1.x "more system adapters")

## Bounded adapter and admission contract

- Keep the five names fixed core tools, selected through a static internal adapter registry by the current `game.system.id`. There is no public registration or pack API surface, adapter tool namespace, new protocol message or protocol major change. Unknown systems select the generic fallback. Existing core-role/count/schema limits remain unchanged; any actual limit conflict must be reported before changing a ceiling.
- Task31 supports only canonical top-level world Actors: resolve the exact UUID through the native compatibility API and require Actor class/document type, matching UUID and identity in `game.actors`, no parent/compendium/synthetic Token association, and a current canonical native user. Before invoking any adapter, require current OWNER permission or native GM status plus the current role's folder policy. GM status does not bypass folder restrictions. Reject missing, forged, compendium, synthetic, unseen or unauthorized targets uniformly without exposing their names or other metadata. Synthetic support is deferred until a later scoped design can enforce Token ancestry/perception safely.
- The generic summary returns only bounded native UUID/name/img/type/system identity, never raw `system`, flags, biography, embedded items/effects or other module data. Generic actions are empty. Generic inventory and conditions reads return explicit unsupported metadata with empty lists, rather than guessing system semantics. Generic `action_perform` and conditions changes return `INVALID_ARGS` with bounded unsupported-system text and invoke no native mutator. Future dnd5e/pf2e adapters implement the same typed interface in tasks32/33.
- Public outputs share canonical `actorUuid`/`systemId` plus strict shapes: summary `name`/`img`/`type` and at most 64 string-valued attributes; actions `supported` plus at most 128 named actions with optional bounded description/group/cost/uses strings; perform `completed`/`message`; inventory `supported`, at most 256 named Item summaries with optional bounded finite nonnegative quantity, bounded weight string and boolean equipped/invested fields and 16 string-valued totals; conditions `supported` and at most 128 named conditions with optional finite numeric value. Generic collections are empty, with unsupported reads marked `supported:false`. Inputs use bounded Actor/action/condition IDs; optional action options are an at-most-8192-character JSON object subject to explicit structural limits, and conditions change is a strict `{id, active, value?}` object with an optional integer value in 0..1000.
- Use strict conservative JSON schemas with named bounded strings, arrays, result sizes and optional argument limits. Adapter results must pass the exact public output schema and byte cap before structured or text response delivery; malformed, throwing or oversized results become a per-call `INTERNAL` result and cannot break the shared connection. Do not stringify arbitrary objects or silently coerce invalid result fields. Any flexible action options must remain bounded inert data, never code, a native method name/path, identity or policy/category provenance.
- `conditions` remains canonically read for its definition. A supplied valid change is classified as write by trusted synchronous core preparation and matching `actionCategory` logic before policy, rate limits, approval and audit. Caller arguments and adapter code cannot choose a weaker category or escalate after preparation. Conditions without a change remain read. The gateway's offline queue conservatively refuses all base-read conditions calls, including changes, with `WORLD_OFFLINE`; Task31 does not expand offline replay or alter protocol6 wire semantics.
- Keep caller options separate from a final internal `AdapterExecutionContext` argument. Mutation methods receive the canonical native user and existing audited `callOptions`, `snapshot`, `intendCreate` and `created` capabilities from the tool wrapper; conditions reads may omit this context. The wrapper is readonly/frozen without freezing native Foundry objects. No caller JSON, public API or adapter registration can supply trusted capabilities. Reuse the five owned protocol files' exported strict schemas and inferred result types so adapters and tool outputs share one contract.
- Mutating adapter calls remain inside the ordinary dispatcher and audited write capabilities. Resolve/recheck the current Actor, native user/ownership and folder policy after any approval and immediately before adapter invocation; snapshot validated existing targets before mutation and use existing call/audit correlation. Unsupported generic operations perform no world writes. Do not call adapters from preparation, tool announcement, public pack API or bypass the approval/audit pipeline. Preserve Task30 replay provenance and source/admission rules for the new write tool.

## Required regression and native limits

- Shared adapter contract fixtures check strict bounded summary/action/inventory/condition shapes, generic unsupported behavior and no native mutation. Five-tool tests verify exact registration/role/count guards, internal registry fallback, unchanged public pack API keys, and current native ownership/GM/folder access before adapter invocation.
- Cover noncanonical/missing/compendium/synthetic Actor rejection, denied folder even for GM, malformed/throwing/oversized adapter outputs, inert bounded options, read-versus-change conditions classification before each policy/rate/approval/audit stage, no late/forged escalation, ownership/folder loss while approval waits, and snapshot/audit behavior for a fake supported adapter. Existing online calls, ordinary offline reads and Task30 replay remain unchanged.
- No Task31 native mutation or installed deployment is authorized by implementation permission. After source review and the required full gate, propose exact fresh consent for any native test fixtures, actions, approval dialogs and cleanup. Task30 native evidence does not establish adapter behavior.

## Bounded native acceptance scope

- Validate generic native plumbing on both configured PF2e worlds before starting Task33. The proposed fixed scope is one temporary GM-private NPC and six real SDK calls per world: summary, actions, inventory and conditions reads, then unsupported action and condition-change calls. Two real human once approvals admit the unsupported writes; each must return `INVALID_ARGS` and retain one error audit with an unchanged existing Actor snapshot. Reads produce no audit. This does not validate concrete PF2e semantics or player permissions.
- Before fixture creation, prove the exact tested runtime bundle/fallback, canonical sole GM, actual read-allow/write-ask_owner policy, fixture admissibility under current GM folder restrictions and native audit subtype/anchor/routing. Serve the verified bundle only to test browsers and use an isolated gateway with read-only credential import; change no world settings.
- Verify the fixture full source/version after each unsupported call, track and drain every SDK/approval continuation, and fence nonexecutable failed continuations before any exact fixture deletion. Restore participant views and verify original documents/settings/world time and credential databases. Retain the two error audits per world. Exact fixture payloads, targets, audit writes and cleanup still require fresh scoped human approval; this plan does not grant it.

## Native validation result; publication pending

Bounded generic native validation is accepted on Foundry 13.351 and 14.369. V13 completed the automated proof; v14 retained an automated audit-encoding failure and was accepted from separately reviewed read-only reconciliation. Each world completed six SDK calls (four reads and two human once-approved unsupported writes), retained two matching error audits with unchanged Actor snapshots, and deleted its exact private fixture. Original documents/settings/views/world time and credential databases were preserved.

Final reusable harness `5f4bab8a78605748a3db52391b8ac03b5fa84fe7` passed build/lint, 3,595 fast / 2,227 slow tests, 15 independent offline harness checks, strict TypeScript, ESLint and actual-tsx callback serialization. Runtime source remains `68e1b4216ad05cfe77ff138b5045768aca776a59`, served bundle `cde74e8bd0252019a53cdfad410fe08ebc3ce041b67460e55430379bbe48e945`. V14 ran `1e8acbf` and reconciled read-only at `5f4bab8`; v13 ran `5f4bab8`.

This proves GM generic plumbing only, not concrete PF2e semantics, player ownership/privacy, policy races, supported adapter mutations or installed deployment. V14's unpersisted volatile capture-error state cannot be reconstructed; saved terminal calls, unique approval IDs and absence of queued frames were checked separately. The original v14 result remains failed, cleaned and free of teardown errors. Any repeat requires fresh scoped approval.
