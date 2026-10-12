# 26 — Add code tools macro_run and script_run with mandatory confirmation

**Repo:** .
**Status:** Implementation and bounded native v13/v14 acceptance verified; PR #69 awaits merge. Keep this contract active until merge.
**Depends on:** 21, 20d, 20e
**Owns:**
- protocol/src/tools/macro-run.ts
- protocol/src/tools/script-run.ts
- protocol/src/tools/index.ts (insertions only)
- module/src/tools/macro-run.ts
- module/src/tools/script-run.ts
- module/src/tools/_code.ts
- module/src/ops/types.ts (core-only read-only admission hook typing; preserve existing authority/category contracts)
- module/src/ops/dispatch.ts (invoke trusted core admission before stages; preserve canonical registry/role/category checks)
- module/test/ops/dispatch.test.ts (admission authority, rejection and freshness regressions only)
- protocol/test/tools/rules/validate.test.ts (two canonical example-argument insertions only)
- module/src/tools/index.ts (insertions only)
- module/test/tools/code/**
- module/test/stubs/** (insertions only)

## Goal
Let a GM's agent run macros and ad-hoc scripts only after a human has read the
full source and confirmed every time. Existing code-category once-only approval
is preserved; session grants cannot authorize these calls and there is no path
to auto-run code.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:86-88 — runtime code never runs unconfirmed
- docs/plan/specs/2026-10-09-agent-gateway.md:132-134 — code always ask, cannot be set to auto
- module/src/policy/** code coercion (13); module/src/apps/approval/** code rendering (17)

- These are core tools: add them to `protocol/src/tools/index.ts` `TOOLS` and `module/src/tools/index.ts` `HANDLERS` as before; `module/src/ops/core-tools.ts` (20c) registers them through the same registry path as pack tools, and `checkToolDefinition(…, 'core')` (20b) must pass for each (the 20b test sweeps `TOOLS`)
## Acceptance
- [ ] `macro_run` (gm, code): args `macroUuid`, optional `args` JSON string; the approval dialog shows the macro's full command text
- [ ] `script_run` (gm, code): args `source` (max 20000 chars); runs as an async function with `game`, `canvas`, `ui` in scope; return value serialised (max 4000 chars)
- [ ] A test proves both tools reach the approval stage even when policy storage has been tampered to `allow`
- [ ] A fixture pack tool registered with category `code` (20d) also reaches the approval stage under the same tampered policy (test), so the code rule holds for packs
- [ ] Errors thrown by scripts return `INTERNAL` with the error message only
- [ ] Guards pass; manual check on foundry.local v14 with a screenshot of the source in the dialog

## Out of scope
- Any sandboxing beyond Foundry's own permissions (documented in 43)

## Bounded native execution and review binding
- Both tools remain `gm` / `code`. Keep the existing policy coercion to ask,
  immutable category binding, current approver checks and every-call once-only
  code approval, including registered pack tools. No approval/UI authority
  broadening is intended.
- Public schemas are closed. `macro_run` accepts a bounded canonical world or
  compendium Macro UUID and optional JSON text `args` (maximum 64 KiB UTF-8,
  depth 16, 5,000 nodes; reject unsafe prototype keys/non-JSON values). Pass its
  parsed value through the single fixed native scope binding `{args: value}`;
  do not spread caller keys into native function parameters or speaker/actor/
  token/context. Both native `script` and `chat` macro types are supported.
- Resolve one canonical Macro before approval through a distinct trusted
  core-only asynchronous read-only admission hook. Keep existing synchronous
  category preparation closed and unchanged. The hook returns replacement
  internal arguments only; it has no caller-controlled authority/category
  fields and cannot be announced/registered by a pack. Recheck current native
  GM and canonical registry binding after the await before any stage runs.
- Capture the canonical document/reference, world collection or compendium
  entry/pack identity, native type, finite native modification stamp and exact
  full command in private per-call state. Reject commands over 20,000 chars
  rather than displaying a truncated approval. Enrich a new frozen internal
  argument object with the exact command as `source`; the public schema rejects
  caller-supplied `source`. Existing approval rendering and argument hashing
  must display/bind this full source; never recompute a different source for
  execution. Original caller arguments are not mutated.
- Immediately before native `Macro.execute`, freshly verify current native GM,
  native `canUserExecute`/`canExecute`, canonical document/pack identity, type,
  command and modification stamp against the captured approval. Changed or
  missing macros, permission loss or changed source fail closed without running
  either old or new command; the caller may submit a new reviewed request.
  Both supported native generations capture command synchronously when
  `execute` is invoked. Chat macros retain native processing semantics: an
  undefined result means the native invocation returned no value, not proof of
  chat delivery or successful processing of errors swallowed by Foundry.
- `script_run` compiles the exact approved source as an async function with
  `game`, `canvas`, `ui` in scope, after current-GM and approved-call checks.
  Both handlers require the actual approved code call and audit call identity/
  options before invocation; direct handler calls cannot bypass approval.
- Return a bounded serialized representation (`result`, maximum 4,000 chars,
  and `truncated` boolean). Represent undefined explicitly. Serialization must
  be bounded in depth/nodes/output and must not invoke arbitrary getters or
  `toJSON`; unsupported/cyclic/unsafe results may fail explicitly with a
  bounded INTERNAL message instead of claiming successful serialization.
  Thrown compile/runtime errors return INTERNAL with bounded error message only,
  without stack/source dumps. Never claim rollback after approved code ran.
- A normal native chat Macro can return a world ChatMessage. Represent only a
  verified canonical instance of the configured native ChatMessage class as
  bounded JSON `{uuid: "ChatMessage.<id>"}`: use own data descriptors for its
  `_source._id`, require exact `game.messages.get(id)` identity, and compute the
  UUID without invoking returned-object getters, `toJSON` or `toObject`. Reject
  forged, stale or accessor-backed instances. Other unsupported host results
  remain explicit result-serialization errors (for example, "Code returned an
  unsupported result"), not a claim that already-invoked code had no effects.
  This is not a general native-document serialization framework.
- Arbitrary approved code runs with native Foundry permissions. This task adds
  no sandbox, hard CPU timeout, universal mutation correlation or automatic
  Undo guarantee. Audit the invocation/category/reviewed arguments and outcome
  honestly; do not fabricate snapshots or created targets for unknown effects.

## Required regression and native evidence
- Exercise the actual approval renderer/hash/pipeline for full macro source,
  public source-injection rejection, source/type/version/replacement changes
  while pending, changed pack entry and current-GM/permission loss after awaits.
  A cached SDK call delayed beyond 25 seconds must stay pending until a real
  approval and continue only once; retain the existing text-only pending-result
  limitation rather than claiming structured output survives it.
- Cover native-shaped v13/v14 script and chat Macro execution, fixed JSON args
  binding, undefined chat return, async return/rejection/syntax error, output
  truncation and hostile/cyclic return values. Prove both core tools and a
  genuinely registered category-code pack tool still ask under tampered allow
  policy; no session or direct-handler bypass.
- Before any native writes, propose exact harmless fixture macro/script source,
  human once approvals, protected-baseline/readback and exact fixture cleanup
  for fresh scoped consent. Native v14 acceptance includes an actual full-source
  approval-dialog screenshot kept local; v13 compatibility evidence is reported
  separately. Do not execute code or create fixtures merely to investigate APIs.
