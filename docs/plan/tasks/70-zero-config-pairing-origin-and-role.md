# 70 — Zero-config setup: bind pairings to the browser origin, take the role from Foundry

**Repo:** .
**Depends on:** 69
**Status:** MVP A (Andrew, 2026-10-13); after 69, before 34
**Owns:**
- gateway/mcpb/manifest.json
- scripts/test/build-mcpb.test.mjs
- gateway/src/config/index.ts
- gateway/test/config/config.test.ts
- gateway/src/bin/cli.ts (USAGE text, the `--allow-origin` default, the ignored-role warning line)
- gateway/src/app.ts (origin warning, `allowedOrigins` default, `EmptyModuleConnections`/`ModuleConnections` removal, the relay config built for 69)
- gateway/src/link/server.ts
- gateway/src/link/origin.ts (new)
- gateway/src/link/code-attempts.ts (new)
- gateway/src/link/index.ts (export lines only)
- gateway/src/store/store.ts
- gateway/src/store/migrations/007-pairing-origin.ts (new)
- gateway/src/store/migrations/index.ts (insertions only: one import, one array entry)
- gateway/src/mcp/server.ts (delete)
- gateway/src/mcp/index.ts (delete)
- gateway/src/relay/config.ts
- gateway/test/store/store.test.ts
- gateway/test/link/server.test.ts
- gateway/test/link/helpers.ts (additive: an optional origin on connect, pair and reconnect)
- gateway/test/link/origin-pairing.test.ts (new)
- gateway/test/link/code-attempts.test.ts (new)
- gateway/test/routing/role-source.test.ts (new)
- gateway/test/mcp/server.test.ts (remove the `createMcpServer` cases only; the CLI cases stay)
- gateway/test/relay/server.test.ts (the `relay config fingerprint` describe block only)
- gateway/test/bin/link-conflict.test.ts (the origin-warning and `--allow-origin` cases, plus one new origin-pairing case)

## Goal
Setup has to be easy, and you should not need to restart the plugin to change a
setting (Andrew, 2026-10-13). The Claude Desktop extension loses its
`foundry_url` and `role` settings, so a fresh install needs zero settings. Any
http(s) browser origin may make a new pairing, but only with the one-time code.
Each pairing remembers the exact origin it was made from, and its token works
only from that origin. The tool tier comes only from the bound Foundry user's
role as the module reports it over the authenticated link. No gateway setting
and no MCP input can choose it.

## Context
- gateway/src/link/server.ts:101-109: `onUpgrade` refuses any Origin outside `allowedOrigins` with a 403, before `hello`. Today that is the only origin rule.
- gateway/src/link/server.ts:265-309: `handshake`. A code creates a pairing (`store.createPairing`, :288). A token is matched by hash, world and user (:297-305). Neither looks at the origin.
- gateway/src/link/pairing-codes.ts:30-35: `consume` is single-use, and a wrong guess does not spend the real code. There is no attempt limit anywhere. See PLAN.md "Follow-ups from task 06", which said loopback plus the origin allowlist made guessing impractical. This task removes the allowlist default, so the limit becomes necessary.
- gateway/src/app.ts:17, :131-148: `DEFAULT_ALLOWED_ORIGINS`, and the once-per-origin warning (`warned` set, `MAX_WARNED_ORIGINS` 20, `sanitizeOrigin`). Its text points at the extension's Foundry URL, which this task removes.
- gateway/src/bin/cli.ts:19-20, :27-47, :88-93: `--allow-origin` parsing and normalisation (keep these), and the USAGE default text (change it)
- gateway/src/store/store.ts:7-24, :75: `PairingRow`, `NewPairing`, the insert. gateway/src/store/migrations/002-pairing-user-name.ts is the shape of a column-add migration. gateway/src/store/migrate.ts runs each migration in one transaction.
- gateway/test/store/store.test.ts:82-110: the migration order and `user_version` guard. Adding 007 must keep it green.
- gateway/src/config/index.ts:4-20: `role` and `AGENT_GATEWAY_ROLE`. In the shipped code, the only reader of `config.role` is the legacy, unused `gateway/src/mcp/server.ts:9-17`. PLAN.md "Follow-ups from wave 4" already asks for it to be removed.
- gateway/src/mcp/session.ts:83-90: the real tier. Before the module announces a tool set, the GM-only tools show only if `conn.info.isGM`. After that, the list is exactly what the module announced.
- gateway/src/link/server.ts:320: `info.isGM` comes from `hello.user.isGM`
- module/src/link/runtime.ts:59-68: the module fills `hello.user` and announces its tool set from `game.user.isGM`, and it re-announces when the role changes
- module/src/ops/dispatch.ts:37: the module refuses a `minRole: 'gm'` tool for a non-GM at call time
- gateway/test/routing/toolset.test.ts:58-115: the role tests that already exist (tier before announcement, a promoted player gains the GM tool)
- module/src/settings/index.ts:41-44: `pairingCredential` is `scope: 'client'`, so it lives in that origin's localStorage. module/src/link/client.ts:419-436: a `PAIRING_INVALID` reply to a **token** clears the credential and shows "pairing required". A `PAIRING_INVALID` reply to a **code** keeps the token. This is why the module needs no change (see Design 6).
- claude/task-69:gateway/src/relay/config.ts: 69's `RelayConfig` fingerprint is `{role, origins, startedAt}`, plus `sameConfig` and `describeConfigDiff`. A newer differing config makes the primary step down.
- gateway/mcpb/manifest.json:20-29, :32-73 and scripts/test/build-mcpb.test.mjs:25-50: the manifest and its current assertions about `foundry_url` and `AGENT_GATEWAY_ROLE`

## Design (decided here; change only through a PR note Andrew approves)
1. **When an origin is acceptable at upgrade.** A new `gateway/src/link/origin.ts` exports `canonicalOrigin(header): string | undefined`. It returns the header only if all of the following hold, and `undefined` otherwise:
   - it parses with `new URL`;
   - its protocol is `http:` or `https:`;
   - `new URL(h).origin === h`, so it has no path, no trailing slash and no upper case;
   - it is at most 255 characters.

   `null`, an absent header, `file://`, `chrome-extension://` and any non-canonical form are refused at upgrade with the existing 403, and the existing warning is logged once.
2. **Host check against DNS rebinding.** When the link is bound to loopback (the default), the upgrade's `Host` header must be `localhost:<port>` or `127.0.0.1:<port>`, or a 403 follows. Under `allowNonLoopback` this check is skipped; that mode belongs to 68.
3. **`--allow-origin` becomes an optional extra restriction.** `LinkServerOptions.allowedOrigins` becomes optional and keeps its name, so the native-proof harnesses still compile unchanged. Undefined or empty means any canonical origin may reach `hello`. Non-empty means only those origins may, and every other origin gets the 403 at upgrade. `DEFAULT_ALLOWED_ORIGINS` is deleted. The CLI passes `allowedOrigins` only when `--allow-origin` is given with a non-empty value, as it does today.
4. **Rules at `hello`.** The canonical origin from upgrade is passed into `handshake`.
   - `pairingCode`: a valid code creates a pairing with `origin` set to that exact string. The code is the proof of consent, because it is shown only in the user's local stderr or log and in the MCP `pairing` notice.
   - `pairingToken`: accepted only if `row.origin === origin`, and also the existing revoked, world and user checks. A row with `origin` NULL (made before this task) is refused (see 7).
   - Every refusal at `hello` replies `PAIRING_INVALID` with a message that names the reason: `no valid pairing code`, `pairing was made from a different origin`, or `pairing predates origin binding; pair again with a code`. The message never includes the stored origin.
   - The gateway logs one stderr line per distinct (origin, reason). It uses the existing `warned` set and its cap of 20, through `onOriginRejected(origin, reason)`, and passes the origin through `sanitizeOrigin`. The new text names the origin and the reason. For a code refusal it also says where the code is (the gateway log or the client's MCP log). It no longer mentions a Foundry URL setting.
5. **Code brute force.** A new `gateway/src/link/code-attempts.ts` exports `MAX_FAILED_CODE_ATTEMPTS = 10` and `CODE_ATTEMPT_WINDOW_MS = 60_000`. Failed `pairingCode` hellos are counted globally, across all origins, in a rolling window. While the count is at the limit, a `pairingCode` hello is refused with `RATE_LIMITED` before `codes.consume` is called, so a valid code is not spent. Token hellos are not counted, since a token is 32 random bytes.
   - The bound is at most 100 guesses in a code's 10-minute life against 31^8 (about 8.5e11) codes.
   - The cost is that a hostile page that stays open can keep legitimate pairing rate-limited. The log line names its origin, so the user can close that page.
   - `MAX_PENDING_HANDSHAKES = 16` caps sockets that have upgraded but not yet sent `hello`. The next upgrade gets `503` and closes.
6. **No module or protocol change.** `RATE_LIMITED` and `PAIRING_INVALID` already exist in `ErrorCode`. The module already behaves as follows:
   - It does not connect without a code or a stored token.
   - It drops a token that gets `PAIRING_INVALID`.
   - It keeps its token when a code is refused.

   Origin refusals now arrive as a proper `reject` instead of a bare 403, so the module shows "pairing invalid" or "pairing required" instead of a silent failure.
7. **Migration and existing pairings: require a re-pair.** `007-pairing-origin.ts` is `ALTER TABLE pairings ADD COLUMN origin TEXT` (nullable, no default). Existing rows keep `origin` NULL and are not revoked. Their tokens are refused as in 4, the module clears its token, and the user enters one new code. The alternative was binding a legacy row to the first origin that presents its token. It was rejected for three reasons:
   - (a) Until that first use, the "a token works only from its own origin" invariant would not hold, and a test could not prove it.
   - (b) No released build has pairings yet. 0.1.0 is not cut, so the only rows are Andrew's dev, Desktop and e2e ones.
   - (c) A re-pair costs one code entry.

   `PairingRow` gains `origin: string | null`. `NewPairing` gains a required `origin: string`. `listActivePairings` is unchanged, and legacy rows stay in `knownIdentities`.
8. **Role comes from Foundry only.**
   - Delete `role` from `ConfigSchema` and `AGENT_GATEWAY_ROLE` from `ENV_KEYS`.
   - When `AGENT_GATEWAY_ROLE` is set, or the config file has a `role` key, `loadConfig` reports it, and the CLI writes one stderr line: `AGENT_GATEWAY_ROLE / config "role" is ignored: the tool tier comes from the Foundry user's role`. The value is otherwise ignored, so an old config still starts.
   - Delete the legacy `gateway/src/mcp/server.ts` and `gateway/src/mcp/index.ts`, and `ModuleConnections`/`EmptyModuleConnections` in `app.ts`.
   - The tier stays as in `session.ts:83-90`: `conn.info.isGM` from the authenticated `hello`, then the module's announced set.
   - No environment override is kept. Tests drive the tier through the fake module's `isGM`. Headless mode (37) logs in as a real Foundry user whose role decides.
   - Threat note for the PR: `hello.user.isGM` is the module's report from the user's own browser. A tampered client could claim GM, but the gateway tier is only a filter. The module re-checks `game.user.isGM` at dispatch, and Foundry's server enforces the user's real permissions on every write.
9. **69's relay fingerprint after this task.** `RelayConfig` becomes `{allowOrigins, httpPort, logLevel, startedAt}`:
   - `role` is removed.
   - `origins` is renamed to `allowOrigins` and means only the optional `--allow-origin` restriction, sorted; empty means unrestricted.
   - `httpPort` and `logLevel` are added, so a changed Desktop setting hands over to the new instance without a restart.
   - The link port stays a handshake field (`RELAY_PORT_MISMATCH`), not a fingerprint field.
   - `--world`/`--user` stay under `RELAY_SELECTOR_MISMATCH`.

   `describeConfigDiff` names each differing field and passes each value through `safeText`. If 69 merged without a fingerprint, this task adds one with exactly these fields and 69's step-down rule.
10. **Manifest.**
   - `args` becomes `["${__dirname}/dist/bin/cli.js"]`.
   - `env` keeps exactly `AGENT_GATEWAY_LINK_PORT`, `AGENT_GATEWAY_HTTP_PORT` and `AGENT_GATEWAY_LOG_LEVEL`.
   - `user_config` keeps exactly `link_port`, `http_port` and `log_level`. Each has a default and `required: false`, and its description starts with `Advanced.`
   - `foundry_url` and `role` are gone.

## Threat model (the PR restates it; 65 turns it into user docs)
- **A malicious page in the same browser** can open `ws://localhost:7420`, since the Origin check no longer blocks it at upgrade. It cannot pair without the code, which it never sees. It cannot read another origin's localStorage token. Its guesses are capped by Design 5. Its pre-`hello` sockets are capped and time out after 10 s.
- **Token replay from another origin** is refused at `hello` (Design 4). A non-browser local process can forge `Origin`, but it would also need the token, which is stored hashed by the gateway and held only in the paired origin's localStorage. Same-user local processes are outside the local-mode trust boundary, as before.
- **DNS rebinding.** A rebound page still sends its own Origin, so it is just an unknown origin that needs a code. The loopback `Host` check (Design 2) refuses it at upgrade anyway.
- **http vs https of one host** are different origins. A token from `https://foundry.local` is refused from `http://foundry.local`, and each must pair separately. Since localStorage is per origin as well, the module never sends the token there in normal use.
- **Phishing the code** (a user typing it into a hostile page) is not defended. The code's 10-minute life and single use limit the damage. 65 documents it.

## Acceptance
- [ ] Unit tests in `gateway/test/link/origin-pairing.test.ts`, against a `LinkServer` with no `allowedOrigins`, each as its own `it`:
  - (a) A code hello from `https://foundry.local` gets `welcome` with a `pairingToken`, and the stored row has `origin === 'https://foundry.local'`.
  - (b) That token reconnects from `https://foundry.local` and gets `welcome`.
  - (c) The same token from `http://foundry.local` gets `reject` `PAIRING_INVALID`, and so does the same token from `https://evil.example`.
  - (d) A hello from `https://evil.example` with no valid code gets `PAIRING_INVALID`, and no pairing row is created.
  - (e) A token whose row has `origin` NULL gets `PAIRING_INVALID` from any origin.
  - (f) Origins `null`, absent, `file://`, `HTTPS://Foundry.Local`, `https://foundry.local/` and a 256-character origin get a 403 at upgrade.
  - (g) `Host: evil.example:<port>` gets a 403 at upgrade, and `Host: localhost:<port>` and `127.0.0.1:<port>` are accepted.
  - (h) With `allowedOrigins: ['https://foundry.local']`, a valid code from `http://localhost:30000` gets a 403 at upgrade.
- [ ] `gateway/test/link/code-attempts.test.ts`:
  - After 10 failed code hellos within 60 s, the 11th hello carrying the **valid** code gets `RATE_LIMITED`, and the same code still pairs once the window has passed (fake clock).
  - Token hellos are never counted.
  - The 17th socket that never sends `hello` gets a 503.
- [ ] Logging: the once-per-(origin, reason) stderr line is covered in `gateway/test/bin/link-conflict.test.ts` against the built CLI. It is written once for two refusals from `https://evil.example`. A 300-character origin is truncated with `...` and the line is under 400 characters. No line contains `Foundry URL`.
- [ ] Integration, built CLI with no `--allow-origin` (`gateway/test/bin/link-conflict.test.ts`): a `ws` client with `Origin: https://foundry.local` pairs using the code from stderr and reconnects with its token. A second client presenting that token with `Origin: http://foundry.local` is refused, and the first client stays connected.
- [ ] Migration: `MIGRATIONS` has 7 entries, and `gateway/test/store/store.test.ts` proves two things:
  - A db at `user_version` 6 with one pairing migrates to 7, and that row reads back `origin: null` and `revokedAt: null`.
  - `createPairing` without `origin` fails `tsc`, enforced by the type, not a runtime check.

  The existing registry-order test passes.
- [ ] Role, in `gateway/test/routing/role-source.test.ts`, through the conformance fake module:
  - A session bound to a module with `isGM: true` lists the GM-tier fixture tool. A session bound to a module with `isGM: false` does not list it, and calling it returns `FORBIDDEN`.
  - Both hold with `AGENT_GATEWAY_ROLE=gm` and with `AGENT_GATEWAY_ROLE=player` set in the env given to `loadConfig`.
  - An MCP `tools/call` with `_meta: {role: 'gm'}` and an argument named `role` changes nothing.
- [ ] `rg -n "AGENT_GATEWAY_ROLE|config\.role|createMcpServer|EmptyModuleConnections|DEFAULT_ALLOWED_ORIGINS" gateway/src` prints only the ignored-setting warning in `gateway/src/config/index.ts`.
- [ ] `gateway/test/config/config.test.ts`: a config file `{"role":"gm"}` and `AGENT_GATEWAY_ROLE=gm` both load without error and report the ignored setting once. `Config` has no `role` key (type test).
- [ ] Relay fingerprint (`gateway/test/relay/server.test.ts`, `relay config fingerprint` block):
  - Configs that differ only in `allowOrigins`, `httpPort` or `logLevel` are refused or stepped down, as 69 does today.
  - A config with no `role` field parses.
  - `rg -n "role" gateway/src/relay/config.ts` prints nothing.
- [ ] Manifest (`node --test scripts/test/build-mcpb.test.mjs`):
  - `user_config` keys are exactly `link_port`, `http_port` and `log_level`. Each has `required: false`, a default, and a description starting with `Advanced.`
  - `mcp_config.args` equals `["${__dirname}/dist/bin/cli.js"]`.
  - The `env` keys are exactly the three named in Design 10.
  - No string in the manifest contains `foundry_url`, `role` or `allow-origin`.
  - The built bundle's entry still runs.
- [ ] `npm run verify` passes
- [ ] Manual (Andrew, Mac, Claude Desktop), recorded in the PR:
  1. Uninstall the old extension and move `~/.foundry-agent-gateway/gateway.db` aside.
  2. Install the rebuilt `.mcpb` and change no setting.
  3. Open a normal chat, open https://foundry.local as the GM, and enter the pairing code from `~/Library/Logs/Claude/main.log` in the module's pairing window. It connects.
  4. Without restarting Claude Desktop or the extension, `world_info` succeeds in that normal chat and in a Cowork chat.
  5. In the same window, the Foundry tab at `http://foundry.local` (if served) is asked for a code rather than connecting.
- [ ] The PR states that Andrew must re-run `npm run test:e2e:setup` once, because existing e2e pairings have no origin (Design 7).

## Out of scope
- Any file under `module/**` or `protocol/**`. If a new error code, a localised message or a module change turns out to be needed, stop and report.
- Server-mode pairing confirmation and non-loopback hosts (68, 38)
- Pairing revocation and a UI to list pairings (36)
- Task 34's HTTP transport. This task only keeps `httpPort` in config and in the relay fingerprint.
- `e2e/**`: the harness keeps passing `--allow-origin`, which is still valid
- User docs, the security model and the threat model write-up for users: 65 (`docs/security.md`, guides) and the scribe (`docs/architecture.md`)
- Binding by user id instead of name (PLAN "Follow-ups from wave 4")
