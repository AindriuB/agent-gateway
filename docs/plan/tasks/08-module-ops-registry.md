# 08 — Add the module operation registry, dispatcher and document serialiser

**Repo:** .
**Depends on:** 03, 04
**Owns:**
- module/src/ops/**
- module/src/serialise/**
- module/src/tools/index.ts
- module/test/ops/**
- module/test/serialise/**
- module/package.json (dependency insertions only)
- package-lock.json

## Goal
Give the module one place where tool handlers are registered and invoked: look
up the protocol definition, check the caller's role, validate arguments with the
protocol zod schema, run an ordered list of stages (policy, rate limit, approval
and audit plug in later), then the handler. Add the serialiser every read tool
uses: strips other modules' flags unless the GM opted in, converts HTML to
markdown and pages large output.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:74-76 — registry fields; handlers use the Foundry document API as the logged-in user
- docs/plan/specs/2026-10-09-agent-gateway.md:86-88 — other modules' flags and data stripped unless the GM opts in
- docs/plan/specs/2026-10-09-agent-gateway.md:155-157 — short text plus structured content; paging; HTML to markdown
- protocol/src/tools/** — `defineTool`, `TOOLS` (03)
- docs/conventions.md — `module/src/tools/index.ts` and `module/src/ops/stages.ts` are insertion-only

## Acceptance
- [ ] `module/src/tools/index.ts` exports `HANDLERS`, a map from tool name to handler; empty in this PR
- [ ] `module/test/ops/coverage.test.ts` fails if any `TOOLS` entry with `handledBy: 'module'` lacks a handler in `HANDLERS`, or a handler exists for an unknown tool
- [ ] `OpContext` type carries `user`, `agent {id, ownerUserId, headless}`, `sessionId`, `tool`, `args`
- [ ] `dispatch(call, user)` returns `TOOL_NOT_FOUND`, `FORBIDDEN` (gm tool, non-GM user), `INVALID_ARGS` (zod issues summarised in one line) or the handler result `{text, structured}`; handler throws become `INTERNAL` without stack traces in the message
- [ ] `module/src/ops/stages.ts` exports a list of stages `{name, order, run(ctx, next)}`, empty in this PR, executed sorted by `order` so insertion position never matters; documented orders: agent-control 10, policy 20, rate-limit 30, approval 40, audit 50; a test proves ordering and short-circuit
- [ ] `serialiseDocument(doc, {includeOtherModuleData})` keeps `flags.core`, `flags[game.system.id]` and `flags['agent-gateway']` only, unless the `includeOtherModuleData` world setting is true (tests both)
- [ ] `htmlToMarkdown` handles headings, lists, links, bold/italic, tables, and Foundry `@UUID[...]{label}` enrichers (keeps label and uuid); tests with fixtures
- [ ] `page(text, cursor, limit)` returns a chunk plus `nextCursor`; default chunk size is a named constant in one config object
- [ ] `npm test -w module` passes

## Out of scope
- Any concrete tool handler (09, 10 and later)
- Wiring dispatch to the link client (11)
- Policy, rate-limit, approval, audit stages (13, 14, 16, 19)
