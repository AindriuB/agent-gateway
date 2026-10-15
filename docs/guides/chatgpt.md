# Connect ChatGPT

ChatGPT runs in OpenAI's cloud, so it reaches the gateway through a public HTTPS URL and signs in with OAuth. You need a gateway at a public URL first; see [reverse-proxy.md](reverse-proxy.md) or the [server-mode stack](../../gateway/docker/README.md).

> This guide has not been run end to end against a live ChatGPT account. The per-release checklist is in [docs/compatibility.md](../compatibility.md#per-release-manual-checklist-remote-clients-oauth) and is not ticked. The gateway-side commands were run. ChatGPT's custom connectors are in developer mode and their screens and plan requirements change; check OpenAI's current documentation for where the option is.

## Before you start

Run the gateway at its public URL and pair the Foundry user exactly as in the [claude.ai guide](claude-ai.md#before-you-start):

```
node <repo>/gateway/dist/bin/cli.js --public-url https://gateway.example.com --trust-proxy --allow-origin https://foundry.example.com
curl https://gateway.example.com/status
```

The module connects to `wss://gateway.example.com/link`. In server mode, ask the operator for an invite instead of a code from the log.

## Add the connector

1. In ChatGPT, turn on developer mode (Settings, then Connectors, then the advanced options) and create a connector.
2. Give it a name, the MCP server URL `https://gateway.example.com/mcp`, and choose OAuth for authentication. Leave any client id and secret empty; ChatGPT registers itself with the gateway.
3. Create it. ChatGPT opens `https://gateway.example.com/authorize`. Enter the world id and the Foundry user (name or id), untick any scope you do not want to give, press "Send a code to that user", then type the code that appears in that user's Foundry window and press Approve.
4. Start a chat, enable the connector, and ask for `gateway_status`.

## What to expect

- Scopes are `read` (default), `write`, `destructive` and `code`. Tools outside the scopes you granted are not listed at all. Writes still wait for approval in Foundry.
- ChatGPT may call tools more eagerly than you expect. Give it only `read` first.
- Revoke from Foundry (Configure Settings, then Agent Gateway, then Connected apps). The next call gets 401 and ChatGPT asks you to reconnect.
- Everything the agent reads goes to OpenAI, under OpenAI's terms. See [the privacy statement](../privacy.md).

## If something goes wrong

- **Redirect URI errors.** The gateway accepts a client's redirect only if it is registered exactly (HTTPS, or HTTP on a loopback host) and refuses anything else, without redirecting to it.
- **Wrong audience (`invalid_target`).** The connector URL must be exactly `https://<your host>/mcp`; the token is bound to that audience.
- **Consent page expired.** Requests last 15 minutes. Connect again.
