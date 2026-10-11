# Completed task contracts

These 16 contracts have merged implementations and recorded evidence. Task 19's
native Undo acceptance follow-ups remain explicitly open in PLAN. Active,
queued and blocked work stays in `../tasks/`; task 18 is explicitly blocked.
Earlier tasks 01–12 were retired before this archive convention and remain in
HISTORY and HISTORY-INDEX rather than recreated here. Archived checklists retain
the original acceptance wording; completion status and evidence take precedence
over unchecked historical boxes.

| Tasks | Status | Merged evidence |
|---|---|---|
| 13, 14 | Complete | PR #33, #34 |
| 16, 20 | Complete | PR #37, #36 |
| 19 | Implementation merged; native Undo UI and v13 reservation validation pending | PR #41 |
| 20b–20f | Complete; optional v13 pack lifecycle unproven | PR #43–47; follow-ups #49–50 and acceptance records #48, #51–53 |
| 15, 17 | Complete | PR #55 (`d62dc36`), #56 (`f127431`) |
| 15a, 21 | Complete; later offline gates distinct from native proof | PR #57 (`c6421ee`); atomic candidate `ab6b67f` / reconciliation `f66de98` |
| 21a, 21b | Complete | PR #58 (`6e6f3d4`), #60 (`0d7a4b3`) |

Final offline gate: 2,626 fast / 2,227 slow on `c6421ee`; independent parser and
settlement checks: 26. Native GM/Player1 write proof on v13.351/v14.369 remains
historical `d0a11fb`, bundle `9151dcaece963660a3c93039613b4580ded558f9c9f0d5546f4e9f59cecb33c4`.
Later offline changes do not constitute a new native run. Optional v13 Hello Pack
lifecycle remains unproven. See the matching HISTORY entry for cleanup, retained
audits, admission/migration bounds and task 18's unchanged blocker.
