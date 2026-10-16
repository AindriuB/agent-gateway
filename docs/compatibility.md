# Compatibility matrix

Automated conformance: `scripts/conformance.sh` runs the MCP Inspector CLI
(pinned version in the script) against the built gateway over stdio, with a
fake module connected: `tools/list` plus one `tools/call` that round-trips
through the link. It uses a temp `HOME`, a temp database and a non-default link
port. `gateway/test/conformance/schemas.test.ts` checks every emitted tool
schema (object type, `additionalProperties: false`, no `$ref`) and every tool
name (`^[a-zA-Z0-9_-]{1,64}$`, at most 36 characters).

The same script then runs an OAuth mode: it starts the gateway with
`--public-url http://127.0.0.1:<free port>`, registers a client, authorizes
through the consent page (the fake module receives the consent code over the
link and the script submits it with the CSRF token), exchanges the code, and runs
the Inspector CLI `tools/list` and one `tools/call` with the access token. A
static bearer against that gateway must get 401. The final line names the modes
that ran, `oauth` among them.

The script retries an Inspector call, up to four attempts with a 1.1 s pause,
when the gateway answers its per-client rate limit with `too many requests`;
any other failure fails at once.

| Client         | stdio                                 | `.mcpb` | Local HTTP                            | OAuth                                 |
| -------------- | ------------------------------------- | ------- | ------------------------------------- | ------------------------------------- |
| Claude Desktop | MVP A                                 | MVP A   | not supported in this release (MVP B) | not supported in this release (MVP B) |
| Claude Code    | MVP A                                 | n/a     | MVP A                                 | not supported in this release (MVP B) |
| claude.ai      | not supported in this release (MVP B) | n/a     | not supported in this release (MVP B) | MVP B (manual checklist)              |
| ChatGPT        | not supported in this release (MVP B) | n/a     | not supported in this release (MVP B) | developer-mode connector (0.3.0)      |
| Gemini CLI     | not supported in this release (MVP B) | n/a     | not supported in this release (MVP B) | MVP B (manual checklist)              |
| Gemini app     | not supported in this release (MVP B) | n/a     | not supported in this release (MVP B) | MVP B (manual checklist)              |

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

## Per-release manual checklist (remote clients, OAuth)

Run for each release candidate against a test world, with the gateway reachable
through its public HTTPS URL (`--public-url`). Record the result and the client
version. Each client needs the account named; these cannot run in CI.

The steps are the same for each client:

1. Connect the client to `https://<public host>/mcp`; it discovers OAuth and registers itself.
2. On the consent page, name the world and the Foundry user, choose scopes, and enter the code shown in that user's Foundry window; the client reports it is connected.
3. One read call returns a sensible result from Foundry.
4. One write call is held for approval in Foundry; nothing changes until approved.
5. Revoke the grant from Foundry; the next call from the client gets 401 and the client asks to reconnect.

claude.ai (custom connector, Claude account):

- [ ] Connect through the public URL and complete consent.
- [ ] One read call works.
- [ ] One write call is held for approval.
- [ ] Revoke from Foundry; the next call gets 401.

ChatGPT (developer mode connector, ChatGPT account; connect and consent confirmed live 2026-10-16 on gateway 0.3.0, the other steps not individually recorded):

- [x] Connect through the public URL and complete consent.
- [ ] One read call works.
- [ ] One write call is held for approval.
- [ ] Revoke from Foundry; the next call gets 401.

Gemini CLI (`gemini mcp add` with the public URL):

- [ ] Connect through the public URL and complete consent.
- [ ] One read call works.
- [ ] One write call is held for approval.
- [ ] Revoke from Foundry; the next call gets 401.

Gemini app (Google account):

- [ ] Connect through the public URL and complete consent.
- [ ] One read call works.
- [ ] One write call is held for approval.
- [ ] Revoke from Foundry; the next call gets 401.
