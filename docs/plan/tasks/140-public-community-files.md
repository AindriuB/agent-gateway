# 140 — Add the public community files: SECURITY, CODE_OF_CONDUCT, CONTRIBUTING, CHANGELOG, templates

**Repo:** .
**Depends on:** none
**Owns:**
- SECURITY.md (new)
- CODE_OF_CONDUCT.md (new)
- CONTRIBUTING.md (new)
- CHANGELOG.md (new)
- .github/ISSUE_TEMPLATE/** (new)
- .github/pull_request_template.md (new)

**Status:** Part of the go-public set (140-148), planned 2026-10-16 from Andrew's decisions of
that date. Recorded decisions that apply here:
- Decision 1: `docs/conventions.md` moves to the private companion repo (task 147). Its
  contributor-facing content is useful to strangers, so it gets a public home here, in
  CONTRIBUTING.md. The agent-only parts (the shared insertion-only file list, the role loop,
  worktree rules) stay private.
- Decision 4: security reports go through GitHub private vulnerability advisories.
- Decision 5: the code of conduct reflects Foundry VTT's community and package policies,
  especially around copyrighted material.
- Decision 7: the Ascend-derived CSS values in `gateway/src/oauth/consent/style.ts` are approved
  to stay public (Andrew, 2026-10-16). No code change; see Scribe items.

## Goal

A stranger landing on the public repo can find how to report a vulnerability, what behaviour is
expected of them, how to contribute a change that passes the gate, and what changed between
releases. Issues and PRs arrive in a shape a maintainer can act on.

## Context

- docs/conventions.md (whole file, 52 lines) — the source for CONTRIBUTING.md's code style,
  layout, tests and suites, i18n, ports and PR sections. Do not copy its "Shared insertion-only
  files" section or the "v13 pending homelab instance" wording.
- PROJECT.md:38-50 — the rules that apply to humans too: never push to `main`, one change per PR,
  `npm run verify` must pass (it also runs the script tests), never commit secrets.
- docs/security.md — the existing threat model and security model; SECURITY.md links to it and
  does not repeat it.
- docs/releasing.md — release mechanics; the CHANGELOG step is added there by task 143.
- `git tag` — v0.1.0, v0.1.1, v0.2.0, v0.3.0 (rc tags are not releases). `gh release list` shows
  0.3.0 published and 0.1.0 as a never-published draft.
- docs/plan/HISTORY-INDEX.md — one row per change; use it (and `git log v0.2.0..v0.3.0` etc.) to
  summarise earlier releases. It is internal: do not link to it from any public file.
- module.json `manifest` / `download` — the Foundry install path to mention in the bug template's
  "how installed" field.

## Acceptance

- [ ] SECURITY.md exists. It says vulnerabilities are reported through GitHub private
      vulnerability reporting ("Report a vulnerability" on the repo's Security tab, with the
      `https://github.com/AindriuB/agent-gateway/security/advisories/new` URL), never in a public
      issue, PR or discussion. It has a "Supported versions" table listing `0.4.x` as supported and `< 0.4` as
      not supported (decided, owner 2026-10-16: latest minor only). It states what to include (affected component: module, gateway,
      plugin or Docker image; version; reproduction) and links `docs/security.md` for the threat
      model. It contains no email address and no personal name.
- [ ] CODE_OF_CONDUCT.md exists, written in the implementer's own words (no sentence copied from
      Foundry's policies or from the Contributor Covenant). It covers, as explicit rules:
      1. no sharing of, linking to or requests for pirated or paid content: premium modules,
         adventures, compendium content, Foundry VTT core itself, or licence keys;
      2. respect for game-system publishers' licences (for example the ORC, OGL or a publisher's
         own fan-content policy) and for the licence of each system and module;
      3. no pasting of copyrighted rulebook text into issues, PRs or discussions; describe the
         rule or cite the book and page instead;
      4. an AI agent driving Foundry through this project must not be used to extract, bulk-copy
         or redistribute licensed content (compendium packs, premium module content, paid art);
      5. ordinary conduct rules: respectful, no harassment, no personal data of others.
      It names enforcement steps and says conduct reports go through GitHub's "Report content"
      feature or to the maintainer handle `@AindriuB` on GitHub (decided, owner 2026-10-16); it
      says a private vulnerability advisory is not the channel for conduct. No email address
      (`rg -n '@AindriuB' CODE_OF_CONDUCT.md` finds the handle; `rg -n 'Report content'
      CODE_OF_CONDUCT.md` finds the feature).
- [ ] The PR description lists the foundryvtt.com policy pages this was grounded in (at least the
      package development / submission rules, the software licence or EULA, and the community
      rules), each with its URL and the date it was read. The URLs do not appear in
      CODE_OF_CONDUCT.md.
- [ ] CONTRIBUTING.md exists and covers: prerequisites (Node >= 22.13 per `engines.node`),
      `npm ci`, `npm run build`, `npm test`, `npm run test:slow`, `npm run verify` as the gate;
      fast vs `*.slow.test.ts` suites; test layout `<workspace>/test/<area>/**` and Foundry stubs in
      `module/test/stubs/**`; directory layout; TypeScript strict, ESM, Prettier and ESLint; i18n
      keys `AGENT_GATEWAY.<Area>.*` in `lang/en.json`; the one shared version across `module.json`
      and every `package.json`; that live end-to-end tests need a Foundry instance and are not
      required for an outside PR; PR expectations (one change per PR, what and why, tests run);
      that forked PRs get CI checks (task 145) without secrets; links to CODE_OF_CONDUCT.md and
      SECURITY.md. It does not mention agents, worktrees, roles, `docs/plan`, PLAN.md, HISTORY,
      `docs/workflow.md`, `docs/conventions.md`, CLAUDE.md, AGENTS.md or PROJECT.md
      (`rg -n -i 'docs/plan|PLAN\.md|HISTORY|workflow\.md|conventions\.md|CLAUDE\.md|AGENTS\.md|PROJECT\.md|worktree|homelab' CONTRIBUTING.md` prints nothing).
- [ ] CHANGELOG.md exists in Keep a Changelog style. Its top section is `## [0.4.0] - Unreleased`
      listing the user-visible changes on `main` since `v0.3.0` at the time of writing (the image
      tools will be added at release time; say so in the PR). Below it is one
      `## Earlier releases` section summarising 0.1.0, 0.1.1, 0.2.0 and 0.3.0 in two to five
      bullets each, user-facing only (no task numbers, no PR numbers, no internal names).
- [ ] `.github/ISSUE_TEMPLATE/` holds a bug report form and a feature request form (YAML issue
      forms) and a `config.yml` with `blank_issues_enabled: false` and a contact link to the
      security advisory URL for vulnerabilities. The bug form asks for Foundry version, game system
      and version, module version, gateway version, how the gateway runs (Claude Desktop bundle,
      npm, Docker), the AI client, and steps; it carries a checkbox stating the reporter has not
      pasted copyrighted rulebook or premium content, and a warning not to paste tokens, invite
      codes or pairing codes.
- [ ] `.github/pull_request_template.md` asks for what and why, how it was tested, `npm run verify`
      result, and Foundry versions tried, with checkboxes for "no copyrighted content added" and
      "no secrets or personal paths".
- [ ] No `.github/FUNDING.yml` is added (decided, owner 2026-10-16): `test ! -e .github/FUNDING.yml`
      succeeds after the change.
- [ ] No file in this task contains `Andrew`, `aindriub.app`, `homelab`, `/Users/`, `/home/` or an
      email address (`rg -n -i 'andrew|aindriub\.app|homelab|/Users/|/home/|@[a-z0-9-]+\.[a-z]' SECURITY.md CODE_OF_CONDUCT.md CONTRIBUTING.md CHANGELOG.md .github/ISSUE_TEMPLATE .github/pull_request_template.md` prints nothing).
- [ ] `npm run verify` exits 0.

## Out of scope

- `.github/workflows/ci.yml` (task 145) and `.github/FUNDING.yml` (decided, owner 2026-10-16: not
  added at all).
- README.md (task 142) and every file under `docs/` (tasks 143 and 146), including adding the
  CHANGELOG step to docs/releasing.md.
- Moving or editing `docs/conventions.md`, PROJECT.md, CLAUDE.md, AGENTS.md (task 147).
- LICENSE: decided, keep "Copyright (c) 2026 Andrew Bannister" (Andrew, 2026-10-16). Do not edit.
- Enabling private vulnerability reporting in repo settings: an owner action, listed in task 148.

## Owner questions

- Supported versions in SECURITY.md — Decided (owner, 2026-10-16): only the latest minor,
  `0.4.x`; `< 0.4` is not supported.
- Funding links — Decided (owner, 2026-10-16): no `.github/FUNDING.yml` is added.
- Conduct enforcement contact — Decided (owner, 2026-10-16): GitHub "Report content" plus the
  maintainer handle `@AindriuB`.

## Scribe items

- Decision 7 (Andrew, 2026-10-16): the Ascend-derived style values in `CONSENT_CSS`
  (`gateway/src/oauth/consent/style.ts`) are approved to be public. Close PLAN.md's "Approve the
  Ascend style values going public" action and the matching prerequisite in the Go public item.
