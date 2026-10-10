# 17 — Add the approval diff dialog with batch approval

**Repo:** .
**Depends on:** 16, 20c
**Owns:**
- module/src/apps/approval/**
- templates/approval/**
- module/test/apps/approval/**
- styles/agent-gateway.css (approval section only)
- lang/en.json (insertions under `AGENT_GATEWAY.ApprovalDialog.*` only)

## Goal
Show approvers what an agent wants to do before it happens: an ApplicationV2
dialog with a field-level diff for updates, the full payload for creates, a
summary for deletes and the full source for code, with approve, approve for this
session, and deny with a reason. Grouped requests can be approved together.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:79-80 — AppV2 diff dialog; code always shows full source
- docs/plan/specs/2026-10-09-agent-gateway.md:136-139 — dialog actions and batch approval
- module/src/ops/registry.ts (20c) — `toolRegistry.info(name).origin` tells a core tool from a pack tool
- module/src/approvals/** — hook and `resolveApproval` (16)

## Acceptance
- [ ] Opens on `agentGateway.approvalRequested` for eligible approvers; shows agent label, owner, tool, category and requester
- [ ] `computeDiff(before, after)` yields path/old/new rows for nested objects and arrays; unit tests with fixtures; for `document_update`-style args the dialog loads the current document via `fromUuid` to diff
- [ ] Category `code` renders the entire source in a monospace block with no truncation (test with a 500-line fixture)
- [ ] Requests from the same agent and session arriving within 2 s are grouped; "Approve all" and per-row actions both work
- [ ] Deny requires a non-empty reason, which reaches the agent via 16
- [ ] Manual check on foundry.local v14 using a fixture write tool exercised through MCP; screenshots in PR
- [ ] A tool with no dedicated renderer, which includes every pack tool, shows its full name, the pack id and version from `toolRegistry.info(name).origin`, a localized "third-party tool pack" label, its category, and the args as escaped, pretty-printed JSON (test renders a fixture pack tool whose args contain `<img src=x onerror=alert(1)>` and asserts it appears only as text)

## Out of scope
- Approval logic and persistence (16)
- Audit and undo (19)
