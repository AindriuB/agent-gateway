# Connect Claude Desktop

Claude Desktop starts the gateway for you and talks to it over stdio. Use one of the two installs below, not both. Before you start, install and enable the module and keep a logged-in Foundry tab open, as in the [README quick start](../../README.md#quick-start).

The `.mcpb` and `npx` installs are verified on macOS and untested on Windows in this release.

## Install the extension (.mcpb)

1. Download `foundry-agent-gateway.mcpb` from the [releases page](https://github.com/AindriuB/agent-gateway/releases).
2. Open it with Claude Desktop, or go to Settings, then Extensions, and drag the file in. Confirm the install.
3. Leave the settings alone. The extension has only three, all optional and advanced: the link port (default 7420), the HTTP port (default 7421) and the log level. There is no Foundry URL and no role setting. Your Foundry user's role decides which tools you get.

## Or add it to the config file

If you would rather not use the extension, edit `claude_desktop_config.json` and restart Claude Desktop. The file is at:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add the server under `mcpServers`:

```json
{
  "mcpServers": {
    "foundry": {
      "command": "npx",
      "args": ["-y", "foundry-agent-gateway"]
    }
  }
}
```

Node 22.13 or newer must be installed. If Claude Desktop cannot find `npx`, give the full path to it as `command`.

## Pair

1. Start a new chat and ask Claude to run `gateway_status`. If Foundry is not connected yet, the reply includes a pairing code. Any tool call that fails with "not connected" shows the code too.
2. In Foundry, open Configure Settings, then Agent Gateway, then Pair with gateway. Enter the code and press Connect. Leave the gateway URL as it is.
3. Ask for `gateway_status` again. It should say you are connected, with the world and user name.

A code is valid for 10 minutes and works once. If it has expired, `gateway_status` shows a fresh one. The module remembers its pairing in that browser, so you only repeat this for a new browser address. A pairing works only from the address it was made from, so `http://` and `https://` addresses of the same host pair separately. If you used an earlier build, you need to pair once more.

Several chats can use Foundry at the same time. Every chat runs through the one gateway that holds the link.

## If something goes wrong

- **`LINK_UNAVAILABLE: this gateway instance is not connected to Foundry: …`** Tool calls fail with this reply when the gateway cannot take the link port or reach the one that holds it. The reason follows, for example `link port 7420 is in use; is another gateway running?`. Another program holds the port, or a gateway started by something else is running. Quit the other gateway. Or change the extension's link port, or use `AGENT_GATEWAY_LINK_PORT` in the config file, and use the same port in the module's gateway URL (`ws://localhost:<port>`).
- **"Not connected to Foundry yet" or "is not connected".** The gateway is running but no module is paired. Open the world in a browser as the right user, keep that tab open, and enter the pairing code shown in the message.
- **The pairing is refused.** The code may have expired or been used, the address may differ from the one you paired from, or there have been 10 wrong codes in a minute. Ask for `gateway_status` to get a fresh code, or wait a minute.
- **The tool list is shorter than you expect.** Tools follow your Foundry user's role, and agents for non-GM users stay off until a GM turns them on in the module's policy settings.

Claude Code can also use the gateway; see [the Claude Code guide](claude-code.md). The [security model](../security.md) and [privacy statement](../privacy.md) say what the agent can do and what is stored.
