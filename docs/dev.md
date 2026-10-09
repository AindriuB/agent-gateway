# Local development

Requires Node >= 22.13 (`engines.node`), because the gateway uses the built-in `node:sqlite`.

## Loop

1. Install: `npm ci` (or `npm install` when changing dependencies).
2. Build: `npm run build` (all workspaces), or `npm run build -w module`. Watch the module with `npm run watch -w module`.
3. Link into Foundry: `/home/andrew/homelab/bin/foundry-link agent-gateway`. The repo root is the module folder (`module.json` is at the root); Foundry loads `dist/module/main.js`.
4. Enable: reload https://foundry.local setup, open `test-world`, Settings > Manage Modules, enable Agent Gateway. The browser console shows `agent-gateway | loaded` on `init`.
5. Run the gateway: `npm run build -w gateway`, then `npm exec -w gateway foundry-agent-gateway -- --version` (or `node gateway/dist/bin/cli.js`).

`npm run verify` builds, lints and tests everything. There is no CI; run it before merging.
