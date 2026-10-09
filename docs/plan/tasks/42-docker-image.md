# 42 — Add the server-mode Docker image

**Repo:** .
**Depends on:** 38, 41
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

## Acceptance
- [ ] Multi-stage Dockerfile on a Node LTS slim base with Chromium for headless; runs as a non-root user; data dir is a volume; config via env and a mounted 0600 file
- [ ] `docker build` and a smoke run (`--version`, `/status` over HTTP) succeed locally on the homelab; PR includes output
- [ ] Release script builds and tags the image locally; push step is behind a flag and prints "registry not configured" until Andrew decides GHCR vs Docker Hub
- [ ] `docs/server-mode.md` covers compose example, volumes, ports, OAuth public URL and headless setup

## Out of scope
- Choosing or configuring the registry
- Homelab compose wiring (homelab repo)
