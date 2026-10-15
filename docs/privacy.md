# Privacy

This statement covers the Agent Gateway module and gateway including remote access, server mode and headless agents. It says what data goes where.

## What leaves the Foundry client

The module sends tool results and events to the gateway you run on your own machine, over a WebSocket to `ws://localhost:7420`. It sends nothing to any other server. The module and gateway contain no analytics, telemetry or update check.

## What the gateway writes to disk

The gateway keeps one SQLite file, by default `~/.foundry-agent-gateway/gateway.db` (change it with `--db` or `AGENT_GATEWAY_DB`). It holds:

- **Pairings.** For each paired browser: a hash of its pairing token, the world and user ids, the user's name, the browser origin it was made from and its creation and revocation times. The token itself is not stored here.
- **The HTTP bearer token's hash**, if you use `--http`. Never the token.
- **The event buffer.** Always on while a module is connected, whatever the offline-reading setting says. The module sends each world event the connected user can observe, and the gateway stores it in SQLite without checking that setting (`module/src/events/index.ts:127`, `gateway/src/link/server.ts:304`, `gateway/src/events/buffer.ts:134`). Each stored event holds a sequence number, a time, the event type, the Foundry user id, a summary of up to 200 characters, an optional flag for agent actions and, for events about a document, the document's uuid, type and name (`protocol/src/events/index.ts:34-48`). The gateway adds its own receipt time and the agent id, and writes a marker row when a connection is interrupted. The buffer keeps at most 10,000 events per world and user. Rows older than the retention period are removed, 14 days by default and 1 to 365 days when a GM sets it, counted from when the gateway received them. Retention runs at startup and hourly (`gateway/src/events/repository.ts:109-114`, `gateway/src/events/buffer.ts:291-304`). The offline-reading setting, off by default, controls only whether an agent may read these events while Foundry is offline; it does not stop them being stored. A GM can clear the buffer with Purge buffered events in the module's settings, which deletes the world's stored events but keeps cursor positions so gaps are reported honestly. You can also delete `gateway.db` while the gateway is stopped.
- **Offline write-queue receipts.** When an agent asks for a write while Foundry is offline, the gateway records the tool name, its arguments, the request's state and the outcome. Pending work expires after seven days. Receipts are kept at most seven days after they finish, up to 1,000 in all.

The gateway also writes a small per-boot secret and a socket file for the relay between its own processes, in the same directory. Both are readable by your user only and hold no world data.

Other data the module keeps stays in Foundry itself: the audit journal of agent writes is a journal in your world, and your browser keeps the pairing token and a replay guard for queued writes in localStorage.

## Remote access, server mode and headless agents

These are off unless you turn them on with `--public-url`, `--server-mode` or a headless agent.

- **What a public gateway exposes.** `/status` shows only the version and uptime. The other public paths are `/link` (the WebSocket the Foundry module connects to), `/mcp`, the OAuth endpoints (`/.well-known/...`, `/register`, `/authorize`, `/token`) and the consent page.
- **What the OAuth tables store** (in the same SQLite file): registered client names and redirect addresses, the hash of each authorization code and token (never the code or token itself), and grants, which hold the client, the world and Foundry user it is bound to, the scopes and the times. Expired codes and tokens and revoked grants are swept out about every 10 minutes. Client IP addresses are kept in memory only, for rate limits, and are lost on restart. The sign-in pages set one strictly necessary cookie, expiring after 15 minutes. If you operate a public gateway you are the controller of this data; see [server mode](server-mode.md#privacy-and-cookies).
- **Invites and pairings** (server mode) store a hash of the invite, its target world and user, and its times; the pairing keeps what the base pairing keeps.
- **The `headless_agents` table** stores, for each stored headless agent, its name, Foundry URL, world id, user id, owner user id and creation time. It does not store a password; that stays in the environment or the 0600 config file.
- **A headless agent's profile directory** is a Chromium profile under `<state dir>/headless/profiles/`, one per world and user, mode 0700. It holds that agent user's logged-in Foundry session and the module's pairing token. It is kept until you delete it by hand, including after `headless remove`.

## The AI client

The product ships no model and sends nothing to any AI vendor itself. The AI client you connect, such as Claude Desktop, Claude Code, claude.ai, ChatGPT or Gemini, sends tool results to its vendor, because that is how the model reads them. Whatever an agent reads from your world can leave your machine that way. The vendor's own privacy terms cover that, and this statement does not. Choose which agents to enable with that in mind. Player agents are off until a GM turns them on.

## Tool packs

A tool pack is separate software. How it handles data is its author's responsibility and is not covered by this statement.
