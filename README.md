# Agent Gateway

Agent Gateway lets an AI assistant work inside your Foundry VTT world. It has two parts: a Foundry module that runs in your browser tab, and a gateway, a small program that speaks the Model Context Protocol (MCP) to your AI client. The agent acts in your world as one real Foundry user, with that user's permissions, and the GM approves changes according to a policy. You bring the AI client; the product ships no model and holds no model keys. It is free and MIT-licensed.

It runs on your own machine, or on a server for remote clients and several people.

## What it can and cannot do

- It acts as a real Foundry user. Your Foundry user's role decides which tools the agent gets; there is no role setting in the gateway.
- Writes need GM approval, according to the approval policy. Tools from third-party packs are tagged in approval prompts.
- It has no access beyond that user's permissions. It cannot read or change anything the user could not.
- It supports Foundry v13 and v14 in Pathfinder 2e and D&D 5e worlds.
- It does no TLS and has no tunnel or share mode. A public URL needs a reverse proxy you run.
- Headless agents do not work in the Claude Desktop bundle.

> Agent Gateway is not affiliated with or endorsed by Foundry Gaming LLC. You must own your Foundry licence and any content you use with it.

## Install

Install the module first, then one way of running the gateway.

### 1. The Foundry module

In Foundry, open Add-on Modules, choose Install Module, and paste this into the Manifest URL field:

```
https://github.com/AindriuB/agent-gateway/releases/latest/download/module.json
```

Then enable Agent Gateway in a Pathfinder 2e or D&D 5e world.

### 2. The gateway

Choose one:

- **Claude Desktop bundle.** Download `foundry-agent-gateway.mcpb` from the [latest release](https://github.com/AindriuB/agent-gateway/releases/latest) and open it with Claude Desktop. See the [Claude Desktop guide](docs/guides/claude-desktop.md).
- **npm.** Run `npx foundry-agent-gateway`, or add that command to your MCP client. It needs Node 22.13 or newer. See [`foundry-agent-gateway` on npm](https://www.npmjs.com/package/foundry-agent-gateway).
- **Docker.** The image is `ghcr.io/aindriub/foundry-agent-gateway`. No login is needed to pull it. For an always-on server, see [server mode](docs/server-mode.md).

### 3. Or build from source

You need git and Node 22.13 or newer.

```
git clone https://github.com/AindriuB/agent-gateway.git
cd agent-gateway
npm install
npm run build
```

Run `npm run pack:module` to write `dist/release/agent-gateway.zip` (unzip it into `<Foundry Data>/modules/agent-gateway`), and `npm run pack:mcpb` to write `dist/release/foundry-agent-gateway.mcpb`. The gateway itself starts with `node gateway/dist/bin/cli.js`.

## Quick start

1. Install the module and a gateway as above.
2. **Keep a Foundry browser tab open**, logged in as the user the agent should act as. The agent works through that tab. To run an agent with no tab open, see [the headless guide](docs/guides/headless.md).
3. **Pair.** The module connects from your tab to `ws://localhost:7420` with no configuration. The gateway makes a one-time pairing code, valid for 10 minutes. It is printed on the gateway's stderr, and it comes back in chat when you ask the agent for `gateway_status` or when a tool call fails because Foundry is not connected. In Foundry, open Configure Settings, then Agent Gateway, then Pair with gateway, enter the code and press Connect. You do this once per browser address.
4. **Connect your client** using the table below, then ask the agent to run `gateway_status` to confirm.

## Which guide do I need?

| You use                                 | Read                                                           |
| --------------------------------------- | -------------------------------------------------------------- |
| Claude Desktop                          | [docs/guides/claude-desktop.md](docs/guides/claude-desktop.md) |
| Claude Code                             | [docs/guides/claude-code.md](docs/guides/claude-code.md)       |
| claude.ai                               | [docs/guides/claude-ai.md](docs/guides/claude-ai.md)           |
| ChatGPT                                 | [docs/guides/chatgpt.md](docs/guides/chatgpt.md)               |
| Gemini CLI                              | [docs/guides/gemini-cli.md](docs/guides/gemini-cli.md)         |
| Gemini app                              | [docs/guides/gemini-app.md](docs/guides/gemini-app.md)         |
| An agent with no browser tab (headless) | [docs/guides/headless.md](docs/guides/headless.md)             |
| A self-hosted, always-on server         | [docs/server-mode.md](docs/server-mode.md)                     |
| A public HTTPS URL (Caddy or nginx)     | [docs/guides/reverse-proxy.md](docs/guides/reverse-proxy.md)   |

The remote clients (claude.ai, ChatGPT, Gemini) sign in with OAuth. The gateway's OAuth server is tested with its own client and the MCP Inspector; the per-release checks with the real clients are in [docs/compatibility.md](docs/compatibility.md).

## Tool packs

The core is complete and free. Optional tool packs, from the maintainer or others, add more tools. A pack is a separate Foundry module, and installing one means trusting its author with full access to whatever your Foundry user can do. Tools that come from a pack appear with a "Third-party tool pack" tag in approval prompts. Pack authors start at [docs/packs/README.md](docs/packs/README.md).

## Security and privacy

- [Security model](docs/security.md)
- [Privacy statement](docs/privacy.md)
- [Reporting a vulnerability](SECURITY.md)

## Compatibility

Foundry v13 and v14 (`minimum` 13, `verified` 14). Tested systems are pf2e 8.6.0 and dnd5e 6.0.6 on Foundry 14.369. The Claude Desktop bundle and source installs are verified on macOS and untested on Windows. Details and per-client checks are in [docs/compatibility.md](docs/compatibility.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). For a local development setup, see [docs/dev.md](docs/dev.md).

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## Licence

[MIT](LICENSE).
