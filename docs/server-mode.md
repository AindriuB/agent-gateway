# Server mode

Server mode is a gateway that runs all the time on a server next to a self-hosted Foundry,
for several people at once. It has no stdio session and stays up when stdin closes
(`--server-mode`, or `AGENT_GATEWAY_SERVER_MODE=1`).

## The Compose stack

`gateway/docker/compose.yaml` runs two services:

- `gateway`: the image built from `gateway/Dockerfile`. It binds 127.0.0.1:7420 (the module
  link) and 127.0.0.1:7421 (HTTP, with `/mcp` and `/status`). It has no browser and runs as a
  non-root user.
- `caddy`: terminates TLS and shares the gateway's network namespace
  (`network_mode: "service:gateway"`). `/link*` goes to port 7420, everything else to 7421. The
  gateway does no TLS and is never bound to a public address.

Ports: only 80 and 443 are published (on the `gateway` service, because Caddy shares its
namespace). Volumes: `gateway-data` at `/data` (the database `gateway.db` with its WAL files),
`caddy-data` and `caddy-config` (certificates).

## The public URL

The stack sets `AGENT_GATEWAY_PUBLIC_URL=https://<domain>`. That derives the allowed Host and
Origin values, turns the static bearer token off, and makes `/status` show only the version and
uptime. `AGENT_GATEWAY_TRUST_PROXY=1` makes the gateway key clients by the address Caddy
forwards, so each client has its own rate limit. The flag applies whenever it is set, with or
without a public URL, and the gateway reads `X-Forwarded-For` only from a loopback peer. The module connects to `wss://<domain>/link`.

## Connecting a remote client

When a remote client (claude.ai, ChatGPT) starts OAuth, the gateway shows a consent page at
`<public URL>/authorize`. Whoever is connecting picks the world, the Foundry user and the scopes,
and then types a code that appears in that user's own Foundry client (the module must be paired
and open). Players can list and revoke what they have approved under "Connected apps" in the
module. The gateway deletes expired OAuth codes and tokens on its own. The page loads its
stylesheet from `/authorize/consent.css`; if you restrict paths at the proxy, allow
`/authorize/*`.

## Pairing

In server mode nobody pairs without an operator invite, and the gateway prints no shared pairing
code. Ask the person for their world id and user id: the pairing app in the module has a "Copy my
ids" line for this. Then run, inside the gateway container (for example
`docker compose exec gateway ...`):

- `foundry-agent-gateway --invite <world> <user> [--ttl 30m|12h|7d] [--origin <origin>]` prints a
  single-use code once. It expires in 24 hours unless `--ttl` says otherwise (7 days at most).
  Send it privately; the gateway never logs or shows it again. A wrong world or user id spends it.
- `--list-invites` and `--list-pairings` show what exists and print no code or token.
- `--cancel-invite <world> <user>` cancels the unused invites for that target.
- `--revoke-pairing <world> <user>` revokes the pairing, that user's OAuth grants and tokens, and
  their unused invites. A live connection is closed within about 5 seconds.

A new invite for someone who is already paired replaces the old pairing and revokes its grants and
tokens, so use one for a new device or a lost token. Failed invites are rate limited. Refusals are
logged at most 20 per minute, followed by a count of the suppressed ones.

Steps, backup and restore: [gateway/docker/README.md](../gateway/docker/README.md).
