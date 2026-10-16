# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.4.0] - Unreleased

### Added

- `image_upload` tool: an agent can upload a PNG, JPEG or WebP image into the world's Data folder. Uploads have a per-user size quota and need approval, and the approval prompt doesn't show the raw image data.
- `image_view` tool: an agent can look at an image from the world (an Actor portrait, token art, a scene background or a Data file). It is downscaled to fit, and it follows Foundry's visibility rules and the folder allowlist.
- `image_assign` tool: list existing Data images and set them on Actors, tokens, tiles and scene backgrounds, with Undo for each change. Uses the same folder allowlist.
- Image content now travels from module tool results through the gateway to MCP clients.
- Pending approvals now survive a logout, a reconnect, a tab being replaced and a gateway restart. A caller that asks after the requester has gone gets the recorded result.
- The active GM's client creates each user's upload folder (`agent-gateway/uploads/<user id>`) for every user who has the "Upload files" permission. Foundry lets only Assistant GMs and GMs create folders.
- Gateway protocol 7.2.0.

### Changed

- The OAuth consent page leaves the "destructive" and "code" scopes unticked by default.
- Offline-queue replies name the world and user and say what to do next.
- The pairing window says plainly when the browser is not paired, and collapses operator ids under a details block.
- An admin GM is told when an invite needs them online, and sees whether a vouch was confirmed or the link is not connected.
- Link closes record why they happened (`heartbeat-timeout` or `socket-error`).

### Fixed

- Players can now use `image_upload`. Before this, a player was always refused because Foundry would not let them create the upload folder.
- On Foundry v14, `image_view` and `image_assign` read a scene's background from its starting Level, the same Level `image_upload` writes to, instead of the deprecated `Scene#background`. A scene with no background now gets a clear error.

### Upgrade notes

- Update the module and the gateway together. Approval persistence needs both on 0.4.0. An older module or gateway keeps working with the previous approval behaviour.
- For players to upload images, give them both "Upload files" and "Browse file explorer". Then have a GM load the world once, so their upload folder is created. Don't mark the `agent-gateway` folder private.

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
- The gateway accepts invite create, list and cancel requests from an admin GM's link (the window for this arrived in 0.3.0).
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
