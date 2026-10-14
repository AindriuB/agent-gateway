# agent-gateway — design spec

> Agreed with Andrew on 2026-10-09 through a shaping conversation. This is the
> input to `/plan`. Where a later decision changes something here, update this
> file in the same PR.
>
> Revised 2026-10-10 (Andrew): free core plus an open, versioned tool-pack API;
> premium packs are sold separately by their authors. See "Free core, open
> tool-pack API, premium packs sold separately", section 1 "Tool packs",
> section 2 "Dynamic tool definitions" and section 6 "Tool packs: distribution
> and licensing".

## Outcome

A free, MIT-licensed Foundry VTT module plus a companion MCP gateway that gives
AI agents structured, permissioned access to a running Foundry world. It is a
**product**: success for v1 is an approved listing on foundryvtt.com with the
"AI Tools" tag, and a GM or player can connect their own AI client in under five
minutes.

- The core is free forever; donations accepted (Ko-fi / GitHub Sponsors links
  in README and listing). The core has no tiers and no licence server.
- Bring your own AI: the product ships no model and holds no model keys.
- Cross-vendor: must work with Claude (Desktop, Code, claude.ai), ChatGPT,
  Gemini (CLI and web app), and any standard MCP client.
- Foundry **v13 and v14** (`minimum: 13`, `verified: 14`).

### Free core, open tool-pack API, premium packs sold separately

- **The core stays free forever and MIT-licensed**: the module, the gateway,
  policy, approvals, audit and undo, rate limits, the read tools and the general
  write tools. Nothing in it is ever moved behind a pack.
- **An open, documented, versioned tool-pack API** lets anyone ship a separate
  Foundry module (a "tool pack") that registers extra AI tools with the core.
  Andrew will sell some premium packs separately; anyone else may build free or
  paid packs of their own.
- **The core dogfoods the API**: its own tools are registered through the same
  registry and the same checks as a pack's (section 1). The pack API lands
  before the write tools (task 21 onwards).
- **The core does no licensing.** No licence server, no tiers, no DRM, no
  licence checks for packs. Licensing and distribution belong to each pack
  (section 6). The core never requires a pack.

## Differentiators (vs existing Foundry MCP bridges)

Per-agent scoped permissions, GM and owner approval queue with diffs, audit log
with undo, event log with replay and gap detection, role-based tool sets,
headless agents, policy-native design, and an open tool-pack API whose packs get
the same guarantees as core tools.

Position the core on the permission model (players and GMs, approvals, undo,
audit, multi-user isolation, any AI vendor), not on tool count. Competitors in
the "AI Tools" category as of 2026-10-10: Foundry API Bridge (hosted MCP;
Patreon tiers of 61 tools free, 80 for EUR 3 and 123 for EUR 10 a month);
Familiar (USD 6 a month or USD 99 lifetime, 200+ tools, GM confirmation for
risky actions, licence-server key); Foundry MCP Bridge (free, open source);
Ninjo's Foundry MCP (free).

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
- Keep tools per session small (about 18 player, about 28 GM core tools; pack
  tools are capped separately per session, see section 2).
- Tool names use only `[a-z0-9_-]` and stay short enough to survive client
  prefixing (for example Claude Code's `mcp__<server>__`): this is the
  intersection of the MCP naming guidance and the OpenAI, Anthropic and Gemini
  function-name rules. Core names have no `-`; pack names are
  `<prefix>-<tool>` (section 1).
- Never rely on a client's own write confirmation; approvals live in Foundry.
- Compatibility matrix: automated MCP Inspector conformance; manual check
  against Claude, ChatGPT and Gemini before each release.

## 1. Module

- ApplicationV2 only; a thin compat layer isolates v13/v14 differences; v14-only
  features (e.g. Scene Levels) used only when present.
- **Connection**: WebSocket client; one-time pairing code shown by the gateway;
  pairing token in **client** settings.
- **Operation registry (the public tool API)**: each tool = name, minimum role,
  input and output schema, category (`read` | `write` | `destructive` |
  `code`), description, handler, undo snapshot. Handlers use the normal Foundry
  document API as the logged-in user. The registry is the single source every
  part of the module asks about a tool: the dispatcher, policy, rate limits,
  approvals, audit and the tool-set announcement. Nothing looks a tool up in the
  protocol's static list directly. Core tools are registered through the same
  registry path as pack tools, with their zod schemas in `protocol/` as their
  source; the registry is sealed when the module's `ready` handler starts, so
  the set of tools is fixed for the life of the page.
- **Tool packs**: a pack is a separate Foundry module that calls
  `game.modules.get('agent-gateway').api.registerPack({id, version, apiVersion,
  prefix, tools: [{name, description, category, minRole, inputSchema,
  outputSchema, handler}]})` during the `agentGateway.registerPacks` hook (fired
  in `setup`) or between the core's `init` and `ready`.
  - Pack tool names are `<prefix>-<name>`; a pack can never shadow a core tool
    or another pack's tool, and reserved prefixes are refused.
  - The category is mandatory and must be one of the four; policy, rate limits
    and approvals use it. Unknown or missing fails closed (refused at
    registration, denied at dispatch).
  - Schemas are plain JSON Schema in the conservative subset (an allowlist of
    keywords), size-limited, and copied and frozen at registration.
    Descriptions are plain text with length caps (section 2).
  - The pack's `apiVersion` major must match the core's; the pack's `id` must
    be an active Foundry module. A pack disabled in the world loads no code,
    so its tools are absent after the reload Foundry requires.
  - Every pack call goes through the same dispatcher pipeline (argument
    validation, role, agent control, policy, rate limit, approval, audit). The
    public API exposes no handler, no stage list and no dispatch function, so
    nothing reached through it can run a tool outside the pipeline. A throwing
    or misbehaving pack handler returns `INTERNAL` for that call only.
  - **Trust model, stated plainly**: a pack is a Foundry module with full
    JavaScript in the user's browser. The core cannot sandbox it: a pack can
    call Foundry's document API directly, patch the core, or read anything the
    user can read. The core's guarantees (policy, rate limit, approval, audit)
    hold for every call that goes through the dispatcher, and only for those.
    Installing a pack means trusting its author, exactly as with any other
    Foundry module. The GM enabling the module in the world is that decision.
  - System adapters are not packs: they implement a fixed interface behind the
    fixed core adapter tools, and stay internal in v1.
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
  `gateway/` and `protocol/` workspaces. Core tool schemas defined once in
  `protocol/` (zod), generating client-facing JSON Schema and module validators.
  `protocol/` also holds the runtime rules every tool definition must meet
  (conservative-schema allowlist, size and description limits, name rules) and
  a validator for that JSON Schema subset, shared by module and gateway.
- MCP sessions bind to one Foundry user in one world; tool list from what that
  user's module announces (role and policy applied there);
  `tools/list_changed` on change, coalesced.
- **Dynamic tool definitions**: the module announces the full definitions
  (name, description, category, minimum role, input and output JSON Schema,
  pack id and version) of the tools its user may use. The gateway:
  - lists a core name only if it is in its own static registry, and then shows
    its own definition and validates with its own zod schema (an announcement
    can never rewrite a core tool's description or schema);
  - accepts a non-core name only in pack form (`<prefix>-<name>`), re-checks
    it with the protocol's runtime rules, and drops any tool that fails, with
    one safe-text log line naming the tool and the reason;
  - validates a pack tool's arguments against the announced input schema
    before anything goes over the link;
  - caps the announcement (tool count and bytes) and the pack tools listed per
    session;
  - treats every pack description as untrusted text that reaches the AI
    client: plain text only (no control, format or bidi characters, no markup,
    no URLs), capped in length, and prefixed by the gateway with a fixed
    provenance tag naming the pack. This narrows, but cannot remove, the
    prompt-injection risk of a hostile description steering the AI towards
    the user's other tools; the docs say so.
  - Tool lists stay per session and per user; the change signature covers
    definitions, not only names.
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

These are the core tools. Pack tools come on top, always named
`<prefix>-<name>`, and are subject to the same layers in section 3.

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
- Gateway release: npm, `.mcpb` on the GitHub release, Docker image (registry:
  GHCR, decided 2026-10-14 by task 77).
- Single version number across module, gateway and protocol; handshake refuses
  a major protocol mismatch with an actionable message.
- `npm run release` runs locally from the homelab (build, test on v13 and v14,
  upload with `gh`). GitHub Actions does run on this private repo (first green
  CI run 2026-10-14, PR #128) and runs the tests and the image publish.
- Project submission checklist: confirm the "AI Tools" category with Foundry;
  AI-assisted code attestation; human-authored prepared content and listing;
  no other-module context without rights and opt-in; code confirmation; listing
  states what data goes where. Category and context requirements here include
  project rules and questions, not all verified quotations of Foundry policy.
- Docs: README quick start; per-client setup guides (Claude Desktop, Claude
  Code, ChatGPT with tunnel, Gemini CLI, Gemini app); headless and server-mode
  guide; security model; privacy statement.
- Support: GitHub issues and a Foundry Discord thread.

### Tool packs: distribution and licensing

From research on Foundry's rules, 2026-10-10:

- **Selling is allowed.** The EULA's Limited License for Package Development
  says "You are allowed to sell or lease package content"
  (https://foundryvtt.com/article/license/).
- **Two routes** (Publisher Handbook,
  https://foundryvtt.com/article/publisher-handbook/):
  - self-publishing: a Patreon-gated or private manifest, or the author's own
    store plus a licence key. No fee and no protection; the author enforces
    access;
  - the Premium Content Partnership: a `protected: true` manifest and
    account-bound content keys (sold through DriveThruRPG, Itch, the author's
    store or a Patreon mapping). The handbook asks authors to contact Foundry
    for the agreement and fee; neither amount nor cadence is published there.
- **The AI policy covers paid packs, with a transition for older premium
  agreements** (https://foundryvtt.com/article/ai-policy/, revised 18 March
  2026; checked 2026-10-10): prepared content and listing copy are human-made;
  authors must understand and maintain AI-assisted code; runtime-generated code
  must be shown and explicitly consented to before execution. The project also
  requires rights and opt-in before other-module content becomes AI context.
  Confirm category tagging and the application of context rules with Foundry;
  the checked policy does not establish those specific claims.
- **Dependencies**: a pack declares the core in `relationships.requires`. The
  core never requires, recommends by manifest or bundles a paid pack.
- **No DRM in the core.** A pack that does licensing does it itself and must
  stay attestable, so the core never requires or encourages obfuscation.

**Ask Foundry before submitting** (task 41 records the answers):

1. May paid packs be sold outside Premium Content while the core is listed?
2. What is the Premium Content fee, and do code-only modules fit it?
3. Does each pack need the "AI Tools" tag and its own attestation?
4. Do agents reading compendium or game-system data trip the other-modules
   context rule?
5. Is minified or obfuscated code acceptable in premium packs?
6. What consent UI satisfies the runtime-code rule for agent-run macros?

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
