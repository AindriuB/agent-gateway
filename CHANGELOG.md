# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.4.0] - Unreleased

### Added

- `image_upload` tool: an agent can upload an image into the world's Data folder, with a size quota, an approval step that does not show the raw image data, and a folder allowlist.
- `image_assign` tool: list existing Data images and set them on actors, tokens, items and scene backgrounds, with Undo for each target and the same folder allowlist.
- Image content now travels from module tool results through the gateway to MCP clients.
- Gateway protocol 7.1.0.

### Changed

- The OAuth consent page leaves the "destructive" and "code" scopes unticked by default.
- Offline-queue replies name the world and user and say what to do next.
- The pairing window says plainly when the browser is not paired, and collapses operator ids under a details block.
- An admin GM is told when an invite needs them online, and sees whether a vouch was confirmed or the link is not connected.
- Link closes record why they happened (`heartbeat-timeout` or `socket-error`).

### Notes

- The image tools are still being added; this entry will be completed at release time.

## Earlier releases

### 0.3.0

- Admin GMs get a "Manage access" window to create and cancel player invites and to revoke pairings.
- Admin GMs can list and revoke the OAuth apps each paired user has authorized.
- Headless agents are stored by the gateway and managed with `headless add`, `list` and `remove`.
- OAuth consent for a headless agent goes to its owner, and the grant ends when the agent is re-paired.
- New guides for remote, server-mode and headless setups.

### 0.2.0

- GM-vouched pairing: a player invite is completed once an admin GM confirms who the player is.
- Operator commands `--invite --admin`, `--gm` and `--demote` for pairing without a vouch.
- Admin GMs can create, list and cancel player invites from inside Foundry.
- Fixes the "too many sessions" errors for remote MCP clients by evicting idle sessions at the cap.

### 0.1.1

- Pairing credentials are kept per gateway, world and Foundry user in the browser, so switching users no longer sends or removes another user's credential.
- An "Unpair this browser" button.
- The module shows link status in the Players list and retries when the browser comes back online.
- Clearer messages when pairing is rejected.

### 0.1.0

- First release: the Foundry module, the gateway, and a Claude Desktop bundle.
- Local setup with zero-config pairing bound to the browser origin.
- Streamable HTTP endpoint on `127.0.0.1` for Claude Code and similar clients.
- Tools for documents, compendia, rolls, chat, combat, scenes, tokens, journals and macros, with approval and Undo.
- System adapters for dnd5e and pf2e.
