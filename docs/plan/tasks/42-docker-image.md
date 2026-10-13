# 42 — Add the server-mode Docker image

**Repo:** .
**Depends on:** 38, 35, 64
**Status:** MVP B (after A). B order 5.
**Owns:**
- gateway/Dockerfile
- gateway/.dockerignore
- gateway/docker/**
- scripts/release.mjs (Docker build step only)
- docs/server-mode.md

## Goal
Package the gateway for server mode next to a self-hosted Foundry: an image that
runs always-on with headless support and persistent SQLite storage. Build it
locally; the registry is not yet chosen.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:48-56 — server mode
- docs/plan/specs/2026-10-09-agent-gateway.md:188-190 — Docker image, registry to confirm (GHCR vs Docker Hub)
- gateway/src/headless/** (37, 38)
- docs/plan/tasks/36-consent-and-revocation.md — `--server-mode` flag and server-mode pairing confirmation

## Acceptance
- [ ] Multi-stage Dockerfile on a Node LTS slim base with Chromium for headless; runs as a non-root user; data dir is a volume; config via env and a mounted 0600 file
- [ ] `docker build` and a smoke run (`--version`, `/status` over HTTP) succeed locally on the homelab; PR includes output
- [ ] Release script builds and tags the image locally; push step is behind a flag and prints "registry not configured" until Andrew decides GHCR vs Docker Hub
- [ ] The image's default command runs the gateway with `--server-mode`; the smoke run's startup log or `/status` shows server mode is on (output in PR)
- [ ] `docs/server-mode.md` covers compose example, volumes, ports, OAuth public URL and headless setup, and states that the image runs with `--server-mode`, so first pairings and re-pairings need confirmation in the paired user's Foundry client (or GM approval)

## Out of scope
- Choosing or configuring the registry
- Homelab compose wiring (homelab repo)

## MVP split (2026-10-13)
Depends was `38, 41, 36`. 41's MVP A scope moved to 64, which creates `scripts/release.mjs`. 36 is deferred beyond B, so the two `--server-mode` acceptance items and the server-mode pairing statement in `docs/server-mode.md` cannot be met in B as written. Andrew decides: hold those items for 36, or keep 36's server-mode pairing confirmation in B. Until then, an image that many players reach has no defence against a player pairing as another user.
