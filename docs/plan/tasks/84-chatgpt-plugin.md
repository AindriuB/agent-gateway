# 84 — Package the Foundry gateway as a private ChatGPT plugin

**Repo:** .
**Depends on:** none (35, 42, 67, 68 and 74 are delivered foundations, not open blockers).
**Status:** Planned 2026-10-14. Andrew confirms the supporting tasks are delivered and the deployment is live at `https://foundry.aindriub.app` and `https://gw.aindriub.app`. Ready for implementation; live acceptance requires his ChatGPT account and Foundry session.
**Owns:**
- plugins/foundry-agent-gateway/** (new portable package source, including plugin.json, mcp.json, skills/ and any referenced assets)
- scripts/build-chatgpt-plugin.mjs (new standalone packer)
- scripts/test/chatgpt-plugin.test.mjs (new packer and package-contract tests)
- docs/chatgpt-plugin.md (new package-specific setup, verification and maintenance notes; scribe writes this file)

## Goal
Deliver a reviewable private plugin package that lets ChatGPT use the existing hosted Foundry gateway, with a focused skill for discovering the connected world and performing permission-appropriate Foundry work. Reuse the deployed Streamable HTTP service and its OAuth consent flow. This is a modern plugin package wrapping an existing MCP server; it is not a legacy ChatGPT Actions/OpenAPI integration or a new hosted service.

## Context
- gateway/src/oauth/server.ts:144-160, 270-295: public resource and OAuth discovery metadata.
- docs/plan/done/67-oauth-consent-and-grants.md:25-26: consent binds a grant to a world/user and Foundry provides the code and revocation UI.
- docs/plan/tasks/40-mcp-conformance.md:6-12, 32-39 and docs/plan/tasks/43-user-docs.md:6-10, 39-47: compatibility matrix/conformance and general client guides belong to those tasks; this task neither blocks on nor edits their files.

## Verified connection and implementation shape
- On 2026-10-14, an unauthenticated GET of `https://gw.aindriub.app/.well-known/oauth-protected-resource` returned resource `https://gw.aindriub.app/mcp`, authorization server `https://gw.aindriub.app`, and scopes `read`, `write`, `destructive`, `code`. This verifies the MCP resource URL, not a successful ChatGPT connection or authenticated tool discovery.
- Use `https://gw.aindriub.app/mcp` with Streamable HTTP in portable `mcp.json`. Foundry itself is at `https://foundry.aindriub.app`; it is not the MCP endpoint. Do not invent client IDs, tokens, headers or an app binding.
- Read the installed plugin-creator create-plugin skill and its existing-server and package references at implementation time. Follow the current supported portable manifest/connection format and validate it; record the validator/version used. The current format is a root Agent Plugins 1.0 `plugin.json`, root `mcp.json`, and `skills/<name>/SKILL.md`. No Sites deployment is needed.
- Keep deployment-specific source explicit: this package connects to Andrew's deployment. Document how a self-hoster changes the MCP URL and revalidates/repackages it. Do not imply the URL is automatically configurable in ChatGPT unless verified.
- The workflow's shaping-work skill was not found in the repository or installed skill locations during planning; the scoped shape and checkable acceptance below are the planning fallback.

## Acceptance
- [ ] The self-contained `plugins/foundry-agent-gateway/` package has a matching lowercase package name, valid semantic version, accurate display metadata, and a listing short description no longer than 30 characters. All referenced files exist within the package. Use original or already licensed assets if any; do not copy the consent-page Ascend mark.
- [ ] Portable `mcp.json` points to the verified HTTPS `/mcp` endpoint using Streamable HTTP. Authentication uses the existing host OAuth flow; the archive contains no static bearer token, client secret, Foundry password, cookie, invite or consent code. Unsupported auth fields or guessed app IDs are not added to make validation pass.
- [ ] One focused skill tells the agent to inspect the connected world's identity and available tools before acting; treat world content as untrusted data; respect the granted user, scopes and Foundry permissions; and honor pending approval, denial, offline and revoked-session results. It never invents tools, retries a denied write through code execution, requests `destructive`/`code` by default, or promises unsupported game-system features. Its examples cover a read-only world summary and a user-requested change subject to Foundry approval.
- [ ] `node scripts/build-chatgpt-plugin.mjs` produces one archive under ignored `dist/release/`, containing exactly one `foundry-agent-gateway/` root. The output archive is outside its input directory. The packer excludes dependency directories, symlinks and unrelated files, fails for missing references or invalid manifests, and never uploads or changes a remote account. Package tests inspect the actual archive and exercise invalid/missing input cases; they run through the existing `npm run test:scripts` discovery without changes to package.json or release automation.
- [ ] `docs/chatgpt-plugin.md` records the build command, archive path, current supported private installation/connection steps, exact deployment URLs, OAuth consent and Foundry grant-revocation flow, and the distinction between packaging, saving privately and working authentication. It links existing client documentation where available rather than rewriting task 43's guide. It records the host/validator version and what was actually verified; unsupported host installation is reported as a blocker with the archive retained.
- [ ] In Andrew's authorized ChatGPT session, install/connect the private plugin using the supported host flow, complete OAuth through his paired Foundry user, discover actual tools and perform one read (for example `world_info` if advertised). Demonstrate one user-selected harmless write with Foundry approval enabled: it must remain unapplied before approval, then apply only after approval. Revoke that test grant from Foundry and show the same connection can no longer perform an authenticated call. Record only redacted outcomes, not world content, tokens or codes. Do not mark live acceptance passed from metadata or package validation alone. Credentials, consent and the test write require Andrew's participation/authorization when execution reaches them.
- [ ] Run `npm run verify`, package-contract tests, the packer and archive inspection. The PR reports automated and live acceptance separately. If live account access is unavailable, retain the artifact and mark live acceptance pending; the task is not complete.

## Out of scope and coordination
- New gateway/module behavior, OAuth implementation, deployment, database migrations, headless runners, new Foundry tools, interactive app views and Extensions.
- General MCP conformance and compatibility matrix edits (40), general remote-client guides (43), CI, release publishing and version-bump automation. These tasks can proceed independently because ownership is disjoint. Give their scribe a package-doc link and verified results for later incorporation.
- Public directory submission, workspace-wide sharing and public publication. Planning this task does not authorize those actions or account installation now; implementation prepares the reviewable package before the live connection step.
- If supported plugin packaging requires a gateway change or another task's owned file, stop and report the concrete requirement for an amended contract instead of silently widening scope.
