# 25 — Add GM tools table_roll, playlist_control and notify

**Repo:** .
**Depends on:** 23, 20d, 20e
**Status:** Complete; PR #67 merged at `6ec99ff3d8d526e232b7b48e6cefb78e76f597ee`. Bounded native v13/v14 acceptance and coverage limits are recorded in PLAN and HISTORY.
**Owns:**
- protocol/src/tools/table-roll.ts
- protocol/src/tools/playlist-control.ts
- protocol/src/tools/notify.ts
- protocol/src/tools/index.ts (insertions only)
- module/src/tools/table-roll.ts
- module/src/tools/playlist-control.ts
- module/src/tools/notify.ts
- module/src/tools/_ambience.ts (shared bounded canonical-document and current-GM guards)
- module/src/tools/notify-receiver.ts (idempotent ready-time notification receiver only)
- module/src/compat/index.ts (Task25 native table-result and audited playlist adapters only)
- module/test/compat/gm-ambience.test.ts
- protocol/test/tools/rules/validate.test.ts (three canonical Task25 argument examples only)
- module/src/tools/index.ts (insertions only)
- module/test/tools/gm-ambience/**
- module/test/stubs/** (insertions only)

## Goal
Round out the GM tool set with rollable tables, music control and on-screen
notifications to players.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:151-153 — GM tools
- module/src/tools/_write.ts (21)

- These are core tools: add them to `protocol/src/tools/index.ts` `TOOLS` and `module/src/tools/index.ts` `HANDLERS` as before; `module/src/ops/core-tools.ts` (20c) registers them through the same registry path as pack tools, and `checkToolDefinition(…, 'core')` (20b) must pass for each (the 20b test sweeps `TOOLS`)
## Acceptance
- [ ] `table_roll` (gm, write): args `tableUuid`, optional `toChat` (default true), optional `rollMode`; returns result text and drawn document uuids
- [ ] `playlist_control` (gm, write): action enum play|stop|next|set_volume with `playlistUuid`, optional `soundUuid`, `volume` 0..1
- [ ] `notify` (gm, write): args `message` (max 300 chars), `level` info|warn|error, optional `users`; message is prefixed with the AI marker text from `lang/en.json`
- [ ] Guards pass; manual check on foundry.local v14

## Native behavior and security boundaries

All three schemas are closed. Resolve world UUIDs through native collections and
require the authenticated, current Foundry user to remain the same GM after every
await and immediately before a native mutation. Caller user IDs, payload roles,
options and UUID-shaped strings never establish authority. Preserve the existing
policy/approval/audit pipeline and pass the original call options to each explicit
document mutation; record actual created chat UUIDs and honest partial failures.
Protect designated audit documents and reserved gateway metadata. No new Undo
classes or authority are added; unsupported targets remain view-only.

### Table draw

- One world RollTable, at most 100 canonical TableResults and 20 selected results.
  Validate finite ranges and bounded text before rolling. Use the existing bounded
  arithmetic/dice grammar and at most 100 native roll attempts; refuse missing or
  unsupported stored formulas, exhausted tables and invalid results explicitly.
  Do not silently normalize, save a formula, reset drawn flags or recursively draw
  another table. Selecting a nested RollTable result is explicitly unsupported.
- Preserve non-replacement drawn-state behavior through explicit TableResult
  updates with call options, fresh parent/result identity and version/source
  checks. Replacement draws do not set drawn flags. No compendium table writes.
- Return result text and referenced document UUIDs without executing references or
  enriching untrusted HTML. `toChat: false` creates no chat. Otherwise create one
  AI-marked chat with escaped, inert result text and the native roll. `rollMode`
  accepts publicroll|gmroll|blindroll|selfroll; preserve native recipient/blind
  privacy on both generations and validate it before any mutation. Never call
  native draw/toMessage wrappers that silently omit audit options.

### Playlist control

- One canonical world Playlist with at most 100 canonical PlaylistSounds.
  `soundUuid`, when present, must name its exact embedded sound. Volume is finite
  0..1 and required only for set_volume, which changes the selected sound or all
  sounds when omitted. No caller media paths, formulas or native options.
- Reproduce native play/stop behavior for selected sound or whole playlist,
  including playback mode, paused resume, shuffle/sequential order and stopped
  sound state. `next` follows native sequential/shuffle wrap and same-track
  forceSync semantics; reject unsupported modes/empty selections explicitly.
  Keep native seed/update behavior and call options in explicit audited updates.
- PlaylistSound has no native own stats in v13/v14: require its canonical parent,
  finite parent version and bounded source fingerprint; never invent a timestamp
  or relax root-version checks. Recheck all affected identities/source after
  awaits and validate actual native update results.
- Audio playback and subsequent native playback lifecycle callbacks can affect
  listeners and later playback state. Report this boundary honestly; do not claim
  an atomic audio transaction, automatic Undo or correlation of future natural
  track-end callbacks with the original call.

### Notifications

- `users` contains unique native world User IDs, at most 20. Omission selects all
  active world users including the caller, with the same bound; reject excess or
  unknown/inactive targets rather than truncating or broadcasting accidentally.
  Escape the complete localized AI-marker prefix and message as plain text;
  map warn to the native warning level. No HTML, arbitrary options or persistence.
- A remote receiver must authenticate the sender using independently verified
  native server-provided identity for that Foundry generation and re-resolve its
  current GM role. Never trust a claimed sender/GM field, configurable QUERY_USER
  permission, presence messages, or recipient IDs alone. Bind each bounded
  envelope to its exact intended recipients and prevent duplicate display within
  a bounded lifetime/cache. Registration must be idempotent and owned by the
  notify receiver, without unrelated bootstrap changes.
- Native v13.351 and v14.369 server source verifies module-channel sender
  attestation: the authenticated world session supplies a separate sender User ID,
  independent of payload fields. An explicit recipients array routes to those User
  IDs (including their tabs); omission can broadcast and is forbidden for targeted
  delivery. Both generations may use this verified transport. v13 custom User.query
  discards sender identity before its callback, so that callback is insufficient.
  Server-source verification establishes the trust boundary; actual notification
  delivery still requires the approved native acceptance checks below.
- Distinguish server relay acceptance from recipient display. Never return an
  end-to-end delivered claim from a server-only acknowledgement; if delivery is
  acknowledged, require exact recipient-authenticated, bounded request correlation.
  Local notification display is a transient user effect, not an Undo snapshot.

## Required verification

- Native-shaped v13/v14 tests cover canonical identity/current-GM drift, parent
  source changes at an unchanged timestamp, missing own sound stats, partial or
  cancelled updates, bounded rolls, drawn flags, no-chat/private chat/AI marker,
  playlist modes/paused resume/wrap/forceSync/volume and unsupported cases.
- Notification tests cover forged/missing sender identity, demoted sender, foreign
  recipient, duplicate/replayed envelope, bounds and hostile HTML. Test actual
  supported transport semantics; a payload-only fake sender is not proof.
- Required offline gate is npm run verify plus independent review. Native checks
  use fresh, explicitly approved owned table/playlist fixtures and named recipient
  sessions; approval is required before audio or notification effects. Preserve
  existing world data/settings and retain truthful audit records. No live effects
  are authorized merely by this contract amendment.

## Out of scope
- Scene, token, combat tools (24)
