# 114 — Docs: GM-vouched invites and --admin/--gm/--demote in server-mode docs

**Repo:** .
**Role:** scribe (docs only; workspace rule: only the scribe writes docs).
**Depends on:** 105
**Status:** Ready once 105 has merged (it changes the "Copy my ids" wording these docs quote).
**Owns:**
- docs/server-mode.md
- gateway/docker/README.md
- docs/guides/headless.md (the "Copy my ids" step at `:13` only)

## Goal
docs/server-mode.md and gateway/docker/README.md predate task 90 (GM-vouched player invites) and
task 91 (`--admin`, `--gm`, `--demote`). The docker README still says invites "arrive with task 68".
An operator following them today cannot onboard a GM correctly, and nothing tells them that a
player invite only completes while an admin GM is online. This was a known gap (PLAN item 0a, the
43 follow-ups, "Docs gap"), and the playtest hit it.

## Context
- docs/server-mode.md:64-81 — the invites section (no vouch, no `--admin`/`--gm`/`--demote`).
- gateway/docker/README.md:95-125 — the invite section; `:105-108` is the stale "task 68" text.
- docs/plan/done/90-vouched-pairing.md and docs/plan/done/91-operator-admin-flag.md — the behaviour
  to describe. Read only their Goal and Acceptance.
- PLAN item 2a (91 follow-ups): pair the Foundry user first, then sign in the AI.
- docs/guides/headless.md:13 — refers to the "Copy my ids" line, which 105 moves.

## Acceptance
- [ ] docs/server-mode.md describes the onboarding order: the operator mints `--invite <world> <user>
      --admin` for the first GM, who pairs directly; the admin GM then invites players from Manage
      access (or the operator mints player invites); a player invite completes only while an admin
      GM is in the world with Agent Gateway connected, and otherwise the player sees "No GM is
      online". It also says what `--gm` (pairs directly, not admin) and `--demote` (clears admin) do,
      and that a re-pair replaces the old pairing.
- [ ] Every flag named exists in `gateway/src/bin/cli.ts` (checked with `rg -n -- '--admin|--gm|--demote' gateway/src/bin/cli.ts`).
- [ ] gateway/docker/README.md has no "task 68", "not in this build yet" or other task-number
      wording, gives the same onboarding order with `docker compose exec gateway <cli> …` commands,
      and links to docs/server-mode.md for detail rather than repeating it.
- [ ] Both files say to pair the Foundry user before signing in the AI client.
- [ ] Every "Copy my ids" reference in the three files matches the pairing window wording after 105.
- [ ] No secrets, real invite codes or host names beyond `example.com` placeholders.
- [ ] Prettier passes on the three files.

## Out of scope
- ChatGPT docs (task 113), docs/security.md and docs/privacy.md (including the 94 privacy follow-up).
- Any CLI or code change; if a documented behaviour turns out wrong, report it, do not fix it.
- PLAN.md and HISTORY*.md (the record step closes the "Docs gap" follow-up line).
