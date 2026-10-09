# 07 — Add the module's WebSocket link client and pairing app

**Repo:** .
**Depends on:** 02, 04
**Owns:**
- module/src/link/**
- module/src/apps/pairing/**
- templates/pairing/**
- module/test/link/**
- module/src/main.ts (insert the link start/stop call only)
- module/src/settings/index.ts (insertions only)
- lang/en.json (insertions under `AGENT_GATEWAY.Link.*` and `AGENT_GATEWAY.Pairing.*` only)

## Goal
Let a Foundry user connect their client to a gateway: an ApplicationV2 pairing
app takes the gateway URL and the code the gateway printed, the module performs
the handshake, stores the issued token in a client setting, and from then on
reconnects automatically with backoff. Version mismatch is shown to the user
with the gateway's actionable message.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:72-73 — pairing code, token in client settings
- docs/plan/specs/2026-10-09-agent-gateway.md:113-118 — auto-reconnect with backoff
- protocol/src/link/** — handshake and messages (02)
- module/src/compat/**, module/src/settings/** — from 04

## Acceptance
- [ ] `module/src/link/client.ts` connects to `gatewayUrl`, sends `hello` with world, user, versions and either the stored token or a supplied code; stores `welcome.pairingToken` into the `pairingToken` client setting
- [ ] Reconnect uses exponential backoff 1 s to 60 s with jitter, resets on successful `welcome`; `reject` `PAIRING_INVALID` clears the token and stops retrying; `PROTOCOL_MAJOR_MISMATCH` stops retrying and shows `ui.notifications.error` with the gateway message (fake-timer tests)
- [ ] Inbound `call` frames are passed to an injectable `onCall` handler; with none installed the client replies `error` `TOOL_NOT_FOUND`
- [ ] Pairing app is an ApplicationV2 (via compat accessors) opened from a settings menu entry; fields: gateway URL, pairing code; shows connection state (disconnected, connecting, connected as <user> to <world>)
- [ ] Every user-visible string is a `lang/en.json` key
- [ ] Manual check on foundry.local v14: pairing app opens, a wrong code shows the localized invalid-code message (gateway from 06 run by a test script or 11); PR includes a screenshot

## Out of scope
- Dispatching calls into the operation registry (11)
- Agent list, pause, revoke (18)
- Event sending (27)
