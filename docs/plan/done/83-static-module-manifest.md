# 83 — Pack the module for a self-hosted manifest URL

**Repo:** .
**Depends on:** none
**Owns:**
- scripts/pack-module.mjs
- scripts/test/pack-module.test.mjs

## Goal
While the repo is private, the GitHub `releases/latest/download/module.json` manifest URL returns 404, so Foundry cannot install the module from a manifest URL. Add `--base-url <https-url>` to `pack-module`. It writes `manifest` and `download` under that base into the `module.json` inside the zip, and also into a standalone `dist/release/module.json`. Andrew can then serve both files as static files from his own Caddy (for example `https://dl.aindriub.app/agent-gateway/`) and install from that URL. The committed `module.json` is never modified.

## Design (fixed; do not redesign)
- The flag is `--base-url <url>`, and it is optional. It combines with `--root` in any order. If the flag has no value, or its value starts with `--`, the script exits 1 with the existing one-line `pack-module: usage: ...` message. Extend the usage string and the header comment to show `[--base-url <https-url>]`.
- To validate, parse the value with `new URL()`. Reject it unless `protocol === 'https:'` and it has no `username`, `password`, `search` or `hash`. A rejection exits 1 with a single stderr line, `pack-module: --base-url must be an https URL without credentials, query or fragment`, and never echoes the value back. Validate before the build check and before touching `dist/release/`.
- Normalise by stripping trailing `/` characters from the pathname. Then `manifest = <base>/module.json` and `download = <base>/agent-gateway.zip`. The download path carries no version: a re-pack overwrites in place, and Foundry's update check uses the `version` in the manifest.
- To rewrite, read `<root>/module.json`, parse it, and set only `manifest` and `download`. Key order and every other field, `version` included, stay unchanged. Write it as `JSON.stringify(m, null, 2) + '\n'` to `dist/release/module.json`. Run the existing `zip` call with `module.json` removed from `inputs`, then add the rewritten file at the zip root with `zip -q -X -j <out> dist/release/module.json`. `<root>/module.json` is only ever read.
- Without `--base-url`, the zip is byte-for-byte the same as today: `module.json` is zipped from the root. The script also deletes any stale `dist/release/module.json` (`rmSync(..., { force: true })`), so an old self-hosted manifest cannot be copied out by mistake.
- On success, stdout is the zip path as now. With `--base-url`, a second line follows with the path of the standalone `module.json`.
- `scripts/release.mjs` stays unchanged. It calls `pack-module` without the flag and uploads the root `module.json`, so GitHub releases keep the GitHub URLs. The no-flag cleanup step only deletes a file that release never uploads. Adding the flag to release later is a separate task.

## Context
- scripts/pack-module.mjs:1-43 — the current script: `--root` parsing at 8-16, the zip inputs and excludes at 30-32, and the `zip` call with its error handling at 33-42.
- scripts/test/pack-module.test.mjs:16-41 — `fakeRoot(name, withBuild)` and `run(root)`. Reuse them, and add a `run` variant that passes extra args.
- scripts/test/pack-module.test.mjs:80-102 — the existing zip-entries test, which shows the `unzip -Z1` / `unzip -p` style to follow.
- scripts/release.mjs:99 and :187 — the release flow calls pack-module without the flag and uploads the root `module.json`. Read these lines only; do not edit them.
- scripts/bump-version.mjs:52-56 — keeps `version` and the `download` tag of the root `module.json` in step. That is why the root file must never be rewritten.
- docs/conventions.md — script style. `npm run test:scripts` runs `scripts/test/*.test.mjs`, and `npm run verify` runs it too.

## Acceptance
- [ ] `node scripts/pack-module.mjs --root <r> --base-url https://dl.example.test/agent-gateway/` exits 0. `unzip -p <r>/dist/release/agent-gateway.zip module.json` parses with `manifest === 'https://dl.example.test/agent-gateway/module.json'` and `download === 'https://dl.example.test/agent-gateway/agent-gateway.zip'`. A trailing slash and no trailing slash give the same result.
- [ ] `<r>/dist/release/module.json` exists and is byte-identical to the `module.json` entry in the zip.
- [ ] The packed `module.json` deep-equals the source `module.json` except for `manifest` and `download`. In particular, `version` equals the source `version`, and the key order is the same.
- [ ] `<r>/module.json` is byte-identical before and after a `--base-url` run.
- [ ] The zip has exactly one `module.json` entry, at the root, and still passes the existing allowed-entries assertions.
- [ ] Each of `http://dl.example.test/x`, `ftp://dl.example.test/x`, `dl.example.test/x`, `https://u:p@dl.example.test/x`, `https://dl.example.test/x?a=1` and `https://dl.example.test/x#f` exits 1 with exactly one stderr line matching `^pack-module: --base-url must be an https URL`. That line does not contain the given value, and no `dist/release/agent-gateway.zip` is created.
- [ ] `--base-url` with no value, or with a value starting with `--`, exits 1 with stderr matching `^pack-module: usage`.
- [ ] Without `--base-url`, the zipped `module.json` is still byte-identical to the source (the existing test passes unchanged). A `dist/release/module.json` left by an earlier `--base-url` run is gone afterwards.
- [ ] `git diff --stat origin/main` touches only the two owned files, and `scripts/release.mjs` is unchanged.
- [ ] `npm run verify` passes.
- [ ] Manual (Andrew): run `npm run build && node scripts/pack-module.mjs --base-url https://dl.aindriub.app/agent-gateway`, copy `dist/release/agent-gateway.zip` and `dist/release/module.json` to the served directory on the VPS, add the Caddy site below, and run `curl -sI https://dl.aindriub.app/agent-gateway/module.json`, which returns 200. Then go to Foundry v14 Setup → Add-on Modules → Install Module, set Manifest URL to `https://dl.aindriub.app/agent-gateway/module.json`, and install. The module appears in the list, enables in a world, and loads without console errors.

## Docs handed to the scribe at record time (not the implementer)
Add a new section to `docs/releasing.md`, after "Manifest URL", titled "Self-hosted manifest (private testing)". Give it the steps and this Caddy site block. Add one cross-reference line from `gateway/docker/README.md` under "Bring your own Caddy". `docs/releasing.md` is the home because this is a distribution flow, not part of running the gateway.

```
dl.aindriub.app {
	root * /srv/dl
	file_server
}
```

- Files go to `/srv/dl/agent-gateway/module.json` and `/srv/dl/agent-gateway/agent-gateway.zip`. There is no `browse`, so no directory listing. Caddy obtains the certificate itself once a DNS record for `dl.aindriub.app` points at the VPS. It needs a host of its own, as with the gateway block.
- If Caddy is the bundled `gateway/docker/compose.yaml` container, `/srv/dl` must be bind-mounted read-only into the `caddy` service. Do this with an uncommitted `compose.override.yaml`; do not edit the committed compose file. The site block is added to the local Caddyfile.
- CORS: no `Access-Control-Allow-Origin` header is needed. On Install Module, the Foundry server process fetches the manifest and the zip itself, and the browser never requests `dl.aindriub.app`. Caddy's `file_server` serves `.json` as `application/json` and `.zip` as `application/zip`, which is fine.
- The zip is not secret, but anyone with the URL can download it. Remove the files after testing if that matters.
- Re-packing for a new test overwrites both files in place. Foundry's "Check for updates" compares the served `version`.

## Out of scope
- `scripts/release.mjs` and `docs/releasing.md` (no flag pass-through, and docs go to the scribe).
- The committed `module.json` URLs and `scripts/bump-version.mjs`.
- `gateway/docker/**` (Caddyfiles, compose files, README).
- Uploading to the VPS, rsync/scp helpers, or any deploy script.
- Versioned download paths, checksums, or signing.

## Review round 1 — findings
- [STYLE] scripts/pack-module.mjs:10,36,55 and scripts/test/pack-module.test.mjs:3,108,126,142 — these lines exceed the repo's 100-character Prettier width, and pack-module.mjs:23 is wrapped differently from Prettier's output. `prettier --check` fails on both files at HEAD and passes on origin/main (docs/conventions.md:3, `.prettierrc` `printWidth: 100`; `npm run lint` does not cover `scripts/**/*.mjs`). route: implementer. Run `prettier --write` on the two owned files; behaviour does not change.
- [P3] scripts/test/pack-module.test.mjs:146-165 — no test shows validation runs before anything in `dist/release/` is touched: each bad URL runs on a fresh root with no zip. Moving the validation block after the `rmSync` calls still passes all 11 tests. route: implementer. Pack once with a good URL, then run a bad `--base-url` on the same root, and assert that both `dist/release/agent-gateway.zip` and `dist/release/module.json` still exist.
- [P3] scripts/pack-module.mjs:35 / scripts/test/pack-module.test.mjs:151 — the only credentials input is `u:p`, so removing either the `username` or the `password` check leaves every test passing. route: implementer. Add `https://u@dl.example.test/x` (username only) and `https://:p@dl.example.test/x` (password only) to the bad list.

## Outcome

Done on branch `claude/task-83` (rebased onto `origin/main` 072c159), 2026-10-14. `/review` round 1 found a STYLE issue (Prettier width on both owned files) and two P3s (no test that validation runs before `dist/release/` is touched; the username and password checks were not guarded separately). All were fixed in the last commit; the re-review was CLEAN and mutation-checked. `/verify`: tester PASS (verify exit 0: 4396 fast, 2227 slow and 69 script tests), reviewer APPROVE.

What landed: `pack-module --base-url <https-url>` writes `manifest` and `download` under that base into the `module.json` in the zip and into a standalone `dist/release/module.json`. The committed `module.json` is never modified, and `release.mjs` is unchanged.

Deployed 2026-10-14 on Andrew's say-so:
- A real pack made with `--base-url https://dl.aindriub.app/agent-gateway` was copied to his VPS.
- His Caddy (the aindriub-app compose project in `/opt/aindriub-app`) got a `dl.{$DOMAIN}` site block serving `/srv/site/dl`, plus a landing-page 404 for `/dl`. That change is uncommitted in that repo; Andrew commits it.
- `https://dl.aindriub.app/agent-gateway/module.json` serves 200 with the same checksum as the pack.
- Pending Andrew: the manual Foundry v14 install from that manifest URL.

Notes for later:
- Reviewer suggestion: the `--base-url` test does not re-run the allowed-entries and exclusion checks on the rewritten zip.
- The usage comment at `scripts/pack-module.mjs:2` is over 100 characters (cosmetic).
- The scribe docs were written as `docs/releasing.md` "Self-hosted manifest (private testing)" and a cross-reference in `gateway/docker/README.md`. The Caddy example uses a mounted site folder rather than the `/srv/dl` in the brief above, because Andrew's Caddy runs in a container.
