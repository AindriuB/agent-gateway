# 01 — Scaffold the npm workspace, root manifest and conventions

**Repo:** .
**Depends on:** none
**Owns:**
- package.json
- package-lock.json
- tsconfig.base.json
- eslint.config.js
- .prettierrc
- .gitignore
- vitest.workspace.ts
- module.json
- lang/en.json
- styles/agent-gateway.css
- templates/.gitkeep
- LICENSE
- README.md
- docs/conventions.md
- docs/dev.md
- protocol/package.json
- protocol/tsconfig.json
- protocol/src/index.ts
- protocol/src/link/index.ts
- protocol/src/tools/index.ts
- module/package.json
- module/tsconfig.json
- module/vite.config.ts
- module/src/main.ts
- gateway/package.json
- gateway/tsconfig.json
- gateway/src/bin/cli.ts

## Goal
Lay down the repo shape every later task builds on: npm workspaces `protocol/`,
`module/` and `gateway/`, a `module.json` at the repo root with id
`agent-gateway` so `/home/andrew/homelab/bin/foundry-link agent-gateway` works, and
one `npm run verify` that builds, lints and tests everything locally (no CI). Also
write the conventions file that fixes directory layout and the shared
insertion-only files, so parallel tasks do not collide.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:92-104 — repo layout, workspaces, zod schemas in `protocol/`
- docs/plan/specs/2026-10-09-agent-gateway.md:7-21 — `minimum: 13`, `verified: 14`, MIT, free
- docs/plan/specs/2026-10-09-agent-gateway.md:180-201 — single version number across module, gateway and protocol
- /home/andrew/homelab/bin/foundry-link — requires `module.json` at the folder root
- /srv/dev/projects/foundry-modules/README.md — how Foundry mounts this folder (`/dev-modules/agent-gateway`)

## Acceptance
- [ ] `module.json` at repo root: `"id": "agent-gateway"`, `compatibility.minimum` "13", `compatibility.verified` "14", `"socket": true`, `esmodules: ["dist/module/main.js"]`, `styles: ["styles/agent-gateway.css"]`, `languages` pointing at `lang/en.json`, `license` "MIT", manifest URL `https://github.com/AindriuB/agent-gateway/releases/latest/download/module.json`
- [ ] Root `package.json` declares workspaces `protocol`, `module`, `gateway`, one shared `version` (`0.1.0`) matching `module.json` and every workspace `package.json`; `gateway/package.json` `name` is `foundry-agent-gateway`
- [ ] Foundation dependencies installed once here so wave-2/3 tasks need not touch lockfiles: `zod` v4 (protocol), `@modelcontextprotocol/sdk` and `ws` (gateway), `typescript`, `vitest`, `vite`, `eslint`, `prettier`, `@types/ws`, `@types/node` (dev)
- [ ] `engines.node` set to a version with built-in `node:sqlite` (>=22.13), stated in `docs/dev.md`
- [ ] `npm ci && npm run verify` exits 0 on a clean checkout (placeholder sources compile; vitest runs with zero or trivial tests)
- [ ] `npm run build -w module` writes `dist/module/main.js`, which logs `agent-gateway | loaded` on Foundry `init`; after `foundry-link agent-gateway` and enabling it in `test-world` on https://foundry.local the line appears in the browser console (screenshot or console paste in the PR)
- [ ] `npx foundry-agent-gateway --version` (via `npm exec -w gateway`) prints `0.1.0`
- [ ] `docs/conventions.md` lists: directory layout per workspace (as used by tasks 02-43), test locations (`<workspace>/test/<area>/**`), the default link WebSocket port and default local HTTP port, i18n key prefix `AGENT_GATEWAY.<Area>.*`, and the **shared insertion-only files**: `lang/en.json`, `protocol/src/tools/index.ts`, `protocol/src/link/messages.ts`, `module/src/tools/index.ts`, `module/src/ops/stages.ts`, `module/src/settings/index.ts`, `module/src/adapters/index.ts` (adapter registry), `module/test/stubs/**`, `module.json` (`documentTypes` only), `styles/agent-gateway.css` (one section per app), workspace `package.json` dependency blocks, root `package.json` `scripts`, `gateway/src/store/migrations/` (one new file per task, renumbered at merge if two land together), and `package-lock.json`
- [ ] `docs/conventions.md` states the PR rule: one task = one PR to `main`, description gives what/why, acceptance items met, and test evidence on v14 and v13 (v13 marked "pending homelab instance" until it exists)
- [ ] `docs/dev.md` gives the local loop: install, build/watch, foundry-link, enable in `test-world`, run gateway
- [ ] `LICENSE` is MIT, copyright Andrew Bannister; README links the spec and `docs/dev.md`

## Out of scope
- Any protocol message, tool, compat or link code (02-08)
- Release, zip or `.mcpb` packaging (41)
- Creating the homelab Foundry v13 instance (homelab repo, outside this plan)
