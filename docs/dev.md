# Local development

Requires Node >= 22.13 (`engines.node`), because the gateway uses the built-in `node:sqlite`.

## Loop

1. Install: `npm ci` (or `npm install` when changing dependencies).
2. Build: `npm run build` (all workspaces), or `npm run build -w module`. Watch the module with `npm run watch -w module`.
3. Link into Foundry: make the repo root appear as `Data/modules/agent-gateway` in your Foundry data directory, either with a symlink (`ln -s /path/to/agent-gateway <FoundryData>/Data/modules/agent-gateway`) or by copying the built tree. The repo root is the module folder (`module.json` is at the root); Foundry loads `dist/module/main.js`, so build before you reload. To deploy an update to another machine, `git fetch`, fast-forward or check out the branch under test, and run `npm run build` (all workspaces; `-w module` alone fails because the protocol package must build first). Clients reload to load the new bundle.
4. Enable: open your Foundry setup page (for example `https://foundry.example` or `http://localhost:30000`), launch a test world, go to Settings > Manage Modules, and enable Agent Gateway. The browser console shows `agent-gateway | loaded` on `init`.
5. Run the gateway: `npm run build -w gateway`, then `npm exec -w gateway foundry-agent-gateway -- --version` (or `node gateway/dist/bin/cli.js`).

`npm run verify` builds, lints and tests everything. CI runs `npm run verify` on pull requests; running it locally before you push is still expected.
