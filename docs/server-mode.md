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

## Pairing

Pairing is by operator invite (task 68). The operator issues a single-use code for one world and
user, and sends it privately; nobody else can pair, because the gateway never prints or accepts
a shared code in this mode. Until task 68 lands, the build prints a shared pairing code in the
operator log.

Steps, backup and restore: [gateway/docker/README.md](../gateway/docker/README.md).
