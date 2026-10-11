# 20d — Add the public tool-pack API: registerPack, lifecycle, isolation and security tests

**Repo:** .
**Status:** Complete; implementation merged and archived after the completion audit. See done/README.md and HISTORY for evidence.
**Depends on:** 20c, 20
**Owns:**
- module/src/packs/**
- module/test/packs/api/**
- module/src/main.ts (insertions only: install the api in `init`, fire the hook in `setup`, seal at the start of `ready`)
- module/src/approvals/live.ts (remove the legacy `module.api` replacement only)
- module/test/stubs/** (insertions only: `game.modules`, `Hooks.callAll`)
- lang/en.json (insertions under `AGENT_GATEWAY.Packs.*` only)

## Goal
Let any Foundry module register namespaced AI tools with the core through a
small, frozen, versioned API, with every pack call running through the same
dispatcher pipeline as core tools and a broken pack unable to affect anything
but its own calls. This is the API third-party and premium packs build on.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md section 1 "Tool packs" (shape, trust model) and section 6 "Tool packs: distribution and licensing" (no DRM in the core)
- module/src/ops/registry.ts (20c) — `register`, `registerAll`, `seal`, `RegistryError`
- protocol/src/tools/rules.ts, validate.ts, limits.ts, pack.ts (20b)
- module/src/ops/dispatch.ts:50-55 — throws already map to `INTERNAL`
- task 19 `module/src/audit/stage.ts:210-214` — `ctx.snapshot`, `ctx.created`, `ctx.intendCreate`, `ctx.callOptions`
- module/src/main.ts — current `init` and `ready` hooks (as changed by 20)

## Design constraints (decided; implement as stated)
- **Surface.** `game.modules.get('agent-gateway').api` is a frozen object with exactly: `packApiVersion` (`'1.0'`), `registerPack(spec)`, `isSealed()`. No other key, no prototype methods beyond `Object.prototype`. Installed in the core's `init`.
- **Approval integration.** Remove `startApprovals`' legacy replacement of `module.api` with `resolveApproval` and `listApprovals`. Approval UI uses the internal `getApprovalManager()` import; the frozen public API stays exactly the three pack keys even after the approval ready hook runs.
- **Lifecycle.** The core calls `Hooks.callAll('agentGateway.registerPacks', api)` in its `setup`. Direct `registerPack` calls are accepted from the core's `init` until the start of its `ready` handler, which seals the registry before the link starts. Later calls throw `PackError` with code `SEALED` and a localized message telling the author to use the hook.
- **Spec.** `{id, version, apiVersion, prefix, tools: [{name, description, category, minRole, inputSchema, outputSchema, handler}]}`. The API reads each field once from a JSON round-trip copy of everything except handlers (so getters, Proxies and later mutation cannot change what was checked), deep-freezes the copy, then runs `checkToolDefinition(…, 'pack')` on every tool. `name` is the local name; the registered name is `<prefix>-<name>`.
- **Refusals** (each throws `PackError` with a code, registers nothing, and logs one `console.error` line): `API_VERSION` (major differs from the core's, or unparseable); `INACTIVE` (`game.modules.get(id)?.active !== true`, or `id === 'agent-gateway'`); `PREFIX_TAKEN` (another pack already uses the prefix, or a reserved prefix); `DUPLICATE` (a pack id registered twice); `INVALID_TOOL` (any rules problem, missing or unknown category, non-function handler, more tools than `TOOL_LIMITS.maxToolsPerPack` (32)). Registration of one pack is atomic.
- **Calls.** `parseArgs` for pack tools is `validateArgs(inputSchema)` from 20b. The handler receives a frozen view `{user: {id, isGM}, agent: {id, headless}, sessionId, tool, args, callOptions, snapshot, created, intendCreate}`, where the last three are bound functions forwarding to the live context (absent if 19's audit did not set them), never the live `OpContext` itself. The result must be `{text: string, structured: object}` within `TOOL_LIMITS`, and `structured` must pass `validateArgs(outputSchema)`. Otherwise the call returns `INTERNAL` "Tool pack <id> returned an invalid result" and logs the reason. A pack may return `{error: {code, message}}` only with `INVALID_ARGS` or `FORBIDDEN` (message capped at 500 characters); any other code becomes `INTERNAL`.
- No licence check, key check or network call of any kind in this code (spec section 6).

## Acceptance
- [ ] `Object.keys(api)` equals `['packApiVersion', 'registerPack', 'isSealed']`, `Object.isFrozen(api)` is true, and assigning to `api.registerPack` or adding `api.dispatch` has no effect (test)
- [ ] Shadowing refused: a pack registering local name `info` with prefix `world` registers `world-info`, not `world_info`; a pack trying prefix `ag` gets `PREFIX_TAKEN`; a second pack with the first pack's prefix gets `PREFIX_TAKEN`; in each case dispatching the existing tool still reaches its original handler (test)
- [ ] Category required: missing, `null`, `'admin'` and `'Read'` each give `INVALID_TOOL`, and nothing from that pack is registered (test)
- [ ] Hostile input: a spec whose `inputSchema` getter returns a valid schema on first read and `{anyOf: …}` on the second ends up registered with the valid one; mutating the caller's object after `registerPack` returns does not change `toolRegistry.info()`; a Proxy spec is handled the same way (tests)
- [ ] No bypass: a pack tool dispatched with spy stages at orders 10-50 runs all of them before its handler; when the policy stage returns `DENIED` or the approval stage withholds approval, the pack handler is never called (spy count 0); nothing reachable from `api` or from the handler's context object is the dispatcher, a stage, `STAGES`, another tool's handler or the registry (test walks both objects, including prototypes, to depth 3)
- [ ] The handler's context is frozen: setting `ctx.approved = true` or `ctx.tool = 'script_run'` inside a pack handler throws in strict mode and changes nothing the audit stage records (test with a stub audit stage)
- [ ] Error isolation: a pack handler that throws, one that returns a string, one that returns `{text: 1}`, one whose `structured` breaks its output schema, and one that returns 65 KiB of text each give `INTERNAL` for that call, while a following call to a core tool and to a second pack's tool succeed (test)
- [ ] Running the approval ready hook preserves the same frozen API object and its exact three keys (test)
- [ ] Lifecycle: `registerPack` inside the `agentGateway.registerPacks` hook succeeds; after the `ready` seal it throws `SEALED`; with `apiVersion: '2.0'` it throws `API_VERSION`; `'1.7'` is accepted (test with stubbed hooks)
- [ ] Disabled pack: with the stubbed `game.modules.get(id).active === false`, or the id unknown, `registerPack` throws `INACTIVE` and `toolRegistry.list()` has none of its tools (test)
- [ ] A pack tool with `minRole: 'gm'` called by a player returns `FORBIDDEN` before any stage runs (test)
- [ ] `grep -rniE "licen[cs]e|fetch\(|XMLHttpRequest|WebSocket" module/src/packs` is empty
- [ ] `npm run verify` passes

## Out of scope
- Announcing pack tools to the gateway and anything in the gateway (20e)
- The example pack and pack-author docs (20f)
- A GM switch to disable one pack's tools without disabling the module (open question; would belong to the policy app, 15)
- Exposing `defineWriteHandler` (21), `ctx.escalate` (24) or system adapters (31) to packs
- Cross-tool calls from one pack handler to another tool
- Handler timeouts beyond the gateway's call timeout
