# Architecture

The shape of the system: what the pieces are, what talks to what, and where the
boundaries are. `explorer` and `architect` read this before inferring
structure from the filesystem, so keeping it honest saves every session a
search.

Keep it to the parts that are stable. Anything that changes weekly belongs in a
repo's own `PROJECT.md` (the agent guide that `CLAUDE.md` and `AGENTS.md` point to), not here.

## Components

| Component | Directory | Port | Owns |
|---|---|---|---|
| Foundry module, running in the browser tab of a logged-in user | `module/src` (entry `module/src/main.ts`) | none | Native permission checks, policy, approvals, audit log with Undo, tool execution, the link client (`module/src/link/`) |
| Gateway, one Node process per MCP client | `gateway/src` (CLI `gateway/src/bin/cli.ts`, wiring `gateway/src/app.ts`) | link 7420, local HTTP 7421 | Link server, pairing, MCP sessions and routing, SQLite store, event buffer, offline queue |
| MCP clients (Claude Desktop, Claude Code, others) | outside the repo | stdio, or HTTP on 7421 | Speak MCP to the gateway; never talk to Foundry directly |
| Link protocol | `protocol/src` (`link/`, `tools/`, `events/`) | none | The wire types shared by module and gateway |

The gateway never runs inside Foundry. The module, which runs in the browser with the user's own Foundry session, is the only thing that touches world data, so every action runs as that Foundry user.

### Ports and endpoints

- **Link, 7420** (`gateway/src/config/index.ts:5`, served by `gateway/src/link/server.ts`): a WebSocket the module dials. Only the primary holds it. The `Origin` must be a canonical http(s) origin (`gateway/src/link/origin.ts`) and the `Host` header is checked against DNS rebinding.
- **Local HTTP, 7421** (`gateway/src/config/index.ts:6`, `gateway/src/http/server.ts`): optional Streamable HTTP MCP with `--http`, bound to loopback and guarded by a bearer token (`gateway/src/http/token.ts`), size and rate limits, and a status page (`gateway/src/status/page.ts`).
- **Relay socket or pipe**: in the 0700 state dir, a Unix socket on darwin and linux and a named pipe on win32, namespaced by link port (`gateway/src/relay/endpoint.ts`), with a per-boot secret (`gateway/src/relay/secret.ts`). Secondaries reach the primary through it.

## Roles of a gateway instance

Several instances can share one state dir and one database, for example Claude Desktop's extension alongside a separate `--http` gateway.

- **Primary**: the instance that holds the link port. It serves the module link, the optional HTTP endpoint and the relay (`gateway/src/relay/server.ts`).
- **Secondary**: an instance that finds the port taken relays its stdio MCP session to the primary (`gateway/src/relay/secondary.ts`, `proxy.ts`, `upstream.ts`). Each connection gets its own session. On primary loss it takes over, replaying initialize and a `list_changed`; calls in flight get `RELAY_LOST`.
- **Standby**: an instance that may not relay because its settings differ from the primary's, or that was stepped down (`gateway/src/relay/standby.ts`). It serves only `gateway_status`, keeps watching the link port, and takes over when it can.

A secondary with a strictly newer config fingerprint asks the primary to step down after a 2 s grace. The primary writes a handover claim naming the heir by its `startedAt` (`gateway/src/relay/claim.ts`, file `relay-heir-<linkPort>.json`, mode 0600), so the old primary becomes a standby and the heir takes the port without a race (tasks 69 and 72). The step-down sequence is in `gateway/src/app.ts`.

## Store

SQLite, opened and migrated by `gateway/src/store/` (`store.ts`, `migrate.ts`). Migrations are numbered, positional files in `gateway/src/store/migrations/`, and a migration's number must equal its position in `index.ts`.

| Migration | Adds |
|---|---|
| 001 | `pairings` |
| 002 | `pairings.user_name` |
| 003 | `event_streams`, `event_evictions`, `event_rows` |
| 004 | `event_policies`, `event_read_permissions` |
| 005 | `queued_catalogs`, `queued_calls` |
| 006 | `queued_calls.result_failed` |
| 007 | `pairings.origin` |
| 008 | retires pairings with no origin |
| 009 | `gateway_settings` (the HTTP token hash) |

## Pairing

A new browser pairs with a one-time code (`gateway/src/link/pairing-codes.ts`): `XXXX-XXXX` from an unambiguous alphabet, valid 10 minutes, self-refreshing, and shown in the not-connected errors and `gateway_status`. Entering it in the module's pairing app approves that browser's origin, which is stored on the pairing (migration 007); later reconnects with the token are accepted only from that origin (task 70). Failed codes are limited to 10 per 60 s across origins (`gateway/src/link/code-attempts.ts`), and the number of connections that have not yet sent `hello` is capped at 16. Role is whatever Foundry reports in `hello` (`isGM`), never a setting. A session without `--user` follows the connected pairing, re-binding on a switch with a 30 s grace (task 71, `gateway/src/routing/binding.ts`).

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

The MCP client calls the gateway (stdio, relay or HTTP). The gateway routes each tool call to the paired module over the link, and the module replies. The module dials out to the gateway, never the reverse. Link messages are defined in `protocol/src/link/messages.ts`; the module's side is `module/src/link/client.ts`. Tool schemas and event types live in `protocol/src/tools` and `protocol/src/events`.

## Boundaries that must not be crossed

- Identity comes only from Foundry's server-set user, never from a hint in a message and never from the MCP client.
- The gateway holds no world permissions. Native permission checks, policy and approvals happen in the module, and a queued offline call never carries permission forward.
- Untrusted text is escaped and bounded before it reaches a client; protocol schemas are strict.
- Only the primary binds the link and HTTP endpoints; secondaries and standbys never do.

## Planned (MVP B)

Not built yet; `docs/plan/PLAN.md` has the order. A public URL option (`--public-url`) and a server mode with host allowlists and per-client limits (task 74); a Compose stack with Caddy terminating TLS in front of the gateway (task 42); an OAuth 2.1 authorization server for remote clients, with a consent page and grant revocation (tasks 35, 67); pairing confirmation in server mode (task 68); and a headless runner that logs in as an agent user so a world needs no open GM tab (tasks 37, 38). In server mode the static bearer is off, pairing codes appear only in operator logs, and the store gains WAL and a `--backup` command. Two migrations are reserved: 010 (OAuth and grants) and 011 (headless agents).

## Decisions worth knowing

- 2026-10-14: Compose on a VPS is the primary remote deployment, and TLS terminates at a reverse proxy. Rejected: a built-in tunnel or TLS in the gateway.
- 2026-10-14: SQLite stays the store. Rejected: a server database, for single-operator deployments.
- 2026-10-13: the pairing code approves a browser origin (task 70). Rejected: trusting a role or Foundry URL from settings.

## Offline intent replay (Task30 source verified)

The gateway owns pairing-scoped SQLite catalogs, queue intent and status receipts. MCP offline admission persists the original session, validated definition and exact arguments before returning a queue ID. The authenticated module link receives bounded `queuedCalls` batches and returns correlated `queuedStatus` frames under protocol6. Only fresh matching definitions on the exact active owner connection permit delivery.

The module owns native admission, a durable browser replay guard and fresh once-only approvals. Queueing never carries permission forward from an offline policy or a session grant. Before execution, the dispatcher checks the immutable request, current native policy/permissions, original queue deadline and current authenticated connection. Unknown outcomes remain reconciliation receipts and are not automatically replayed. This is bounded cooperative persistence, not exactly-once distributed world mutation. Source `b320505daaec9928fc5908cf938874948c5be240` passed build/lint and the required full gate (3,487 fast / 2,227 slow tests). Both independent reviews passed; the independent 213-test selection passed separately. That source-only checkpoint preceded the bounded native proof below.

Task30 bounded native acceptance on Foundry 13.351/14.369 verified durable offline queue receipts across isolated database reopen, native once approval and denial, owner-bound status, and no repeated mutation/audit on duplicate terminal delivery or reconnect. Tested runtime source `57adb9` / bundle `84ea050e` is shared by both proofs. Native coverage uses the actual GM `ask_owner` policy. Forced approval under allow/session grants, TTL/caps, claimed-crash unknown recovery, policy/source/definition tightening and native failed-execution results remain offline-test coverage. No installed deployment, exactly-once crash guarantee or Task18 resolution is claimed. Implementation, repair and final harness/validation are merged in PR #80 (`232130f`, main `216e22a`); Task30 is archived.

## System adapter tools — Task31 source verified

Five fixed core tools select an internal static adapter by the current system ID. Unknown systems use a generic metadata summary and explicit unsupported empty collections; action and condition mutations are unsupported by the fallback. Adapters have no public pack API or runtime registration. Shared strict protocol schemas bound results after an iterative inert-data clone; malformed results become per-call INTERNAL errors.

Only canonical top-level world Actors are supported. Current native user identity, OWNER or GM permission and folder restrictions precede adapter invocation, with a fresh check after write snapshots. A separate frozen trusted context carries native user and existing audit capabilities; caller options remain inert bounded data. Conditions changes escalate synchronously during preparation, while all base-read conditions calls remain refused by the offline queue. Protocol6 and existing core limits remain unchanged. Source verification at `76a111cad1ea292fe33f6b79902e896fa4b01698` passed build/lint, 3,580 fast / 2,227 slow tests and both independent reviews. Source is merged in PR #82 (head `1d4743b`, main `783ba3a`). Bounded generic native validation is accepted as recorded below; validation publication is pending and no installed deployment is claimed.

Bounded generic native validation is accepted on Foundry 13.351 and 14.369. V13 completed the automated proof; v14 retained an automated audit-encoding failure and was accepted from separately reviewed read-only reconciliation. Each world completed six SDK calls (four reads and two human once-approved unsupported writes), retained two matching error audits with unchanged Actor snapshots, and deleted its exact private fixture. Original documents/settings/views/world time and credential databases were preserved. Runtime source/bundle remain `68e1b42` / `cde74e8b`; final harness `5f4bab8a78605748a3db52391b8ac03b5fa84fe7` passed build/lint, 3,595 fast / 2,227 slow tests and 15 independent offline checks. V13 executed that harness; v14 executed `1e8acbf` and used `5f4bab8` only for registration-only read-only evidence reconciliation. This proves GM generic plumbing only, not concrete PF2e semantics, player ownership/privacy, policy races, supported adapter mutations or installed deployment. V14's unpersisted volatile capture-error state cannot be reconstructed; saved terminal calls, unique approval IDs and absence of queued frames were checked separately. The original v14 result remains failed, cleaned and free of teardown errors.
