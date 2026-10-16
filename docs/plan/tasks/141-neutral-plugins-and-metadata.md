# 141 — Plugins default to a user-set gateway URL; public identity is "AindriuB"

**Repo:** .
**Depends on:** none
**Owns:**
- plugins/** (both plugin sources: `plugins/claude/foundry-gateway/**`, `plugins/foundry-agent-gateway/**`)
- .claude-plugin/marketplace.json
- scripts/build-claude-plugin.mjs
- scripts/build-chatgpt-plugin.mjs
- scripts/test/claude-plugin.test.mjs
- scripts/test/build-claude-plugin.test.mjs
- scripts/test/chatgpt-plugin.test.mjs
- docs/claude-plugin.md
- module.json (the `authors` field, plus new `bugs`, `readme` and `changelog` URL fields only)
- gateway/mcpb/manifest.json (the `author` object only)
- gateway/package.json (add `author` and `bugs` only)
- package.json, module/package.json, protocol/package.json (add `author` only)

**Status:** Part of the go-public set (140-148), planned 2026-10-16. Recorded decisions:
- Decision 3 (Andrew, 2026-10-16): the plugins in the repo default to a placeholder gateway URL
  the user sets (`AGENT_GATEWAY_URL` or equivalent). The builds published on `dl.aindriub.app`
  bake in `https://gw.aindriub.app` at build time. "Andrew's gateway", "private repository" and
  "Private marketplace" wording goes, and the tests asserting those strings follow.
- Decision 6 (Andrew, 2026-10-16): the author in public metadata is "AindriuB". LICENSE and
  gateway/LICENSE keep "Copyright (c) 2026 Andrew Bannister" (decided, not open). Neither LICENSE
  file is touched.

Note: `docs/chatgpt-plugin.md` is owned by open task 113, so its matching edit is in task 146.

## Goal

A stranger who installs either plugin from the public repo is pointed at their own gateway, not
Andrew's, and the repo's manifests name the author by the public handle only. The hosted builds
Andrew serves keep working unchanged for his users, because the build scripts write the hosted URL
in at build time.

## Context

- plugins/claude/foundry-gateway/.mcp.json:5 — `${AGENT_GATEWAY_URL:-https://gw.aindriub.app}/mcp`.
  Claude Code expands `${VAR:-default}` in plugin `.mcp.json`.
- plugins/claude/foundry-gateway/.claude-plugin/plugin.json:5-7 — author "Andrew Bannister".
- .claude-plugin/marketplace.json:3-6 — "Private marketplace…", owner "Andrew Bannister".
- plugins/foundry-agent-gateway/mcp.json:6 — hard-coded `https://gw.aindriub.app/mcp`; the ChatGPT
  package format has no env expansion.
- plugins/foundry-agent-gateway/plugin.json:5,14 — "Andrew's hosted Foundry VTT gateway…",
  "Connects to Andrew's gateway at gw.aindriub.app."
- plugins/*/skills/**/SKILL.md — check for the same wording.
- scripts/build-claude-plugin.mjs:22,35-50 — `--base-url` parsing and validation (https, no
  credentials, query or fragment) to mirror for a new flag; :54-71 staging copy; :113-125 the
  hosted marketplace (`name: 'aindriub-dl'`, `owner: { name: 'Andrew Bannister' }`).
- scripts/build-chatgpt-plugin.mjs:130-152 — the MCP URL validation (https, path `/mcp`, no
  credentials, query or fragment); :160-170 argument handling.
- scripts/test/claude-plugin.test.mjs:49,66 and scripts/test/build-claude-plugin.test.mjs:214-215 —
  the URL and owner assertions; scripts/test/chatgpt-plugin.test.mjs:73 — the hard-coded URL
  assertion; :150-156 the invalid URL cases.
- docs/claude-plugin.md:3,19,31,36,45,49,51 — hosted URLs and "Andrew" wording.
- scripts/test/docker-release.test.mjs:25-36 — bump-version touches
  `plugins/claude/foundry-gateway/.claude-plugin/plugin.json`; keep its `version` field where it is.
- module.json:7 `authors`; gateway/mcpb/manifest.json:7-9 `author`; gateway/package.json has
  `repository` and `homepage` but no `author` or `bugs`.

## Acceptance

- [ ] `rg -n -i "andrew|aindriub\.app|private marketplace|private repo" plugins .claude-plugin module.json gateway/mcpb/manifest.json package.json gateway/package.json module/package.json protocol/package.json`
      prints nothing.
- [ ] Claude plugin `.mcp.json` URL is `${AGENT_GATEWAY_URL}/mcp` with a non-routable placeholder
      default, `${AGENT_GATEWAY_URL:-https://gateway.example.invalid}/mcp` (or another
      `.invalid`/`example` host, stated in the PR), and docs/claude-plugin.md says the user must set
      `AGENT_GATEWAY_URL` to their gateway's public URL before `/mcp`.
- [ ] ChatGPT plugin `mcp.json` URL is the same placeholder host with path `/mcp`, and the package
      validator still accepts it (https, `/mcp`, no credentials, query or fragment).
- [ ] `scripts/build-claude-plugin.mjs` gains `--gateway-url <https-url>`, validated like
      `--base-url`. When given, the staged `.mcp.json` inside the zip has the URL
      `<gateway-url>/mcp` with no env expansion; when absent, the zip keeps the repo's placeholder.
      The source file in `plugins/` is never modified (test asserts its bytes are unchanged after a
      build).
- [ ] `scripts/build-chatgpt-plugin.mjs` gains the same `--gateway-url` flag with the same
      behaviour for its `mcp.json`, and an invalid value exits 1 without echoing the value.
- [ ] Building with `--gateway-url https://gw.aindriub.app` (and `--base-url
      https://dl.aindriub.app/claude` for Claude) reproduces today's hosted connection URL
      `https://gw.aindriub.app/mcp` in the built archive; a test asserts this with a neutral host
      (`https://gw.example.org`), and docs/claude-plugin.md gives the exact aindriub commands under a
      "Hosted build" heading.
- [ ] The hosted marketplace's `owner.name` is "AindriuB" and its description says "Hosted
      marketplace…"; its `name` stays `aindriub-dl` so existing users' marketplace entries keep
      working (unless Andrew answers the question below otherwise).
- [ ] Every `author`/`owner`/`authors` name in the owned manifests is "AindriuB"
      (`rg -n '"name": "AindriuB"'` finds one per file). plugin.json descriptions say "your Foundry
      VTT gateway" and no longer name a host.
- [ ] module.json gains `"bugs": "https://github.com/AindriuB/agent-gateway/issues"`,
      `"readme": "https://github.com/AindriuB/agent-gateway#readme"` and
      `"changelog": "https://github.com/AindriuB/agent-gateway/blob/main/CHANGELOG.md"`; no other
      module.json field changes (diff). `manifest`, `download` and `url` are unchanged.
- [ ] gateway/package.json gains `"author": "AindriuB"` and
      `"bugs": { "url": "https://github.com/AindriuB/agent-gateway/issues" }`;
      gateway/test/package/contents.test.ts still passes.
- [ ] The tests asserting the old strings are updated, not deleted: claude-plugin.test.mjs:66 and
      chatgpt-plugin.test.mjs:73 assert the placeholder URL; new tests cover `--gateway-url`
      (valid, missing value, http, credentials, query) for both build scripts.
- [ ] `npm run verify` exits 0.

## Out of scope

- docs/chatgpt-plugin.md (open task 113 owns it; the edit is task 146).
- README.md (142), docs/releasing.md and the other docs (143), gateway/docker/** (146).
- LICENSE and gateway/LICENSE: decided, unchanged.
- Rebuilding or re-uploading anything on dl.aindriub.app: an owner action after merge.
- Plugin behaviour, skills content beyond the wording above, OAuth settings.
- module.json `documentTypes`, `version`, `manifest`, `download`.

## Owner questions

- Rename the hosted Claude marketplace from `aindriub-dl` to something neutral? Renaming breaks
  existing `/plugin marketplace add` entries, so the default here is to keep it.
- The placeholder host: `gateway.example.invalid` is the proposal; confirm or name another.
