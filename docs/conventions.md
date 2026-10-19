# Conventions

Code style: TypeScript strict, ESM, Prettier (`.prettierrc`) and ESLint (`eslint.config.js`). One shared version (`0.1.0`) across `module.json`, root and every workspace `package.json`.

## Directory layout

- `protocol/src/link/` link messages (`messages.ts`, `index.ts`); `protocol/src/tools/` tool schemas (zod), `index.ts` re-exports.
- `module/src/` Foundry module: `main.ts`, `tools/`, `ops/` (`stages.ts`), `settings/`, `adapters/` (system adapter registry), `ui/` apps.
- `gateway/src/` Node gateway: `bin/cli.ts`, `store/` (with `migrations/`), transport, auth, runner.
- Root: `module.json`, `lang/en.json`, `styles/agent-gateway.css`, `templates/`, `dist/module/main.js` (build output).

## Tests

`<workspace>/test/<area>/**` (e.g. `gateway/test/store/foo.test.ts`). Foundry API stubs live in `module/test/stubs/**`.

### Test suites

Tests are split into fast and slow. Slow tests (scaling oracles, min-of-runs timing tables, full oracle sweeps) are named `*.slow.test.ts` and run in their own vitest project (`module-slow`, `module/vitest.slow.config.ts`). `npm test` runs the fast suites only; `npm run test:slow` runs the slow ones; `npm run verify` runs both, then the offline e2e harness tests (`npm run test:e2e-unit`) and the type check of `e2e/` (`npm run typecheck:e2e`), then the script tests (`npm run test:scripts`), and is the gate. When a slow oracle is added, keep a representative fast sample of it in the fast suite so ordinary runs still catch regressions.

In a fresh worktree run `npm ci` before `npm run verify`. Without its own `node_modules`, `@agent-gateway/protocol` resolves from the main checkout's possibly stale build and verify fails with unrelated TypeScript errors.

## Ports

- Link WebSocket (module to gateway): `7420`
- Local HTTP (MCP, bound to `127.0.0.1`): `7421`

## i18n

All UI strings in `lang/en.json`, keys prefixed `AGENT_GATEWAY.<Area>.*`.

## Shared insertion-only files

Several tasks edit these in parallel. Only insert; never reorder, reformat or delete others' lines.

- `lang/en.json`
- `protocol/src/tools/index.ts`
- `protocol/src/link/messages.ts`
- `module/src/tools/index.ts`
- `module/src/ops/stages.ts`
- `module/src/settings/index.ts`
- `module/src/adapters/index.ts` (adapter registry)
- `module/test/stubs/**`
- `module.json` (`documentTypes` only)
- `styles/agent-gateway.css` (one section per app)
- workspace `package.json` dependency blocks
- root `package.json` `scripts`
- `gateway/src/store/migrations/` (one new file per task, renumbered at merge if two land together)
- `package-lock.json`

## Pull requests

One task = one PR to `main`. The description gives what and why, the acceptance items met, and test evidence on Foundry v14 and v13 (v13 marked "pending homelab instance" until it exists).
