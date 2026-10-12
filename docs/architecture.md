# Architecture

The shape of the system: what the pieces are, what talks to what, and where the
boundaries are. `explorer` and `architect` read this before inferring
structure from the filesystem, so keeping it honest saves every session a
search.

Keep it to the parts that are stable. Anything that changes weekly belongs in a
repo's own `PROJECT.md` (the agent guide that `CLAUDE.md` and `AGENTS.md` point to), not here.

## Components

<!--
| Component | Directory | Port | Owns |
|---|---|---|---|
| ... | ... | ... | ... |
-->

## Repository topology

A workspace root spans several repositories that a single `git clone` does not
obtain. Say which they are, which are deliberately untracked here and why, and
give the exact commands that assemble a working setup from scratch — including
which remotes are SSH and which are HTTPS, rather than assuming one everywhere.

`.claude/` is untracked on purpose: it holds the worktree scripts installed from
the agent-kit repo, whose single clone lives outside every project it serves and
is refreshed with `git -C <kit> pull`. The roles themselves are not here at all —
`agents/` and `commands/` are symlinked into `~/.claude`, shared by every
project. Tracking any of it here would fork the harness away from that upstream.
Sibling project directories
are likewise untracked — each is its own repository with its own remote, a plain
directory this repo's `.gitignore` excludes, not a submodule and not a nested
tracked tree. Git has no record of them at all from this repo's side, so nothing
about cloning this repo alone tells you they exist.

<!--
| Repo | Role | Tracked here? |
|---|---|---|
| ... | ... | ... |
-->

<!--
```
git clone <workspace-repo> <dir> && cd <dir>
git clone <project-repo-1>
git clone <project-repo-2>
git clone git@github.com:AindriuB/workspace.git .claude && .claude/install.sh
```
-->

If a repo has been renamed, say so and say what older `HISTORY.md` entries call
it — otherwise every entry written before the rename reads as a fourth repo that
does not exist.

## How they talk

<!-- Synchronous calls, queues, shared databases. Name the contract and where it
     is defined. Direction matters: say who calls whom. -->

## Boundaries that must not be crossed

<!-- e.g. "nothing but the transaction service writes to the ledger tables" —
     the rules whose violation is a defect regardless of how the code reads. -->

## Decisions worth knowing

<!-- One line each, with the date and the alternative that was rejected. -->

## Offline intent replay (Task30 source verified)

The gateway owns pairing-scoped SQLite catalogs, queue intent and status receipts. MCP offline admission persists the original session, validated definition and exact arguments before returning a queue ID. The authenticated module link receives bounded `queuedCalls` batches and returns correlated `queuedStatus` frames under protocol6. Only fresh matching definitions on the exact active owner connection permit delivery.

The module owns native admission, a durable browser replay guard and fresh once-only approvals. Queueing never carries permission forward from an offline policy or a session grant. Before execution, the dispatcher checks the immutable request, current native policy/permissions, original queue deadline and current authenticated connection. Unknown outcomes remain reconciliation receipts and are not automatically replayed. This is bounded cooperative persistence, not exactly-once distributed world mutation. Source `b320505daaec9928fc5908cf938874948c5be240` passed build/lint and the required full gate (3,487 fast / 2,227 slow tests). Both independent reviews passed; the independent 213-test selection passed separately. That source-only checkpoint preceded the bounded native proof below.

Task30 bounded native acceptance on Foundry 13.351/14.369 verified durable offline queue receipts across isolated database reopen, native once approval and denial, owner-bound status, and no repeated mutation/audit on duplicate terminal delivery or reconnect. Tested runtime source `57adb9` / bundle `84ea050e` is shared by both proofs. Native coverage uses the actual GM `ask_owner` policy. Forced approval under allow/session grants, TTL/caps, claimed-crash unknown recovery, policy/source/definition tightening and native failed-execution results remain offline-test coverage. No installed deployment, exactly-once crash guarantee or Task18 resolution is claimed. Implementation, repair and final harness/validation are merged in PR #80 (`232130f`, main `216e22a`); Task30 is archived.

## System adapter tools — Task31 source verified

Five fixed core tools select an internal static adapter by the current system ID. Unknown systems use a generic metadata summary and explicit unsupported empty collections; action and condition mutations are unsupported by the fallback. Adapters have no public pack API or runtime registration. Shared strict protocol schemas bound results after an iterative inert-data clone; malformed results become per-call INTERNAL errors.

Only canonical top-level world Actors are supported. Current native user identity, OWNER or GM permission and folder restrictions precede adapter invocation, with a fresh check after write snapshots. A separate frozen trusted context carries native user and existing audit capabilities; caller options remain inert bounded data. Conditions changes escalate synchronously during preparation, while all base-read conditions calls remain refused by the offline queue. Protocol6 and existing core limits remain unchanged. Source verification at `76a111cad1ea292fe33f6b79902e896fa4b01698` passed build/lint, 3,580 fast / 2,227 slow tests and both independent reviews. Source is merged in PR #82 (head `1d4743b`, main `783ba3a`). Bounded generic native validation is accepted as recorded below; validation publication is pending and no installed deployment is claimed.

Bounded generic native validation is accepted on Foundry 13.351 and 14.369. V13 completed the automated proof; v14 retained an automated audit-encoding failure and was accepted from separately reviewed read-only reconciliation. Each world completed six SDK calls (four reads and two human once-approved unsupported writes), retained two matching error audits with unchanged Actor snapshots, and deleted its exact private fixture. Original documents/settings/views/world time and credential databases were preserved. Runtime source/bundle remain `68e1b42` / `cde74e8b`; final harness `5f4bab8a78605748a3db52391b8ac03b5fa84fe7` passed build/lint, 3,595 fast / 2,227 slow tests and 15 independent offline checks. V13 executed that harness; v14 executed `1e8acbf` and used `5f4bab8` only for registration-only read-only evidence reconciliation. This proves GM generic plumbing only, not concrete PF2e semantics, player ownership/privacy, policy races, supported adapter mutations or installed deployment. V14's unpersisted volatile capture-error state cannot be reconstructed; saved terminal calls, unique approval IDs and absence of queued frames were checked separately. The original v14 result remains failed, cleaned and free of teardown errors.
