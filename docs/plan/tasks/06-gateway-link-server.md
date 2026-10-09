# 06 — Add the gateway's module link server, pairing and store

**Repo:** .
**Depends on:** 02
**Owns:**
- gateway/src/link/**
- gateway/src/store/**
- gateway/test/link/**
- gateway/test/store/**

## Goal
Accept WebSocket connections from module instances, pair them with a one-time
code printed on start, issue a pairing token, and keep a registry of live
connections keyed by world and Foundry user. Add the SQLite store that holds
hashed pairing tokens (and later OAuth and event data), never world data.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:72-73 — one-time pairing code shown by the gateway; token kept in module client settings
- docs/plan/specs/2026-10-09-agent-gateway.md:101 — one gateway can hold several module connections
- docs/plan/specs/2026-10-09-agent-gateway.md:110-118 — storage rules, lifecycle
- protocol/src/link/** — messages, version check, frame limit (02)

## Acceptance
- [ ] `gateway/src/store/` exposes a `Store` interface backed by `node:sqlite` with versioned migrations; first migration creates `pairings(id, token_hash, world_id, user_id, created_at, revoked_at)`; `welcome.agentId` is `pairings.id`; tokens stored as SHA-256 hashes only (test asserts the raw token is absent from the DB file)
- [ ] `gateway/src/link/server.ts` listens on `127.0.0.1` at the configured link port; binding to another address requires an explicit option
- [ ] Connections whose `Origin` is not in the configured allowlist are refused before the handshake (test)
- [ ] `PairingCodes` generates a code of the form `XXXX-XXXX` (unambiguous alphabet), single use, expires after 10 minutes; `hello` with a valid code yields `welcome` with a fresh pairingToken; reused or expired code yields `reject` `PAIRING_INVALID`
- [ ] `hello` with a known unrevoked token for the same world/user yields `welcome` without a new token; major protocol mismatch yields `reject` `PROTOCOL_MAJOR_MISMATCH` with the message from `checkCompat`
- [ ] `LinkRegistry` tracks connections by `(worldId, userId)`, replaces a stale duplicate, emits connected/disconnected, and provides `call(conn, tool, args, timeoutMs)` resolving on `result`/`error`; closed connections reject pending calls with `WORLD_OFFLINE`
- [ ] Heartbeat: ping every 15 s, drop after two missed pongs (fake-timer test)
- [ ] Tests use a real `ws` client against the server; `npm test -w gateway` passes

## Out of scope
- Printing the code from the CLI and wiring into `app.ts` (11)
- MCP routing (11), OAuth tables (35), event buffer (28)
- Module-side client (07)
