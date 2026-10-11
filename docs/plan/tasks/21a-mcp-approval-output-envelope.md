# 21a — Project delayed approval envelopes into MCP output schemas

**Repo:** .
**Depends on:** 16, 20e
**Owns:**
- gateway/src/mcp/output-schema.ts (new shared MCP-only projection helper)
- gateway/src/mcp/session.ts (`tools/list` output-schema projection only)
- gateway/src/mcp/server.ts (legacy `tools/list` output-schema consistency only)
- gateway/test/mcp/output-schema.test.ts (new focused helper tests)
- gateway/test/mcp/server.test.ts (listing projection assertions only)
- gateway/test/routing/approval-pending.test.ts
- gateway/test/routing/dynamic-tools/definitions.test.ts (MCP listing projection assertion only: normal branch remains canonical and pending branch is strict)
- gateway/test/routing/toolset.test.ts (announcement/schema immutability assertions only)

## Goal
An SDK client that caches `tools/list` must accept the legitimate delayed
`{status: 'pending_approval', id}` result as well as the tool's normal output.
Fix the generic MCP projection independently of task 21's new tools, which
need this prerequisite for their delayed-approval live proof.

## Context
- gateway/src/mcp/session.ts — `listed()` currently advertises only the normal output schema; forwarding returns the module's structured result
- gateway/src/mcp/server.ts — legacy listing path needs the same projection
- gateway/test/routing/approval-pending.test.ts — existing delayed test omits `listTools()` before `callTool()`, hiding SDK cached-output validation
- module/src/approvals/manager.ts — legitimate pending result; no module changes
- protocol/src/tools/approval-status.ts — approval id limit and status follow-up

## Acceptance
- [ ] Shared MCP-only helper projects a normal object output schema to `{type: 'object', anyOf: [normalOutputSchema, pendingSchema]}`. The pending branch is an object requiring exactly `status` (enum `['pending_approval']`) and `id` (string, minimum length 1, maximum 100), with `additionalProperties: false`
- [ ] Use `anyOf`, not `oneOf`, so permissive or overlapping normal schemas remain valid. The root retains `type: 'object'` for SDK compatibility. Do not mutate the input schema or share writable projection state between tools/calls
- [ ] Existing definitions require an output schema; the helper may retain a required schema parameter. If a defensive listing adapter handles an absent schema, preserve absence/omit outputSchema unchanged, never advertise a pending-only schema that would reject unknown normal results. Do not introduce optional-schema support into protocol/announcement requirements
- [ ] Apply the projection consistently to all module tools listed by session and legacy paths: core and announced pack tools, including read tools whose configured policy may request approval. Preserve names, input schemas, descriptions/provenance, visibility, ordering and list-change semantics
- [ ] Canonical protocol ToolDefinition outputs, module runtime output validation, link announcements, pack-schema rules and stored announced definitions remain unchanged. The extra union exists only at the MCP transport boundary; do not relax normal output schemas or accept arbitrary structured results
- [ ] Real SDK integration calls `listTools()` before `callTool()` for strict normal-schema core and announced pack fixtures, including a read-category tool. A delayed/scaled pending result succeeds without timeout/schema rejection, and immediate normal output remains valid
- [ ] SDK/helper regressions reject invalid normal outputs and malformed pending branches (missing/empty/oversized id, wrong status, extra fields) when neither branch matches; overlapping valid normal output remains accepted. Existing errors still use text-only content with no structuredContent
- [ ] Tests prove announcement schemas and original schema objects are unchanged, the root schema is SDK-compatible, and the legacy listing matches the session projection. Generic fixtures suffice: this task bases on current main and does not depend on task 21's tool implementation
- [ ] `npm run verify` passes. Task 21 then integrates this prerequisite and repeats its default-policy delayed approval proof through an SDK client that has listed tools, using owner-approved exact test payloads and the real approval UI

## Out of scope
- Tool handler/schema changes, approval lifecycle changes or module/link protocol changes
- Broadening pack schema acceptance or weakening strict normal-result validation
- Task 21 world mutations/live acceptance, which remain pending until separately approved and proven
