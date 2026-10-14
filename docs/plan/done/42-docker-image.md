# 42 — Ship the server-mode Docker image and a Compose stack with Caddy

**Repo:** .
**Depends on:** 64, 74
**Status:** MVP B wave 2, alongside 35. Amended 2026-10-14 in the MVP B re-plan. Docker Compose on a public VPS is the primary deployment (Andrew, 2026-10-14): Andrew deploys it first so friends can test and give feedback. It no longer waits for 38 or 68. Headless Chromium is not in this image: 37 adds it.
**Owns:**
- gateway/Dockerfile
- gateway/Dockerfile.dockerignore (BuildKit reads it for a build whose context is the repo root; replaces the old `gateway/.dockerignore` entry)
- gateway/docker/** (compose.yaml, Caddyfile, .env.example, README.md, any entrypoint script)
- scripts/release.mjs (the Docker build step only)
- scripts/test/docker-*.mjs (new, if a pure helper needs a test)
- docs/server-mode.md

## Goal
Package the gateway for server mode next to a self-hosted Foundry. Andrew should be able to deploy to a fresh VPS with one `docker compose up`, a domain name and TLS managed by Caddy, and then have friends pair and connect. The gateway image is lean and gateway-only. Caddy terminates TLS and shares the gateway's network namespace, so the gateway stays on 127.0.0.1. Build the image locally; the registry is not chosen yet.

## Context
- Andrew, 2026-10-14:
  - TLS terminates at a reverse proxy, with the gateway on 127.0.0.1 behind it. This task ships the Compose file with Caddy, and the gateway does no TLS.
  - With `--public-url` set, the static bearer is off and the pairing code goes only to the operator's log.
  - Server mode pairs through operator invites (68, Model I, Andrew 2026-10-14). Once 68 lands, there is no shared code in the logs, and the operator runs `--invite <world> <user>` through `docker compose exec`. Until then, the smoke run reads the shared code from `docker compose logs`.
  - Compose on a VPS comes first. Native installers come later, and tunnel or self-TLS setups are not planned.
- 74 provides every setting as an env key: `AGENT_GATEWAY_PUBLIC_URL`, `AGENT_GATEWAY_SERVER_MODE`, `AGENT_GATEWAY_TRUST_PROXY`, `AGENT_GATEWAY_ALLOW_ORIGIN`, `AGENT_GATEWAY_LINK_HOST` and `AGENT_GATEWAY_HTTP_HOST` (default 127.0.0.1), `AGENT_GATEWAY_HTTP`, plus the existing `AGENT_GATEWAY_LINK_PORT`, `AGENT_GATEWAY_HTTP_PORT`, `AGENT_GATEWAY_LOG_LEVEL` (gateway/src/config/index.ts:14-18) and `AGENT_GATEWAY_DB` (gateway/src/bin/cli.ts:153, :177). With `--server-mode`, stdin end does not stop the process, and there is no stdio session.
- gateway/src/bin/cli.ts:184: before 74, a closed stdin stops the gateway. Check that the image runs with 74 merged.
- The link server accepts an upgrade on any path (gateway/src/link/server.ts:110-114, :135). The module takes any `wss://` URL as its gateway URL (module/src/link/client.ts:28-34), so `wss://<domain>/link` works through Caddy.
- docs/plan/specs/2026-10-09-agent-gateway.md:86-87 (server mode), :291-292 (Docker image; registry to confirm: GHCR or Docker Hub).
- scripts/release.mjs:1-4 (the local release flow from 64) and docs/releasing.md.
- 74 decisions (i) and (j): the store runs in WAL mode, and `--backup <path>` writes a consistent 0600 copy while the gateway runs.
- gateway/dist/bin/cli.js is the single esbuild bundle from 61. The image needs only it, gateway/package.json and production dependencies.

## Decisions
- (a) **Topology.** Compose has two services:
  - `gateway`: this image. It binds 127.0.0.1:7420 (link) and 127.0.0.1:7421 (HTTP).
  - `caddy`: the official Caddy image with `network_mode: "service:gateway"`. Ports 80 and 443 are published on the `gateway` service, because the two share a namespace, and nothing else is published. The gateway's bind address stays loopback, and 74's non-loopback bind is not used.
- (b) **Routing.** The Caddyfile for `{$DOMAIN}`:
  - `handle /link*` goes to `reverse_proxy 127.0.0.1:7420` (WebSocket);
  - everything else goes to `reverse_proxy 127.0.0.1:7421`, which covers `/mcp`, `/status`, the OAuth endpoints from 35 and the consent page from 67.

  Caddy keeps the original Host, which 74's allowlist needs.
- (c) **Gateway settings in Compose**, from `.env`:
  - `AGENT_GATEWAY_SERVER_MODE=1`;
  - `AGENT_GATEWAY_PUBLIC_URL=https://${DOMAIN}`;
  - `AGENT_GATEWAY_TRUST_PROXY=1` (required, F7), safe because the only loopback peer is Caddy. Without it every client shares one rate-limit bucket, and 74 logs a warning;
  - `AGENT_GATEWAY_ALLOW_ORIGIN=${FOUNDRY_ORIGIN}`;
  - `AGENT_GATEWAY_DB=/data/gateway.db`.

  Volumes: `gateway-data:/data` (0700, owned by the image's non-root user), and `caddy-data` and `caddy-config` for certificates. `/data` also holds the headless agents' Chromium profiles under `/data/headless/profiles/<agent-id>/` once 37 lands, one dir per agent. No extra volume is needed, and backups of `/data` include them.
- (d) **Missing settings.** If a setting the stack needs has no env key after 74, stop and report. Do not edit gateway/src/**.

## Acceptance
Image:
- [ ] A multi-stage `gateway/Dockerfile` on a Node LTS slim base. It contains no browser, runs as a non-root user, declares `/data` as a volume, and its default command runs the gateway in server mode from env alone (no arguments needed). The PR reports the image size.
- [ ] `docker build -f gateway/Dockerfile .` succeeds, `docker run --rm <image> --version` prints the repo version, and `docker run` with `AGENT_GATEWAY_SERVER_MODE=1` and no TTY or stdin stays up and answers `GET /status` inside the container (output in the PR).
- [ ] A `HEALTHCHECK` that calls `/status` on 127.0.0.1.

Stack:
- [ ] `gateway/docker/compose.yaml`, `Caddyfile` and `.env.example` implement decisions (a) to (c). `.env.example` holds only `DOMAIN`, `FOUNDRY_ORIGIN`, `ACME_EMAIL` and optional `AGENT_GATEWAY_LOG_LEVEL`, each with a one-line comment.
- [ ] Local smoke run on the homelab with `DOMAIN=localhost` (Caddy's internal CA), including one `--backup` through `docker compose exec` while the stack runs:
  - `docker compose up -d` brings both services healthy;
  - `curl -k https://localhost/status` shows only the version and uptime;
  - `docker compose logs gateway` shows a `Pairing code:` line before 68 lands (after 68, `docker compose exec gateway … --invite <world> <user>` prints an invite code instead), and does not show 74's shared-bucket warning;
  - a static bearer on `/mcp` gets 401.

  Output in the PR.
- [ ] Through the stack, a module (the real one in a browser, or the conformance FakeModule pointed at `wss://localhost/link`) pairs with the code from the logs, and `/status` with no credentials still shows no user (output in the PR).
- [ ] `gateway/docker/README.md` is the operator's page. It is short and has exact commands:
  - prerequisites: a VPS with Docker, a DNS A/AAAA record for the domain, and ports 80/443 open;
  - copy `.env.example` to `.env` and fill it in;
  - `docker compose up -d`;
  - pairing each person:
    1. they open Agent Gateway's pairing app in Foundry and send the operator the world id and user id from its "Copy my ids" line (68);
    2. the operator runs `docker compose exec gateway <cli> --invite <world id> <user id>` and sends them the printed code privately (single use, 24 h);
    3. they set the gateway URL to `wss://<domain>/link` and enter the code;
  - re-pairing a lost device needs a new invite; `--revoke-pairing <world> <user>` removes someone and cancels their unused invites; `--cancel-invite <world> <user>` withdraws an invite that was not used; `--list-invites` and `--list-pairings` show status without codes;
  - that there is no static bearer token to rotate in this mode;
  - how to update (`docker compose pull` or rebuild, then `up -d`);
  - where the data lives (`gateway.db` and its `-wal`/`-shm` files in the `gateway-data` volume, since 74 turns on WAL);
  - backup while running: `docker compose exec gateway <cli> --backup /data/backups/<date>.db` (74 decision j), then copy it off the host. The other way is to stop the stack (`docker compose stop gateway`), copy the whole `/data` volume and start it again. Never copy `gateway.db` alone from a running stack, because recent writes may still be in `gateway.db-wal`;
  - restore: stop the stack, put the backup in place as `/data/gateway.db`, remove any `gateway.db-wal` and `gateway.db-shm`, and start it again.
- [ ] Manual check by Andrew (recorded at `/record`, not a merge blocker): on a fresh VPS, one `docker compose up -d` with a real domain gets a Caddy-issued certificate, and the GM's Foundry pairs over `wss://<domain>/link`.

Release:
- [ ] `scripts/release.mjs` builds and tags the image locally as `foundry-agent-gateway:<version>`. A push step sits behind a `--push-image` flag and prints "registry not configured" and exits non-zero until Andrew chooses GHCR or Docker Hub. Without the flag nothing is pushed.
- [ ] `docs/server-mode.md` covers what server mode is, the Compose stack, volumes, ports, the public URL, that pairing is by operator invite (68), and why nobody can pair without one. It links `gateway/docker/README.md` for the steps.
- [ ] `npm run verify` passes, and `git diff --stat main` lists only files in Owns.

## Out of scope
- Headless Chromium in the image and its profile volume (37).
- Choosing or configuring the registry.
- VPS provisioning, DNS and firewall automation; homelab compose wiring (homelab repo).
- Native installers (Windows .exe, macOS .pkg, a Linux script with Node bundled): a later "ease of installation" phase.
- Tunnel or `share` modes, port-forwarding and TLS in the gateway: not planned.
- Any gateway source change (decision d).
- Client setup guides and the reverse-proxy guide for nginx (43).

## History
- 2026-10-13 MVP split: depends was `38, 41, 36`. 41's MVP A scope moved to 64; the server-mode flag came from 68.
- 2026-10-14 re-plan: depends is `64, 74`. Flags and env keys come from 74. Compose with Caddy terminates TLS, and the gateway stays on 127.0.0.1. Headless moved to 37, and pairing confirmation (68) is no longer a prerequisite, so the image ships first for the friend test.

## Review round 1 — findings

Reviewed HEAD: 77f4c2d (code-reviewer, 2026-10-14). All routed to implementer.

- [P1] gateway/Dockerfile:21-23 — the build stage's `npm ci --workspace protocol --workspace gateway` omits the root devDependencies (typescript, @types/node), so both builds fail with `tsc` not found and `docker build -f gateway/Dockerfile .` cannot succeed. Fix: add `--include-workspace-root` to that `npm ci` (verified in scratch).
- [P2] gateway/Dockerfile:34 with gateway/docker/README.md "Backup while running" — the documented backup writes to `/data/backups/<date>.db`, but nothing creates `/data/backups` and `--backup` does not mkdir (gateway/src/bin/cli.ts:113). A fresh stack's first backup fails with ENOENT. Fix: create `/data/backups` owned by `node` in the image next to `mkdir /data`, or a `mkdir -p` README step. No gateway source change.
- [P3, optional] gateway/docker/README.md HTTP_PORT/HTTPS_PORT with compose.yaml:23-24 — moving the HTTPS port makes browsers send `Host: <domain>:<port>`, which does not match `AGENT_GATEWAY_PUBLIC_URL=https://${DOMAIN}` (exact host:port, gateway/src/http/public-url.ts:13), so the link and /mcp refuse. Fix: remove the knob, or document that it cannot be used with a public URL.
- [NOTE] compose.yaml:28 network_mode "service:gateway" with restart: Caddy can be left in a dead namespace after a gateway auto-restart; one README line or a Caddy healthcheck.
- [NOTE] docs/server-mode.md "Pairing" reads backwards for an operator deploying before task 68.
- [NOTE] scripts/release.mjs:111-116 — releases now need a running Docker daemon when gateway/Dockerfile exists.

## Outcome

Done on branch `claude/task-42` (HEAD fb4435a, based on `origin/main` 0fa6581), 2026-10-14. Review round 1 found P1 (the build stage lacked the root devDependencies, so the image could not build), P2 (`/data/backups` did not exist, so the first backup failed) and P3 (the `HTTPS_PORT` knob breaks the public-URL Host check). All three were fixed in fb4435a and the re-review was clean with no drift.

Real Docker smoke test (Docker 29.4.0 on OrbStack, started with Andrew's approval):
- The build succeeded at 375 MB; `--version` printed 0.1.0; server mode was healthy with no stdin; `/data` is 0700 and owned by `node`.
- The compose stack on host ports 18480 and 18443 got a Caddy local certificate; `/status` was minimal; a fake bearer got 401; `--backup` worked through `compose exec`.
- A raw ws client paired over `wss://.../link` through Caddy and received a welcome.
- Cleanup was complete: no `ag-smoke` containers, images, volumes or networks remain.

`/verify`: tester PASS (`npm run verify` twice, 4,182 fast and 2,227 slow tests; `test:scripts` 34 including 3 docker-release; mcpb 6/6; `compose config -q` ok; the real gateway was untouched). Acceptance reviewer APPROVE.

Suggestions not fixed: the README's revoke, cancel and list bullets should each carry "(after task 68)"; `GATEWAY_VERSION` (the compose image tag) is undocumented; a Caddy healthcheck could reveal a stranded network namespace.

Notes: releases now need a running Docker daemon when `gateway/Dockerfile` exists. A `gateway-data` volume created before the P2 fix will not have `/data/backups`.

Pending (Andrew): the manual check on a real VPS.
