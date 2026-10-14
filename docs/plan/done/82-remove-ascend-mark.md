# 82 — Remove the Ascend mark from the consent footer

**Repo:** .
**Depends on:** none
**Owns:**
- gateway/src/oauth/consent/**
- gateway/test/oauth/consent/**

**Status:** Requested by Andrew on 2026-10-14. He declined to ship his all-rights-reserved Ascend mark in a public repo, so this resolves the go-public prerequisite that task 75 recorded in PLAN.md. It reverses the part of 75 that relaxed 67's bans for "ascend". 75's relaxation for `<svg>` stays, narrowed from two marks to one. Every path:line below was checked on `origin/main` at 0fa6581.

## Goal

Remove every trace of the Ascend mark from the gateway source, so the repo can go public without shipping an all-rights-reserved asset. The consent-page footer's "Source code" link keeps the GitHub mark only. The word "ascend" goes back to being banned on every consent page, footer included. The footer may hold exactly one `<svg>`, and only when `--source-url` is set.

## Context

- gateway/src/oauth/consent/marks.ts:1-24: the two marks. Lines 4-5 are the Ascend provenance comment, lines 10-13 are `ASCEND_PATH` and `ASCEND_VIEWBOX`, and line 24 is `ASCEND_MARK`. The GitHub provenance comment (7-8), `GITHUB_PATH`, `GITHUB_VIEWBOX`, the `svg()` helper and `GITHUB_MARK` stay as they are. The header line 2 says "Two marks".
- gateway/src/oauth/consent/render.ts:3: the `ASCEND_MARK` import. render.ts:59: the source link, with `aria-label="Source code on GitHub, by Ascend"` and `${GITHUB_MARK}${ASCEND_MARK}`.
- gateway/src/oauth/consent/style.ts:1-6: the stylesheet header comment. It does **not** name Ascend. It says the palette and other values were "copied in as plain values", which is the provenance of the Ascend style values, but it names no mark or brand, so it stays. Line 5 says "The footer's two inline SVG marks", which becomes wrong after this task. style.ts:112 `.mark + .mark { margin-left: 0.25rem; }` only spaces a second mark, so it becomes dead.
- gateway/test/oauth/consent/branding.test.ts:47-62: the footer-only relaxation. Line 49 bans `<svg|ascend` outside the footer, line 55 bans them everywhere when no URL is set, and lines 60-61 expect exactly two `<svg>` with both URLs set. Line 86 bans "ascend" in the stylesheet already.
- gateway/test/oauth/consent/footer.test.ts:3: imports `ASCEND_PATH`. footer.test.ts:65-86: the "two decorative marks" test. Line 70 is the Ascend aria-label, 73 expects two SVGs, 74-79 are the per-SVG rules, and 80 is the Ascend path check.
- docs/plan/done/75-consent-page-footer.md:43-60,66,70: what 75 relaxed from 67, and the per-mark rules (decorative, `currentColor`, no `style=`/`<style`/`<title`/`id=`/`href`/`<use`) that stay in force for the GitHub mark.
- docs/plan/done/67-oauth-consent-and-grants.md:127-168: 67's original branding bans, which this task restores for "ascend".

## Acceptance

- [ ] `marks.ts` has no `ASCEND_PATH`, `ASCEND_VIEWBOX` or `ASCEND_MARK`, and no Ascend provenance comment. Its header describes one mark. The GitHub comment, path, viewBox, the `svg()` helper and `GITHUB_MARK` are byte-identical to `origin/main` (diff).
- [ ] With `--source-url` set, the footer's source link is `<a href="…" rel="noopener noreferrer" aria-label="Source code on GitHub">` containing `GITHUB_MARK` and then `<span>Source code</span>`, and nothing else. The aria-label still contains the visible text "Source code" (WCAG 2.5.3) (diff of render.ts:59).
- [ ] `git grep -n -i ascend -- gateway/src` prints nothing. The style.ts header names no mark or brand, so no exception is needed. Its line 5 now says the footer's one inline SVG mark lives in marks.ts.
- [ ] style.ts drops the dead `.mark + .mark` rule. No other byte of `CONSENT_CSS` changes (diff). In particular, the palette, type, spacing and radius values are untouched.
- [ ] `branding.test.ts`, for every page in its page set: "ascend" (case-insensitive) is absent from the whole body, footer included, with or without URLs set. `<svg` is absent outside `<footer>…</footer>`. With neither URL set, `<svg` is absent everywhere. With both URLs set, `<svg` occurs exactly once in the footer and exactly once in the whole body. The external-href assertions are unchanged.
- [ ] `footer.test.ts`: the source-link test is renamed to say one mark. It asserts `aria-label="Source code on GitHub"` exactly, and asserts that the label does not contain "ascend". It asserts exactly one `<svg>` in the anchor. That SVG has `aria-hidden="true"`, `focusable="false"` and `fill="currentColor"`, and does not match `/style=|<style|<title|\sid=|href|<use/`. It asserts that its path data equals `GITHUB_PATH`, imported from marks.ts in place of `ASCEND_PATH`. With `sourceUrl` unset, there is still no `<svg` and no "Source code".
- [ ] The CSP string and every other test in `gateway/test/oauth/consent/` are unchanged, apart from the edits listed above (diff). 67's original assertions still run with neither URL set.
- [ ] Mutation-checked. The PR description lists each mutation below, applied one at a time to `src`, and the test that failed for each. Every one must fail at least one test:
  1. Re-add a second `<svg>` (any path) after `GITHUB_MARK` in render.ts.
  2. Put "Ascend" back into the aria-label.
  3. Add the text "ascend" to the footer's cookie note.
  4. Drop `aria-hidden="true"` from the `svg()` helper.
  5. Change `fill="currentColor"` to `fill="#000"`.
  6. Render `GITHUB_MARK` inside `<main>` instead of the footer.
  7. Render the source link when `sourceUrl` is unset.
- [ ] `npm run verify` exits 0.

## Out of scope

- Git history. The Ascend path stays in the commits of task 75 (branch `claude/task-75`, PR #127) unless history is rewritten before the repo goes public. That is Andrew's call, not this task's. Note it in the PR description.
- The Ascend style values in `CONSENT_CSS` (palette, type stacks, spacing, radii). Andrew still has to OK them being public. Do not change, rename or re-source them here.
- The CSP, `SECURITY_HEADERS`, the privacy link, the cookie note text, `--source-url` and `--privacy-url` config, `index.ts` and `consent.test.ts`.
- `docs/plan/done/67-*.md` and `docs/plan/done/75-*.md`, PLAN.md, HISTORY*.md and every other doc. Only the scribe edits docs. They keep their historical mentions of Ascend.
- Any change to the GitHub mark's path, viewBox or size rules (`.mark` width and height).

## Scribe items (record time)

- PLAN.md, the Go public item: the prerequisite on the all-rights-reserved Ascend mark in `marks.ts` is resolved by 82, because the mark was removed. The other prerequisite stays open: Andrew OKs the Ascend style values in the consent CSS being public.
- PLAN.md's description of 75 says the source link carries "the GitHub and Ascend marks". Add that 82 reduced this to the GitHub mark only.
- Note for Andrew: the mark remains in git history (task 75's commits) unless history is rewritten.

## Outcome

Done on branch `claude/task-82` (HEAD ac42f98 before rebase onto `origin/main` 072c159), 2026-10-14. `/review` was CLEAN. `/verify`: tester PASS (verify exit 0: 4396 fast, 2227 slow and 63 script tests), reviewer APPROVE. The branch has 3 commits: the plan commit, the removal, and a fix-up ("fix import and exact label") that corrected a leftover import and the exact aria-label string, found when a sed pass missed them.

What landed:
- `marks.ts` holds only the GitHub mark. `git grep -i ascend -- gateway/src` is empty, and the GitHub mark is byte-identical to `origin/main`.
- The source link's aria-label is exactly `Source code on GitHub`, and the footer holds at most one `<svg>`, only when `--source-url` is set.
- The dead `.mark + .mark` CSS rule was removed from `style.ts`. No other byte of `CONSENT_CSS` changed.
- "ascend" is banned again on every consent page, footer included.

Mutations, each applied one at a time to `src` and each failing at least one test:
1. A second `<svg>` after `GITHUB_MARK`.
2. "Ascend" in the aria-label.
3. "ascend" in the cookie note.
4. `aria-hidden="true"` dropped from the `svg()` helper.
5. `fill="#000"` in place of `currentColor`.
6. `GITHUB_MARK` rendered inside `<main>`.
7. The source link rendered while `sourceUrl` is unset.

Residual: the Ascend mark remains in task 75's git history (branch `claude/task-75`, PR #127). Andrew chose to leave history as it is (2026-10-14).
