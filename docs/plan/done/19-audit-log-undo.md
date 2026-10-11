# 19 — Add the audit log journal and human-only undo

**Repo:** .
**Status:** Implementation merged in PR #41 and archived. Task23a's unmerged PR #63 source now has native human Audit UI Undo evidence on v13.351/v14.369 for grouped root deletion with embedded restoration, persisted completion and released reservation. Direct embedded-only Undo and native concurrent-reservation contention are not claimed; see the task23/23a HISTORY entry.
**Depends on:** 13
**Owns:**
- module/src/audit/**
- module/src/apps/audit/**
- templates/audit/**
- module/test/audit/**
- module/src/ops/stages.ts (insertions only)
- module.json (`documentTypes` insertion only)
- styles/agent-gateway.css (audit section only)
- lang/en.json (insertions under `AGENT_GATEWAY.Audit.*` only)

## Goal
Record every write, destructive and code call an agent makes, with a
before-snapshot, as a module-defined JournalEntryPage subtype in a GM-only
journal, and let a GM undo an entry from the UI. Undo restores the snapshot and
warns when the document changed since.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:81-83 — subtype, GM-only journal, fields, undo with conflict warning
- docs/plan/specs/2026-10-09-agent-gateway.md:155 — undo is not a tool; only humans undo
- module/src/ops/stages.ts — stage order 50

## Acceptance
- [ ] `module.json` `documentTypes.JournalEntryPage` declares `audit`; a TypeDataModel defines timestamp, userId, agentId, tool, category, args, targets [{uuid, before, afterModifiedTime}], result summary
- [ ] A GM client creates the "Agent Gateway Audit" journal on ready if missing, default ownership NONE
- [ ] Audit stage (order 50) runs for non-read categories; handlers obtain snapshots via `ctx.snapshot(uuid)` before mutating; entries from player clients are relayed over the module socket to an active GM, buffered client-side until one is present
- [ ] Undo button (GM only) on an entry: restores `before` via update, deletes a created document, recreates a deleted one; if `_stats.modifiedTime` is newer than recorded, a confirm dialog warns of the conflict first
- [ ] A test asserts no `TOOLS` entry name contains `undo`
- [ ] Unit tests with a fixture write tool; manual check on foundry.local v14 with a screenshot of an entry and a successful undo

## Out of scope
- Event log (27); concrete write tools (21+)
