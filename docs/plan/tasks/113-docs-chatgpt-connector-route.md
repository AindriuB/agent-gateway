# 113 — Docs: lead ChatGPT setup with the developer-mode connector; record the plugin finding

**Repo:** .
**Role:** scribe (docs only; workspace rule: only the scribe writes docs).
**Depends on:** 103
**Status:** Ready once 103 has merged.
**Owns:**
- docs/guides/chatgpt.md
- docs/chatgpt-plugin.md
- docs/compatibility.md (the ChatGPT row of the matrix and the "ChatGPT (developer mode connector…)" checklist block only)

## Goal
The 0.3.0 playtest settled the open ChatGPT question. A plugin made at chatgpt.com/plugins shows
up only in Codex, never in ChatGPT chat, while a developer-mode custom connector (no plugin) works
on a live ChatGPT account. Make the connector the route the ChatGPT guide leads with, record the
plugin finding where task 84 documented the plugin, and bring the consent steps in line with 103
(destructive and code unticked by default).

## Context
- docs/guides/chatgpt.md:5 — the banner says the guide was never run against a live ChatGPT account.
- docs/guides/chatgpt.md:18-23 — "Add the connector" (already the connector route); step 3 says
  "untick any scope you do not want to give".
- docs/guides/chatgpt.md:27 — the scope list in "What to expect".
- docs/chatgpt-plugin.md:68, :92-104, :141 — what was observed about Codex versus ChatGPT and what
  is still pending.
- docs/compatibility.md:28 — the ChatGPT matrix row; :78-83 — the ChatGPT manual checklist.
- docs/plan/tasks/84-chatgpt-plugin.md — the plugin task. Its live acceptance (install in ChatGPT,
  read, approved write) cannot be met by a plugin as of this finding.

## Acceptance
- [ ] docs/guides/chatgpt.md opens by saying the supported route is a developer-mode custom
      connector, and that a plugin from chatgpt.com/plugins currently appears only in Codex (link
      to docs/chatgpt-plugin.md). It gives the date of the observation.
- [ ] The guide's banner is replaced by what was actually run live (connector, OAuth consent and
      whatever calls the orchestrator confirms Andrew ran). Steps not run stay marked as not run.
      Nothing is claimed beyond what the orchestrator confirms.
- [ ] Step 3 says `read` and `write` are ticked by default and `destructive` and `code` must be
      ticked deliberately (matches 103).
- [ ] docs/chatgpt-plugin.md has a dated "Status" section stating the Codex-only finding, that ChatGPT
      chat users should use the connector guide instead, and what the package is still for (Codex).
      Its pending "ChatGPT Work tool discovery and read" line (`:141`) is resolved accordingly.
- [ ] docs/compatibility.md's ChatGPT checklist ticks only the steps the orchestrator confirms
      passed live, with the date and gateway version (0.3.0). The matrix row no longer says "not
      supported in this release" if the connector route was confirmed.
- [ ] No deployment-specific host names are added beyond those docs/chatgpt-plugin.md already
      contains. No secrets, tokens or invite codes, and no employer or customer names.
- [ ] Prettier passes on the three files (`npx prettier --check <files>`).

## Note for the record step (scribe, at /record; not part of this task's diff)
Close task 84's open item rather than amending it. Archive docs/plan/tasks/84-chatgpt-plugin.md to
docs/plan/done/ with a closing note: the package and packer were delivered (PR #136). Live ChatGPT
acceptance is superseded, because ChatGPT plugins surface only in Codex; the supported ChatGPT
route is the developer-mode connector, documented by 113. Codex use was reported working by Andrew.
Remove PLAN "Now" item 1, keeping the 429 retest only if Andrew has not done it. Add a HISTORY
entry and index row.

## Out of scope
- docs/server-mode.md and gateway/docker/README.md (task 114).
- Consent-page world and user wording beyond scopes (follows task 104 once decided).
- The plugin package, the packer and any code.
- PLAN.md and HISTORY*.md (the record step).

## Review round 1 — findings

Reviewed HEAD: e50bfc4

- [P2] docs/chatgpt-plugin.md:98-100, :66-74, :122-129, :154-156 — the new Status section (:14-16) is contradicted by unchanged text in the same file. :99-100 says the observation "does not establish that the plugin is Codex-only". :66-74 tells readers to switch to Work and install the plugin in ChatGPT. "Next checks" (:122-129) says to test the Work installation first. :156 says the task stays incomplete until live acceptance passes. Make the whole file consistent with Status. Orchestrator ruling on scope of the finding: the 2026-10-16 observation is that the plugin surfaced only in Codex and not in ChatGPT chat; Work mode was not separately verified. Say exactly that. Don't claim Work mode is ruled out; say it is unverified and that the connector is the supported route either way. route: implementer
- [P2] docs/guides/chatgpt.md:27 — "Scopes are `read` (default), `write`, …" contradicts step 3 (:24) and gateway/src/oauth/consent/render.ts:81,88: `read` and `write` start ticked, `destructive` and `code` start unticked. Fix it so a reader who wants read-only knows to untick `write`. route: implementer
- [P3] docs/guides/chatgpt.md:24 — step 3 is hard for a non-technical reader: a comma splice, and "untick any other scope" is unclear, because the page shows only the scopes the client requested (render.ts:85). Rewrite as short steps. route: implementer
- [NOTE] docs/guides/chatgpt.md:7 — "used by ChatGPT as the agent in a playtest" is accurate. On 2026-10-16 ChatGPT, via the connector, made real tool calls: 1808 /mcp requests, and one queued call that was approved at 08:13:58Z. Keep it.
