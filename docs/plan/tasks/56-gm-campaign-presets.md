# 56 — gm-campaign pack: encounter presets and campaign outline

**Repo:** .
**Status:** Planned — do not start; queued after current workloads (32, 44, and the five gap tasks)
**Depends on:** 45, 47, 48, 50
**Owns:**
- packs/gm-campaign/** (new pack module)
- module/test/packs/gm-campaign/** (new)
- e2e/packs/gm-campaign/** (new)

Andrew listed this phase's dependencies as A and gap 1 (45). The task also depends on 50:
- MAX_GM_TOOLS is 36 (protocol/test/tools/tool-count.test.ts:7), so this cannot be a core tool and must be a pack.
- Packs must use 50's write helper.

It is a separate pack from gm-builder, so it does not wait for 53 or 54.

## Goal
Let a GM set up an encounter or a campaign skeleton in a few approved, idempotent calls. The
tools cover:
- an NPC roster imported from compendia and bundled with a combat on a scene
- folder trees and journals
- several scenes at once

The pack stops before Adventure documents, world settings, users, macros and module config.

## Context
- Task 45 covers compendium entry checks and embedding. Task 48 covers batch combat creation. Task 47 covers batch scene creation. A pack cannot call these tools (task 50), so it repeats their native checks through 50's helper.
- module/src/tools/compendium-import.ts:12-55: the canonical compendium entry checks to mirror.
- module/src/tools/_documents.ts:144-166: folder checks.

## Design gate
Before code, an architect pass decides two things:
- whether the pack re-implements 45's and 48's native steps or core exposes them as vetted pack helpers in a 1.x minor (a separate task)
- the idempotency design

## Spike (verify before code; record in PR)
- [ ] Idempotency: a caller key (≤64 chars) is stored in `flags.<pack-id>.key` on each root document created. Decide what a repeated call with the same key returns: the existing UUIDs, with no new write. Decide how a partial earlier run is reported. Consider whether flags survive Undo and duplication.
- [ ] Whether the encounter combat stays non-undoable, following 48's outcome.

## Acceptance
- [ ] Tools are GM-only and prefixed: `<prefix>_encounter_preset` and `<prefix>_campaign_outline`. A test asserts that a player-role session's tools/list contains neither, in a unit test and in the e2e roles check.
- [ ] `encounter_preset` takes `sceneUuid`, at most 12 roster rows `{compendiumUuid, count 1–6, x, y}` and a `key`. It imports the NPC Actors, places their tokens and creates one combat. The target count stays at or under 50's `maxTargets`, or the call refuses. It is one approval and one audit entry.
- [ ] `campaign_outline` takes a `key` and a bounded tree: at most 3 folder levels, at most 50 folders, journals and pages in total, and at most 10 scenes using 47's bounds. Journal text is treated as untrusted Markdown, rendered inert the way `markdownHtml` does it (module/src/tools/_write.ts:48-54).
- [ ] Repeating either call with the same `key` writes nothing and returns the same UUIDs (unit test). A different user's key never matches.
- [ ] Refused with FORBIDDEN in unit tests: Adventure, Setting, User, Macro and module-config document types, and any data path naming them.
- [ ] Native acceptance on v14 and v13 (`AGENT_GATEWAY_E2E_GM_BUILDER=1`). A preset with 2 roster rows creates actors, tokens and a combat, and a repeat call is a no-op. An outline with one folder, journal and scene is created. Everything is deleted by exact UUID afterwards. Native execution needs Andrew's per-run approval.
- [ ] `npm run verify` passes

## Out of scope
- Adventure documents, world settings, users, macros, module config
- Character building (45, 46, 49); map import (54, 55)
