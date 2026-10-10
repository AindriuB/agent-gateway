# 20c — Make the operation registry the single tool source and register core tools through it

**Repo:** .
**Depends on:** 20b, 14, 16, 19
**Owns:**
- module/src/ops/registry.ts
- module/src/ops/core-tools.ts
- module/src/ops/dispatch.ts
- module/src/ops/index.ts (insertions only)
- module/src/policy/stage.ts (the default tool lookup only)
- module/src/ratelimit/stage.ts (the default tool lookup only)
- module/src/approvals/stage.ts (the default tool lookup only)
- module/src/approvals/manager.ts (the default tool lookup only)
- module/src/audit/index.ts (the default `categoryOf` only)
- module/test/ops/registry/**

## Goal
Replace every "find the tool by name in the protocol's static `TOOLS`" in the
module with one registry, so that core tools and (from 20d) pack tools are known,
checked and dispatched the same way. Core tools register through the same
`register` path a pack will use, which is the dogfooding the spec asks for. No
behaviour visible to an agent changes in this task.

## Context
- module/src/ops/dispatch.ts:23-60 — the dispatcher; `config.tools.find(...)` and `HANDLERS` today
- module/src/tools/index.ts — `HANDLERS`; protocol/src/tools/index.ts — `TOOLS` (both stay the source of core tools, and stay insertion-only for 21-33)
- module/src/policy/stage.ts:46,52 — `config.tools ?? TOOLS` lookup
- task 14 `module/src/ratelimit/stage.ts` — `config.tools ?? TOOLS`, `bucketFor(category)`
- task 16 `module/src/approvals/stage.ts` and `manager.ts` (`(this.opts.tools ?? TOOLS).find(...)` on the approver's client)
- task 19 `module/src/audit/index.ts` — `categoryOf: (tool) => TOOLS.find(...)`
- protocol/src/tools/rules.ts (20b) — `checkToolDefinition`
- docs/plan/specs/2026-10-09-agent-gateway.md section 1 "Operation registry"

## Design constraints (decided; implement as stated)
- `registry.ts` exports a `ToolRegistry` class and the live instance `toolRegistry`. Entries hold: `name`, `category`, `minRole`, `description`, `inputSchema`, `outputSchema` (JSON), `parseArgs(args)` (returns `{ok, data}` or issues), `origin` (`'core'` or `{packId, version, prefix}`), and the handler. The handler lives in a module-private `WeakMap` or closure. `info(name)` returns a frozen record with no function-valued field. `list()`, `forRole(isGM)` and `categoryOf(name)` are built on `info`. Only `dispatch.ts` can get a handler, through a non-exported accessor or one passed at construction.
- `register(entry)` refuses, with a typed `RegistryError` and no partial change: a duplicate name (core vs core, or anything vs an existing name), a category outside the four, a missing category, `minRole` outside `player`/`gm`, any `checkToolDefinition` problem for the entry's origin, and any call after `seal()`. `registerAll(entries)` is atomic: all or none.
- `core-tools.ts` registers every `TOOLS` entry with its `HANDLERS` handler, with `parseArgs` = the tool's zod `safeParse` (so core defaults, coercions and error messages are unchanged) and JSON schemas from `toJsonSchema`. A `TOOLS` entry without a handler, or a handler without a `TOOLS` entry, throws at load.
- `createDispatcher({tools, handlers, stages})` keeps its signature (it builds a private registry from the arrays), so the existing dispatcher tests are untouched; the exported `dispatch` uses `toolRegistry`.
- Each stage keeps its existing `tools?` (or `categoryOf`) option, so the existing tests that inject fixture tools are untouched; only the default changes from `TOOLS` to the registry.

## Acceptance
- [ ] `grep -rn "TOOLS" module/src` finds only `module/src/ops/core-tools.ts` (and the `toolsForRole` import in `module/src/link/toolset.ts`, which 20e removes)
- [ ] `git diff origin/main -- module/test/policy module/test/ratelimit module/test/approvals module/test/audit module/test/ops/dispatch*` is empty, and those suites pass
- [ ] Registry tests: registering a second `world_info` throws `RegistryError` and the original entry's handler still answers a dispatched call; category `'admin'`, `undefined` and `'READ'` are each refused; `minRole: 'owner'` is refused; a `registerAll` of three entries whose third is invalid leaves `list()` unchanged; `register` after `seal()` throws
- [ ] `info(name)` and every element of `list()` are frozen and have no function-valued property at any depth (test walks them)
- [ ] Dispatch of a registered fixture tool runs every stage in `STAGES` in order before the handler (spy stages at orders 10, 20, 25, 30, 40), and a stage that short-circuits means the handler is never called
- [ ] A fixture tool registered with no category is impossible (refused); a registry entry whose category is later reported as unknown by `categoryOf` (forced through a test seam) is `DENIED` by the policy stage and charged to the `write` bucket by the rate-limit stage
- [ ] A load-time test: removing one `HANDLERS` entry in a test copy makes `core-tools.ts` throw naming that tool
- [ ] The approver-side lookup in `approvals/manager.ts` uses the registry: a relayed request for a name the approver's registry does not know is dropped (existing behaviour, now via the registry; test)
- [ ] `npm run verify` passes; the e2e read suites pass unchanged on v14 (`npm run test:e2e`), v13 pending if absent

## Out of scope
- `game.modules.get('agent-gateway').api`, `registerPack`, pack validation, lifecycle hooks (20d)
- The `toolset` link message and anything in the gateway (20e)
- Changing core tool schemas, names, error messages or stage orders
- Adding `ctx.escalate` (24)
