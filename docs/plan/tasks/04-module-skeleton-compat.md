# 04 — Build the module skeleton, v13/v14 compat layer and Foundry test stubs

**Repo:** .
**Depends on:** 01
**Owns:**
- module/src/main.ts
- module/src/compat/**
- module/src/settings/**
- module/test/stubs/**
- module/test/compat/**
- module/test/settings/**
- module/vitest.config.ts
- lang/en.json (insertions under `AGENT_GATEWAY.Settings.*` only)

## Goal
Turn the placeholder module entry into a real skeleton: lifecycle hooks, a
settings registry that later features append to, and a thin compat layer that
is the only code allowed to branch on Foundry generation (v13 vs v14) or probe
for v14-only features such as Scene Levels. Provide the stubbed Foundry globals
that every module unit test uses.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:68-71 — ApplicationV2 only; compat layer isolates v13/v14; v14 features only when present
- docs/plan/specs/2026-10-09-agent-gateway.md:89-91 — vitest against a stubbed Foundry API
- docs/conventions.md — `module/src/settings/index.ts` and `module/test/stubs/**` are insertion-only for later tasks

## Acceptance
- [ ] `module/src/compat/index.ts` exports `foundryGeneration()` (13 or 14, from `game.release.generation`), `hasSceneLevels()`, `ApplicationV2`/`HandlebarsApplicationMixin` accessors, and a `fromUuid` wrapper; no other file under `module/src` reads `game.release` (checked by a test that greps `module/src`)
- [ ] `module/src/settings/index.ts` exports `registerSettings()` calling a list of per-feature register functions, and registers the foundation settings: `gatewayUrl` (client), `pairingToken` (client, not shown in config), `includeOtherModuleData` (world, GM, default false)
- [ ] `main.ts` registers settings on `init` and logs `agent-gateway | ready (v<generation>)` on `ready`
- [ ] `module/test/stubs/foundry.ts` installs minimal `game`, `Hooks`, `CONST.USER_ROLES`, `foundry.applications.api`, settings and document-collection stubs, parameterised by generation 13 or 14; compat tests run against both
- [ ] All setting names and hints are `AGENT_GATEWAY.Settings.*` keys present in `lang/en.json`
- [ ] On https://foundry.local (v14, `test-world`, pf2e) the ready line shows `v14` and the three settings appear in module settings with correct scope; PR includes the console line. v13 marked pending if the instance is not up.

## Out of scope
- WebSocket client, pairing UI (07)
- Operation registry and tool handlers (08 onward)
- Policy settings (13, 15)
