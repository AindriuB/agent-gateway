# 75 — Add a privacy, cookie and source footer to the OAuth consent pages

**Repo:** .
**Depends on:** 67
**Status:** Follow-up to 67, requested by Andrew on 2026-10-14. It deliberately relaxes three of 67's consent-page bans, for the footer only (see "What this reverses from 67"). It overlaps 68 on `gateway/src/bin/cli.ts` and `gateway/src/app.ts`. The regions differ (see Owns), but 75 and 68 must not be in flight at the same time; whichever lands second rebases.
**Owns:**
- gateway/src/oauth/consent/** (the footer in `render.ts`, its rules in `style.ts`, the new `marks.ts` holding the two inline SVGs, and the two optional URLs on `ConsentPagesOptions` in `index.ts`)
- gateway/test/oauth/consent/** (relax `branding.test.ts` as described below; new `footer.test.ts`)
- gateway/src/config/index.ts (insertions only: the `privacyUrl` and `sourceUrl` schema fields, the `AGENT_GATEWAY_PRIVACY_URL` and `AGENT_GATEWAY_SOURCE_URL` entries in `ENV_KEYS`, and one link-URL validator called from `loadConfig`. `normalizePublicUrl` keeps its behaviour and its messages)
- gateway/src/bin/cli.ts (insertions only: two `parseArgs` options, two entries in the `loadConfig` flags, and two `USAGE` entries)
- gateway/test/config/consent-links.test.ts (new)
- gateway/test/bin/consent-links.test.ts (new)
- gateway/src/oauth/server.ts (pass-through only: two optional fields on `OAuthServerOptions`, forwarded into `new ConsentPages({...})` at :161)
- gateway/src/app.ts (pass-through only: `config.privacyUrl` and `config.sourceUrl` forwarded into `new OAuthServer({...})` at :591)

## Goal
Every HTML consent page (request, code and message) ends in a static footer with three parts. First, a "Privacy" link to an operator-set `--privacy-url`, shown only when that setting is set. Second, a one-line note naming the single strictly necessary security cookie. Third, a "Source code" link carrying the GitHub mark and Andrew's Ascend mark, shown only when an operator-set `--source-url` is set, because the repo stays private until go-public. The gateway operator is the data controller, so the operator must be able to point users to the operator's own privacy notice.

## Context
- gateway/src/oauth/consent/render.ts:43-44: `shell()` is the one place every consent page is built. Add the footer there, after `</main>`.
- gateway/src/oauth/consent/render.ts:23-37: `consentCsp` and the headers. **Leave them unchanged.**
- gateway/src/oauth/consent/style.ts: the same-origin stylesheet. Footer and mark sizing go here, never in `style=""` or `<style>`.
- gateway/src/oauth/consent/index.ts:32,133: `COOKIE_PREFIX = '__Host-agcsrf-'`. The cookie set is `__Host-agcsrf-<request id>` (Secure, HttpOnly, SameSite=Strict, Max-Age 15 min). The note must name it by that prefix, taken from the constant so the two cannot drift.
- gateway/test/oauth/consent/branding.test.ts:18-39,86-98: the 67 bans and the step-1 byte-identical test that this task changes or extends.
- gateway/src/config/index.ts:25-44,55-66,72-92,149: the schema, `ENV_KEYS`, `normalizePublicUrl` (the https / loopback-http rule to mirror) and where it is applied in `loadConfig`.
- gateway/src/bin/cli.ts:28-30,188,236: how `--public-url` is declared, documented and passed. Follow the same shape.
- gateway/test/config/exposure.test.ts and gateway/test/bin/exposure.test.ts:131-133: the test shape for a refused URL (exit 2, with the reason).
- ~/workspace/branding/assets/logos/svg/ascend-black.svg: the monochrome silhouette path. **Copy** it into `marks.ts`. Never import, read or reference that path at build or run time.
- ~/workspace/branding/brand/guidelines.md:14-27,58-60: small sizes use the monochrome silhouette; a logo inside a link that already names it is decorative; title IDs must be unique.
- ~/workspace/branding/RIGHTS.md and README.md:59: the Ascend mark is all rights reserved, for the owner's use only.
- https://github.com/logos: GitHub's logo usage rules for the GitHub mark (Invertocat).
- docs/plan/tasks/67-oauth-consent-and-grants.md:129-166: 67's Branding section and the bans it set.

## Decisions
- **Source link uses an operator setting, not a build-time constant.** The settings are `--source-url <url>` and `AGENT_GATEWAY_SOURCE_URL`, plus `sourceUrl` in the config file. The reasons:
  - The gateway is MIT and has no AGPL-style duty to link its source, so the link is attribution. The right target is whatever source the operator actually runs, and a fork should point to its own.
  - A build-time constant would bake the private repo URL into the built package, and going public would then need a rebuild.
  - It reuses the same validation and escaping path as `--privacy-url`, so there is one mechanism.
  - The cost: when no URL is set, nothing is shown. Andrew's own deployments set the URL. Whether a default should appear at go-public is decided then, not here.
- **URL rule (both settings).** Use `new URL()`. Accept `https:`, or `http:` only on a loopback host or `localhost` (the same rule as `normalizePublicUrl`). Refuse credentials. Allow a path, query and fragment. Cap the length at 2048 characters. Store and render the parsed `url.href`. A refusal is a `ConfigError` with exit code 2 and the message `Invalid --privacy-url <value>: <why>` or `Invalid --source-url <value>: <why>`. Unset or empty means no link. The settings are accepted without `--public-url`, and are then simply unused.
- **Accessible names.** The source link's visible text is "Source code". Its `aria-label` is `Source code on GitHub, by Ascend`, which contains the visible text (WCAG 2.5.3). Both SVGs are then decorative: `aria-hidden="true" focusable="false"`, with no `<title>` and no `id`. This follows guidelines.md:60, which makes a logo decorative when the link already names it.
- **Marks.** The Ascend mark is the `ascend-black.svg` silhouette path with `fill="currentColor"`, so one asset serves both themes and stays monochrome at small sizes. The GitHub mark is the official Invertocat path, unmodified, also with `fill="currentColor"`. Both are rendered at the same small size, from the stylesheet (target 16–20 px), with a visible gap between them, so neither is merged into or attached to the other mark.
- **Provenance in source.** `marks.ts` opens with a comment covering two marks:
  - The Ascend mark: "© 2026 Andrew Bannister. All rights reserved. Not covered by this repository's MIT licence."
  - The GitHub mark: a trademark of GitHub, Inc., used unmodified under https://github.com/logos, with the date that page was checked.

## What this reverses from 67
67's Branding acceptance (67:151, 67:157-158) and `branding.test.ts` ban `<svg>`, external `href`s and the word "ascend" on every consent page, and say that no Ascend mark ships. This task **deliberately relaxes those bans for the footer only**:
- **External `href`s.** Exactly the configured privacy URL and source URL may appear, inside `<footer>`. No other external URL may appear anywhere.
- **`<svg>`.** Exactly the two named marks may appear, inside the source link in `<footer>`, and only when `sourceUrl` is set. No other `<svg>` may appear.
- **"ascend".** It may appear only inside `<footer>`, and only when `sourceUrl` is set.
- **Ascend asset.** The one Ascend silhouette path now ships, in `marks.ts`. No other Ascend asset ships: no colour mark, avatar, favicon, font or name outside the footer.

With both settings unset, every one of 67's original assertions must still hold unchanged.

## What stays unchanged
- The CSP string, byte for byte, on every consent response. An `<a href>` and inline SVG markup need no CSP change. If anything seems to need one, stop and report.
- No `<script>`, no `<style>` element, no `style=` attribute (inside the SVGs too), no `<img>`, and no external resource load. That means no `src`, no `url()`, and no `<use>`, `href` or `xlink:href` inside the SVGs.
- Escaping: both URLs go through `escapeHtml` when they are written into `href`.
- The step-1 response stays byte-identical across users, apart from the masked id and the CSRF token. The footer depends only on gateway config, never on the request.
- CSRF, the anti-framing headers, the `Host` rule and the stylesheet route.

## Acceptance
- [ ] With neither URL set, every page in `branding.test.ts`'s page set has no external `href`, no `<svg`, and no "ascend" (case-insensitive). The same file also passes with both URLs set, where each external `href` is one of exactly the two configured URLs, `<svg` appears exactly twice, and the `<svg` elements and "ascend" occur only between `<footer` and `</footer>` (tests).
- [ ] Every HTML consent page (request, code and every message page, including 403 and expired) contains exactly one `<footer>`, after `</main>`. JSON responses carry no footer (test).
- [ ] With `privacyUrl = https://example.org/privacy?x=1`, the footer contains `<a href="https://example.org/privacy?x=1" rel="noopener noreferrer">Privacy</a>`. With it unset, the body does not contain `>Privacy<` (test).
- [ ] The footer always contains the cookie note. It names `__Host-agcsrf-`, built from `COOKIE_PREFIX`, and says the cookie is strictly necessary, is for sign-in only, and is not used for tracking (test asserts the prefix and the words "strictly necessary" and "tracking").
- [ ] With `sourceUrl` set, the footer has one `<a>` to it with `rel="noopener noreferrer"`, visible text `Source code` and `aria-label="Source code on GitHub, by Ascend"`. That anchor contains exactly two `<svg>`, each with `aria-hidden="true"` and `focusable="false"` and with `fill="currentColor"` on its paths. Neither has `style=`, `<style`, `<title`, `id=`, `href` or `<use`. One SVG's path data equals the `ascend-black.svg` silhouette path. With `sourceUrl` unset, there is no source link and no `<svg` (tests).
- [ ] A URL containing `"`, `<` or `&` (for example `https://example.org/p?a=1&b="x"<y`) is written only as the escaped `url.href`, and the body contains no raw `"x"<y` (test).
- [ ] The CSP header on every consent response still equals 67's exact string (the existing assertion runs with both URLs set, too) (test).
- [ ] The step-1 byte-identical test also passes with both URLs set (test).
- [ ] Config: the flag, the env key and the config-file key each set `privacyUrl` and `sourceUrl`, with the existing precedence. `http://evil.example`, `ftp://x`, `javascript:alert(1)`, `https://u:p@x.example`, a non-URL and a 2049-character URL are each refused with `Invalid --privacy-url` (and the same for `--source-url`) and exit code 2. `http://127.0.0.1:8080/p` and `https://x.example/a#b` are accepted (gateway/test/config/consent-links.test.ts).
- [ ] CLI: `--privacy-url http://evil.example` exits 2 with the reason on stderr, and `--help` lists both flags with their env keys (gateway/test/bin/consent-links.test.ts).
- [ ] `marks.ts` carries the provenance comment from Decisions, and `rg -n 'workspace/branding' gateway/` finds nothing.
- [ ] The diff touches only the files in Owns. `app.ts` and `oauth/server.ts` change only by forwarding the two values.
- [ ] Manual: screenshots of the step-1 page with both URLs set, in light and in dark colour scheme, plus one with neither URL set, are attached to the PR (not committed). In them, the marks are legible, monochrome and visibly separate, and the footer text meets 4.5:1 contrast.
- [ ] `npm run verify` passes.

## For the scribe (not the implementer)
- docs/server-mode.md: a short "Privacy and cookies" section. It says the operator of a public gateway is the data controller and should set `--privacy-url` to the operator's own notice. It lists what the gateway stores: Foundry user names and ids; OAuth client registrations, grants and tokens (tokens hashed); and client IP addresses, in memory only, for rate limits. It gives retention: 67's sweep and its caps, and that in-memory rate-limit state is lost on restart. It names the one `__Host-agcsrf-` cookie. It documents `--privacy-url` and `--source-url`. Check each claim against the code before writing it, and link `docs/privacy.md`.
- docs/plan/PLAN.md, in the Go public item, add a prerequisite. The Ascend mark in `gateway/src/oauth/consent/marks.ts` is all rights reserved (branding RIGHTS.md). Shipping it in a public repo is Andrew's go-public decision. If he declines, remove the mark (and its relaxed test allowance) before the repo goes public. This holds even though the mark is hidden at run time when `--source-url` is unset, because the source file itself ships.

## Out of scope
- Any CSP change, any inline style, and any script.
- The Ascend colour mark, favicons, avatars, fonts or the "Ascend" name anywhere outside the footer.
- A default source or privacy URL, and any build-time constant.
- Editing docs (scribe), PLAN.md or HISTORY.md.
- Other pages the gateway serves (the JSON OAuth endpoints, the stylesheet route, the link or MCP surfaces).
- 68's commands in `cli.ts` and its sweep in `app.ts`.
- Refactoring `normalizePublicUrl` or the other existing flags.
