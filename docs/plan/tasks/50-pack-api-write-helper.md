# 50 — Pack API 1.1: a vetted write helper and the bulk-write contract

**Repo:** .
**Status:** Planned — do not start; queued after current workloads (32, 44, and the five gap tasks)
**Depends on:** 47, 48
**Owns:**
- protocol/src/tools/pack.ts (`PACK_API_VERSION` bump to `1.1` and additive types only)
- module/src/packs/**
- module/test/packs/api/**
- docs/packs/** (except `docs/packs/naming.md`)
- examples/hello-pack/**
- module/test/packs/example/**

## Goal
Pack authors re-implement the fail-closed audit wrapper that core tools get from
`defineWriteHandler`, and a mistake there is an unaudited write. Pack API 1.1 exposes a
vetted equivalent and documents the bulk-write contract: one call is one approval, one audit
entry and one undo group, under a fixed target cap. The GM builder packs (54–56) build on it.
Packs still cannot call other tools.

## Context
- module/src/tools/_write.ts:58-84 shows the core helper: it fails closed without audit capabilities, uses only the trusted user, snapshots targets and maps WriteError.
- module/src/packs/api.ts:
  - :30-40 `PackContext`
  - :75-86 is the frozen context view, which exposes `callOptions`, `snapshot`, `created` and `intendCreate` only when present (:81-84).
- docs/packs/api.md:74-76: the helpers are "when present", so authors must check them.
- examples/hello-pack/scripts/main.js:94-99 has the pack's own hand-written check.
- docs/packs/versioning.md: minors are additive, and the major must match.
- AUDIT_LIMITS.targets 50 (module/src/audit/types.ts:78); excess targets are dropped (module/src/audit/stage.ts:176-181).

## Acceptance
- [ ] `PACK_API_VERSION` is `1.1`. A 1.0 pack still registers and runs unchanged, and module/test/packs/api/** proves it.
- [ ] The pack API exposes a frozen `writeHandler({targets, run})`. It returns INTERNAL without audit capabilities and a valid `callOptions.agentGateway.callId`, exactly like `defineWriteHandler`. It also provides `forbid`, `invalid` and a frozen `bounded(value)` that applies the limits of module/src/tools/_documents.ts:40-65.
  - Unit tests: a pack write with missing `snapshot` fails closed with no native call; a `WriteError` maps to its code; the helper's user is the server-set user, never `ctx.args`.
- [ ] The helper exposes `maxTargets` (a value below `AUDIT_LIMITS.targets`) and refuses a declared batch larger than it before any write. A unit test covers this.
- [ ] Packs get no way to invoke another tool. A unit test asserts that the pack context and the API object have no dispatch, registry or handler reference (no `HANDLERS`, `dispatch` or `call` key at any depth of the frozen API).
- [ ] docs/packs/api.md documents the bulk-write contract: one approval, one audit entry, one undo group, the target cap, and that every created document is declared. docs/packs/versioning.md lists what is new in 1.1.
- [ ] examples/hello-pack uses `writeHandler`, and module/test/packs/example/** passes.
- [ ] Player-role sessions never see a GM pack tool in tools/list: a test in module/test/packs/api/ registers a `minRole:'gm'` pack tool and asserts it is absent from the player toolset.
- [ ] Native acceptance on v14 and v13 (`npm run test:e2e` packs suite, with `--foundry v13` when `AGENT_GATEWAY_E2E_V13_URL` is set). The hello pack write audits and undoes on both. Native execution needs Andrew's per-run approval.
- [ ] `npm run verify` passes

## Out of scope
- Cross-tool calls from packs
- New core tools; the gm-builder pack itself (54–56)
- Raising AUDIT_LIMITS (module/src/audit/**)
