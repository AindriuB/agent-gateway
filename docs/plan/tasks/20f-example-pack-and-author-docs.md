# 20f — Add a free example tool pack and the pack-author documentation

**Repo:** .
**Depends on:** 20d, 20e
**Owns:**
- examples/hello-pack/**
- module/test/packs/example/**
- e2e/packs/**
- docs/packs/** (except `docs/packs/naming.md`, owned by 20b; links to it are fine)

## Goal
Give pack authors a working starting point and a contract they can rely on: a
small free pack, kept in this repo but never shipped in the core's release zip,
and documentation of the API, the security model, the categories, how to test a
pack against the e2e harness, and the versioning and compatibility policy.

## Context
- module/src/packs/** (20d) — the API, error codes, the handler context
- protocol/src/tools/rules.ts, limits.ts, pack.ts (20b); docs/packs/naming.md (20b)
- gateway/src/mcp/session.ts (20e) — the provenance tag and the per-session cap
- docs/testing.md and e2e/** — the harness, `~/.config/agent-gateway/test.env`, the one-time pairing setup
- docs/plan/specs/2026-10-09-agent-gateway.md section 1 "Tool packs" (trust model) and section 6 "Tool packs: distribution and licensing"
- task 41 `scripts/release.mjs` builds a zip of a fixed file list, which must not include `examples/`

## Design constraints (decided; implement as stated)
- `examples/hello-pack/` is a complete Foundry module: `module.json` (id `agent-gateway-hello-pack`, `relationships.requires` the `agent-gateway` module, `esmodules: ["scripts/main.js"]`, compatibility `minimum: 13`, `verified: 14`, MIT), `scripts/main.js` in plain ESM JavaScript with JSDoc types, no build step, `README.md`, `LICENSE`.
- It registers prefix `hello` with two tools: `hello-dice_odds` (player, `read`; args `count` 1-20, `sides` 2-100, `target`; returns the probability that the sum is at least `target`, computed without touching the world) and `hello-journal_stamp` (player, `write`; appends a timestamped line to a page of a journal the user owns, calling `ctx.snapshot(pageUuid)` before the update).
- Docs pages: `docs/packs/README.md` (what a pack is, free core and paid packs, where to start), `api.md` (every field, error code, the hook and lifecycle window, the handler context and result rules, limits from `TOOL_LIMITS`), `security.md` (the trust model in the spec's words, what the core guarantees and what it cannot, untrusted descriptions and results, no secrets in descriptions, the AI policy duties that apply to pack authors), `categories.md` (the four categories, default policy per category, why a mislabelled category is the author's breach of trust, `code` never auto), `testing.md` (unit-testing a handler with a stubbed context, running the example under the e2e harness), `versioning.md` (the `packApiVersion` major.minor contract: minors only add; a major change is refused at registration; the core keeps accepting the previous major for at least one core minor release after a new major; deprecations announced in the changelog), `distribution.md` (the spec's section 6 facts with their sources, and that the core does no licensing).

## Acceptance
- [ ] `module/test/packs/example/` imports `examples/hello-pack/scripts/main.js` against the real 20d API with stubbed Foundry globals; both tools register, `hello-dice_odds` with `count: 2, sides: 6, target: 7` returns `21/36` to 6 decimal places through the full dispatcher, and `hello-journal_stamp` reaches the approval stage under default policy
- [ ] With the stubbed `game.modules.get('agent-gateway-hello-pack').active === false`, the example's registration is refused and neither tool is in `toolRegistry.list()` (test)
- [ ] Every tool definition in the example passes `checkToolDefinition(…, 'pack')` (test)
- [ ] `e2e/packs/hello-pack.e2e.test.ts` runs when `AGENT_GATEWAY_E2E_HELLO_PACK=1` and otherwise skips with a message naming the variable; when run on v14 with the pack linked and enabled in `test-world`, `tools/list` for the player session contains both tools with the provenance tag, `hello-dice_odds` returns the expected probability, and after Andrew disables the pack and relaunches, a second run with `AGENT_GATEWAY_E2E_HELLO_PACK=disabled` asserts neither tool is listed
- [ ] `npx eslint examples` passes, and `grep -rn "examples" scripts/release.mjs` (if 41 has landed) shows the directory is not in the zip list
- [ ] Each page listed under Design constraints exists; `api.md` documents every `PackError` code that `module/src/packs/**` can throw (a test or script greps the source for codes and the doc for each)
- [ ] `npm run verify` passes

## Out of scope
- Publishing the example pack anywhere, or any premium pack
- A pack scaffolding CLI or npm package for pack authors
- User-facing docs for GMs about installing packs (43)
- Changes to the pack API itself (20d) or the gateway (20e)
