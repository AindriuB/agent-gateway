# 29 — Add offline event reading with retention and purge

**Repo:** .
**Depends on:** 28, 15
**Owns:**
- module/src/events/offline-setting.ts
- module/src/apps/policy/** (offline-reading section only)
- templates/policy/** (offline-reading section only)
- protocol/src/link/messages.ts (insertions only)
- gateway/src/events/**
- gateway/test/events/**
- module/src/settings/index.ts (insertions only)
- lang/en.json (insertions under `AGENT_GATEWAY.OfflineEvents.*` only)
- docs/security.md

## Goal
Let a GM choose whether agents may read buffered events while the world is
offline, with a retention window and a purge button. Gateways honour the setting
in software; the docs must say so plainly.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:175-178 — offline event reading setting, default off, 14-day retention, purge, honour by software

## Acceptance
- [ ] World setting `offlineEventReading {enabled:false, retentionDays:14}` edited in the policy app (GM only), with a "Purge buffered events" button
- [ ] Module sends link message `eventPolicy {enabled, retentionDays}` on connect and change; `purgeEvents` on button press; gateway deletes all buffered events for that world and replies with a count shown in a notification
- [ ] When disabled, gateway refuses `events_poll`/`events_history` while the connection is offline with `WORLD_OFFLINE`, and `events_history` is not listed
- [ ] Gateway deletes events older than the retention window hourly and on start (fake-clock test)
- [ ] `docs/security.md` gains a section stating that player gateways enforce this by software, not cryptography
- [ ] `npm run verify` passes

## Out of scope
- Offline write queueing (30)
