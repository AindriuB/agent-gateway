# Claude Code plugin

The `foundry-gateway` plugin points Claude Code at the hosted gateway (`https://gw.aindriub.app/mcp`) and adds a short skill on working in a Foundry world. It carries no code and no secrets: the MCP entry is an HTTP URL, and sign-in is OAuth. The plugin source is `plugins/claude/foundry-gateway/`. The repository is private, so installing from the repo needs a GitHub login that can read it.

## Install

There are two routes. Use whichever Claude Code can reach.

From the repository marketplace:

```
/plugin marketplace add AindriuB/agent-gateway
/plugin install foundry-gateway@agent-gateway
```

From the hosted marketplace, which needs no GitHub access:

```
/plugin marketplace add https://dl.aindriub.app/claude/marketplace.json
/plugin install foundry-gateway@aindriub-dl
```

Updates arrive only when the plugin version changes, which every release does (`bump-version` sets it).

## Sign in

Run `/mcp` in Claude Code, pick `agent-gateway` and authenticate, or run `claude mcp login agent-gateway`. Your browser opens the gateway's consent page, where you choose what Claude may do as your Foundry user. Approving returns you to Claude Code. To cut Claude off, revoke the grant under Connected apps in Foundry's Agent Gateway settings. To drop the local credentials, log out from `/mcp`.

## Pointing at another gateway

The MCP URL is `${AGENT_GATEWAY_URL:-https://gw.aindriub.app}/mcp`. Set `AGENT_GATEWAY_URL` (scheme and host, no trailing `/mcp`) in the environment Claude Code starts in to use a different deployment.

## Building and uploading the hosted copy

```
node scripts/build-claude-plugin.mjs --base-url https://dl.aindriub.app/claude
```

This writes `dist/release/claude/plugins/foundry-gateway-<version>.zip` and `dist/release/claude/marketplace.json`, whose marketplace is named `aindriub-dl` and whose entry uses an archive source with the zip's sha256. Upload both under the base URL, keeping the relative layout, and upload the zip first, so the marketplace never points at a missing file. The zip is not reproducible (file mtimes differ per build), so always upload a zip and the marketplace built together; mixing a new marketplace with an old zip fails the sha256 check. The build refuses symlinked plugin files, an invalid version, and a base URL that is not plain https.

The same zip is accepted by claude.ai "Upload plugin"; that path has not been tried.

## Fallback: claude.ai custom connector

If the plugin cannot be used, add a custom connector in claude.ai with URL `https://gw.aindriub.app/mcp` and choose Register automatically. You get the tools without the skill.

## What was verified

Automated, on 2026-10-14: the plugin and marketplace contract tests and the build script tests pass; `claude plugin validate --strict` ran and passed on both the repo and the hosted marketplace. The hosted files at `https://dl.aindriub.app/claude/` were built from `5fa4da5` (zip sha256 starting `4730657a`), replacing an earlier hand-built upload.

Not yet verified, pending a live Claude Code run by Andrew: adding the marketplace and installing, the `/mcp` OAuth flow and which scopes Claude Code requests (if it asks for read only, writes cannot be approved and that must be reported), listing tools, one read, one approved write, revocation and logout. Loading the plugin in claude.ai chat is also unverified.

Known limits of the build script: a symlinked plugin root is followed; there is a window between the file check and the copy; a bare `?` or `#` on the base URL is silently dropped.
