# Privacy

This statement covers the Agent Gateway module and gateway in the local release. It says what data goes where.

## What leaves the Foundry client

The module sends tool results and events to the gateway you run on your own machine, over a WebSocket to `ws://localhost:7420`. It sends nothing to any other server. The module and gateway contain no analytics, telemetry or update check.

## What the gateway writes to disk

The gateway keeps one SQLite file, by default `~/.foundry-agent-gateway/gateway.db` (change it with `--db` or `AGENT_GATEWAY_DB`). It holds:

- **Pairings.** For each paired browser: a hash of its pairing token, the world and user ids, the user's name, the browser origin it was made from and its creation and revocation times. The token itself is not stored here.
- **The HTTP bearer token's hash**, if you use `--http`. Never the token.
- **The offline event buffer.** Off by default. A GM can turn on offline reading in the world's settings, and then the gateway keeps world events it receives, including their payloads, so an agent can read what happened while it was away. Rows are removed by the retention setting, 14 days by default and 1 to 365 days when set, counted from when the gateway received them. Retention runs at startup and hourly. A GM can also purge the buffer from the module, which deletes the payloads but keeps cursor positions so gaps are reported honestly.
- **Offline write-queue receipts.** When an agent asks for a write while Foundry is offline, the gateway records the tool name, its arguments, the request's state and the outcome. Pending work expires after seven days. Receipts are kept at most seven days after they finish, up to 1,000 in all.

The gateway also writes a small per-boot secret and a socket file for the relay between its own processes, in the same directory. Both are readable by your user only and hold no world data.

Other data the module keeps stays in Foundry itself: the audit journal of agent writes is a journal in your world, and your browser keeps the pairing token and a replay guard for queued writes in localStorage.

## The AI client

The product ships no model and sends nothing to any AI vendor itself. The AI client you connect, such as Claude Desktop or Claude Code, sends tool results to its vendor, because that is how the model reads them. Whatever an agent reads from your world can leave your machine that way. The vendor's own privacy terms cover that, and this statement does not. Choose which agents to enable with that in mind. Player agents are off until a GM turns them on.

## Tool packs

A tool pack is separate software. How it handles data is its author's responsibility and is not covered by this statement.
