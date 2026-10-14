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
forwards, so each client has its own rate limit. The module connects to `wss://<domain>/link`.

## Connecting a remote client

When a remote client (claude.ai, ChatGPT) starts OAuth, the gateway shows a consent page at
`<public URL>/authorize`. Whoever is connecting picks the world, the Foundry user and the scopes,
and then types a code that appears in that user's own Foundry client (the module must be paired
and open). Players can list and revoke what they have approved under "Connected apps" in the
module. The gateway deletes expired OAuth codes and tokens on its own. The page loads its
stylesheet from `/authorize/consent.css`; if you restrict paths at the proxy, allow
`/authorize/*`.

## Pairing

Pairing is meant to be by operator invite (task 68): the operator issues a single-use code
for one world and user and sends it privately, so nobody can pair without one. Task 68 is not
in this build yet. Until it lands, the gateway prints one shared pairing code in the operator
log (`docker compose logs gateway`), and anyone who gets that code can pair; share it only with
the people you mean to pair.

Steps, backup and restore: [gateway/docker/README.md](../gateway/docker/README.md).
