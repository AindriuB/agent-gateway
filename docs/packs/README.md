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

The example provides `hello-dice_odds`, a pure read tool, and
`hello-journal_stamp`, an owned-journal write tool. It is a standalone example,
not part of the core release bundle. Enabling a pack means trusting its author
with the same browser access as any other Foundry module.
