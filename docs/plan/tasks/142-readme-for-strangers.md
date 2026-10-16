# 142 — Rewrite the README for someone who has never seen the project

**Repo:** .
**Depends on:** none
**Owns:**
- README.md
- gateway/README.md (the npm package readme)

**Status:** Part of the go-public set (140-148), planned 2026-10-16 (Andrew's decision 8: README
rewritten for strangers).

## Goal

The repo is about to become public and be listed for Foundry users. The README must tell a
stranger what this is (a Foundry VTT module plus an MCP gateway that lets an AI client act in a
world as a specific Foundry user, within that user's permissions and with approvals), whether it
is for them, how to install it the supported ways, and where to go next, without assuming
knowledge of the private repo, Andrew's deployment or the internal planning docs.

## Context

- README.md (60 lines) — current text. :11 "You need git access to the private repository";
  :14 the clone URL; :49 "from Andrew or from others"; :59 links `docs/conventions.md`; :60 links
  the internal design spec `docs/plan/specs/2026-10-09-agent-gateway.md`.
- docs/guides/claude-desktop.md:11 links `README.md#quick-start`; keep a `## Quick start` heading so
  that anchor still resolves.
- module.json `manifest` — `https://github.com/AindriuB/agent-gateway/releases/latest/download/module.json`,
  the Foundry install-by-manifest URL once releases are public.
- docs/guides/*.md, docs/server-mode.md, docs/security.md, docs/privacy.md, docs/compatibility.md,
  docs/packs/README.md — the public docs to route readers to.
- gateway/README.md:17 — the npm readme; check it reads correctly for an npm visitor.
- Files added by sibling tasks that the README links to: CONTRIBUTING.md, SECURITY.md,
  CODE_OF_CONDUCT.md, CHANGELOG.md (task 140). The links may dangle until 140 merges; that is
  expected.

## Acceptance

- [ ] README opens with a one-paragraph plain description and a short "What it can and cannot do"
      list (acts as a real Foundry user; GM approval for writes per policy; no access beyond that
      user's permissions).
- [ ] "Install" covers, in this order: the Foundry module by manifest URL (the module.json
      `manifest` URL, verbatim); the gateway by the Claude Desktop bundle, by npm
      (`foundry-agent-gateway`) and by Docker (`ghcr.io/aindriub/foundry-agent-gateway`); and build
      from source with a public `git clone https://github.com/AindriuB/agent-gateway.git`. No step
      needs credentials or `docker login`.
- [ ] A `## Quick start` heading exists (anchor used by docs/guides/claude-desktop.md:11).
- [ ] A "Which guide do I need?" table maps each client (Claude Desktop, Claude Code, claude.ai,
      ChatGPT, Gemini CLI, Gemini app, headless) and the self-hosted server mode to its file in
      `docs/`; every relative link resolves to a tracked file or to a file added by task 140
      (check with a link script or by hand; list the check in the PR).
- [ ] Sections for "Security and privacy" (links docs/security.md, docs/privacy.md, SECURITY.md),
      "Compatibility" (Foundry and system versions from docs/compatibility.md), "Contributing"
      (CONTRIBUTING.md, CODE_OF_CONDUCT.md), "Changelog" (CHANGELOG.md) and "Licence" (MIT).
- [ ] The README carries a one-line notice that the project is not affiliated with or endorsed by
      Foundry Gaming LLC, and that users must own their Foundry licence and content.
- [ ] `rg -n -i "andrew|private repo|private repository|docs/plan|conventions\.md|PROJECT\.md|CLAUDE\.md|AGENTS\.md|homelab|aindriub\.app|/Users/|/home/" README.md gateway/README.md`
      prints nothing.
- [ ] Pack text no longer names a person ("Optional tool packs, from the maintainer or others…").
- [ ] `npm run verify` exits 0 (prettier on README is not in the lint glob, but run
      `npx prettier --check README.md gateway/README.md` and list the result).

## Out of scope

- Every file under `docs/` (tasks 143 and 146), including fixing other docs' links.
- gateway/docker/README.md (task 146).
- CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md, CHANGELOG.md (task 140).
- Funding badges or links (an owner question in task 140).
- module.json and package.json fields (task 141).
