# 104 — Make the consent page's world and user entry usable without raw ids

**Repo:** .
**Depends on:** 103
**Status:** BLOCKED on decision. Do not fan out until Andrew answers "Open decisions" and the
answer is written into this file.
**Owns:**
- gateway/src/oauth/consent/** (the render.ts step-1 form, and the index.ts form handling and `resolve`)
- gateway/test/oauth/consent/world-user-entry.test.ts (new)
- gateway/src/bin/cli.ts and gateway/test/http/cli.test.ts (only if option 1B is chosen: one new flag and its test)

## Goal
The consent page asks for a raw "World id" and "Foundry user (name or id)". Players do not know
their world id, and a typo gets the same uniform reply as any other failure. Make the common case
(one world on the gateway) need no world typing, without weakening the page's uniform,
non-enumerating design.

## Context
- gateway/src/oauth/consent/render.ts:93-94 — the two free-text inputs.
- gateway/src/oauth/consent/index.ts:286-310 — `resolve`: accepts a user id, or a name that exactly
  one active pairing in that world holds.
- docs/plan/PLAN.md, "Decisions (Andrew, 2026-10-14)" — "The consent page does not list users (67)".
- docs/plan/PLAN.md item 0b (98) — the consent page stays uniform whoever is named and whether or not
  they are online. It must not reveal headless, owner or online status.
- Anyone who can start an OAuth authorize request reaches the page, before any sign-in.

## Open decisions
1. **How to avoid typing the world id.**
   - A. Prefill and lock the world field when the gateway has exactly one world with an active
     pairing; otherwise free text as now. This shows that one world id to anyone who opens /authorize.
   - B. An operator setting (`--consent-world <id>` / `AGENT_GATEWAY_CONSENT_WORLD`) that prefills
     the world. Nothing is inferred from the store, so the page shows only what the operator chose
     to publish.
   - C. A dropdown of every world with an active pairing. This lists worlds to the public.
   - D. Keep the field and add help text ("the world's folder name; your GM can tell you").
   - **Recommendation: B, with D's help text.** It fixes the hosted single-world case, shows
     nothing the operator did not configure, and keeps 67's no-listing rule.
2. **The user field.** Andrew's 67 decision rules out listing users.
   - A. Keep free text, but relabel it "Your Foundry user name (as shown in Foundry)" and drop "or id"
     from the visible label (ids are still accepted).
   - B. Revisit the 67 decision and list the users of the chosen world.
   - **Recommendation: A.** Names already resolve (`index.ts:300`).

## Acceptance (to be finalised with the decision)
- [ ] With the chosen world option configured, step 1 renders the world prefilled (editable or
      not, as decided), and a test posts the form without typing a world.
- [ ] Without it, the page renders exactly as it does after 103, apart from the new label and help text.
- [ ] The step-1 response for a wrong world, a wrong user, an offline user and a headless agent is
      byte-identical apart from the rid and csrf values (test), so 98's uniform-page rule holds.
- [ ] No user, pairing or world list is rendered unless decision 2B is chosen.
- [ ] `npm run verify` passes.

## Out of scope
- Scope checkbox defaults (task 103).
- The code page, the grants, and the module's "Connected apps" UI.
- Docs: task 113 or a follow-up scribe task updates the wording once this lands.
