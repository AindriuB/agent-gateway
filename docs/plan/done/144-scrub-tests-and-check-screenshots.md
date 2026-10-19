# 144 — Neutralise personal names in tests and check the 16 evidence screenshots

**Repo:** .
**Depends on:** none
**Owns:**
- module/test/apps/approval/evidence/**
- module/test/apps/policy/evidence/**
- module/test/tools/player-writes/live-proof.mts
- module/test/tools/player-tokens-combat/native-proof.mts
- module/test/serialise/paging-corpus.ts (the header comment at :1 only)
- gateway/test/relay/endpoint.test.ts (the Windows-path fixture strings at :39-62 only)

**Status:** Part of the go-public set (140-148), planned 2026-10-16 (Andrew's decision 8: check the
16 test screenshots for real usernames or data).

## Goal

Make sure the screenshots committed as test evidence show no real person's username, email,
world, IP address or private content, and replace the remaining personal names in test code with
role words. Anything found in a screenshot must also be reported so task 148 can strip the blob
from history, since replacing a file now leaves the old one in every earlier commit.

## Context

- `git ls-files 'module/test/apps/*/evidence/*'` — 16 PNGs: approval/{v13,v14}-{batch,code,code-end,document-diff,pack-denial}.png
  and policy/{v13,v14}-{gm,gm-controls,player}.png.
- `rg -n 'evidence/' module docs` — check whether any test or doc references them by name.
- module/test/tools/player-writes/live-proof.mts:4,27,137,250,287 and
  module/test/tools/player-tokens-combat/native-proof.mts:31,138 — "Andrew must approve…" in
  comments and in thrown/printed messages.
- module/test/serialise/paging-corpus.ts:1 — "Andrew's table of paging hazards".
- gateway/test/relay/endpoint.test.ts:39-62 — `/Users/a/…` and `C:\Users\Andrew\…` fixtures for
  socket-path derivation.
- e2e/** also has an "Andrew's per-run" comment (e2e/pf2e-choices/spike.e2e.test.ts:5); e2e is
  owned by the open image tasks, so it is left for history only.

## Acceptance

- [ ] The PR description has a table of all 16 screenshots: file, what is visible, and a verdict
      (clean / contains X). Things to look for: Foundry user names other than generic fixtures
      (Gamemaster, Player1, Player2…), world names, browser chrome showing URLs, hostnames or IPs,
      OS user names, email addresses, avatar images of real people, premium or copyrighted content
      (module art, compendium text).
- [ ] Every screenshot with a finding is either re-captured from a fixture world with generic names
      or cropped/blurred so the finding is gone, keeping the same filename. If any finding exists,
      the PR description lists the old blob ids (`git rev-list --objects --all -- <path>`) for
      task 148 to strip.
- [ ] If all 16 are clean, no PNG changes (diff).
- [ ] `rg -n -i "andrew" module/test/tools/player-writes/live-proof.mts module/test/tools/player-tokens-combat/native-proof.mts module/test/serialise/paging-corpus.ts gateway/test/relay/endpoint.test.ts`
      prints nothing; the replacements are "the GM" / "the human approver" in prose and a neutral
      name such as `alice` in path fixtures.
- [ ] endpoint.test.ts assertions still test the same derivation (same structure of path, only the
      user segment changes); `npx vitest run gateway/test/relay/endpoint.test.ts` passes.
- [ ] `npm run verify` exits 0.

## Out of scope

- e2e/** (open image tasks 53, 121, 123 own parts of it); the comment stays.
- module/test/tools/image-*/** and module/test/stubs/** (image tasks).
- Every other test containing `foundry.local`, `/home/u` or `/Users/a`: generic placeholders, keep.
- docs/testing.md (143) even where it describes these screenshots.
- History rewriting (148).
