# Authoring tool packs

A tool pack is a separate Foundry module that registers AI tools with Agent
Gateway. The core module, gateway and pack API remain free and MIT-licensed.
Authors may distribute free or paid packs independently; the core performs no
licensing checks.

Start with [the hello pack](../../examples/hello-pack/README.md), then read the
[API](api.md), [naming rules](naming.md), [security model](security.md) and
[categories](categories.md). Use [testing](testing.md) before distributing a
pack. [Versioning](versioning.md) describes compatibility; [distribution](distribution.md)
covers the separate publishing responsibilities.

The example provides `hello-dice_odds`, a pure read tool with 1–20 dice, 2–100 sides and an integer target of 1–2001,
and `hello-journal_stamp`, an owned-journal write tool for HTML text pages
(`text.format === 1`). It is a standalone example,
excluded from the core release packaging contract. Enabling a pack means trusting its author
with the same browser access as any other Foundry module.
