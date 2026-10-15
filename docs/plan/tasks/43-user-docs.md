# 43 — Write the remote, server-mode and headless user documentation

**Repo:** .
**Depends on:** 65, 35, 37, 38, 40, 42, 67, 68, 74, 97 (all merged)
**Status:** MVP B wave 4, last. Amended 2026-10-14 in the MVP B re-plan: the items 65 already did are removed; the existing docs/security.md sections are edited, not created; README.md:34 is flipped at the end. Refreshed 2026-10-15 against what shipped in 37 (PR #151, Amendments 1-7), 38 (PR #153), 97 (PR #152) and 40 (PR #150), at be8ab45: every "note for 43" from those tasks and PLAN.md "Now 0a" is checked against the merged code and added below as a concrete doc item; Owns widens to `docs/releasing.md` (one line, from 40); README.md:21 is added (it still says there is no headless mode); 97 joins Depends. Line references re-checked at be8ab45. Amendment 1 (2026-10-15): the 35b docs item moves to 35b; no funding links yet.
**Owns:**
- README.md
- docs/guides/** (new guides; the Claude Desktop and Claude Code guides only where they link a new guide)
- docs/security.md (edits to existing sections, plus new sections where named below)
- docs/privacy.md (the remote, server-mode and headless additions only)
- docs/releasing.md (the quoted `test:conformance` final line at :20 only; 40's residual)
- .github/FUNDING.yml (deletion only, per Amendment 1: the branch added it and must remove it)

## Goal
Document what MVP B adds, for someone who has never seen the project: remote clients through a public URL with OAuth, the server-mode Compose stack behind a reverse proxy, and headless agents. Update the security model and privacy statement for remote, server and headless mode. Then remove "local only" from the README, because after this task it is no longer true.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:79-87 (reach modes), :302-304 (the docs list).
- 65 (done) wrote the README quick start, docs/guides/claude-desktop.md, docs/guides/claude-code.md, docs/privacy.md and the base security model. These stay and are not rewritten.
- README.md:
  - :21 (quick start step 3) still says "There is no headless mode in this release, so if the tab closes the agent is offline";
  - :32-36 "What this release does not do": :34 says the release is local only, with no remote clients, OAuth, public URLs, ChatGPT or Gemini connectors, headless agents or Docker images; :36 is the macOS-verified / Windows-untested line;
  - :42-45 "More" lists the two Claude guides.
- docs/security.md (existing sections to edit; numbers checked at be8ab45):
  - :41 "Local HTTP transport — task 34";
  - :44-55 "The permission model in this release — task 65" (:55 says OAuth scopes apply but that consent is auto-deny "until the consent page (task 67) lands"; 67 has landed);
  - :57 "Pairing, code confirmation and token storage";
  - :65 "HTTP bearer token";
  - :69-71 "Relay between gateway instances";
  - :73-78 "Multi-user isolation" (:78 is local mode's trust assumption);
  - :80 "What a malicious agent can and cannot do";
  - :84 "Tool packs";
  - :90-92 "Public mode behind a reverse proxy — task 74" (74's; extend or link, do not duplicate).
- docs/privacy.md:1-28: what leaves the client (:5), what the gateway writes (:9-20), the AI client (:22), tool packs (:26). :3 says "in the local release".
- docs/releasing.md:20 quotes the old final line `conformance: ok (inspector <v>, stdio, http)`. The script now prints `conformance: ok (inspector <v>, stdio, http, oauth)` (docs/plan/done/40-mcp-conformance.md, review round 3).
- docs/server-mode.md and gateway/docker/README.md (42); docs/compatibility.md (40): its per-release manual checklist for the remote clients is at :53 onwards, written and unticked (Andrew runs it). The guides link it; they do not tick it.
- Settings and behaviour to describe:
  - 74: `--public-url`, the bind addresses, `--trust-proxy`, the static bearer is off in public mode, the pairing code only in the operator log, and the minimal `/status`;
  - 35: the scopes;
  - 67: consent and revoking a grant;
  - 68: operator invites in server mode (`--invite`, `--revoke-pairing`, `--cancel-invite`, `--list-invites`, `--list-pairings`, and the pairing app's "Copy my ids" line);
  - 37, 38 and 97: headless agents (verified notes below).
- Headless, as shipped (verified at be8ab45):
  - Flag/env agent: `--headless-foundry-url`, `--headless-world`, `--headless-user` (an id, not a name) and the password only as `AGENT_GATEWAY_HEADLESS_PASSWORD` or `headlessPassword` in the 0600 `--config` file; there is no password flag. All four together or none (gateway/src/config/index.ts:289-301; gateway/src/bin/cli.ts:73-80).
  - Stored agents: `headless add <name> --foundry-url <u> --world <id> --user <id> [--owner <id>]`, `headless list`, `headless remove <name>` (help text gateway/src/headless/config/commands.ts:8-22). The password comes only from `AGENT_GATEWAY_HEADLESS_<NAME>_PASSWORD` (name upper-cased, `-` as `_`) or `headless.<name>.password` in the 0600 config file (config/index.ts:98-136). A stored agent with no password available is not started and the gateway logs "headless agent <name> has no password in this gateway's environment or config file; not started" (gateway/src/app.ts:637-643).
  - The password is required by design: an empty one is a `ConfigError` (38 decision g). Reason: a Foundry user with no password can be logged into by anyone who reaches `/join`.
  - `add` revokes the (world, user)'s existing pairings and OAuth grants and cancels its unused invites, so a browser already using that user must pair again (the agent user is not for humans). `remove` revokes the same and keeps the browser profile, printing its path. A running gateway picks up `add`/`remove` within one revocation sweep (5 s), starting a stored agent only if it already holds the password (passwords are read once at start).
  - `add` checks for a duplicate of the flag/env agent only as its own invocation sees it (its own flags, env and config). Run from a shell that does not see a running gateway's flag/env agent, `add` for that same (world, user) is accepted and revokes that agent's pairing; the running gateway keeps the flag/env agent (app.ts:623) and its runner re-pairs through a newly minted invite, so the agent drops briefly (PLAN.md "Now 0a", 38 residual).
  - Explicit binding only: a follow-mode session never binds to a headless identity; reach one with `--world` and `--user <agent id>`, or an OAuth grant naming it. `--owner` routes the agent's ask-owner approvals to that Foundry user; it grants no permission.
  - Browser: system Chrome, then Edge, then Chromium, then a Chromium under `<state dir>/browsers/` (gateway/src/headless/browser.ts:105-118); none found logs "headless agents: no Chrome, Edge or Chromium found; install one, or put Chromium under <dir>/browsers. Runners off" (app.ts:550); found logs "headless runner browser: <kind> at <path>" (app.ts:555). The Docker image ships Debian Chromium at /usr/bin/chromium (gateway/Dockerfile:26-31). Profiles live under `<state dir>/headless/profiles/`, one per (world, user), mode 0700.
  - Sandbox: `headlessNoSandbox` / `AGENT_GATEWAY_HEADLESS_NO_SANDBOX` defaults to off (sandboxed) for npm and from-source installs (config/index.ts:52-56); the Docker image sets `AGENT_GATEWAY_HEADLESS_NO_SANDBOX=1` (Dockerfile:31) because Chromium's sandbox cannot normally start as a non-root user in a container without extra capabilities or a seccomp profile (37 Amendment 2.2). The launcher passes `chromiumSandbox: !noSandbox` (browser.ts:125-135). On Ubuntu 23.10+ with `kernel.apparmor_restrict_unprivileged_userns=1`, a sandboxed Chromium does not start ("No usable sandbox!"; seen live on Ubuntu 26.04 with Chrome for Testing 156, 37 review round 8); the runner then logs once: "Chromium could not start with its sandbox (often Ubuntu AppArmor restricting unprivileged user namespaces, or a container); set AGENT_GATEWAY_HEADLESS_NO_SANDBOX=1 to run it unsandboxed" (browser.ts:137-147, runner.ts:271-274).
  - Certificates: the runner fetches `<foundry url>/api/status` from Node and drives Chromium at the same URL, so the URL needs a certificate both trust: a public certificate, or plain `http` on loopback. A private CA such as Caddy's internal CA is not trusted by either (37 attempt 2 manual run: `foundry.local` failed, `http://localhost:30000` worked).
  - The runner's page reaches the gateway's link at `ws://localhost:<link port>` (app.ts:589; runner.ts:108). A `--link-host` bound to one non-loopback address cuts the runner off; keep the link on loopback, or on an address that includes it.
  - `.mcpb` bundle: headless is not supported (playwright-core is not bundled). Configured anyway, the runner logs once: "playwright-core is not installed; the headless runner needs the npm or Docker install, not the .mcpb bundle" (browser.ts:211).
  - Signals: SIGHUP, SIGINT and SIGTERM all stop the gateway gracefully, closing the headless browser within 5 s (gateway/src/bin/signals.ts; 37 Amendment 3).
  - Relay takeover with headless settings (37 Amendments 5-7, 38 decision e, 97):
    - the headless settings take part in the relay comparison as a one-way digest (Foundry URL, world, user, `noSandbox`, stored-agent passwords this process holds through scrypt); no password or URL credentials are sent;
    - a headless primary never steps down for a caller without headless settings: if the session settings (`publicUrl`, `serverMode`, `allowOrigins`) match, the caller relays; otherwise it goes to standby with `RELAY_CONFIG_MISMATCH` and the reason "the primary gateway has different session settings (...) and is kept because it runs a headless agent" (gateway/src/relay/secondary.ts:299);
    - callers with headless settings keep the normal rules: newer and different takes over, older and different goes to standby;
    - a pre-37 primary ignores headless settings, so a headless caller goes to standby with "primary too old, headless agent not running: the gateway holding the link port does not understand headless settings; upgrade or stop it" (secondary.ts:53), and takes over by itself when the old primary exits;
    - so all gateways sharing a link port should run the same version.
  - Compose (42): gateway/docker/compose.yaml:13-19 passes no headless env; a Docker operator adds it with an override file or `.env`, without editing 42's files.
- docs/spikes/foundry-socket-identity.md (10b): what Foundry can and cannot prove about identity.

## Acceptance
- [ ] Guides in `docs/guides/`, each with exact config snippets and the commands the implementer ran:
  - `claude-ai.md`;
  - `chatgpt.md`, through the public URL;
  - `gemini-cli.md`;
  - `gemini-app.md`;
  - each of the four links the matching manual checklist in docs/compatibility.md (:53 onwards) and does not claim it has been run;
  - `reverse-proxy.md`: Caddy as in 42, nginx with `proxy_set_header Host $host` and WebSocket upgrade headers for `/link`, why `X-Forwarded-For` is trusted only with `--trust-proxy` from a loopback peer, and why the gateway itself never does TLS;
  - `headless.md` (items below).
- [ ] `docs/guides/headless.md` covers, each with the exact command or snippet:
  - a dedicated agent user **with a Foundry password** (required; why: a passwordless user can be logged into at `/join`), the GM's headless toggle, the owner (`--owner`, a routing hint for approvals, not a permission), and explicit binding with `--world`/`--user <agent id>` (follow mode never picks a headless agent);
  - both ways to configure: the flag/env agent (`--headless-foundry-url`, `--headless-world`, `--headless-user`, password via `AGENT_GATEWAY_HEADLESS_PASSWORD` or `headlessPassword` in the 0600 config) and stored agents (`headless add|list|remove`, passwords via `headless.<name>.password` in the 0600 config file or `AGENT_GATEWAY_HEADLESS_<NAME>_PASSWORD`, with the name-to-env rule); a stored agent without a password is not started (quote the log line); passwords are read at start, so a new password needs a restart;
  - that `add` revokes the user's existing pairings and OAuth grants and cancels its invites, that `remove` keeps the profile and prints its path, and the caution that `add` run from a shell that does not see a running gateway's flag/env agent can briefly revoke that agent;
  - the browser: discovery order, the "no Chrome, Edge or Chromium found" and "headless runner browser:" lines, and that the Docker image ships Chromium;
  - the sandbox: npm installs run Chromium sandboxed; on Ubuntu 23.10+ with the AppArmor unprivileged-userns restriction it fails with "No usable sandbox!" and the runner logs its one line (quoted); the two fixes (set `AGENT_GATEWAY_HEADLESS_NO_SANDBOX=1` / `headlessNoSandbox`, or install an AppArmor profile for that Chromium) and the trade-off; the Docker image runs unsandboxed by default and why, and how an operator with the capabilities or a seccomp profile sets it back to `0`;
  - the Foundry URL needs a certificate Node and Chromium both trust (public certificate, or `http` on loopback); a private CA such as Caddy's `tls internal` does not work;
  - the link must stay reachable at `ws://localhost:<port>`: a `--link-host` bound to one non-loopback address cuts the runner off;
  - not supported in the `.mcpb` bundle (quote the log line); use the npm or Docker install;
  - in Docker: the env for headless added through a compose override or `.env` (not by editing 42's compose files), and how to run `headless add` against the container's database (the command the implementer ran);
  - SIGHUP, SIGINT and SIGTERM all stop the gateway and its browser gracefully;
  - several gateways on one link port: the takeover rules (the five bullets under Context "Relay takeover"), including both standby reasons quoted, and "run the same version on every gateway that shares a link port".
- [ ] docs/security.md edits:
  - "The permission model": token scopes become layer 1, and the line at :55 goes;
  - "Pairing, code confirmation and token storage": codes only in the operator log with a public URL, and server-mode operator invites (68): single use, bound to one world and user, with a 24 h TTL by default;
  - "HTTP bearer token": off with a public URL;
  - "Relay between gateway instances": the relay comparison carries a one-way digest of the headless settings and never a password or URL credentials; a headless primary is never displaced by a caller without headless settings; a pre-37 primary leaves a headless caller in standby; link to headless.md for the full rules;
  - "Multi-user isolation": in server mode only the operator decides who pairs as whom, through invites bound to an exact (world, user); re-pairing needs a new invite, which revokes the old pairing and its OAuth grants; the operator revokes with `--revoke-pairing`, and a running gateway closes the connection within seconds; Foundry cannot prove identity to the gateway, so the invite is the trust root and must be sent privately; OAuth sessions are bound to the grant's (world, user), and headless identities are reachable only by explicit binding;
  - "What a malicious agent can and cannot do": remote clients.

  A new "Remote access and OAuth" section covers PKCE, exact redirect URIs, audience binding, token lifetimes, revocation from Foundry, CSRF and anti-framing on the consent page, and the per-client limits.

  A new "Headless agents" section covers: the agent user is not for humans (its pairings come only from gateway-minted invites; `add` revokes existing pairings and grants); the password is required and lives only in the 0600 config file or env, never in SQLite; Chromium's sandbox default (on for npm, off in the Docker image) and what turning it off means; the profile directory (0700, holds a logged-in Foundry session and the pairing token, kept on `remove`); the owner is a routing hint, not a permission; the headless toggle in the module refuses calls when off.
- [ ] docs/privacy.md: :3 no longer says "local release"; it adds what a public gateway exposes (the version and uptime on `/status`), what the OAuth tables store (hashes, client names, grants), what the `headless_agents` table stores (name, Foundry URL, world, user, owner, created time; no password), and what a headless agent's profile directory holds (a Chromium profile with the Foundry session and the module's pairing token, under `<state dir>/headless/profiles/`, kept until deleted by hand).
- [ ] README:
  - the five-minute local quick start stays first; :21's "There is no headless mode in this release" sentence is replaced by one sentence linking docs/guides/headless.md (the rest of step 3 unchanged);
  - a short "Remote and server mode" section links the new guides, and "More" (:42-45) lists them;
  - no sponsor or funding links (Amendment 1): `grep -n -i "ko-fi\|sponsor" README.md` is empty, and `.github/FUNDING.yml` does not exist on the branch (`git diff --stat main...HEAD -- .github/FUNDING.yml` is empty).
- [ ] docs/releasing.md:20 quotes `conformance: ok (inspector <v>, stdio, http, oauth)` (`grep -n "stdio, http, oauth" docs/releasing.md` matches; nothing else in the file changes).
- [ ] Last commit of the PR: README.md:32-36 "What this release does not do" no longer says local only. It lists only what is still missing at that point (for example, native installers, headless in the `.mcpb` bundle), and keeps the macOS-verified / Windows-untested line if still true.
- [ ] Every command in the new docs was run once by the implementer, and the PR lists them. Quoted log lines and standby reasons match the source at the PR's base (`grep -F` each against gateway/src).

## Out of scope
- Rewriting the 65 quick start (beyond the one :21 sentence) or the Claude Desktop and Claude Code guides.
- Foundry listing text and submission (manual, Andrew).
- Native installers, tunnels, `share` mode, and TLS in the gateway (not planned in MVP B).
- docs/server-mode.md, gateway/docker/README.md and the compose files, which are 42's; this task only links them.
- docs/compatibility.md (40's): ticking the manual checklists, or flipping its claude.ai/ChatGPT/Gemini rows (:23-26, still "not supported in this release (MVP B)"), which follows Andrew's checklist run.
- Any code change: making headless work in the `.mcpb` bundle, passing headless env through the compose file, the `add` duplicate check against a running gateway, the "MCP stdio server started" line in server mode, and 96's error-message redaction (96 owns gateway/src/config and gateway/src/bin messages).
- gateway.db created 0644 (37's follow-up task).
- Documenting 35b's gateway audit trail and verbose mode, or linking `docs/audit-trail.md` (moved to 35b by Amendment 1).
- Ko-fi / GitHub Sponsors links and `.github/FUNDING.yml` (added when the repo goes public; Amendment 1).

## History
- 2026-10-13 MVP split: depends was `29, 32, 33, 36, 38, 41, 20f, 35b`. 65 took the README quick start, the Claude guides, the privacy statement and the base security model.
- 2026-10-14 re-plan: those items were removed; the existing security sections are edited in place; README.md:34 is flipped at the end.
- 2026-10-15 refresh: the notes for 43 from 37 (Amendments 2, 3, 5, 6, 7; review rounds 7-9; attempt 2), 38 (decision g, residuals), 97 and 40 (releasing.md line) verified against be8ab45 and added; Owns gains docs/releasing.md (one line); 97 added to Depends.

## Amendment 1 (2026-10-15)

Andrew.

### Decisions

1. **The 35b docs item moves to 35b.** The acceptance item "If 35b has landed, docs/security.md and docs/privacy.md link `docs/audit-trail.md` and cover verbose mode" is removed from this task. 35b is not built and `docs/audit-trail.md` does not exist, so there is nothing to link or describe. 35b's Acceptance now carries an item to document its audit trail and verbose mode in the user docs, and its Owns gains the two files for that purpose. This task's docs must not mention the gateway audit trail or `docs/audit-trail.md`.
2. **No funding links yet.** `.github/FUNDING.yml` (new) leaves Owns, and the README Ko-fi / GitHub Sponsors links leave scope. They will be added when the repo goes public. The branch already adds both (`.github/FUNDING.yml`, and the "support its development on GitHub Sponsors or Ko-fi" sentence in README.md), so the implementer deletes `.github/FUNDING.yml` and removes every sponsor/funding link and sentence from the branch. Owns keeps `.github/FUNDING.yml` for that deletion only.

### Acceptance (changed)
- [ ] README: no sponsor or funding links; `grep -n -i "ko-fi\|sponsor" README.md` is empty and `.github/FUNDING.yml` is not in `git diff --stat main...HEAD` (replaces "Ko-fi and GitHub Sponsors links are added, and `.github/FUNDING.yml` lists both").
- [ ] Removed: the "If 35b has landed ..." item (now 35b's).

### Follow-up
- **Repo goes public:** add `.github/FUNDING.yml` (Ko-fi and GitHub Sponsors) and the README sponsor links. Not a task file yet; file it with the move-public work.
