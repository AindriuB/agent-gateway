# 02 — Define the module-gateway link protocol and version handshake

**Repo:** .
**Depends on:** 01
**Owns:**
- protocol/src/link/**
- protocol/test/link/**

## Goal
Define, once in zod, every message that crosses the WebSocket between the module
and the gateway for the foundations wave: hello/welcome/reject handshake with
pairing, tool call and result, ping/pong, and the error code set. Include the
protocol version and the rule that a major mismatch is refused with an
actionable message.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:33-47 — architecture; module is the WebSocket client
- docs/plan/specs/2026-10-09-agent-gateway.md:68-76 — pairing code, pairing token in client settings
- docs/plan/specs/2026-10-09-agent-gateway.md:113-118 — lifecycle: gateway outlives Foundry, module reconnects
- docs/plan/specs/2026-10-09-agent-gateway.md:195-196 — handshake refuses major mismatch with an actionable message
- docs/conventions.md — `protocol/src/link/messages.ts` is insertion-only for later tasks

## Acceptance
- [ ] `protocol/src/link/messages.ts` exports zod schemas and a discriminated union `LinkMessage` on `type` for: `hello` (protocolVersion, moduleVersion, foundryVersion, world {id,title,system,systemVersion}, user {id,name,role,isGM}, auth: pairing code or pairing token), `welcome` (gatewayVersion, protocolVersion, connectionId, agentId (stable id of the pairing), optional issued pairingToken), `reject` (code, message), `call` (id, sessionId, tool, args), `result` (id, ok true, text, structured), `error` (id, code, message), `ping`, `pong`
- [ ] `protocol/src/link/errors.ts` exports the code enum including `WORLD_OFFLINE`, `PROTOCOL_MAJOR_MISMATCH`, `PAIRING_INVALID`, `TOOL_NOT_FOUND`, `FORBIDDEN`, `INVALID_ARGS`, `RATE_LIMITED`, `DENIED`, `INTERNAL`
- [ ] `protocol/src/link/version.ts` exports `PROTOCOL_VERSION` and `checkCompat(local, remote)` returning ok, or a reject whose message names both versions and says which side to upgrade
- [ ] `parseLinkMessage(raw)` rejects unknown `type`, extra keys (strict objects) and frames over a size limit exported as `MAX_FRAME_BYTES`
- [ ] Unit tests cover round-trip of every message type, major mismatch rejection, minor mismatch acceptance, oversize and malformed frames; `npm test -w protocol` passes

## Out of scope
- Tool definitions and JSON Schema generation (03)
- Event, approval and revocation messages (16, 18, 27)
- Any socket code on either side (06, 07)
