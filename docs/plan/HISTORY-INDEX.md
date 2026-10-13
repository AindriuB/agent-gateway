# History index

One row per `## YYYY-MM-DD` entry in `HISTORY.md`, newest first. Only `scribe`
edits this file, and it writes the row in the same commit as the entry.

`HISTORY.md` grows without bound and is the single largest file a session can
accidentally load. This index exists so `planner` can answer "has this been
built before, and where do I read about it?" without opening it. Rows are taken
from `HISTORY.md`'s own headings rather than re-summarized, so the index can be
checked against its source by eye.

Read a full entry by grepping the exact string in the **Heading** column:

```
grep -n '<heading text>' docs/plan/HISTORY.md
```

Then read that section only. A stale index is worse than none — an entry with
no row is one `planner` cannot find, and will re-plan.

| Date | Task IDs | Summary | Heading (grep this exact string) |
|---|---|---|---|
| 2026-10-13 | 62 | unsigned Claude Desktop `.mcpb` (about 261 KB, mcpb 2.1.2) from re-bundled CLI, generated third-party notices, 4 user_config settings, 4/4 tests; manual Desktop check pending | ## 2026-10-13 — Claude Desktop .mcpb bundle (task 62) |
| 2026-10-13 | 63 | `scripts/conformance.sh` (Inspector 2.10.1 over stdio, fake paired module, list and echo call), schema checks, `docs/compatibility.md` | ## 2026-10-13 — stdio MCP conformance and compatibility matrix (task 63) |
| 2026-10-13 | 61 | gateway built as one esbuild bundle with protocol inlined, 4-file 37.7 kB npm package, pack allowlist test and packed-tarball smoke, not published | ## 2026-10-13 — gateway npm package (task 61) |
| 2026-10-13 | 60 | release zip packer (no .map, .ts or dotfiles), download tied to version, no relationships in module.json by decision, 6/6 tests | ## 2026-10-13 — module release zip packer (task 60) |
| 2026-10-13 | 32 | dnd5e adapter (summary, use/attack/damage actions, conditions, embed hook, skill_rank build hook), native v14 7/7, advancements not applied | ## 2026-10-13 — dnd5e system adapter (task 32) |
| 2026-10-13 | 57 | LinkListenError for EADDRINUSE/EACCES on the link port; CLI prints one stderr line and exits 1, stdout untouched | ## 2026-10-13 — link port bind failures reported as one stderr line (task 57) |
| 2026-10-13 | 49 | pf2e ChoiceSet answered headlessly (compendium_import choices, character_build listChoices), call-keyed preCreate wrapper, bounded filter resolution, native v14 2/2 | ## 2026-10-13 — pf2e ChoiceSet answered headlessly (task 49) |
| 2026-10-13 | 46 | character_build tool (describe and bounded apply) with build-hook registry, pf2e hook validates the whole batch first, native v14 2/2 | ## 2026-10-13 — character-build interface, pf2e first (task 46) |
| 2026-10-13 | 45 | compendium_import embeds into an owned Actor (actorUuid + bounded overrides), per-system embed hook, pf2e native v14 2/2 | ## 2026-10-13 — compendium entry embedded in an owned Actor (task 45) |
| 2026-10-12 | 33 | pf2e adapter (summary, actions, inventory, conditions), native v14 7/7, known Undo limits to task 44 | ## 2026-10-12 — pf2e system adapter (task 33) |
| 2026-10-12 | 31, 33 | PR84 merged, task31 archived; 28 done / 14 active; pf2e33 in progress on Mac; homelab deploy-only | ## 2026-10-12 — Task 31 validation merged and archived; pf2e adapter started (tasks 31, 33) |
| 2026-10-12 | 31 | V13 automated/native proof and bounded v14 read-only reconciliation accepted; 3,595/2,227; publication pending | ## 2026-10-12 — Generic adapter native validation accepted with v14 reconciliation (task 31) |
| 2026-10-12 | 31, 32, 33 | Validate31 first; PF2e33 next, dnd5e32 deferred; native consent pending | ## 2026-10-12 — Validate generic adapter plumbing before PF2e; dnd5e deferred (tasks 31–33) |
| 2026-10-12 | 31 | PR82 source merged; native pending keeps31 active; 27 done / 15 active; next32 | ## 2026-10-12 — System adapter source merged; native acceptance pending (task 31) |
| 2026-10-12 | 31 | Five bounded adapter tools verified 3,580/2,227 plus independent113; native/publication pending | ## 2026-10-12 — Bounded system adapter tools source verified (task 31) |
| 2026-10-12 | 30 | PR80 merged; bounded offline replay validation archived; 27 done / 15 active; next31 | ## 2026-10-12 — Offline write replay validation merged and task archived (task 30) |
| 2026-10-12 | 30 | GM offline replay passes v13/v14; prior failures cleaned; validation publication pending | ## 2026-10-12 — Offline write replay bounded GM native acceptance passed (task 30) |
| 2026-10-12 | 30 | bounded offline replay and execution-failure receipts verified; native acceptance pending | ## 2026-10-12 — Bounded offline write replay source verified (task 30) |
| 2026-10-12 | 29 | Merged PR #78 bounded validation archived; 26 done / 16 active, Task30 next and Task18 blocked | ## 2026-10-12 — Offline event reading validation merged and task archived (task 29) |
| 2026-10-12 | 29 | Both native GM worlds passed nine reads/four UI operations, isolated purge five and guarded restoration; combined gate 3,437/2,227 passed | ## 2026-10-12 — Offline reading GM native acceptance passed; validation publication pending (task 29) |
| 2026-10-12 | 29, 28a | PR #76 source merged, Task29 native pending; merged test repair archived, 25 done / 17 active, Task30 planning-ready | ## 2026-10-12 — Offline event reading source merged; native pending, test repair archived (tasks 29, 28a) |
| 2026-10-12 | 29 | Source verified 3,427/2,227; protocol5 offline history/retention/purge local implementation, native and publication pending | ## 2026-10-12 — Offline event reading implemented and source verified; native pending (task 29) |
| 2026-10-12 | 29 | Reviewed cooperative offline-read/retention/purge design; implementation and final verification in progress, native pending, stacked PR #75 unmerged | ## 2026-10-12 — Offline event reading design bounded; local implementation in progress (task 29) |
| 2026-10-12 | 28 | PR #73 merged; Task28 archived, 24 done/17 active, Task29 next and18 blocked; historical native/offline repair distinction retained | ## 2026-10-12 — Gateway event buffer task merged and archived (task 28) |
| 2026-10-12 | 28 | P1 rejected-toolset revocation repaired; offline gate 3,393/2,227, historical native source unchanged | ## 2026-10-12 — Event-read revocation survives rejected toolset refreshes (task 28) |
| 2026-10-12 | 28 | Bounded v13/v14 polling, isolation, reconnect and exact NPC cleanup passed; history hidden, PR #73 merge pending | ## 2026-10-12 — Policy-gated event polling validated on v13 and v14; merge pending (task 28) |
| 2026-10-12 | 28 | Source verified 3,380/2,227; protocol4, policy-gated online polling and pairing-isolated cursors; native pending, history hidden | ## 2026-10-12 — Policy-gated gateway event buffer implemented; native acceptance pending (task 28) |
| 2026-10-12 | 27 | PR #71 merged; Task27 archived, 23 done/18 active contracts, task28 next and18 blocked; native proof/follow-up limits preserved | ## 2026-10-12 — Visible-client event tap task merged and archived (task 27) |
| 2026-10-12 | 27 | Token ancestor perception protects synthetic Actor/Item events at capture and flush; offline gate passed, native proof stays historical | ## 2026-10-12 — Token ancestor perception enforced for synthetic document events (task 27) |
| 2026-10-12 | 27 | Scene event privacy now matches active/navigation/requester-view tool visibility at admission and flush; offline gate passed, prior native proof remains historical | ## 2026-10-12 — Scene event visibility aligned with tool privacy (task 27) |
| 2026-10-12 | 27 | Bounded three-client native event/privacy/reconnect proof and exact cleanup passed on v13/v14; PR #71 merge pending | ## 2026-10-12 — Visible-client event tap validated on v13 and v14; merge pending (task 27) |
| 2026-10-12 | 27 | Source gate passed; bounded event tap/protocol3 implemented in draft PR #71, native acceptance pending | ## 2026-10-12 — Bounded visible-client event tap implemented; native acceptance pending (task 27) |
| 2026-10-12 | 26 | PR #69 merged; Task26 archived, 22 completed contracts, task27 next and18 blocked; bounded native history preserved | ## 2026-10-12 — Source-bound GM code task merged and archived (task 26) |
| 2026-10-12 | 26 | Full-source once-only code approval, native v13/v14 pending text results and exact cleanup passed; PR #69 merge pending | ## 2026-10-12 — Source-bound GM code tools validated on v13 and v14; merge pending (task 26) |
| 2026-10-12 | 25 | PR #67 merged; Task25 archived, 21 completed contracts, task26 next and18 blocked; bounded native history preserved | ## 2026-10-12 — GM table, playlist and notification task merged and archived (task 25) |
| 2026-10-12 | 25 | Table/playlist/targeted notifications passed bounded native v13/v14 acceptance and exact cleanup; PR #67 merge pending, historical harness limits retained | ## 2026-10-12 — GM table, playlist and notification tools validated; merge pending (task 25) |
| 2026-10-11 | 24 | PR #65 merged; Task24 archived, 20 completed contracts, task25 next and18 blocked; bounded native history preserved | ## 2026-10-11 — GM scene, token and combat task merged and archived (task 24) |
| 2026-10-11 | 24 | GM scene/token/combat native v13/v14 acceptance and exact cleanup passed; PR #65 merge pending, historical harness failures retained | ## 2026-10-11 — GM scene, token and combat tools validated; merge pending (task 24) |
| 2026-10-11 | 23, 23a | PR #63 merged; 19 completed contracts archived, task24 next and18 blocked; native/history bounds retained | ## 2026-10-11 — GM document and Undo tasks merged and archived (tasks 23, 23a) |
| 2026-10-11 | 23, 23a | GM CRUD/import and grouped native subtree Undo passed v13/v14; PR #63 merge pending, historical failures retained | ## 2026-10-11 — GM document tools and native subtree Undo validated; merge pending (tasks 23, 23a) |
| 2026-10-11 | 22 | Merged movement/target/combat tools; native v13/v14 six-call audits and exact cleanup passed; local harness follow-up | ## 2026-10-11 — Token movement, targeting and combat tools validated on v13 and v14 (task 22) |
| 2026-10-11 | 13–17, 19–21b | Merged policy/approval/player writes; historical native v13/v14 proof retained, later offline policy fixes recorded; 16 completed contracts archived | ## 2026-10-11 — Policy, approval and native player-write wave completed and contracts archived |
| 2026-10-11 | 12a, 12b, 20b–20f | v13 core/read/multi-user gate passed 34 tests; optional pack skipped; fresh-world prerequisites clarified | ## 2026-10-11 — Foundry v13 validation completed and fresh-world setup clarified |
| 2026-10-11 | 20b–20f | All task20 PRs merged; open bridge fix #50 and synchronized pack pass enabled/disabled v14 lifecycle; v13 pending | ## 2026-10-11 — Tool-pack PRs merged and v14 lifecycle verified; v13 pending (tasks 20b–20f) |
| 2026-10-10 | 20b–20f | 20b–20e merged; later P1 guard and PR #47 under review; protocol-2 v14 passed; Hello Pack activation/relaunch and live evidence pending | ## 2026-10-10 — Tool-pack foundation implemented locally; review and live evidence pending (tasks 20b–20f) |
| 2026-10-10 | 12b | e2e multi-user suites: bound isolation, cross-player, no-user ambiguity, reload, restart, stale token | ## 2026-10-10 — E2E multi-user isolation, binding and resilience suites (task 12b) |
| 2026-10-10 | 12a | e2e harness, one-time headed pairing setup, ag-test fixtures seed/clean, single-user read flows, leak check | ## 2026-10-10 — E2E harness and single-user read flows (task 12a) |
| 2026-10-10 | 11, 11b | gateway wiring, session binding by paired identity, isolation tests, text-only errors, live evidence on v14 | ## 2026-10-10 — Gateway wiring, session binding and isolation (tasks 11, 11b) |
| 2026-10-10 | 10 | compendium_search, compendium_get, chat_read with chat visibility rules and Adventure GM-only | ## 2026-10-10 — Compendium and chat read tools (task 10) |
| 2026-10-10 | 09 | world_info, document_search, document_get with allowlist visibility and secret stripping | ## 2026-10-10 — World document read tools and the visibility allowlists (task 09) |
| 2026-10-10 | 10b | spike: Foundry module sockets attest the sender (server-appended user id); recommendation for task 36 | ## 2026-10-10 — Spike 10b: Foundry socket identity (task 10b) |
| 2026-10-09 | 08 | module operation registry (handlers, staged dispatcher, error mapping), document serialiser, paging, DOMParser HTML-to-markdown with link safety | ## 2026-10-09 — Module operation registry and document-to-markdown conversion (task 08) |
| 2026-10-09 | 07 | module LinkClient (hello, token, backoff, pairing errors) and ApplicationV2 pairing app from settings menu | ## 2026-10-09 — Module LinkClient and pairing app (task 07) |
| 2026-10-09 | 06 | gateway link server on loopback, Origin allowlist, pairing codes, hashed tokens, link registry, heartbeat | ## 2026-10-09 — Gateway link server and pairing (task 06) |
| 2026-10-09 | 05 | gateway config, logger, stdio MCP server with empty tool registry | ## 2026-10-09 — Gateway skeleton and stdio MCP server (task 05) |
| 2026-10-09 | 04 | module skeleton, v13/v14 compat layer, settings registry, Foundry stubs | ## 2026-10-09 — Module skeleton and v13/v14 compat layer (task 04) |
| 2026-10-09 | 03 | tool definition framework, JSON Schema generation, conservative-schema tests | ## 2026-10-09 — Tool definition framework (task 03) |
| 2026-10-09 | 02 | link protocol messages, error codes, version handshake | ## 2026-10-09 — Link protocol and version handshake (task 02) |
| 2026-10-09 | 01b | test.projects wiring, per-workspace test scripts, module types [], fsevents allowScripts | ## 2026-10-09 — Workspace test wiring and scaffold follow-ups (task 01b) |
| 2026-10-09 | 01 | npm workspace scaffold, module.json, verify script, conventions | ## 2026-10-09 — Workspace scaffold (task 01) |
