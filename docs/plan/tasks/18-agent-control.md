# 18 — Add agent management: kill switch, pause, revoke and per-agent overrides

**Repo:** .
**Depends on:** 14, 70
**Owns:**
- module/src/agents/**
- module/src/apps/agents/**
- templates/agents/**
- module/test/agents/**
- module/src/ops/stages.ts (insertions only)
- module/src/settings/index.ts (insertions only)
- protocol/src/link/messages.ts (insertions only)
- gateway/src/link/**
- gateway/test/link/**
- styles/agent-gateway.css (agents section only)
- lang/en.json (insertions under `AGENT_GATEWAY.Agents.*` only)

## Goal
Let the GM stop everything at once and manage individual agents: a world kill
switch, per-agent pause and revoke, and per-agent rate-limit overrides, from an
agents app in module settings. Revoking also invalidates the pairing token at
the gateway.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:139 — GM kill switch, per-agent pause and revoke
- docs/plan/specs/2026-10-09-agent-gateway.md:128-131 — per-agent rate override
- module/src/ratelimit/** (14); gateway/src/link/** and store (06)
- module/src/ops/stages.ts — stage order 10

## Acceptance
- [ ] Agent registry (world setting) records agentId, label, ownerUserId, headless, firstSeen, lastSeen; written by a GM client (relayed over the module socket when the owner is a player)
- [ ] Agent-control stage (order 10): kill switch on, agent paused or revoked -> `DENIED` with a localized reason
- [ ] Agents app: GMs list all agents with pause, revoke, rate overrides, and the kill switch; players see their own agents with pause and revoke
- [ ] Revoke sends new link message `revoke {agentId}`; gateway sets `revoked_at`, closes the connection, and later `hello` with that token gets `PAIRING_INVALID` (gateway test)
- [ ] Unit tests for stage decisions and registry updates; manual check on foundry.local v14 with screenshots

## Out of scope
- OAuth token revocation (36)
- Headless agent configuration (38)
