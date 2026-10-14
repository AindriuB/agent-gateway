# 76 — Run behind an existing Caddy

**Repo:** .
**Depends on:** none
**Status:** Requested by Andrew on 2026-10-14, needed before the friend test. Written against main 334f8a8 (after 35, 67, 68, 74 and 42 merged). Its Owns are disjoint from 75 (`gateway/src/**`, `gateway/test/**`), so the two may run in parallel.
**Owns:**
- gateway/docker/compose.byo-caddy.yaml (new)
- gateway/docker/byo-caddy.Caddyfile (new)
- gateway/docker/README.md (insertions only: one new "Bring your own Caddy" section, plus at most one sentence in the intro pointing to it)
- gateway/docker/.env.example (insertions only: a commented-out block for the two variables below)
- scripts/test/docker-byo-caddy.test.mjs (new)

## Goal
An operator whose VPS already runs Caddy, either installed on the host or in its own container, can deploy the gateway without our bundled Caddy service. They get a gateway-only Compose file, a site block to paste into their own Caddyfile, and a README section that explains the two supported network setups, the one that does not work, and why.

## Context
- gateway/docker/compose.yaml:1-44: the bundled stack. Its `gateway` service (:7-24) has the image, build, environment and volume to copy. Caddy joins the gateway's network namespace (`network_mode: "service:gateway"`, :29). The ports are published on `gateway` (:22-24).
- gateway/docker/Caddyfile:1-14: the routing to mirror. `/link*` goes to 127.0.0.1:7420, and everything else goes to 127.0.0.1:7421.
- gateway/docker/.env.example:1-8: the variables the stack already reads.
- gateway/docker/README.md:1-91: the existing sections. "Pair each person" (:35-56), "Update", "Data and backup" and "Restore" all use plain `docker compose ...`, and must keep working unchanged for a BYO operator (see Decisions).
- gateway/Dockerfile:37-40: `EXPOSE 7420 7421`, and a HEALTHCHECK that fetches `http://127.0.0.1:7421/status` from inside the gateway's network namespace.
- gateway/src/http/client-key.ts:70-88: `X-Forwarded-For` is read only with `trustProxy`, and only when the TCP peer is loopback. This is the basis of "Why not a shared Docker network".
- gateway/src/http/server.ts:63-67,136,155 and gateway/src/http/public-url.ts: the Host header must match the public URL's host.
- gateway/src/config/index.ts:72-91: `normalizePublicUrl` accepts only a bare origin with no path, so the gateway cannot be mounted under a sub-path.
- gateway/src/oauth/consent/index.ts:32,133: the `__Host-agcsrf-` cookie (`Path=/`, no `Domain`), which is scoped to the whole host.
- scripts/test/docker-release.test.mjs:1-20,85-112: the test style to follow (`node:test`, `node:assert/strict`, repo root from `import.meta.url`). 42's tests do **not** run `docker compose config` and do not read the compose files, so this task's tests are static file checks and need no Docker.
- package.json:23: `npm run test:scripts` runs `scripts/test/*.test.mjs`. `npm run verify` does not run it.

## Decisions
- **Shape: one standalone, gateway-only Compose file, not an override of compose.yaml.** An override would have to delete the `caddy` service and the gateway's `ports:`, which needs Compose's `!reset` tags and a two-file `-f` invocation on every command. A standalone `compose.byo-caddy.yaml` is self-contained and readable on its own. The cost is a duplicated `gateway` service, and the test pins that duplication to compose.yaml (see Acceptance).
- **One file for both supported setups.** Use `network_mode: ${GATEWAY_NETWORK_MODE:-host}`. A host-installed Caddy leaves the variable unset. A containerised Caddy sets `GATEWAY_NETWORK_MODE=container:<caddy container name>`.
- **Same project name and volume.** Keep `name: agent-gateway` and the `gateway-data` volume, so an operator moving from the bundled stack keeps their database. Never run both files at once.
- **Selecting the file.** The README tells the operator to put `COMPOSE_FILE=compose.byo-caddy.yaml` in `.env`. Then every existing README command (`docker compose exec gateway <cli> --invite ...`, `--backup`, `up -d --build`, and so on) works unchanged, with no `-f`.
- **The site block is a fragment, not a whole Caddyfile.** It has no global options block, because the operator's Caddy already has one (and its ACME email). It uses a literal placeholder host, `gateway.example.com`, because a host Caddy will not have our `DOMAIN` variable. The file is named `*.Caddyfile` so Caddy's adapter and editors recognise it.

## Content the README section must cover
1. **Host-installed Caddy.** The gateway runs with `network_mode: host` and no `ports:`. It keeps its default 127.0.0.1 binding on 7420 and 7421, so nothing new is exposed, and those two host ports must be free. It keeps `AGENT_GATEWAY_PUBLIC_URL`, `AGENT_GATEWAY_TRUST_PROXY=1` and `AGENT_GATEWAY_ALLOW_ORIGIN`. Host networking works on a Linux host only (it does not work under Docker Desktop).
2. **Containerised Caddy.** Set `GATEWAY_NETWORK_MODE=container:<name>`, find the name with `docker ps`, and start Caddy first. The README must say that recreating the Caddy container (an image update, or `docker compose up` on Caddy's own stack) leaves the gateway in a dead network namespace, so the gateway then has to be restarted. The implementer checks whether `docker compose restart gateway` is enough or `docker compose up -d --force-recreate gateway` is needed, and documents the command that works.
3. **Why not a shared Docker network.** On a shared network Caddy reaches the gateway from a container IP, not from loopback. The gateway trusts `X-Forwarded-For` only from a loopback peer, so it ignores the header, and every client then shares one rate-limit bucket. Binding the gateway beyond 127.0.0.1 would also be needed, which this task does not want.
4. **A dedicated subdomain.** The gateway needs a host of its own (for example `gateway.example.com`), never a path under the Foundry host. There are three reasons: the public URL must be a bare origin, the gateway serves at the root (`/mcp`, `/authorize`, `/.well-known/...`, `/link`, `/status`), and the consent page's `__Host-` cookie is scoped to the whole host.
5. **Routing.** `/link*` goes to 127.0.0.1:7420, and everything else goes to 127.0.0.1:7421. Caddy's `reverse_proxy` handles the WebSocket upgrade with no extra configuration, and it sets `X-Forwarded-For` itself.
6. **Verifying with the CLI.** Run `docker compose ps` (the gateway shows "healthy") and `curl https://<domain>/status`. Then run `docker compose exec gateway foundry-agent-gateway --invite <world id> <user id>`, which works because `COMPOSE_FILE` is set. Finally, check that the gateway log does not contain `--trust-proxy is off`.

## Acceptance
- [ ] `gateway/docker/compose.byo-caddy.yaml` exists. It has `name: agent-gateway` and exactly one service, `gateway`. It has no `caddy` service, no `ports:` key and no `ACME_EMAIL`. Its network line is `network_mode: ${GATEWAY_NETWORK_MODE:-host}`. Its only volume is `gateway-data`, mounted at `/data` (test).
- [ ] Its `gateway` service's `image`, `build` (context and dockerfile), `restart` and every `environment` entry are textually identical to those of the `gateway` service in `gateway/docker/compose.yaml` (test compares the two files, so drift in either fails).
- [ ] Neither compose file sets `AGENT_GATEWAY_HTTP_HOST`, `AGENT_GATEWAY_LINK_HOST`, `AGENT_GATEWAY_HTTP_PORT` or `AGENT_GATEWAY_LINK_PORT` (test).
- [ ] `gateway/docker/byo-caddy.Caddyfile` contains one site block for `gateway.example.com` and no global options block (no `{` line before the site address, and no `email`). It contains `handle /link*` with `reverse_proxy 127.0.0.1:7420`, and a bare `handle` with `reverse_proxy 127.0.0.1:7421`. It contains no `header_up` and no `transport` (test).
- [ ] `gateway/docker/compose.yaml`, `gateway/docker/Caddyfile` and `gateway/Dockerfile` are unchanged (`git diff --stat origin/main -- gateway/docker/compose.yaml gateway/docker/Caddyfile gateway/Dockerfile` is empty).
- [ ] `gateway/docker/.env.example` gains commented-out `#COMPOSE_FILE=compose.byo-caddy.yaml` and `#GATEWAY_NETWORK_MODE=container:caddy` lines, each with a one-line comment. Every existing line is unchanged (test, plus the diff).
- [ ] `gateway/docker/README.md` has a `## Bring your own Caddy` heading. The test asserts that the section text includes `COMPOSE_FILE=compose.byo-caddy.yaml`, `network_mode: host`, `GATEWAY_NETWORK_MODE=container:`, `X-Forwarded-For`, `rate-limit`, `subdomain`, `__Host-`, `/link`, `7420`, `7421`, `WebSocket`, `docker compose exec gateway` and `--invite`. A reader can confirm that it covers all six points of "Content the README section must cover".
- [ ] The README's existing sections are byte-identical apart from the inserted section and at most one intro sentence (diff).
- [ ] The test file `scripts/test/docker-byo-caddy.test.mjs` uses `node:test` and needs no Docker or network. `npm run test:scripts` passes.
- [ ] `npm run verify` passes.
- [ ] Manual (Andrew, for the friend test): on his VPS's existing Caddy, he pastes the site block, sets `COMPOSE_FILE`, and runs `docker compose up -d --build`. The gateway is healthy, `curl https://<domain>/status` answers 200, an invite made with `docker compose exec gateway ... --invite` pairs a Foundry world over `wss://<domain>/link`, an MCP client completes the OAuth consent, and the log has no `--trust-proxy is off` line.

## For the scribe (not the implementer)
- At record time, docs/server-mode.md gets a one-line pointer in "The Compose stack" to `gateway/docker/README.md#bring-your-own-caddy`. The implementer does not edit `docs/`.

## Out of scope
- Any change to `gateway/src/**` or `gateway/test/**` (that is 75's territory), to the bundled `compose.yaml` or `Caddyfile`, or to the Dockerfile and its HEALTHCHECK.
- Moving the gateway off ports 7420 and 7421. The HEALTHCHECK hardcodes 7421, so it would break.
- Support for a shared Docker network, nginx, Traefik, Docker Desktop host networking, or mounting the gateway under a path.
- Running `docker compose config` in tests, or adding a YAML parser dependency.
- Installers, and publishing an image.
