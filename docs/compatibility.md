# Compatibility matrix

Automated conformance: `scripts/conformance.sh` runs the MCP Inspector CLI
(pinned version in the script) against the built gateway over stdio, with a
fake module connected: `tools/list` plus one `tools/call` that round-trips
through the link. It uses a temp `HOME`, a temp database and a non-default link
port. `gateway/test/conformance/schemas.test.ts` checks every emitted tool
schema (object type, `additionalProperties: false`, no `$ref`) and every tool
name (`^[a-zA-Z0-9_-]{1,64}$`, at most 36 characters).

| Client         | stdio                                 | `.mcpb` | Local HTTP                            | OAuth                                 |
| -------------- | ------------------------------------- | ------- | ------------------------------------- | ------------------------------------- |
| Claude Desktop | MVP A                                 | MVP A   | not supported in this release (MVP B) | not supported in this release (MVP B) |
| Claude Code    | MVP A                                 | n/a     | MVP A                                 | not supported in this release (MVP B) |
| claude.ai      | not supported in this release (MVP B) | n/a     | not supported in this release (MVP B) | not supported in this release (MVP B) |
| ChatGPT        | not supported in this release (MVP B) | n/a     | not supported in this release (MVP B) | not supported in this release (MVP B) |
| Gemini CLI     | not supported in this release (MVP B) | n/a     | not supported in this release (MVP B) | not supported in this release (MVP B) |
| Gemini app     | not supported in this release (MVP B) | n/a     | not supported in this release (MVP B) | not supported in this release (MVP B) |

## Per-release manual checklist (MVP A rows)

Run for each release candidate, against a test world, and record the result.

Claude Desktop (stdio, then again from the `.mcpb` bundle):

- [ ] The server starts and shows as connected; no error in the client log.
- [ ] The pairing code appears in the gateway's stderr and the module pairs.
- [ ] The tool list shows the expected core tools for the paired user's role.
- [ ] A read tool call returns a sensible result from Foundry.
- [ ] A write tool call is held for approval in Foundry; nothing changes until approved.
- [ ] Quitting the client stops the gateway process.

Claude Code (stdio):

- [ ] `claude mcp add` with the gateway command connects; `/mcp` shows it healthy.
- [ ] Tool names appear as `mcp__<server>__<tool>` and none is truncated or rejected.
- [ ] A read tool call and a write tool call behave as above.
- [ ] Ending the session stops the gateway process.

Claude Code (Local HTTP):

- [ ] `claude mcp add --transport http` with `http://127.0.0.1:7421/mcp` and the bearer header connects; `/mcp` shows it healthy.
- [ ] A read tool call works over HTTP; a request without the token is refused with 401.
