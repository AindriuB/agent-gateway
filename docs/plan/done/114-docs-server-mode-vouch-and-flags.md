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

## Review round 1 — findings

Reviewed HEAD: 5b1e3cd

- [P2] docs/server-mode.md:80-82 and gateway/docker/README.md:116-118 — both say a player sees "No GM is online" when no admin GM is online. In the ordinary case the gateway refuses the invite before any challenge (gateway/src/link/server.ts:848-854, PAIRING_UNCONFIRMED), and the pairing window shows `Pairing.Vouch.unconfirmed` (module/src/apps/pairing/index.ts:53-54, lang/en.json:162): "Your GM could not confirm this pairing, so the invite was not used. Ask your GM to open this world with Agent Gateway connected, then paste the invite again." `Vouch.noGm` (en.json:164) is a rare race notification only (client.ts:795, vouch.ts:31-33). Also "once a GM has joined" should say an admin GM with Agent Gateway connected. Orchestrator ruling (2026-10-16): Acceptance bullet 1 quoted the wrong message, a factual error in the spec; the docs must describe the real behaviour and quote the `unconfirmed` text. Bullet 1 is read as "the docs say what the player sees when no admin GM is online". route: implementer
- [P3] docs/server-mode.md:107-109 and gateway/docker/README.md:122 — "Redeeming any invite … replaces the old pairing" and "Re-pairing a lost device needs a new invite" don't hold for GM users. A plain invite for a GM user is refused (server.ts:944-946, GM_USER_MESSAGE), and a delegated invite to a user with an admin pairing is spent as a mismatch (gateway/src/link/invites.ts:189-193). Say a GM re-pairs with a new `--admin` or `--gm` invite. route: implementer
- [P3] docs/server-mode.md:77 and gateway/docker/README.md:115 — "invites players from Manage access" never says where Manage access is. Give the path as docs/guides/headless.md:14 does (Configure Settings, then Agent Gateway, then Manage access). route: implementer

## Review round 2 — findings

Reviewed HEAD: aa7f5ed

- [STYLE] docs/server-mode.md:76-77, :81, :116 and gateway/docker/README.md:115 — prose left unwrapped or ragged (:81 is 150 chars, README:115 is 139). Re-wrap to 100 columns like the surrounding paragraphs (.prettierrc printWidth 100; proseWrap is preserve, so Prettier won't do it). route: implementer
- [P3] docs/server-mode.md:113-114 — "an invite meant for another user is spent as a mismatch if the user has an admin pairing" describes the wrong case. Any wrong-user invite is spent as a mismatch (claimMatches). The admin-pairing rule (gateway/src/link/invites.ts:186-190) is for a delegated invite, one made from Manage access, aimed at a user who holds an admin pairing. Say "an invite made from Manage access is spent unused if that user holds an admin pairing". route: implementer
- [P3] docs/server-mode.md:114 and gateway/docker/README.md:123-124 — "A GM re-pairs with a new `--admin` or `--gm` invite" doesn't warn that `--gm` downgrades an admin GM (pairTarget, invites.ts:112-126, :195). If the only admin gets `--gm`, no admin is live and every player invite fails PAIRING_UNCONFIRMED. Say: an admin GM re-pairs with `--admin`; other GM accounts with `--gm`. route: implementer
