# 52 — Spike: Foundry file upload rules on v13 and v14

**Repo:** .
**Status:** Planned — do not start; queued after current workloads (32, 44, and the five gap tasks)
**Depends on:** none
**Owns:**
- spikes/image-upload/** (new; throwaway probe scripts and the findings file for the PR)

## Goal
Before the image upload tool (53) is designed, confirm on live v13 and v14 how a module can
upload a file as the calling user. The architect's assumptions about FilePicker are unverified.
This task writes no product code.

## Context
- protocol/src/link/messages.ts:9 sets `MAX_FRAME_BYTES = 1 MiB`. A base64 argument plus its envelope must fit inside it.
- protocol/src/tools/limits.ts sets the existing schema and result byte caps.
- module/src/audit/types.ts:66 limits audit args to 8000 characters, so the approval and audit views must not store the payload.
- docs/testing.md covers the v14 and v13 test beds.

## Acceptance (each answered with live evidence on v13.351 and v14.369)
- [ ] The FilePicker class path on each version: `foundry.applications.apps.FilePicker.implementation` versus the global `FilePicker`, and the `upload` signature and return shape.
- [ ] Which user permission gates upload (`FILES_UPLOAD`, `FILES_BROWSE`), whether the server enforces it for a player socket, and the default role grants.
- [ ] The server's allowed upload extensions and MIME checks, whether SVG is accepted, and the per-file size limits.
- [ ] Whether a module can create and target a fixed directory (e.g. `agent-gateway/uploads/<userId>/`) in the `data` source, and what happens on a name collision.
- [ ] Whether a ~700 KiB-raw base64 argument survives the gateway → link → module path under `MAX_FRAME_BYTES`, and the exact usable maximum.
- [ ] How approvals (module/src/approvals/) and audit store a large argument, and whether the payload must be replaced by a hash and size before it is queued.
- [ ] Whether Actor `img` and `prototypeToken.texture.src` updates by a player-owner go through the normal permission check.
- [ ] A findings file under spikes/image-upload/ with commands, versions and answers. The PR proposes task 53's final arguments and caps.

## Out of scope
- Any change under module/src, gateway/src or protocol/src
- MCP image content blocks
