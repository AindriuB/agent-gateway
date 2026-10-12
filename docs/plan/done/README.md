# Completed task contracts

These 27 contracts have merged implementations and recorded evidence. Task 19's
successful native Undo UI evidence and its bounded scope are explicit in PLAN. Active,
queued and blocked work stays in `../tasks/`; task 18 is explicitly blocked.
Earlier tasks 01–12 were retired before this archive convention and remain in
HISTORY and HISTORY-INDEX rather than recreated here. Archived checklists retain
the original acceptance wording; completion status and evidence take precedence
over unchecked historical boxes.

| Tasks | Status | Merged evidence |
|---|---|---|
| 13, 14 | Complete | PR #33, #34 |
| 16, 20 | Complete | PR #37, #36 |
| 19 | Complete; native human Undo UI evidence on v13/v14 supplied by merged task23a; scope limits in PLAN | PR #41; repair/evidence PR #63 |
| 20b–20f | Complete; optional v13 pack lifecycle unproven | PR #43–47; follow-ups #49–50 and acceptance records #48, #51–53 |
| 15, 17 | Complete | PR #55 (`d62dc36`), #56 (`f127431`) |
| 15a, 21 | Complete; later offline gates distinct from native proof | PR #57 (`c6421ee`); atomic candidate `ab6b67f` / reconciliation `f66de98` |
| 21a, 21b | Complete | PR #58 (`6e6f3d4`), #60 (`0d7a4b3`) |
| 22 | Complete; native v13/v14 full movement/target/turn acceptance passed, no native partial-wall or Undo claim | PR #61 (`c4ff5f0`, merged `ba52acd`); production gate 2,751 fast / 2,227 slow |
| 23, 23a | Complete; native v13/v14 eight-call GM document and grouped subtree Undo acceptance passed | PR #63 (`0cf35c3`, merged `83d216d`); combined gate 3,042 fast / 2,227 slow |
| 24 | Complete; native v13/v14 bounded scene/token/combat acceptance passed; PF2e initiative unsupported | PR #65 (`377ae79`, merged `a150498`); combined gate 3,158 fast / 2,227 slow |
| 25 | Complete; bounded native v13/v14 table, muted playlist and targeted notification acceptance passed; final calls immediate | PR #67 (`aec6db3`, merged `6ec99ff`); combined gate 3,222 fast / 2,227 slow |
| 26 | Complete; bounded native v13/v14 full-source once-only code approval and pending text completion passed | PR #69 (`4f00ed1`, merged `b8eb171`); combined gate 3,268 fast / 2,227 slow |
| 27 | Complete; bounded native v13/v14 event privacy/reconnect proof; later Scene/Token ancestor privacy fixes offline-verified only | PR #71 (`e58590e`, merged `d0093d9`); latest gate 3,340 fast / 2,227 slow |
| 28 | Complete; bounded native v13/v14 polling/isolation/reconnect proof; later gateway revocation fix offline-verified only | PR #73 (`b5293a1`, merged `98ae4ad`); latest gate 3,393 fast / 2,227 slow |
| 28a | Complete; deterministic cross-user notification test binding, no runtime changes | PR #75 (`1eb9b08`, merged `3cd5cb1`); targeted 16 checks and build/lint/full gate 3,393 fast / 2,227 slow |
| 29 | Complete; bounded GM native offline poll/history, policy save and isolated purge/count acceptance on v13/v14 | Source PR #76 (`88b27ca`); validation PR #78 (`366fc5e`, merged `eac0f40`); combined gate 3,437 fast / 2,227 slow |
| 30 | Complete; bounded GM native offline replay/once-denial/status/duplicate/reconnect acceptance on v13/v14; earlier failures cleaned | PR #80 (`232130f`, merged `216e22a`); final gate 3,509 fast / 2,227 slow |

Prior wave offline gate: 2,626 fast / 2,227 slow on `c6421ee`; independent parser and
settlement checks: 26. Native GM/Player1 write proof on v13.351/v14.369 remains
historical `d0a11fb`, bundle `9151dcaece963660a3c93039613b4580ded558f9c9f0d5546f4e9f59cecb33c4`.
Later offline changes do not constitute a new native run. Optional v13 Hello Pack
lifecycle remains unproven. See the matching HISTORY entry for cleanup, retained
audits, admission/migration bounds and task 18's unchanged blocker.

Task 22 has separate native proof at `ba52acd`, production bundle
`9ae039a7198c3136ea237b531cd5c38b1030465387592df3d9bb167a0d16124b`.
Each version retained six matched audits and removed ten exact fixture UUIDs;
see the task22 HISTORY entry for view-only audit and screenshot limitations.

Tasks 23/23a have separate native proof at source `a45541a`, production bundle
`4a35b9e697c17ba92d4f35efb128b0ebf665c144637657c67acec083aef04b32`.
Each version retained eight matched audits, restored five exact root/child UUIDs
and content through one human grouped-delete Undo, then removed those five
fixtures with source compendium, personal views and world time unchanged.
The later reusable harness gate is distinct from native-executed private
harness `8ede52416c640d127472b2e3375846b12c7b65e14013fab42588c1a22f78a235`.
See the task23/23a HISTORY entries for earlier failures and coverage limits.

Task 24 has separate native proof at source `79f6d713`, production bundle
`5e23eca373bd9728e837bc7fe9cac135b147ec210635c44ddcec93023683dee0`.
Each version completed 16 requests with one actual human denial and 15 retained
audits. Cleanup removed nine exact fixture UUIDs on v14 and seven on v13,
restoring baseline roots/sources, active scenes and personal views with unchanged
world time. V14 used separately reconciled zero-MCP cleanup after the final
harness audit match failed; the first wrong-port v13 attempt was cleaned before
the successful run. See HISTORY for executed harness hashes and bounded coverage;
the merged reusable harness gate is separate from native execution.
