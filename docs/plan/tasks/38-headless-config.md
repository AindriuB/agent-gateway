# 38 — Add headless agent configuration and enforcement

**Repo:** .
**Depends on:** 37, 15, 34
**Owns:**
- gateway/src/headless/config/**
- gateway/test/headless/config/**
- gateway/src/bin/cli.ts (`headless` subcommands only)
- gateway/src/store/** (new migration only)
- module/src/policy/** (headless toggle enforcement only)
- module/test/policy/** (headless cases only)
- protocol/src/link/messages.ts (insertions only)
- module/src/link/bridge.ts (owner from welcome only)

## Goal
Make headless agents configurable and safe: credentials in a 0600 config file or
env, per-agent config in SQLite, CLI subcommands to add, list and remove them,
and module-side enforcement of the GM's "headless agents" toggle and owner
assignment.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:105-108, docs/plan/specs/2026-10-09-agent-gateway.md:110-112 — headless credentials, storage
- docs/plan/specs/2026-10-09-agent-gateway.md:132-134 — headless agents off until the GM enables them
- gateway/src/headless/** (37); module/src/policy/** (13)

## Acceptance
- [ ] `foundry-agent-gateway headless add|list|remove` manage entries (foundryUrl, user, password reference, owner Foundry user id); passwords only in the 0600 file or `AGENT_GATEWAY_HEADLESS_<NAME>_PASSWORD`, never in SQLite (test)
- [ ] Module denies every call from a headless agent while `headlessAgentsEnabled` is false, with a localized reason
- [ ] `welcome` gains optional `ownerUserId`; for headless connections the gateway sends the configured owner and the bridge uses it for `ctx.agent.ownerUserId`, so ask_owner approvals reach that human
- [ ] `npm run verify` passes

## Out of scope
- Docker image (42)
