# 85 — Package the hosted gateway as a private Claude Code plugin

**Repo:** .
**Depends on:** none (35, 62, 65, 67, 68 and 74 are delivered foundations, not open blockers; 84 is a sibling, not a dependency).
**Status:** Planned 2026-10-14. The deployment is live at `https://foundry.aindriub.app` and `https://gw.aindriub.app` (Andrew, 2026-10-14). Ready for implementation; live acceptance requires Andrew's Claude Code session and his paired Foundry user.
**Owns:**
- plugins/claude/** (new; the plugin directory `plugins/claude/foundry-gateway/`, holding `.claude-plugin/plugin.json`, `.mcp.json` and `skills/foundry-gateway/SKILL.md`)
- .claude-plugin/marketplace.json (new; the repository-root marketplace)
- scripts/test/claude-plugin.test.mjs (new; plugin and marketplace contract tests)

**Scribe at record time (not implementer-owned):** docs/claude-plugin.md (new).

## Goal
Deliver a private Claude Code plugin that connects to the existing hosted Foundry gateway over Streamable HTTP and authenticates through the gateway's existing OAuth flow, with one focused skill for permission-appropriate Foundry work. The repository root also serves as a plugin marketplace, so `/plugin marketplace add AindriuB/agent-gateway` followed by an install works. This wraps the deployed MCP server; it adds no gateway behaviour, no packer and no hosted service.

## Context
- docs/plan/tasks/84-chatgpt-plugin.md: the ChatGPT counterpart, in progress elsewhere. Mirror its skill rules and live-acceptance standard, but do not read from, import, copy by reference or edit any 84-owned path (`plugins/foundry-agent-gateway/**`, `scripts/build-chatgpt-plugin.mjs`, `scripts/test/chatgpt-plugin.test.mjs`, `docs/chatgpt-plugin.md`).
- gateway/src/oauth/server.ts:155-158, 278-295: the issuer, the `/mcp` resource and the RFC 8414 / RFC 9728 metadata, including `registration_endpoint` (dynamic client registration) and `scopes_supported` `read write destructive code`.
- gateway/src/oauth/server.ts:109-119: registered redirect URIs may be `https:` or `http:` on loopback, so Claude Code's local OAuth callback registers without gateway changes.
- gateway/src/oauth/server.ts:130-139, 470-501: a request with no `scope` gets `read` only; the consent page grants only the scopes the human picks from those requested. See the risk under Acceptance.
- docs/plan/done/67-oauth-consent-and-grants.md:25-26: consent binds a grant to a world and a Foundry user; each Foundry user sees and revokes their own grants from their Foundry client.
- docs/guides/claude-code.md:19-35: the existing local-HTTP guide (bearer token on loopback). Owned by 43; link it, do not edit it.
- scripts/test/build-mcpb.test.mjs:1-20: the node:test shape for script tests; `npm run test:scripts` runs `node --test scripts/test/*.test.mjs` (package.json:23), so a new file is picked up without editing package.json.
- docs/conventions.md: test suites and the `npm run verify` gate. The repository has no exhaustiveness guard that sweeps plugin or marketplace files.

### Claude Code facts (docs as of 2026-10-14)
- **Layout and manifest.** `.claude-plugin/plugin.json` at the plugin root; only `name` is required; it must be kebab-case; names starting `claude-`, `anthropic-`, `anthropics-` or `cc-plugin-` are rejected. `.mcp.json` sits at the plugin root. Skills are `skills/<name>/SKILL.md` with a `description` in the frontmatter. Sources: https://code.claude.com/docs/en/plugins/manifest-reference.md, https://code.claude.com/docs/en/skills.md.
- **MCP entry.** `{"mcpServers":{"agent-gateway":{"type":"http","url":...}}}`. `${VAR:-default}` expansion applies to `url`. The entry has no headers, no `oauth` block and no client id: the gateway supports RFC 9728/8414 discovery and dynamic client registration. Users authenticate with `/mcp` or `claude mcp login agent-gateway`, and `claude mcp logout agent-gateway` clears the credentials. Source: https://code.claude.com/docs/en/mcp.md.
- **Marketplace.** `.claude-plugin/marketplace.json` has `name`, `owner.name` and `plugins[{name, source, description}]`, where `source` is a relative path. The entry `name` must equal the plugin.json `name`. A private repository is cloned with the user's own git credentials. Auto-update is off by default for third-party marketplaces. Sources: https://code.claude.com/docs/en/plugins/create-marketplace.md, https://code.claude.com/docs/en/plugins/install.md.
- **Validation.** `claude plugin validate <dir> --strict` checks a plugin or a marketplace, including MCP entries. It needs Claude Code 2.1.281 or later; this machine has 2.1.299. It does not test reachability or OAuth.
- **Other surfaces.** claude.ai and Desktop chat can load plugins through Customize → Plugins, using the Claude GitHub App for private repositories. Env-var expansion in chat is unverified, and `${user_config.*}` URLs are ignored in chat. Without the plugin, chat users add Customize → Connectors → Add custom connector with `https://gw.aindriub.app/mcp` and "Register automatically" for OAuth.

## Decisions
- **Plugin name `foundry-gateway`.** It is kebab-case, avoids every reserved prefix, and differs from 84's `foundry-agent-gateway`, so the two never collide in a combined listing or in docs. It names the thing the user gets (their Foundry world through the gateway) without the vendor name, which the prefix rule forbids anyway. The skill directory uses the same name.
- **Marketplace name `agent-gateway`.** It is neutral, matches the repository, and gives the install command `/plugin install foundry-gateway@agent-gateway`. `owner.name` is `Andrew Bannister`. No email or other contact field.
- **MCP server key `agent-gateway`**, so `claude mcp login agent-gateway` and `/mcp` show a name that matches the docs.
- **URL.** Exactly `${AGENT_GATEWAY_URL:-https://gw.aindriub.app}/mcp` (Andrew). A self-hoster sets `AGENT_GATEWAY_URL` to their gateway's origin, with no trailing slash and no `/mcp`.
- **No `version` in plugin.json.** The release scripts (41, `scripts/bump-version.mjs`) do not know about this file, and a hand-maintained version would drift from the module. If the manifest reference at implementation time says an omitted version blocks updates, set `0.1.0` and record that in the PR. Do not edit the bump script.
- **Skill text is an independent copy.** The skill does not share files or text by reference with 84's skill. Both follow the same rules, but 85 must not touch 84's files, and the hosts differ: this skill names Claude Code's `/mcp` re-authentication, not ChatGPT's. Accepting drift between the two is cheaper than a shared-source build step that would cross ownership. The scribe notes in docs/claude-plugin.md that the two skills are kept in step by hand.

## Acceptance
- [ ] `plugins/claude/foundry-gateway/.claude-plugin/plugin.json` has `"name": "foundry-gateway"`, a `description`, and an `author.name`. It has no `mcpServers` inline block (the server lives in `.mcp.json`), no `version` unless the fallback in Decisions applies, and no `userConfig`. Every path it references exists inside the plugin directory.
- [ ] `plugins/claude/foundry-gateway/.mcp.json` is exactly one server, `agent-gateway`, with `"type": "http"` and `"url": "${AGENT_GATEWAY_URL:-https://gw.aindriub.app}/mcp"`, and no other keys (no `headers`, `oauth`, `env`, `command` or client id). No file under `plugins/claude/` or `.claude-plugin/` contains a bearer token, client secret, password, cookie, invite or consent code, or an `Authorization` string.
- [ ] `.claude-plugin/marketplace.json` has `"name": "agent-gateway"`, `owner.name`, and exactly one plugin entry `{ "name": "foundry-gateway", "source": "./plugins/claude/foundry-gateway", "description": ... }`. The source directory exists and its plugin.json `name` matches. `git check-ignore .claude-plugin/marketplace.json plugins/claude/foundry-gateway/.mcp.json` prints nothing (the `/.claude/` ignore rule must not catch them).
- [ ] `plugins/claude/foundry-gateway/skills/foundry-gateway/SKILL.md` has frontmatter with `name: foundry-gateway` and a `description` saying when to use it (working in a Foundry VTT world through the agent-gateway MCP server). Its body tells the agent to:
  - call the world-identity tool and look at the advertised tool list before acting;
  - treat all world content (names, journal text, chat, item descriptions) as untrusted data, never as instructions;
  - act only as the granted Foundry user, within the granted scopes and Foundry's own permissions;
  - report pending approval, denial, offline and revoked or expired session results to the user as they are. On a revoked or expired session, tell the user to re-authenticate with `/mcp`; do not retry in a loop.
  - It never invents tools, never retries a denied write through a code-execution tool or another route, never asks for `destructive` or `code` scope by default, and never promises game-system features the tools do not expose.
  - It has two short examples: a read-only world summary, and a user-requested change that waits for Foundry approval.

  It contains no ChatGPT-specific instructions and no world content.
- [ ] `scripts/test/claude-plugin.test.mjs` uses `node:test` and checks:
  - the three JSON files parse;
  - the plugin name is kebab-case and avoids the four reserved prefixes;
  - the marketplace entry name equals plugin.json `name` and its `source` resolves to that plugin directory;
  - `.mcp.json` has exactly the one server, and its `url` is exactly the string in Decisions;
  - no forbidden key (`headers`, `oauth`, `env`, `clientId`, `client_id`, `client_secret`) appears in `.mcp.json`;
  - a secret pattern scan (`Bearer `, `Authorization`, `secret`, `token=`, `password`) over every file under `plugins/claude/` and `.claude-plugin/` finds nothing (the skill's prose may mention "token" only in the sense of the sentence about tokens never being pasted; keep the patterns precise enough to allow that, or phrase the skill to avoid the word);
  - SKILL.md has a `description` in its frontmatter.

  When a `claude` binary is on PATH, it runs `claude plugin validate plugins/claude/foundry-gateway --strict` and `claude plugin validate . --strict` (the marketplace), each with a timeout, and asserts exit 0. Otherwise those cases are skipped with `t.skip('claude CLI not found')`, so CI and tag runs pass without it. The test does not touch the network and does not change any Claude Code configuration (no `marketplace add`, no `install`).
- [ ] `npm run test:scripts` passes both with and without `claude` on PATH. Show the second case with a PATH that excludes it, e.g. `PATH=/usr/bin:/bin:$(dirname $(which node)) node --test scripts/test/claude-plugin.test.mjs`. `npm run verify` passes. No change to package.json, CI workflows or release scripts.
- [ ] Locally, `claude plugin validate plugins/claude/foundry-gateway --strict` and `claude plugin validate . --strict` both exit 0. The PR records the Claude Code version used.
- [ ] Live, in Andrew's Claude Code session (he takes part in the credential, consent and write steps):
  1. `/plugin marketplace add AindriuB/agent-gateway` succeeds using his git credentials. While the branch is unmerged, use the branch ref the install docs support, or a local path add of the worktree, and record which was used.
  2. `/plugin install foundry-gateway@agent-gateway` succeeds.
  3. `/mcp` shows `agent-gateway` needing authentication and completes OAuth through the gateway consent page as his paired Foundry user, granting `read` and `write` only. The PR records which scopes Claude Code requested.
  4. The tools are listed, and one read (the world-identity tool) succeeds.
  5. One harmless write that Andrew chooses, with Foundry approval enabled, stays unapplied before approval and applies only after it.
  6. Andrew revokes that grant from his Foundry client, and the next authenticated call fails as unauthorized rather than returning data.
  7. `claude mcp logout agent-gateway` clears the stored credential.

  Record redacted outcomes only: no world content, tokens or codes. Metadata or validation alone does not pass this item. If account access is unavailable, the PR marks live acceptance pending, and the task is not done.
- [ ] Risk to check first in the live run: the gateway grants only `read` when the authorization request carries no `scope` (gateway/src/oauth/server.ts:131). If Claude Code sends no scope, step 5 cannot pass. Stop and report the observed request. Do not add an `oauth` block or scopes to `.mcp.json`, or change the gateway, without an amended contract.
- [ ] The PR body gives the scribe what docs/claude-plugin.md needs:
  - the install commands (marketplace add, then install);
  - the note that auto-update is off by default for third-party marketplaces, and how to update;
  - OAuth through `/mcp` or `claude mcp login`, the consent page, the scope choice and Foundry grant revocation;
  - `AGENT_GATEWAY_URL` for self-hosters;
  - for claude.ai and Desktop chat: the plugin through Customize → Plugins with the Claude GitHub App, with env-var expansion there unverified. Otherwise, or if the default URL is not theirs, the custom connector at the fixed `https://gw.aindriub.app/mcp` (or their own origin) with "Register automatically";
  - the validator and Claude Code versions;
  - exactly what was verified live and what was not.

  Automated and live acceptance are reported separately.

## Out of scope
- Every 84-owned file, and any shared-source or build step between the two plugins.
- Gateway, module or OAuth changes, including scope defaults. Also deployment, new tools, `userConfig` prompts, hooks, agents, commands and output styles in the plugin.
- docs/guides/** and README.md (43), docs/compatibility.md and conformance (40), CI, release and version-bump automation (41).
- Public plugin directory or official marketplace submission, and making the repository public (it stays private for 0.1.0).
- Verifying claude.ai or Desktop chat plugin loading. Document it as unverified unless Andrew chooses to try it during live acceptance.
- If a supported plugin layout needs a gateway change or a file outside Owns, stop and report the concrete requirement instead of widening scope.


## Amendment 1 — Andrew, 2026-10-14

**Base first.** claude/task-85 (c5be5a3) is behind main. Task 83's `--base-url` pattern is only on main (origin/main scripts/pack-module.mjs:10-41). Before you start, merge `origin/main` into the branch; do not rebase. Line numbers below are from c5be5a3 unless they say `origin/main`.

### Decisions

1. **Version: plugin.json carries the repo version, and bump-version owns it.** This replaces the Decision "No `version` in plugin.json", along with its fallback and its "Do not edit the bump script". `claude plugin validate --strict` requires a version. `plugins/claude/foundry-gateway/.claude-plugin/plugin.json` keeps `"version"` at two-space indent. `scripts/bump-version.mjs` gets one more target, `['plugins/claude/foundry-gateway/.claude-plugin/plugin.json', pkgVersion, 'claude plugin.json']`, next to the targets at scripts/bump-version.mjs:38-61. A bump sets that version, and `--check` counts it as one more place, so the count goes from 15 to 16. As a result every release changes the plugin version, and Claude Code installs pick up the update, because Claude Code re-copies a plugin only when its computed version changes. The repo marketplace entry (`.claude-plugin/marketplace.json`) and the hosted marketplace entry carry no `version`. The version is set in plugin.json only.

   Fixture fallout, the same as task 78's Amendment 1 (docs/plan/done/78-compose-ghcr-image.md:64-69 on origin/main): scripts/release.mjs:62 runs bump-version inside the fixture roots of scripts/test/release.test.mjs:23-34 and scripts/test/docker-release.test.mjs:22-33. Those fixtures fail with "no version found in claude plugin.json" unless their `copied` lists also include `'plugins/claude/foundry-gateway/.claude-plugin/plugin.json'`. The same holds for the `files` list at scripts/test/bump-version.test.mjs:16-25.

2. **Hosted marketplace: a new `scripts/build-claude-plugin.mjs`.** It follows pack-module's `--base-url` handling (origin/main scripts/pack-module.mjs:10-41) and its `zip` invocation and error style (origin/main :66-75). Do not copy pack-module's dotfile exclude (`'.*'`, `'*/.*'`), because it would drop `.claude-plugin/` and `.mcp.json`.
   - Usage: `node scripts/build-claude-plugin.mjs --base-url <https-url> [--root <dir>]`. `--root` defaults to the repo root, as in pack-module. Output goes to `<root>/dist/release/claude/`.
   - `--base-url` is required. It must be https and have no credentials, no query and no fragment. Trailing slashes are stripped. Validation runs before any read of the plugin tree and before any write. On failure the script exits 1 and leaves no output.
   - It writes `dist/release/claude/plugins/foundry-gateway-<version>.zip`, where `<version>` is the plugin.json `version`. The zip holds a single top-level `foundry-gateway/` directory. Both the Claude Code archive source and claude.ai "Upload plugin" accept that layout. The zip contains exactly the plugin's real files (`.claude-plugin/plugin.json`, `.mcp.json`, `skills/foundry-gateway/SKILL.md`), plus directory entries if `zip` adds them. It contains no `.DS_Store`, `__MACOSX/`, `Thumbs.db`, editor backup or other stray file, even when one exists in the source tree. Build the zip from a staging copy or an explicit file list, not from a blanket recursive add.
   - It writes `dist/release/claude/marketplace.json` with `"name": "aindriub-dl"`. That name matches the marketplace already hosted, and it differs from the repo marketplace `agent-gateway`, so the two cannot collide. The file has `owner.name` `Andrew Bannister` and exactly one plugin entry: `name` `foundry-gateway`, the plugin.json `description`, and `source: {"source": "archive", "url": "<base>/plugins/foundry-gateway-<version>.zip", "sha256": "<lowercase hex of the zip>"}`. The entry has no `version`.
   - The source must be an absolute archive URL. Relative sources fail in a marketplace served from a URL.
   - The script refuses (exit 1) to write a marketplace.json over 5 MiB or a zip over 256 MiB, which are the documented limits.
   - It never modifies anything under `plugins/claude/`, `.claude-plugin/` or any other tracked path. It writes only under `dist/release/claude/`, which is ignored through `dist/` (.gitignore:2).
   - Its stdout is the two output paths and the sha256. It prints no other content.

   Documented facts (sources: https://code.claude.com/docs/en/plugins/marketplace-reference and https://code.claude.com/docs/en/plugins/host-marketplace):
   - a relative plugin `source` fails in a marketplace added by URL;
   - the `archive` source is a zip with an optional `sha256`, and Claude Code refuses an archive whose hash does not match;
   - users install with `/plugin marketplace add https://…/marketplace.json`;
   - Claude Code re-copies a plugin only when its computed version changes;
   - limits: marketplace.json at most 5 MiB, the plugin zip at most 256 MiB.

   Andrew's decision: tests go in a new `scripts/test/build-claude-plugin.test.mjs`. claude-plugin.test.mjs stays the static-contract test.

### Owns additions
- scripts/build-claude-plugin.mjs (new)
- scripts/test/build-claude-plugin.test.mjs (new)
- scripts/bump-version.mjs (one target line, plus the comment if needed)
- scripts/test/bump-version.test.mjs (the `files` fixture list at :16-25 and assertions that name the new place)
- scripts/test/release.test.mjs (only the `copied` list at :23-34; insertions only)
- scripts/test/docker-release.test.mjs (only the `copied` list at :22-33; insertions only)

The release and docker-release entries are there because of the bump-version change. They are not extra scope.

### Acceptance changes
- The plugin.json Acceptance line now reads "has a `version` equal to the root package.json `version`". The rest of that line stands: no `mcpServers` inline block, no `userConfig`, and every referenced path exists.
- The line "No change to package.json, CI workflows or release scripts" now reads "No change to package.json, CI workflows, scripts/release.mjs or scripts/pack-module.mjs." scripts/bump-version.mjs changes only as described in Decision 1.
- The Out of scope bullet about "version-bump automation (41)" now excludes everything except the single bump-version target and the fixture lines named above.

### Acceptance additions
- [ ] `node scripts/bump-version.mjs --check` prints `all 16 places agree on <version>`. In a fixture root, `bump-version 9.8.7` sets `"version": "9.8.7"` in the Claude plugin.json and changes no other key or formatting in that file. A fixture whose plugin.json version disagrees makes `--check` exit 1 and name `claude plugin.json`. scripts/test/bump-version.test.mjs asserts all three.
- [ ] `npm run test:scripts` passes, release.test.mjs and docker-release.test.mjs included. The diffs to those two files are single inserted lines in their `copied` lists.
- [ ] Neither `.claude-plugin/marketplace.json` nor the hosted marketplace entry has a `version` key. A test asserts this for both.
- [ ] `node scripts/build-claude-plugin.mjs` exits 1 with a usage message, and writes nothing, when `--base-url` is missing or has no value. It also exits 1 and writes nothing for each of `http://x.test`, `https://u:p@x.test`, `https://x.test/?a=1`, `https://x.test/#f` and `not a url`. A test asserts that `dist/release/claude` does not exist afterwards.
- [ ] `--base-url https://dl.example.test/claude//` produces a source `url` of exactly `https://dl.example.test/claude/plugins/foundry-gateway-<version>.zip`.
- [ ] The zip listing (`unzip -Z1`, or a JS reader) has every entry under `foundry-gateway/`. Its file entries are exactly `foundry-gateway/.claude-plugin/plugin.json`, `foundry-gateway/.mcp.json` and `foundry-gateway/skills/foundry-gateway/SKILL.md`. The test runs the script with `--root` on a temp copy that has a planted `.DS_Store` in the plugin directory and in `skills/`, and asserts neither appears in the zip. Extracted file bytes equal the source bytes.
- [ ] The marketplace.json `sha256` equals the sha256 of the written zip, computed independently in the test with `node:crypto`. It is 64 lowercase hex characters.
- [ ] The marketplace.json parses, has `name` `aindriub-dl` and `owner.name`, and has exactly one plugin whose `name` equals plugin.json `name`. That plugin's `source.source` is `archive` and its `source.url` starts with `https://`.
- [ ] Repo untouched: the test records the sha256 of every file under `plugins/claude/` and `.claude-plugin/` before running the script with `--root <repo>`, and checks they are byte-identical after. Alternatively, it asserts the script never writes outside `<root>/dist/release/claude/` by running it against a temp root and comparing that root's file list before and after. Either way, `git status --porcelain` in the worktree shows nothing new after `npm run test:scripts`.
- [ ] When `claude` is on PATH, the test runs `claude plugin validate --strict` (timeout 60 s) on the extracted `foundry-gateway/` directory and on the generated marketplace, and asserts exit 0. For the marketplace, pass the marketplace.json path if the CLI accepts it. Otherwise place it at `<tmp>/.claude-plugin/marketplace.json` and validate `<tmp>`, and record which form worked in the PR. Without `claude` the case is skipped with `t.skip('claude CLI not found')`. If `--strict` rejects or tries to fetch the archive URL offline, stop and report rather than loosening the test.
- [ ] The tests make no network calls and no changes to Claude Code configuration.
- [ ] Manual (Andrew): after the built files are uploaded to `https://dl.aindriub.app/claude/`, `/plugin marketplace add https://dl.aindriub.app/claude/marketplace.json` succeeds and `/plugin install foundry-gateway@aindriub-dl` installs the plugin. `/mcp` then lists `agent-gateway`. The PR records the outcome, redacted, separately from the automated results.

### Review round 1 findings
- [P3] scripts/test/claude-plugin.test.mjs:22 — the `claude --version` probe in `spawnSync` has no timeout, but the validate calls do (line 87). route: implementer. Add a timeout, as Acceptance says ("each with a timeout"). Input: a `claude` on PATH that stalls on start makes `npm run test:scripts` hang at module load.
- [NOTE, cheap] The tests don't assert the plugin.json Acceptance rules "no `mcpServers` inline block" and "no `userConfig`"; adding `"mcpServers": {}` leaves all 8 tests passing. Add the assertions.

Checkable form:
- [ ] Every `spawnSync('claude', …)` in scripts/test/claude-plugin.test.mjs and scripts/test/build-claude-plugin.test.mjs passes a `timeout`, the `--version` probe included.
- [ ] claude-plugin.test.mjs asserts that plugin.json has no `mcpServers` key and no `userConfig` key. Adding `"mcpServers": {}` to plugin.json makes a test fail.

### Scribe items (record time)
- docs/claude-plugin.md covers both install routes.
  - The repo marketplace: `/plugin marketplace add AindriuB/agent-gateway`, then `/plugin install foundry-gateway@agent-gateway`, which needs git access to the private repo.
  - The hosted URL: `/plugin marketplace add https://dl.aindriub.app/claude/marketplace.json`, then `/plugin install foundry-gateway@aindriub-dl`.
  - How to build: `node scripts/build-claude-plugin.mjs --base-url https://dl.aindriub.app/claude`.
  - How to upload: both `marketplace.json` and `plugins/foundry-gateway-<version>.zip`, keeping that relative layout, with the zip uploaded before the marketplace.json that points at it.
  - That claude.ai "Upload plugin" accepts the same zip.
  - That updates arrive only when the version changes, which every release now does.
- The hosted files currently on dl.aindriub.app were built by hand by the orchestrator from c5be5a3, not by build-claude-plugin.mjs, with zip sha256 `07ceb540…`. Record that, and that the next upload should come from the script.
- docs/releasing.md:15-17 lists the places bump-version sets. Add the Claude plugin.json to that list.

- Orchestrator note (2026-10-14): `claude plugin validate --strict <dir>` on a temp `<dir>/.claude-plugin/marketplace.json` whose entry uses an `archive` source with `sha256` passed offline with Claude Code 2.1.299 (the hand-built hosted file). Use the temp-dir form.

## Review round 2 — findings
- [P3] scripts/build-claude-plugin.mjs:63-67 — the staging copy follows symlinks: `cpSync` copies a symlinked source as a symlink, and `zip -r` without `-y` stores the target's content. Input: SKILL.md replaced by a symlink to an outside file containing `SECRET-CONTENT` → exit 0, and the zip's SKILL.md holds `SECRET-CONTENT`, so a local file ends up in a publicly hosted zip. route: implementer. Refuse (exit 1) unless `lstatSync(...).isFile()` holds for each of the three files, with a test.
- [P3] scripts/build-claude-plugin.mjs:55,59 — the plugin.json `version` goes into the zip path and URL unvalidated. `"x/../../../escaped"` writes the zip outside `dist/release/claude/`. route: implementer. Validate the version against bump-version's semver regex (scripts/bump-version.mjs:10) before building any path, with a test.
- [P3] scripts/build-claude-plugin.mjs:75-78 — `fail()` exits inside `try`, so `finally` never removes the staging dir, and a failed `zip` leaves a `build-claude-plugin-*` dir in the OS tmpdir. route: implementer. Record the failure in `catch` and call `fail` after `finally`.
- [P3] scripts/test/build-claude-plugin.test.mjs:63 — the "missing" and "no value" cases only match `/build-claude-plugin/`, which the URL error also matches, though Acceptance requires a usage message. route: implementer. Assert `/usage:/` for those two cases.
- [NOTE, cheap] The 5 MiB marketplace limit is enforced but untested (disabling it passes all tests). Add a test if cheap.

## Review round 3 — findings
- [P3] scripts/build-claude-plugin.mjs:63-71 — `lstatSync` checks only the last path component, so a symlinked parent directory gets past it. Input: `skills/foundry-gateway/` replaced by a symlink to an outside dir whose SKILL.md holds `SECRET-CONTENT` → exit 0, and the zip's SKILL.md is `SECRET-CONTENT`. route: implementer. Resolve each file with `realpathSync` and refuse unless it sits under `realpathSync(<root>/plugins/claude/foundry-gateway)`, with a directory-symlink test.
- [NOTE, cheap] scripts/build-claude-plugin.mjs:9 — `lstatSync` breaks the alphabetical import order. Fix if cheap.
