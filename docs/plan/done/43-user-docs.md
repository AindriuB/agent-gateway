# 43 — Write the remote, server-mode and headless user documentation

**Repo:** .
**Depends on:** 65, 35, 37, 38, 40, 42, 67, 68, 74, 97 (all merged)
**Status:** MVP B wave 4, last. Amended 2026-10-14 in the MVP B re-plan: the items 65 already did are removed; the existing docs/security.md sections are edited, not created; README.md:34 is flipped at the end. Refreshed 2026-10-15 against what shipped in 37 (PR #151, Amendments 1-7), 38 (PR #153), 97 (PR #152) and 40 (PR #150), at be8ab45: every "note for 43" from those tasks and PLAN.md "Now 0a" is checked against the merged code and added below as a concrete doc item; Owns widens to `docs/releasing.md` (one line, from 40); README.md:21 is added (it still says there is no headless mode); 97 joins Depends. Line references re-checked at be8ab45. Amendment 1 (2026-10-15): the 35b docs item moves to 35b; no funding links yet. Amendment 2 (2026-10-15): remote OAuth clients cannot reach a headless agent yet; the docs say so and point to task 98.
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
  - Explicit binding only: a follow-mode session never binds to a headless identity; reach one with `--world` and `--user <agent id>` on a local stdio or HTTP session. `--owner` routes the agent's ask-owner approvals to that Foundry user; it grants no permission.
  - Remote OAuth clients (claude.ai, ChatGPT, Gemini) cannot reach a headless agent yet (Amendment 2): the consent code goes only to the named user's own link connection (gateway/src/oauth/consent/index.ts `deliver`, ~278-297), which for a headless agent is the gateway's own Chromium, where nobody sees it; and `headless add` revokes any earlier grants for that user. Task 98 (owner-routed OAuth consent) is the follow-up.
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
  - a plain statement that remote OAuth clients (claude.ai, ChatGPT, Gemini) cannot use a headless agent yet, because the consent code would go to the agent's own headless browser where nobody can see it; only local stdio or HTTP sessions bound with `--world`/`--user <agent id>` can; this is planned as task 98 (named, so the line can be found and updated when 98 lands). No guide (`claude-ai.md`, `chatgpt.md`, `gemini-cli.md`, `gemini-app.md`, `headless.md`) describes an OAuth path to a headless agent;
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
  - "Multi-user isolation": in server mode only the operator decides who pairs as whom, through invites bound to an exact (world, user); re-pairing needs a new invite, which revokes the old pairing and its OAuth grants; the operator revokes with `--revoke-pairing`, and a running gateway closes the connection within seconds; Foundry cannot prove identity to the gateway, so the invite is the trust root and must be sent privately; OAuth sessions are bound to the grant's (world, user); headless identities are reachable only by explicit binding (`--world`/`--user <agent id>`) on a local stdio or HTTP session, and remote OAuth clients cannot reach them yet (link to headless.md, which names task 98);
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

## Amendment 2 (2026-10-15)

Andrew, from code review.

### Decisions

1. **Remote OAuth clients cannot reach a headless agent yet, and the docs say so.** The consent code is delivered only to the named user's own link connection (gateway/src/oauth/consent/index.ts `deliver`, ~278-297). For a headless agent that connection is the gateway's own Chromium, where nobody can see the code, so no consent can finish. `headless add` also revokes any earlier OAuth grants for that (world, user) (`revokePairingsFor`). The docs must no longer claim the OAuth path for headless agents. They say plainly that claude.ai, ChatGPT and Gemini cannot use a headless agent yet, that local stdio or HTTP sessions bound with `--world`/`--user <agent id>` can, and that task 98 (owner-routed OAuth consent for headless agents) is the follow-up.

### Context (changed)
- "Explicit binding only": "or an OAuth grant naming it" is removed; a new bullet records why remote OAuth clients cannot reach a headless agent and names task 98.

### Acceptance (changed)
- [ ] `docs/guides/headless.md` states that remote OAuth clients (claude.ai, ChatGPT, Gemini) cannot use a headless agent yet, that local stdio or HTTP sessions bound with `--world`/`--user <agent id>` can, and names task 98 as the planned fix.
- [ ] docs/security.md "Multi-user isolation": headless identities are reachable only by explicit binding on a local stdio or HTTP session; remote OAuth clients cannot reach them yet (replaces "headless identities are reachable only by explicit binding" as part of an OAuth sentence).
- [ ] No file in the PR describes reaching a headless agent through an OAuth grant: `grep -rn -i "headless" docs/guides/claude-ai.md docs/guides/chatgpt.md docs/guides/gemini-cli.md docs/guides/gemini-app.md` shows no such claim, and headless.md and security.md only say it is not possible yet.

### Follow-up
- **Task 98** (owner-routed OAuth consent for headless agents) is filed. When it lands, it updates the headless.md and security.md lines this amendment adds (98 Decision c).

## Review round 1 — findings
Reviewed HEAD: 1c2400c (code review of the implementer's commits c117d4d..51fd326, then Amendments 1 and 2).

- [P2] .github/FUNDING.yml:1 and README.md:61-64: Amendment 1 is not applied yet. Delete .github/FUNDING.yml, and remove the README "## Support the project" section with its GitHub Sponsors and Ko-fi links. Check: `git diff --stat main...HEAD -- .github/FUNDING.yml` and `grep -n -i "ko-fi\|sponsor" README.md` both return nothing.
  route: implementer
- [P2] docs/guides/headless.md:5 and :100, docs/guides/claude-ai.md:17, and the docs/security.md "Multi-user isolation" text: apply Amendment 2. Remove every description of an OAuth path to a headless agent. Say plainly that remote OAuth clients (claude.ai, ChatGPT, Gemini) cannot use a headless agent yet, that local stdio/HTTP sessions bound with `--world`/`--user <agent id>` can, and that task 98 is the fix.
  route: implementer
- [P2] README.md:39 and :43, docs/security.md:110: the testing claims are overstated. "Have not all been run" implies some remote-client manual checks were run, but none were (all unticked in docs/compatibility.md from :53). README:43's "exercised only by the automated OAuth conformance run" implies claude.ai, ChatGPT and Gemini were exercised; conformance drives the gateway's own oauth-flow.mjs and the MCP Inspector, not those clients. Say that none of the remote-client checklists has been run, and that the automated conformance run tests the gateway's OAuth server with its own client and the MCP Inspector.
  route: implementer
- [P3] README.md:42: "you install from source, from the npm package or from the Docker image" contradicts README.md:7 ("Pre-release: not yet published. Install from source."). State the current state: build from source, or build the Docker image locally.
  route: implementer
- [P3] docs/guides/headless.md:214: "headless add, list, remove (both outputs above)" refers to outputs the guide does not show. Either quote real `add` and `list` output, captured from a run with placeholder ids and no secrets, or reword the line.
  route: implementer
- [P3] docs/privacy.md:26: "The other public paths are the MCP endpoint and the sign-in pages" leaves out the public `/link` WebSocket (reverse-proxy.md:11) and the `/register`, `/token` and `/.well-known` endpoints. List the public paths accurately, as the reverse-proxy guide routes them.
  route: implementer
- [P3, optional] docs/guides/headless.md:153: quote the `.mcpb` line with its `headless runner: ` prefix, as :123 does for the sandbox line. :104 "When it starts it logs one of": say discovery happens when the first headless runner starts, not at every gateway start.
  route: implementer

## Review round 2 — findings (external)
Andrew's PR review of #155 at f95072d (2026-10-15).

- [P2] docs/guides/headless.md:14: the headless setup leaves out a required permission. A non-GM agent still cannot use tools after following the guide, because the player permission is off as well as the headless one. Tell users to open the module's Configure policies, enable both player agents and headless agents, then save. Check the exact setting names, labels and defaults against module/src (lang/en.json and the policy settings) and quote the labels exactly. Check the rest of the guide for any other step a non-GM agent needs that is missing.
  route: implementer
- [P2] docs/guides/headless.md:95: the binding command fails against the recommended server-mode deployment. A plain stdio client with `--world`/`--user` goes to standby, because its session settings (publicUrl, serverMode, allowOrigins) differ from the server-mode primary's, and public HTTP clients cannot reach headless agents until task 98. Find out by running them, not by reading code alone, which deployment and client combinations can actually reach a headless agent today:
  - local mode with a stdio client;
  - local mode with HTTP and a static bearer;
  - server mode with a stdio client started with the same session settings as the primary;
  - server mode with Docker `compose exec`;
  - server mode with remote OAuth (not possible until task 98).
  Document them as a short table. Scope the binding command to the combinations that work, and say plainly which do not work yet. Make the README and security.md statements consistent with the table. Record in the PR which combinations were run.
  route: implementer

## Review round 3 — findings
Reviewed HEAD: 515ef49 (re-review of round 2). The permission step is FIXED, with labels, defaults and messages checked against module/src. The reachability part is not finished.

- [P2] docs/guides/headless.md:100-104: the binding example puts `AGENT_GATEWAY_HEADLESS_PASSWORD='…'` in front of `claude mcp add`. That sets it only for the `mcp add` process, so the gateway Claude Code starts later never gets the password. Use `claude mcp add … -e AGENT_GATEWAY_HEADLESS_PASSWORD=… -- …` (check the flag against `claude mcp add --help` if available), and note that the value is then stored in the client's config file. Alternatively, say to export it in the shell that starts the client, or put it in the 0600 config file. Keep the note for other clients.
  route: implementer
- [P2] docs/guides/headless.md:5, :120, :185; docs/security.md:80, :125; README.md:39: the blanket "server mode / Docker: no client can reach it" claims go beyond the runs. Every server-mode run used `--public-url`. By source (app.ts:915, :945, :856-862), server mode WITHOUT a public URL keeps the static bearer, and HTTP sessions fall back to the primary's `--world`/`--user`. Run that case: `--server-mode` with the headless flags and `--world`/`--user`, no `--public-url`, then an HTTP client with the printed bearer. If you can, also run the Docker image without AGENT_GATEWAY_PUBLIC_URL. Add rows with the observed results, and make the prose, README and security.md say exactly what the table shows: e.g. "server mode with a public URL (as the Compose stack sets it)". Claim nothing beyond the runs.
  route: implementer
- [P3] docs/guides/headless.md:119 (Docker row): only `docker exec -i` was run, not `docker compose exec -T`. Mark the compose form as not run, or drop it. No container log shows the in-container agent pairing. Either re-run with the container's log captured and quote the "link connected" line, or soften the "each row was run … with the agent logged in" lead-in (:110) for that row.
  route: implementer
- [P3] docs/guides/headless.md:115: "the session follows the connected browser pairing" does not match the run. With no person paired, follow mode never picks a headless identity, so the session answered WORLD_OFFLINE. Reword to say that.
  route: implementer
- [P3, optional] headless.md:112 "reads and calls tools as the agent": only `world_info` and `gateway_status` were called. Say "reads as the agent", or run one write-capable call under the policy and report it. headless.md:116: the "same settings" row used a different `--http-port`; note it or re-run it with the same port.
  route: implementer
