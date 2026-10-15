# Connect Gemini CLI

Gemini CLI runs on your own machine, but it can use the same public HTTPS URL and OAuth sign-in as the cloud clients. Use that when you want one gateway for several clients. For a gateway used only from your machine, use the local options in the [Claude Code guide](claude-code.md) as a model; this guide is the OAuth route.

> This guide has not been run end to end with Gemini CLI. The per-release checklist is in [docs/compatibility.md](../compatibility.md#per-release-manual-checklist-remote-clients-oauth) and is not ticked. The gateway-side commands were run; check `gemini mcp --help` for the flags in your version.

## Before you start

Run the gateway at its public URL and pair the Foundry user as in the [claude.ai guide](claude-ai.md#before-you-start):

```
node <repo>/gateway/dist/bin/cli.js --public-url https://gateway.example.com --trust-proxy --allow-origin https://foundry.example.com
curl https://gateway.example.com/status
```

## Add the server

```
gemini mcp add --transport http foundry https://gateway.example.com/mcp
```

Start `gemini`, run `/mcp` and choose to authenticate `foundry`. Gemini CLI registers itself with the gateway and opens the consent page `https://gateway.example.com/authorize` in your browser. Enter the world id and the Foundry user (name or id), untick any scope you do not want to give, press "Send a code to that user", then type the code that appears in that user's Foundry window and press Approve.

Then ask Gemini to run `gateway_status`.

## What to expect

- Gemini CLI listens on a local port for the redirect. The gateway accepts `http` redirects only to a loopback host (`127.0.0.1`, `[::1]` or `localhost`) and only the exact address the client registered.
- Tools outside your granted scopes are not listed. Writes still wait for approval in Foundry.
- Revoke from Foundry (Configure Settings, then Agent Gateway, then Connected apps). The next call gets 401 and Gemini CLI asks you to authenticate again.
- The static bearer token is off while a public URL is set, so a plain `Authorization: Bearer` header from a settings file will get 401. Use the OAuth route.
