# History index

One row per `## YYYY-MM-DD` entry in `HISTORY.md`, newest first. Only `scribe`
edits this file, and it writes the row in the same commit as the entry.

`HISTORY.md` grows without bound and is the single largest file a session can
accidentally load. This index exists so `planner` can answer "has this been
built before, and where do I read about it?" without opening it. Rows are taken
from `HISTORY.md`'s own headings rather than re-summarized, so the index can be
checked against its source by eye.

Read a full entry by grepping the exact string in the **Heading** column:

```
grep -n '<heading text>' docs/plan/HISTORY.md
```

Then read that section only. A stale index is worse than none — an entry with
no row is one `planner` cannot find, and will re-plan.

| Date | Task IDs | Summary | Heading (grep this exact string) |
|---|---|---|---|
| 2026-10-10 | 10b | spike: Foundry module sockets attest the sender (server-appended user id); recommendation for task 36 | ## 2026-10-10 — Spike 10b: Foundry socket identity (task 10b) |
| 2026-10-09 | 08 | module operation registry (handlers, staged dispatcher, error mapping), document serialiser, paging, DOMParser HTML-to-markdown with link safety | ## 2026-10-09 — Module operation registry and document-to-markdown conversion (task 08) |
| 2026-10-09 | 07 | module LinkClient (hello, token, backoff, pairing errors) and ApplicationV2 pairing app from settings menu | ## 2026-10-09 — Module LinkClient and pairing app (task 07) |
| 2026-10-09 | 06 | gateway link server on loopback, Origin allowlist, pairing codes, hashed tokens, link registry, heartbeat | ## 2026-10-09 — Gateway link server and pairing (task 06) |
| 2026-10-09 | 05 | gateway config, logger, stdio MCP server with empty tool registry | ## 2026-10-09 — Gateway skeleton and stdio MCP server (task 05) |
| 2026-10-09 | 04 | module skeleton, v13/v14 compat layer, settings registry, Foundry stubs | ## 2026-10-09 — Module skeleton and v13/v14 compat layer (task 04) |
| 2026-10-09 | 03 | tool definition framework, JSON Schema generation, conservative-schema tests | ## 2026-10-09 — Tool definition framework (task 03) |
| 2026-10-09 | 02 | link protocol messages, error codes, version handshake | ## 2026-10-09 — Link protocol and version handshake (task 02) |
| 2026-10-09 | 01b | test.projects wiring, per-workspace test scripts, module types [], fsevents allowScripts | ## 2026-10-09 — Workspace test wiring and scaffold follow-ups (task 01b) |
| 2026-10-09 | 01 | npm workspace scaffold, module.json, verify script, conventions | ## 2026-10-09 — Workspace scaffold (task 01) |
