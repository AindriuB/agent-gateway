# Connect the Gemini app

The Gemini app runs in Google's cloud, so it needs a public HTTPS URL to a gateway and signs in with OAuth, like [claude.ai](claude-ai.md) and [ChatGPT](chatgpt.md).

> This guide has not been run end to end. Whether, and for which Google accounts, the Gemini app accepts a custom remote MCP server has changed between releases and was not verified. The per-release checklist is in [docs/compatibility.md](../compatibility.md#per-release-manual-checklist-remote-clients-oauth) and is not ticked. If the app offers no way to add a custom MCP server for your account, use Gemini CLI ([gemini-cli.md](gemini-cli.md)).

## Before you start

Run the gateway at its public URL and pair the Foundry user as in the [claude.ai guide](claude-ai.md#before-you-start):

```
node <repo>/gateway/dist/bin/cli.js --public-url https://gateway.example.com --trust-proxy --allow-origin https://foundry.example.com
curl https://gateway.example.com/status
```

## Connect

1. In the Gemini app, find the place for adding a custom MCP server or connector (Google's documentation says where in your version).
2. Enter `https://gateway.example.com/mcp` as the server URL and choose OAuth, with no client id or secret.
3. The app opens `https://gateway.example.com/authorize`. Enter the world id and the Foundry user (name or id), untick any scope you do not want to give, press "Send a code to that user", then type the code shown in that user's Foundry window and press Approve.
4. Ask the app for `gateway_status`.

## What to expect

- Writes still wait for approval in Foundry, and tools outside your granted scopes are not listed.
- Revoke from Foundry (Configure Settings, then Agent Gateway, then Connected apps). The next call gets 401.
- Everything the agent reads goes to Google, under Google's terms. See [the privacy statement](../privacy.md).
