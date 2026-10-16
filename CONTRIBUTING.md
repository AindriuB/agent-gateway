# Contributing

Thanks for helping with Agent Gateway. Please read the [code of conduct](CODE_OF_CONDUCT.md) first. To report a vulnerability, follow [SECURITY.md](SECURITY.md) and do not open a public issue.

## Prerequisites

Node 22.13 or newer (`engines.node` in `package.json`) and npm.

```
npm ci
npm run build
npm test
npm run test:slow
npm run verify
```

`npm run verify` is the gate. It builds, lints, runs the fast and slow test suites, then the script tests. A change is ready when `npm run verify` passes. Run `npm ci` first.

## Tests

Tests are split into fast and slow suites. Slow tests (scaling oracles, timing tables, full oracle sweeps) are named `*.slow.test.ts` and run in their own vitest project. `npm test` runs the fast suites; `npm run test:slow` runs the slow ones. When you add a slow oracle, keep a small representative sample of it in the fast suite so ordinary runs still catch regressions.

Test files live in `<workspace>/test/<area>/**`, for example `gateway/test/store/foo.test.ts`. Foundry API stubs live in `module/test/stubs/**`.

The live end-to-end tests need a running Foundry instance and are not required for an outside pull request. Say in the PR if you tried your change against a real Foundry version.

## Layout

- `protocol/src/link/` link messages; `protocol/src/tools/` tool schemas (zod), re-exported from `index.ts`.
- `module/src/` the Foundry module: `main.ts`, `tools/`, `ops/`, `settings/`, `adapters/` (game system adapters), `apps/` (application windows).
- `gateway/src/` the Node gateway: `bin/cli.ts`, `store/` (with `migrations/`), transport, auth and the headless runner.
- Root: `module.json`, `lang/en.json`, `styles/agent-gateway.css`, `templates/`, and `dist/module/main.js` (build output).

Ports: the link WebSocket (module to gateway) is `7420`, and the local HTTP MCP endpoint, bound to `127.0.0.1`, is `7421`.

## Code style

TypeScript strict, ESM, formatted with Prettier (`.prettierrc`) and checked by ESLint (`eslint.config.js`). `npm run lint` runs both.

All UI strings go in `lang/en.json`, with keys prefixed `AGENT_GATEWAY.<Area>.*`.

The whole project shares one version. `module.json` and every `package.json` carry the same number, and `npm run bump-version` changes them together. Do not edit the version by hand in a feature PR.

## Pull requests

- Fork the repository and open the pull request against `main`. Do not push to `main`.
- One change per pull request.
- Say what changed and why, which tests you ran, and the result of `npm run verify`.
- Do not add copyrighted rulebook text, premium content or other licensed material, and do not commit secrets, tokens or personal paths.
- Add or update tests for behaviour you change.

Pull requests from forks get the CI checks. They run without access to repository secrets, so a check that needs a secret will not run for a fork.
