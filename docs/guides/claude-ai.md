# Connect claude.ai

claude.ai runs in Anthropic's cloud, so it cannot reach a gateway on your own machine. It connects through a public HTTPS URL to a gateway you run, and signs in with OAuth. You need a gateway reachable at a public URL first.

> This guide has not been run end to end against a live claude.ai account. The per-release checklist for it is in [docs/compatibility.md](../compatibility.md#per-release-manual-checklist-remote-clients-oauth), and it is not ticked. The gateway-side commands below were run; the claude.ai screens are described from the connector's documented flow and may be worded differently.

## Before you start

1. **Run the gateway at a public URL.** Either follow [the server-mode Compose stack](../../gateway/docker/README.md) (Docker, Caddy and a domain), or run the gateway yourself behind a proxy as in [reverse-proxy.md](reverse-proxy.md):

   ```
   node <repo>/gateway/dist/bin/cli.js --public-url https://gateway.example.com --trust-proxy --allow-origin https://foundry.example.com
   ```

   Check it: `curl https://gateway.example.com/status` returns the version and uptime and nothing else.

2. **Pair the Foundry user.** Keep a Foundry tab open as the user the agent should act as. In Foundry open Configure Settings, then Agent Gateway, then Pair with gateway. Set the gateway URL to `wss://gateway.example.com/link`. With a public URL the code is printed only in the gateway's own log (never in chat, never through the AI client), so read it there. In server mode the operator makes a single-use invite instead; see [server-mode.md](../server-mode.md#pairing).

## Add the connector

1. In claude.ai, open Settings, then Connectors, and add a custom connector.
2. Give it a name and the URL `https://gateway.example.com/mcp`. Leave any client id and secret fields empty: the gateway lets the client register itself (dynamic client registration).
3. Connect. claude.ai opens the gateway's consent page at `https://gateway.example.com/authorize`.
4. On the consent page enter the world id and the Foundry user (name or id). The scopes the client asked for are ticked; untick any you do not want to give (a client that names none gets `read` only). Press "Send a code to that user". A code appears in that user's Foundry window, so type it into the consent page and press Approve. This proves you control that user's session; the page cannot be used to pick a user you do not control.
5. claude.ai reports that it is connected. Ask it to run `gateway_status`.

## What to expect

- The token scopes you grant sit on top of the permission model, they do not replace it: a write still waits for approval in Foundry, and the Foundry user's role and the world policy still apply. See [the security model](../security.md#remote-access-and-oauth).
- Access tokens last 1 hour and are renewed by claude.ai in the background; the grant itself lasts until you revoke it (refresh tokens last 30 days and rotate on every use).
- To disconnect, open Configure Settings, then Agent Gateway, then Connected apps in Foundry and revoke the grant. The next call from claude.ai gets 401 and claude.ai asks you to reconnect.
- Pick a new set of scopes by revoking and connecting again.

## If something goes wrong

- **The consent page says the request is invalid or has expired.** Consent requests live for 15 minutes. Start the connection again.
- **No code appears in Foundry.** The module must be paired and open as that user, and the module and gateway must be the same release.
- **Connecting fails before the consent page.** Check that `https://gateway.example.com/.well-known/oauth-authorization-server` loads from the internet, and that the proxy passes `/authorize` and `/token` (see [reverse-proxy.md](reverse-proxy.md)).
