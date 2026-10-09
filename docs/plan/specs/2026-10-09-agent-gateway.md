# agent-gateway — design spec

> Agreed with Andrew on 2026-10-09 through a shaping conversation. This is the
> input to `/plan`. Where a later decision changes something here, update this
> file in the same PR.

## Outcome

A free, MIT-licensed Foundry VTT module plus a companion MCP gateway that gives
AI agents structured, permissioned access to a running Foundry world. It is a
**product**: success for v1 is an approved listing on foundryvtt.com with the
"AI Tools" tag, and a GM or player can connect their own AI client in under five
minutes.

- Free forever; donations accepted (Ko-fi / GitHub Sponsors links in README and
  listing). No tiers, no licence server.
- Bring your own AI: the product ships no model and holds no model keys.
- Cross-vendor: must work with Claude (Desktop, Code, claude.ai), ChatGPT,
  Gemini (CLI and web app), and any standard MCP client.
- Foundry **v13 and v14** (`minimum: 13`, `verified: 14`).

## Differentiators (vs existing Foundry MCP bridges)

Per-agent scoped permissions, GM and owner approval queue with diffs, audit log
with undo, event log with replay and gap detection, role-based tool sets,
headless agents, policy-native design.

## Names

- Foundry package id and repo: `agent-gateway` (`AindriuB/agent-gateway`).
- npm package: `foundry-agent-gateway` (`agent-gateway` is taken on npm).

## Architecture

```
AI client (any vendor)
   │  MCP: stdio | Streamable HTTP (localhost) | Streamable HTTP + OAuth (remote)
gateway (Node/TS)  ── transport, auth, event buffer, headless runner
   │  WebSocket (localhost by default; wss in server mode)
agent-gateway module in a Foundry client  ── all game logic and policy
   ├─ attach mode: the GM's or player's own browser
   └─ headless mode: Chromium launched by the gateway, logged in as an agent user
```

Rejected: a raw socket.io client without a module (private protocol, misses
system logic in client JS).

### Gateway reach modes (all in v1)

1. **Local**: stdio or `127.0.0.1` HTTP with a bearer token. Desktop/CLI clients.
2. **Tunnelled**: the local gateway behind a user-run tunnel (OpenAI Secure MCP
   Tunnel, Cloudflare Tunnel, ngrok, Tailscale Funnel) via `--public-url`;
   OAuth required. For ChatGPT, Gemini web app, claude.ai, which call MCP from
   their provider's cloud and reject localhost.
3. **Server mode**: gateway next to a self-hosted Foundry; always on; hosts
   headless agents.

### Cross-vendor rules

- Plain MCP spec only; no vendor extensions in core.
- Streamable HTTP + OAuth 2.1 (PKCE, dynamic client registration).
- Conservative JSON Schema (no `oneOf`, no deep nesting, no open objects).
- Keep tools per session small (about 18 player, about 28 GM).
- Never rely on a client's own write confirmation; approvals live in Foundry.
- Compatibility matrix: automated MCP Inspector conformance; manual check
  against Claude, ChatGPT and Gemini before each release.

## 1. Module

- ApplicationV2 only; a thin compat layer isolates v13/v14 differences; v14-only
  features (e.g. Scene Levels) used only when present.
- **Connection**: WebSocket client; one-time pairing code shown by the gateway;
  pairing token in **client** settings.
- **Operation registry**: each tool = name, minimum role, schema, category
  (`read` | `write` | `destructive` | `code`), handler, undo snapshot. Handlers
  use the normal Foundry document API as the logged-in user.
- **Policy engine**: combines world policy (GM ceiling) and owner client policy;
  result is never more permissive than the ceiling.
- **Approvals**: AppV2 diff dialog; queued requests from headless agents relayed
  over the module socket to the owner or a GM. Code always shows full source.
- **Audit log and undo**: module-defined JournalEntryPage subtype in a GM-only
  journal; who, agent, tool, args, before-snapshot; undo restores the snapshot
  and warns on conflict.
- **Event tap**: hooks to sequenced events (see section 5).
- **System adapters**: dnd5e and pf2e in v1.
- **Policy compliance in code**: "AI Tools" tag; no bundled AI content; other
  modules' flags and data stripped from serialised documents unless the GM opts
  in; runtime code never runs unconfirmed; all UI strings in `lang/en.json`.
- **Testing**: vitest unit tests against a stubbed Foundry API; Quench in-world
  integration tests; Playwright end-to-end against homelab Foundry v13 and v14.

## 2. Gateway

- Node/TS; distributed as `npx foundry-agent-gateway`, a Claude Desktop `.mcpb`
  bundle, and a Docker image (server mode). Thin: no game logic.
- **Repo layout**: `module.json` at repo root (so `foundry-link` works);
  `gateway/` and `protocol/` workspaces. Tool schemas defined once in
  `protocol/` (zod), generating client-facing JSON Schema and module validators.
- MCP sessions bind to one Foundry user in one world; tool list from that
  user's role; `tools/list_changed` on change.
- Auth: stdio none; local HTTP bearer on `127.0.0.1`; remote OAuth 2.1 with a
  consent page (world, Foundry user, scopes); short-lived tokens, revocable from
  inside Foundry.
- One gateway can hold several module connections (worlds or users).
- **Headless runner**: `playwright-core`; prefers system Chrome/Edge, downloads
  Chromium otherwise; dedicated Foundry user; credentials in a 0600 config file
  or env; watches Foundry `/api/status`, joins when a world is up and closes
  when it goes down; never launches worlds (no admin key held).
- Defences: schema validation, request size limits, a coarse self-protection
  rate limit (authoritative limits are in the module).
- Management UI lives in the module's settings app; the gateway serves only the
  OAuth consent page and a status page, and prints the pairing code on start.
- Tunnels are documented, not built in.
- Storage: SQLite holding OAuth clients and hashed tokens, the event buffer, and
  headless config. Never world data.
- Lifecycle: the gateway outlives Foundry; tools return "world offline" while no
  module is connected; module auto-reconnects with backoff; pending approvals
  are re-presented on reconnect.

## 3. Permissions and approvals

Layers, strictest wins: (1) gateway token scopes; (2) role tool set; (3) GM
world policy (ceiling); (4) owner policy (may only tighten); (5) Foundry
server permission checks.

- World policy per role x category: allow, ask owner, ask GM, deny. Plus: player
  agents on/off, headless agents on/off, folder allowlists, **rate limits per
  category (v1, GM-configurable per role with per-agent override; defaults about
  60 reads/min, 10 writes/min; enforced in the module)**.
- Defaults: read allow; write ask owner; destructive ask GM (player agents) or
  ask owner (GM's agent); code always ask and **cannot be set to auto**; player
  agents and headless agents off until the GM enables them.
- Owner = the human who paired the agent; any GM can approve anything; offline
  approvers mean the request queues.
- A call waits about 30 s, then returns `{status: "pending_approval", id}`;
  agent follows up with `approval_status(id)`.
- Dialog actions: approve, approve for this session, deny with reason (returned
  to the agent). Batch approval for grouped changes.
- GM kill switch pauses all agents; per-agent pause and revoke.
- **Chat messages posted by agents always carry a visible AI marker; not
  configurable.**

## 4. Tool set

All roles: `world_info`, `events_poll`, `events_history` (when allowed),
`approval_status`, `document_search`, `document_get`, `compendium_search`,
`compendium_get`, `chat_read`, `chat_post`, `roll_formula`, `journal_write`,
adapter tools (`actor_summary`, `actions_list`, `action_perform`, `inventory`,
`conditions`), `token_move`, `target_set`, `combat_status`, `combat_end_turn`.

GM only: `document_create`, `document_update` (**raw Foundry update data,
diff-approved, `ask` by default**), `document_delete`, `compendium_import`,
`token_manage`, `combat_manage`, `scene_control`, `table_roll`,
`playlist_control`, `notify`, `macro_run`, `script_run` (code category).

Undo is not a tool; only humans undo. Results are short text plus MCP
structured content; large documents are paged; HTML converted to markdown.

Adapter interface: `actorSummary`, `listActions`, `performAction`,
`inventorySemantics`, `conditions`. Two adapters in v1 deliberately, to expose
abstraction leaks.

## 5. Event log

- Event types: chat (incl. rolls), combat lifecycle and turns, create/update/
  delete for actors, items, journals, scenes, tokens; user join/leave; scene
  change; approval requested/resolved; agent actions (flagged).
- Shape: seq, timestamp, type, user, doc ref, one-line summary; no full docs.
- Visibility is by construction: events are produced in the user's own client.
- Seq is per connection and strictly increasing; reconnect produces an explicit
  `gap` event with a missed count.
- Rapid updates to one document coalesced (about 500 ms).
- Buffer 10,000 events per connection or the retention window; `events_poll`
  returns at most 100 per call with a 25 s long-poll.
- **Offline event reading** is a world setting, owned by the GM, off by
  default, with retention (default 14 days) and a purge button. Player gateways
  honour it by software, not cryptography; document this.
- Writes attempted while the world is offline queue for approval on next launch.

## 6. Distribution, releases, policy

- Repo private while building; public before Foundry submission.
- **Every change lands via a GitHub PR that Andrew reviews**; no direct pushes
  to `main`. Tasks sized so each PR is readable by a human. PR descriptions
  state what and why, test evidence on v13 and v14, and the acceptance criteria
  met. This is how the Foundry AI-assisted-code attestation is kept true.
- Module release: zip and `module.json` on GitHub releases; manifest URL
  `.../releases/latest/download/module.json`.
- Gateway release: npm, `.mcpb` on the GitHub release, Docker image (registry
  to confirm: GHCR vs Docker Hub, given the GitHub billing block).
- Single version number across module, gateway and protocol; handshake refuses
  a major protocol mismatch with an actionable message.
- GitHub Actions is blocked by billing, so `npm run release` runs locally from
  the homelab (build, test on v13 and v14, upload with `gh`).
- Foundry submission checklist: "AI Tools" tag; AI-assisted code attestation;
  no AI-generated content in the package; no other-module context without
  opt-in; code confirmation; listing states what data goes where.
- Docs: README quick start; per-client setup guides (Claude Desktop, Claude
  Code, ChatGPT with tunnel, Gemini CLI, Gemini app); headless and server-mode
  guide; security model; privacy statement.
- Support: GitHub issues and a Foundry Discord thread.

## Prerequisites (homelab, outside this repo)

- A Foundry **v13** test instance alongside the existing v14 one (homelab repo
  work: compose service, cache zip, Caddy route).
- Foundry users for test agents in each test world.

## Deferred to v1.x

- GM-tunable event and approval values (buffer size, page size, poll wait,
  coalesce window, approval timeout). All live in one config object in v1.
- One AI for the whole table (players use `/ask`; the GM's agent answers with
  each player's permissions).
- A gateway web UI for server mode.
- More system adapters.
