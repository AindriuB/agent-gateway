# Server mode

Server mode is a gateway that runs all the time on a server next to a self-hosted Foundry,
for several people at once. It has no stdio session and stays up when stdin closes
(`--server-mode`, or `AGENT_GATEWAY_SERVER_MODE=1`).

## The Compose stack

`gateway/docker/compose.yaml` runs two services:

- `gateway`: the image `ghcr.io/aindriub/foundry-agent-gateway:${GATEWAY_VERSION}` (built from
  `gateway/Dockerfile`; `docker compose up -d --build` builds it locally). It binds 127.0.0.1:7420 (the module
  link) and 127.0.0.1:7421 (HTTP, with `/mcp` and `/status`). It has no browser and runs as a
  non-root user.
- `caddy`: terminates TLS and shares the gateway's network namespace
  (`network_mode: "service:gateway"`). `/link*` goes to port 7420, everything else to 7421. The
  gateway does no TLS and is never bound to a public address.

Ports: only 80 and 443 are published (on the `gateway` service, because Caddy shares its
namespace). Volumes: `gateway-data` at `/data` (the database `gateway.db` with its WAL files),
`caddy-data` and `caddy-config` (certificates).

If the VPS already runs Caddy, use the gateway-only file instead; see "Bring your own Caddy" in
`gateway/docker/README.md`.

## The public URL

The stack sets `AGENT_GATEWAY_PUBLIC_URL=https://<domain>`. That derives the allowed Host and
Origin values, turns the static bearer token off, and makes `/status` show only the version and
uptime. `AGENT_GATEWAY_TRUST_PROXY=1` makes the gateway key clients by the address Caddy
forwards, so each client has its own rate limit. The flag applies whenever it is set, with or
without a public URL, and the gateway reads `X-Forwarded-For` only from a loopback peer. The module connects to `wss://<domain>/link`.

Two optional settings add links to the footer of the consent pages: `--privacy-url`
(`AGENT_GATEWAY_PRIVACY_URL`) shows a "Privacy" link, and `--source-url`
(`AGENT_GATEWAY_SOURCE_URL`) shows a "Source code" link. Each must be `https`, or `http` on a
loopback host, with no credentials and at most 2048 characters. With neither set, the footer shows
only the cookie note. Both can also be set in the config file as `privacyUrl` and `sourceUrl`.

## Connecting a remote client

When a remote client (claude.ai, ChatGPT) starts OAuth, the gateway shows a consent page at
`<public URL>/authorize`. Whoever is connecting picks the world, the Foundry user and the scopes,
and then types a code that appears in that user's own Foundry client (the module must be paired
and open). Players can list and revoke what they have approved under "Connected apps" in the
module. The gateway deletes expired OAuth codes and tokens on its own. The page loads its
stylesheet from `/authorize/consent.css`; if you restrict paths at the proxy, allow
`/authorize/*`.

## Privacy and cookies

The operator of a public gateway is the data controller. Set `--privacy-url` to your own privacy
notice so the consent pages link to it. The gateway stores Foundry user names and ids, OAuth client
registrations, grants and tokens (tokens are stored hashed), and client IP addresses, in memory
only, for rate limits; the IP addresses are lost on restart. Retention for OAuth rows is a sweep
every 10 minutes that deletes expired codes (60 seconds), expired or revoked tokens past their
lifetime (access 1 hour, refresh 30 days) and revoked grants with no live tokens, at most 500 rows
per table per run. The consent pages set one strictly necessary cookie, `__Host-agcsrf-` followed
by a request id, for sign-in only and not for tracking; it expires after 15 minutes. See
[privacy.md](privacy.md) for the rest of what the gateway keeps.

## Pairing

In server mode nobody pairs without an invite, and the gateway prints no shared pairing code.
Pairing is per browser: a pairing made on another computer does not carry over, and a browser that
has none shows "This browser is not paired for this user" in the pairing window.

### Onboarding order

1. The operator mints an admin invite for the first GM, inside the gateway container (for example
   `docker compose exec gateway ...`):
   `foundry-agent-gateway --invite <world> <gm user> --admin --origin <origin>`. Only the operator
   can make an admin invite. It needs `--origin`, and it is valid for 1 hour unless `--ttl` says
   otherwise (24 hours at most). The GM pastes it into the pairing window and pairs directly.
2. The admin GM invites players from Manage access (Configure Settings, then Agent Gateway, then
   Manage access). The operator can also mint a
   plain player invite with `--invite <world> <user>`.
3. A player pastes the invite into the pairing window in their own browser.

A plain player invite completes only while an admin GM is in the world with Agent Gateway
connected, because that GM vouches for the player. With no such GM the gateway refuses the invite without using it, and the pairing window says: "Your
GM could not confirm this pairing, so the invite was not used. Ask your GM to open this world with
Agent Gateway connected, then paste the invite again. If you are the GM, ask the gateway operator
for a GM invite." The player can paste the same invite again once an admin GM is connected. (If the
last admin GM leaves at the very moment of pairing, the player may instead see "No GM is online".)

Pair the Foundry user first, then sign in the AI client: the consent page asks for a code from
that user's own Foundry client, and it needs the pairing to exist.

### Operator commands

Run these inside the gateway container.

- `foundry-agent-gateway --invite <world> <user> [--ttl 30m|12h|7d] [--origin <origin>]` prints a
  single-use player invite once. It expires in 24 hours unless `--ttl` says otherwise (7 days at
  most). Send it privately; the gateway never logs or shows it again. A wrong world or user id
  spends it.
- `--invite <world> <user> --admin` makes an admin GM invite, as above.
- `--invite <world> <user> --gm` makes an invite for an additional GM user account, for example a
  dedicated "ChatGPT" GM. It pairs directly, skips the GM vouch and is not admin. Use it only for
  GM user accounts, never for players. It has the same `--origin` requirement and short lifetime
  as `--admin`.
- `--demote <world> <user>` clears the admin flag on that user's pairing and exits with status 1
  if the user was not an admin. The pairing, its grants and invites stay, and a running gateway
  stops accepting that GM's vouches at once.
- `--list-invites` and `--list-pairings` show what exists, including who is admin and which
  invites are GM invites, and print no code or token.
- `--cancel-invite <world> <user>` cancels the unused invites for that target.
- `--revoke-pairing <world> <user>` revokes the pairing, that user's OAuth grants and tokens, and
  their unused invites. A live connection is closed within about 5 seconds.

Redeeming a player invite for someone who is already paired replaces the old pairing and revokes
its grants and tokens, so use a new invite for a new device or a lost token. A GM user is different:
a plain invite for a GM user is refused, and an invite meant for another user is spent as a
mismatch if the user has an admin pairing. A GM re-pairs with a new `--admin` or `--gm` invite.
Failed invites are rate
limited. Refusals are logged at most 20 per minute, followed by a count of the suppressed ones.

The operator needs a person's world id and user id only for invites the operator mints (admin, GM,
headless agents). The pairing window has a "Copy my ids" button for this, inside the details block
"For the gateway operator: your ids". A player does not need it, because their GM invites them.

Steps, backup and restore: [gateway/docker/README.md](../gateway/docker/README.md).
