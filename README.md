# agent-gateway

A Foundry VTT module and MCP gateway that give an AI agent permissioned access to a running world. You bring the AI client; the product ships no model and holds no model keys. The core is free and MIT-licensed.

This release is local only. See [What this release does not do](#what-this-release-does-not-do).

## Quick start

1. **Install the module.** In Foundry, open Add-on Modules, choose Install Module, and paste this manifest URL:

   ```
   https://github.com/AindriuB/agent-gateway/releases/latest/download/module.json
   ```

2. **Enable it** in a Pathfinder 2e or D&D 5e world. It supports Foundry v13 and v14 (`minimum` 13, `verified` 14 in `module.json`). Tested systems are pf2e 8.6.0 and dnd5e 6.0.6 on Foundry 14.369.
3. **Keep a Foundry browser tab open**, logged in as the user the agent should act as. The agent works through that tab and acts with that user's permissions. There is no headless mode in this release, so if the tab closes the agent is offline.
4. **Start the gateway**, by one of these:
   - Run `npx foundry-agent-gateway` (needs Node 22.13 or newer). In practice your AI client starts it for you; see the guides.
   - Or install the `foundry-agent-gateway.mcpb` file from the [releases page](https://github.com/AindriuB/agent-gateway/releases) into Claude Desktop.
5. **Pair.** The module connects from your browser tab to `ws://localhost:7420` with no configuration. The gateway makes a one-time pairing code that is valid for 10 minutes. You can get it three ways: it is printed on the gateway's stderr, it comes back in chat when you ask the agent for `gateway_status` (or when a tool call fails because Foundry is not connected), and Claude Desktop also shows it in the extension's log. In Foundry, open Configure Settings, then Agent Gateway, then Pair with gateway, enter the code and press Connect. You do this once per browser address. Your Foundry user's role decides which tools the agent gets; there is no role setting in the gateway.
6. **Connect your client**, and ask the agent to run `gateway_status` to confirm:
   - [Claude Desktop](docs/guides/claude-desktop.md)
   - [Claude Code](docs/guides/claude-code.md)

Licensed MIT.

## What this release does not do

This release is local only. The gateway and your AI client run on one machine, and the link accepts connections from that machine. There are no remote clients, OAuth, public URLs, ChatGPT or Gemini connectors, headless agents or Docker images yet.

The `.mcpb` and `npx` installs are verified on macOS and untested on Windows in this release.

## Tool packs

The core is complete and free. Optional tool packs, from Andrew or from others, add more tools. A pack is a separate Foundry module, and installing one means trusting its author with full access to whatever your Foundry user can do. Tools that come from a pack appear with a "Third-party tool pack" tag in approval prompts. Pack authors start at [docs/packs/README.md](docs/packs/README.md).

## More

- [Claude Desktop guide](docs/guides/claude-desktop.md)
- [Claude Code guide](docs/guides/claude-code.md)
- [Security model](docs/security.md)
- [Privacy statement](docs/privacy.md)
- [Local development](docs/dev.md) and [conventions](docs/conventions.md)
- [Design](docs/plan/specs/2026-10-09-agent-gateway.md)
