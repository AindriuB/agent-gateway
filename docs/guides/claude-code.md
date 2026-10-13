# Connect Claude Code

Claude Code can run the gateway itself over stdio, or talk to a gateway you start yourself over local HTTP. Pick one. Before you start, install and enable the module and keep a logged-in Foundry tab open, as in the [README quick start](../../README.md#quick-start). Needs Node 22.13 or newer.

## Option 1: stdio (simplest)

Claude Code starts the gateway when a session opens and stops it when the session ends:

```
claude mcp add foundry -- npx -y foundry-agent-gateway
```

Add `--scope user` to make it available in every project, or `--scope project` to share it in `.mcp.json`. Then run `/mcp` inside Claude Code and check that `foundry` is connected.

## Option 2: local HTTP

Use this if you want the gateway to keep running between Claude Code sessions. Start it yourself with `--http`:

```
npx foundry-agent-gateway --http
```

On the first run it prints a bearer token, once. The gateway stores only a hash of the token, so it cannot show it again. Copy it now. The HTTP endpoint is `http://127.0.0.1:7421/mcp`, and it binds to the loopback address only; the gateway refuses any other address. Then register it, putting your token where `<token>` is:

```
claude mcp add --transport http foundry http://127.0.0.1:7421/mcp --header "Authorization: Bearer <token>"
```

Every request must carry the token. Treat it like a password: anything on your machine that has it can use the gateway as your paired Foundry user. Do not paste it into chats or commit it.

If you lose the token, or want to cut off a client, run `npx foundry-agent-gateway --http-rotate-token`. It prints a new token once and exits, and the old token stops working at once, even in a gateway that is already running. Register the new token with `claude mcp remove foundry` and the command above. A status page is at `http://127.0.0.1:7421/status` (loopback only, no secrets).

To use another port, pass `--http-port <n>` and put the same port in the URL.

## Pair

1. Ask Claude to run `gateway_status`. If Foundry is not connected, the reply includes a pairing code. The code is also printed on the gateway's stderr, which in Option 2 is the terminal where you started it.
2. In Foundry, open Configure Settings, then Agent Gateway, then Pair with gateway. Enter the code and press Connect. Leave the gateway URL as it is (`ws://localhost:7420`).
3. Ask for `gateway_status` again. It should say you are connected, with the world and user.

A code lasts 10 minutes and works once; `gateway_status` shows a fresh one when needed. The pairing is kept in that browser and only works from the address it was made from, so `http://` and `https://` addresses of one host pair separately. Your Foundry user's role decides which tools the agent gets. Without `--user`, a session follows the connected pairing and can move to a different user or world that you pair later; to fix a session to one user, add `--user <name>` to the gateway command (a Foundry user name or id). See the [security model](../security.md).

## If something goes wrong

- **`LINK_UNAVAILABLE: this gateway instance is not connected to Foundry: …`** Tool calls fail with this reply when the gateway cannot take the link port. The reason follows, for example `link port 7420 is in use; is another gateway running?`, or `another gateway holds link port 7420`. Another program or another gateway holds the port. Stop it, or start this one with `--link-port <n>` and set the module's gateway URL to `ws://localhost:<n>`. If you start the gateway in a terminal, the same reason is printed there.
- **"Not connected to Foundry yet" or "is not connected".** No module is paired. Open the world as the right user in a browser, keep the tab open, and enter the code from the message.
- **HTTP answers 401.** The token is missing, wrong or rotated. Use the current token.
- **The pairing is refused.** The code may have expired, been used already or come from a different address, or there have been 10 wrong codes in a minute. Ask for `gateway_status` for a fresh code.

See also [the Claude Desktop guide](claude-desktop.md), the [security model](../security.md) and the [privacy statement](../privacy.md).
