# Run the gateway on a server (Docker Compose + Caddy)

Caddy gets a TLS certificate for your domain and proxies to the gateway, which stays on
127.0.0.1 inside the stack. Only ports 80 and 443 are published. Background:
[docs/server-mode.md](../../docs/server-mode.md). Already running Caddy? See
[Bring your own Caddy](#bring-your-own-caddy).

`<cli>` below is `foundry-agent-gateway` (already on the image's PATH).

## Prerequisites

- A VPS with Docker and the Compose plugin.
- A DNS A/AAAA record for your domain pointing at the VPS.
- Ports 80 and 443 open to the internet (80 is needed for the certificate challenge).

## Start

```
cd gateway/docker
cp .env.example .env      # set DOMAIN, FOUNDRY_ORIGIN, ACME_EMAIL
docker compose up -d --build
docker compose ps         # both services should be running; gateway "healthy"
curl https://<domain>/status
```

`/status` shows only the version and uptime.

`HTTP_PORT` and `HTTPS_PORT` in `.env` move the published ports. They are for local tests only
and cannot be used for a real deployment: a browser then sends `Host: <domain>:<port>`, which
does not match the public URL, so the gateway refuses it. Test with
`curl -k --connect-to <domain>:443:127.0.0.1:<HTTPS_PORT> https://<domain>/status`.

If the gateway container restarts on its own, run `docker compose restart caddy`: Caddy shares
the gateway's network namespace and can be left in the old one.

## Bring your own Caddy

If your VPS already runs Caddy (installed on the host or in its own container), skip the bundled
one. `compose.byo-caddy.yaml` runs the gateway alone, with the same project name and
`gateway-data` volume, so moving from the bundled stack keeps your database. Never run both
files at once.

1. Put `COMPOSE_FILE=compose.byo-caddy.yaml` in `.env` (with `DOMAIN` and `FOUNDRY_ORIGIN`;
   `ACME_EMAIL` is not needed). Every command in this README then works unchanged, with no `-f`.
2. Paste `byo-caddy.Caddyfile` into your own Caddyfile and change the host. It is a site block
   only: your Caddy already has its global options and ACME email.
3. Pick your setup below, then `docker compose up -d --build`.

**Host-installed Caddy.** Leave `GATEWAY_NETWORK_MODE` unset. The gateway runs with
`network_mode: host` and publishes no ports. It keeps its default 127.0.0.1 binding on 7420 and
7421, so nothing new is exposed, but those two host ports must be free. Host networking works on
a Linux host only (not under Docker Desktop).

**Containerised Caddy.** Set `GATEWAY_NETWORK_MODE=container:<name>` in `.env`, where `<name>` is
your Caddy container's name from `docker ps`, and start Caddy first. The gateway then shares
Caddy's network namespace, so 127.0.0.1 reaches both. If the Caddy container is recreated (an
image update, or `docker compose up` on Caddy's own stack), the gateway is left in a dead
network namespace. Recreate it: `docker compose up -d --force-recreate gateway`. A plain
`docker compose restart gateway` reuses the old container's namespace and is not enough.

**Why not a shared Docker network.** On a shared network Caddy reaches the gateway from a
container IP, not from loopback. The gateway trusts `X-Forwarded-For` only from a loopback peer,
so it ignores the header and every client shares one rate-limit bucket. It would also have to
bind beyond 127.0.0.1. This setup is not supported.

**Use a dedicated subdomain.** The gateway needs a host of its own (for example
`gateway.example.com`), never a path under the Foundry host. The public URL must be a bare
origin, the gateway serves at the root (`/mcp`, `/authorize`, `/.well-known/...`, `/link`,
`/status`), and the consent page's `__Host-` cookie is scoped to the whole host.

**Routing.** `/link*` goes to 127.0.0.1:7420 and everything else to 127.0.0.1:7421. Caddy's
`reverse_proxy` handles the WebSocket upgrade with no extra configuration and sets
`X-Forwarded-For` itself.

**Check it works.**

```
docker compose ps         # gateway "healthy"
curl https://<domain>/status
docker compose exec gateway <cli> --invite <world id> <user id>
docker compose logs gateway | grep -c -- "--trust-proxy is off"   # expect 0
```

The invite works because `COMPOSE_FILE` is set.

## Pair each person

Invites arrive with task 68 (not in this build yet). Until then the shared pairing code is
printed in the log: `docker compose logs gateway | grep "Pairing code:"`.

After task 68:

1. The person opens Agent Gateway's pairing app in Foundry and sends you the world id and user
   id from its "Copy my ids" line.
2. You run `docker compose exec gateway <cli> --invite <world id> <user id>` and send them the
   printed code privately. It works once and expires after 24 hours.
3. They set the gateway URL to `wss://<domain>/link` and enter the code.

Re-pairing a lost device needs a new invite.

- `docker compose exec gateway <cli> --revoke-pairing <world> <user>` removes someone and
  cancels their unused invites.
- `docker compose exec gateway <cli> --cancel-invite <world> <user>` withdraws an unused invite.
- `docker compose exec gateway <cli> --list-invites` and `--list-pairings` show status without
  codes.

There is no static bearer token to rotate in this mode: it is off when a public URL is set.

## Update

```
git pull
docker compose up -d --build
```

(or `docker compose pull` and `docker compose up -d` once an image is published).

## Data and backup

The `gateway-data` volume holds `gateway.db` and its `gateway.db-wal` and `gateway.db-shm`
files (the store runs in WAL mode). Caddy's certificates live in `caddy-data` and
`caddy-config`.

Backup while running:

```
docker compose exec gateway <cli> --backup /data/backups/$(date +%F).db
docker compose cp gateway:/data/backups/$(date +%F).db .
```

The other way is `docker compose stop gateway`, copy the whole `/data` volume, then
`docker compose start gateway`. Never copy `gateway.db` alone from a running stack: recent
writes may still be in `gateway.db-wal`.

## Restore

```
docker compose stop gateway
# put the backup at /data/gateway.db in the gateway-data volume, and delete
# /data/gateway.db-wal and /data/gateway.db-shm if they exist
docker compose start gateway
```
