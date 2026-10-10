# Testing a pack

Start offline: validate every definition with `checkToolDefinition(def, 'pack')`
from `@agent-gateway/protocol`, passing the full namespaced name and pack
metadata. Test each handler with a frozen context and bounded arguments. A
handler test should inspect the result's structured schema and permission
behavior, not only its text.

For a write handler, provide spies for `snapshot`, `created`, `intendCreate`
and document mutation methods. Verify the correct calling user's permissions,
that a snapshot completes before an update/delete, and that mutations receive
`callOptions`. Test non-owners, missing documents, hostile text and a non-HTML text page
(`text.format !== 1`). The hello pack refuses that page rather than appending
HTML to a different text format. Approval
alone must not make a non-owner able to modify a document.

Use the hello pack's tests under `module/test/packs/example/` as the integration
reference: import the actual ESM module with stubbed Foundry globals, register
through the real public API and dispatch through the shared pipeline. Test that
a disabled module registers nothing, a write reaches approval, and
`hello-dice_odds` for two six-sided dice at target seven returns `21/36`.

For journal concurrency, resolve aliases to a canonical UUID before choosing a
per-page queue. Read the page again and check permissions inside the queued
turn, then await its snapshot and update before releasing the turn. The hello
pack limits outstanding calls across its browser instance to 64, counting
identity resolution; overflow returns `FORBIDDEN`. Its tests cover same-page
alias serialization, different-page parallelism, overflow, failure release and
idle queue cleanup. This browser-local coordination does not make edits from
other browsers or manual updates atomic; do not report it as world-wide
protection.

```sh
npx vitest run --project module module/test/packs/example
npx eslint examples
npm run verify
```

## Live example checks

Link the standalone `examples/hello-pack` module into the Foundry test data
modules directory, enable it alongside Agent Gateway in `test-world`, and
relaunch the world so Foundry discovers it. The pack has plain ESM JavaScript
and needs no build. Core changes still need `npm run build`.

Follow [the e2e guide](../testing.md) for credentials, fixtures, browser setup and
the one-time headed pairing. The human types pairing codes. Keep environment
settings and pairing state outside the repository; never attach tokens or
credential dumps to test evidence.

```sh
AGENT_GATEWAY_E2E_HELLO_PACK=1 npm run test:e2e
```

The live pack suite is `e2e/packs/hello-pack.e2e.test.ts`. Enabled mode checks the
player tool list contains both tools with gateway provenance and calls the
pure dice tool. It does not mutate a journal. Disable the pack, relaunch the
world, then check absence:

```sh
AGENT_GATEWAY_E2E_HELLO_PACK=disabled npm run test:e2e
```

Without the variable, pack checks skip with a message naming it. Normal e2e
prerequisites still apply. Record Foundry version, test command and pass/skip
result; mark v13 pending while its instance is unavailable. Unit checks do not
replace these live checks. Enabled/disabled live results require the exact built
core and gateway versions under review, plus installing and activating this
example in the test world; a default-mode skip is not that evidence. The example pack is not published or bundled by
this workflow.
