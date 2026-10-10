# Hello Pack

A free, MIT licensed Foundry v13/v14 example module with no build step.
Install this directory as `Data/modules/agent-gateway-hello-pack`, enable Agent
Gateway and Hello Pack in your world, and relaunch the world.

`hello-dice_odds` computes the probability of a sum at least a target for up to
20 dice with 2–100 sides and an integer target from 1 to 2001. `hello-journal_stamp` appends an escaped timestamped
line of 1–2000 characters to an HTML text page (`text.format === 1`); both the
page and its parent journal must be owned by the calling user. Non-HTML text
pages are refused. The tool requires normal write approval
and records the snapshot for audit and undo. Audit journals are refused.

Journal stamps resolve the canonical page UUID and queue each page's fresh
read, permission check, snapshot and update within this browser's pack instance.
Aliases for the same page share the queue; different pages can proceed in
parallel. At most 64 calls may be outstanding across the instance, including
identity resolution. Overflow returns `FORBIDDEN`; failures release their turn
and idle queue entries are removed.

This queue coordinates only this browser instance. Concurrent stamps from
other browsers and manual edits are not atomic with its read/update sequence;
those edits can still race. The example provides no world-wide lock or
cross-browser transaction guarantee.

The core release packaging contract excludes this directory; the release
builder is a later task. See [the pack API](../../docs/packs/api.md)
and [testing guide](../../docs/packs/testing.md) before adapting it.
