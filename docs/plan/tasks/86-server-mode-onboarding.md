# 86 — Make server-mode onboarding one paste

**Repo:** .
**Depends on:** none (68's invites are on main at 6672f9d)
**Status:** Friend-test feedback, Andrew 2026-10-14. Andrew chose all four improvements: the one-paste invite string, a world-level default gateway URL, server-mode wording, and a not-connected hint.
**Owns:**
- module/src/link/invite-string.ts (new). A pure parser for what a player pastes, either an invite string or a bare code. It has no Foundry globals, so it can be tested on its own.
- module/src/link/gateway-url.ts (new). Pure helpers: resolve the effective gateway URL (client override, then world default, then `ws://localhost:7420`), decide whether a host is loopback, make a display-safe form of an address, and the server-mode heuristic (decision (e)).
- module/src/link/runtime.ts (only the `getGatewayUrl` dependency at :39, plus its import). It must read the effective URL rather than the raw client setting. Otherwise the world default never reaches the link.
- module/src/settings/index.ts. Insertion: a new registrar for the world setting `defaultGatewayUrl`, pushed onto `settingRegistrars`. Allowed edits to existing lines, which is an exception to the insertion-only rule: in `gatewayUrl`'s registration, only `default:` (:19, from `'ws://localhost:7420'` to `''`) and `hint:` (:15, pointed at a new lang key). This is how decision (b) detects "not set by the player", and it cannot be done by insertion.
- module/src/apps/pairing/index.ts (`describeState`, `_prepareContext`, `onSubmit`, `updateStatus`, plus new helpers). This is where the paste is handled, the wording is chosen and the address is shown.
- templates/pairing/pairing.hbs (the field labels and hints, the address line, the server-mode block, and moving "Copy my ids" next to the invite field).
- lang/en.json (insertions only, under `AGENT_GATEWAY.Pairing.Invite.*`, `AGENT_GATEWAY.Pairing.Server.*`, `AGENT_GATEWAY.Pairing.Address.*`, `AGENT_GATEWAY.Settings.gatewayUrlOverride.*` and `AGENT_GATEWAY.Settings.defaultGatewayUrl.*`). Existing values are not edited: the shared-file rule applies, and local mode keeps its "pairing code" wording.
- module/test/link/invite-string.test.ts (new). Parser tests, including malicious strings.
- module/test/link/gateway-url.test.ts (new). Resolution order, legacy-default handling and display sanitising.
- module/test/apps/pairing-onboarding.test.ts (new). Submit flows, wording and the not-connected hint, using the existing stubs.
- module/test/link/pairing.test.ts. Edit an existing assertion only where this task changes the behaviour it pins (an empty URL now means "inherit"). Add no new cases here; they go in the new file.
- module/test/settings/settings.test.ts (insertions only: assertions for `defaultGatewayUrl`, scope `world`, `restricted: true`, and `gatewayUrl` default `''`).
- gateway/src/bin/cli.ts (the `--invite` branch of `runOperatorCommand`, :280-287, plus a small formatter function next to it, and the `--invite` lines of `USAGE`, :46-49). Nothing else in this file. The `--public-url` option already exists in `parseArgs`.
- gateway/test/bin/invite-string-cli.test.ts (new). It spawns the CLI the way gateway/test/bin/invite-cli.test.ts:28-41 does. Copy that helper; do not import it.
- gateway/src/mcp/status-tool.ts (the string literals at :18 and :36 only) and gateway/src/mcp/session.ts (the string literal at :283 only). This is task 68's wording residual (docs/plan/done/68-server-mode-pairing-confirmation.md:200, :244). It is cheap: three literals, and no test asserts them (`rg "operator for a (pairing )?code" gateway/test` is empty at 6672f9d). It is justified because the status tool is what a player's AI reads aloud when they are not connected. If it says "pairing code" while the window says "invite", that is the same confusion this task fixes.

## Goal
Joining a hosted gateway currently takes four manual steps, and a wrong gateway URL fails silently. After this task the GM sets the gateway address once for the world. The operator's `--invite` prints one string that carries both the address and the code. A player pastes that string, and the module sets the address, connects and pairs in one step. In server mode the pairing window talks about invites rather than pairing codes. When the window cannot reach the gateway, it says so and shows which address it tried. The link protocol does not change.

## Decisions (made here; Andrew may override)
- **(a) Invite string format: `wss://<host>/link#<CODE>`**, for example `wss://gw.aindriub.app/link#ABCD-EFGH-JKMN`. It is preferred over an opaque `agw1:<base64url>` token for these reasons:
  - The player and the operator can read which server it points at before pasting. An opaque blob hides the one thing a phishing check needs.
  - Its address part is exactly the value the module stores. The fragment is never sent by a WebSocket client or a browser, so it is the safest place for the code if the string ends up somewhere unexpected.
  - Codes are `[A-HJKMNP-Z2-9]` with dashes (gateway/src/link/invites.ts:6), so they never collide with URL syntax.
  - A future format change can use a fragment prefix such as `#v2.`.

  The cost: `new WebSocket()` throws on a URL with a fragment, so the string must never be stored as the address. Every input path goes through the parser (Acceptance, "paste routing").
- **(b) "The player has set it" means a non-empty client `gatewayUrl`.** The client default becomes `''` (inherit). Foundry stores a client setting only once it has been set, so a player who never touched it inherits from now on with no migration. A separate `gatewayUrlOverride` setting was rejected: it means two settings for one idea, and it needs a migration of today's stored values.

  Legacy: until now the pairing window saved the URL field on every submit, so many players have the literal old default `ws://localhost:7420` stored. That includes Andrew's browser, which "silently never connected". So the resolver treats a stored value that is exactly `ws://localhost:7420` as "inherit" whenever the world default is set and valid. A player who really wants a local gateway in a world with a default enters `ws://127.0.0.1:7420`. **Decision for Andrew.**
- **(c) World default trust.** `defaultGatewayUrl` is world-scoped, `restricted: true` and `config: true`, so only a GM can set it.

  A malicious GM could point players' modules at another server. That is acceptable, because a GM already runs arbitrary script in every player's client (macros, world scripts, module settings), so this grants nothing new. Existing bindings also limit the damage:
  - The stored token is sent only to the URL that issued it (module/src/link/client.ts:268-272).
  - A typed code is sent only to the URL it was entered for (:371-376).

  So a redirected module sends at most a `hello` carrying world and user ids and the user's name, never a credential. The player's own non-empty override always wins over the GM's value. Identity is unchanged: it always comes from `game.user`, the user Foundry's server set.
- **(d) Validation strength.** The world default and the address in an invite string are strictly validated: `wss:`, or `ws:` only on a loopback host; no credentials, query or fragment; at most 2048 characters. The player's typed override keeps today's leniency. module/test/link/pairing.test.ts uses `ws://gw`, and a stricter check could break existing setups. It only rejects a fragment or credentials, which never work anyway.
- **(e) How the module knows it is in server mode.** It uses the effective address: a non-loopback host means server mode. Below are what the module can learn today and why each was not used:
  - `welcome` is a `z.strictObject` (protocol/src/link/messages.ts:40-47), so a new field would make older modules reject every `welcome`. That is a protocol break.
  - The only server-mode signal on the wire is the reject text `no valid invite` (gateway/src/link/server.ts:524-526), which arrives only after a failed attempt.
  - Without `--public-url`, the gateway refuses to bind the link to anything but loopback (gateway/src/config/index.ts:193-195).

  So a non-loopback address is always a gateway whose codes come from an operator: server mode, or public mode where codes are only in the operator logs. Either way, "ask the GM or operator for an invite" is the right advice.
- **(f) `--invite`'s public URL** comes from `--public-url`, then `AGENT_GATEWAY_PUBLIC_URL`. Both Compose files set the environment variable (gateway/docker/compose.yaml:15, compose.byo-caddy.yaml:17), so `docker compose exec gateway <cli> --invite` gets it with no flag. The `--config` file is not read; the one-shot commands deliberately do not call `loadConfig`. With neither set, the output is today's bare code, unchanged.

## Context
- module/src/settings/index.ts:12-20. The client `gatewayUrl` setting has the default `ws://localhost:7420`. :50-56 is the registrar list; insertion only (docs/conventions.md, "Shared insertion-only files").
- module/src/link/runtime.ts:39. `getGatewayUrl` reads the raw client setting. Nothing else in the module reads it (`rg gatewayUrl module/src`).
- module/src/link/client.ts:
  - :16-19 `LinkState`;
  - :28-33 `normalizeGatewayUrl`;
  - :268-272 `tokenForUrl`, which binds the token to its URL;
  - :301-309 `start()`, which does nothing without a stored token;
  - :327-332 `pair(code)`, which records `codeUrl` from `getGatewayUrl()` when it is called;
  - :371-376 the code is never sent to a different URL;
  - :516-534 `reject` handling;
  - :622-625 `scheduleRetry('ERROR')`, the can't-reach state.

  client.ts is not owned and needs no change.
- module/src/apps/pairing/index.ts:
  - :23-40 `describeState`;
  - :71-80 `_prepareContext`;
  - :87-91 `updateStatus` writes through `textContent`, so keep it that way;
  - :105-133 `onSubmit`, which saves the URL field on every submit and returns silently on an empty URL (:109). That is also the open item at docs/plan/PLAN.md:147.
- templates/pairing/pairing.hbs:1-20. Every value uses `{{ }}`, and must stay that way: never `{{{ }}}`.
- lang/en.json:37-41 (`Settings.gatewayUrl`), :101-111 (`Link.*`), :115-133 (`Pairing.*`, with 68's `CopyIds`).
- gateway/src/bin/cli.ts:
  - :46-49 `USAGE` for `--invite`;
  - :197-252 `operatorCommandOf`;
  - :280-287 the `--invite` branch: the code goes to stdout alone, and target and expiry go to stderr;
  - :418 `values['public-url']`.
- gateway/src/config/index.ts:78-97. `normalizePublicUrl` returns a bare `https:` origin, or `http:` on loopback. Reuse it to validate the flag or environment value.
- gateway/test/bin/invite-cli.test.ts:87-108. The existing `--invite` test expects a bare code on stdout. It must keep passing, so that test runs without a public URL.
- Task 68's contract and residuals: docs/plan/done/68-server-mode-pairing-confirmation.md.

## Acceptance
**Gateway `--invite` output**
- [ ] `--invite w u --public-url https://gw.example.com` prints exactly one stdout line, matching `^wss://gw\.example\.com/link#[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}\n$`. The same output appears with `AGENT_GATEWAY_PUBLIC_URL=https://gw.example.com` and no flag. With both set, the flag wins.
- [ ] `--public-url http://localhost:8080` gives `ws://localhost:8080/link#<CODE>`.
- [ ] An invalid `--public-url` (for example `http://gw.example.com` or `https://gw.example.com/x`) exits 2 with `normalizePublicUrl`'s message. No invite is created: the invites table is still empty.
- [ ] With no public URL, stdout is the bare code alone, as today, and gateway/test/bin/invite-cli.test.ts passes unchanged.
- [ ] The code never appears on stderr in any case. The test asserts this by searching stderr for the code.
- [ ] stderr names the target and expiry as today. With a public URL, it adds one line saying that players on an older module enter only the part after `#`.
- [ ] The `USAGE` text for `--invite` mentions the one-paste string and `--public-url` / `AGENT_GATEWAY_PUBLIC_URL`.

**Parser (module/src/link/invite-string.ts)**
- [ ] `parsePairingInput(text)` returns one of:
  - `{ kind: 'invite', url, code }`
  - `{ kind: 'code', code }`
  - `{ kind: 'invalid', reason }`

  `reason` is a fixed enum and never contains any of the input.
- [ ] Input is trimmed first. Any input that contains `:` or `#` is parsed as an invite string. Any other input of 1 to 64 characters with no whitespace or control characters is a bare code, passed through unchanged apart from the trim (the existing `' abc '` → `'abc'` behaviour holds).
- [ ] An invite string is valid only if all of these hold:
  - it is at most 2048 characters;
  - it parses with `new URL`;
  - the protocol is `wss:`, or `ws:` with a loopback host (`localhost`, `127.0.0.0/8` or `[::1]`);
  - it has no username or password;
  - the pathname is exactly `/link`;
  - it has no query;
  - the fragment matches the invite code pattern, case-insensitively, and is returned upper-cased.

  The returned `url` has no fragment.
- [ ] Tests show that each of these returns `invalid` and leaves no state behind:
  - `javascript:alert(1)#ABCD-EFGH-JKMN`
  - `data:text/html,<script>#…`
  - `https://gw/link#<CODE>` (wrong scheme)
  - `ws://gw.example.com/link#<CODE>` (ws to a non-loopback host)
  - `wss://u:p@gw/link#<CODE>`
  - `wss://gw/link?x=1#<CODE>`
  - `wss://gw/other#<CODE>`
  - `wss://gw/link#` and `wss://gw/link` (an address without a code)
  - `wss://gw/link#<script>`
  - a code containing whitespace, newlines or a NUL character
  - a 2049-character string
  - `wss://gw/link#<CODE>#x`
- [ ] Tests show that these parse: the exact gateway output from the CLI test's format; a lower-case code; and the same string with surrounding whitespace.

**World default and effective URL**
- [ ] `defaultGatewayUrl` is registered with `scope: 'world'`, `restricted: true`, `config: true`, `type: String` and `default: ''`, with name and hint keys under `AGENT_GATEWAY.Settings.defaultGatewayUrl.*`.
- [ ] The client `gatewayUrl` setting's default is `''`. Its hint key says that an empty value uses the world's default.
- [ ] `effectiveGatewayUrl(client, world)` returns these, each a unit test:
  - the client value when it is non-empty and not the legacy default (decision (b));
  - otherwise the world value when it passes the strict check (decision (d));
  - otherwise `ws://localhost:7420`.
- [ ] A client value of exactly `ws://localhost:7420` resolves to a valid world default, and to `ws://localhost:7420` when there is none.
- [ ] An invalid world default is ignored. The pairing window shows a GM-only warning saying it is not a valid `wss://` address.
- [ ] A client value with a fragment or credentials is never returned as a connectable URL. The window says the address is not valid, and nothing is sent.
- [ ] module/src/link/runtime.ts uses `effectiveGatewayUrl`. Test: with no client value and a world default of `wss://gw.example.com/link`, `getLinkClient()` creates its socket for that URL after `pair('X')`.

**Paste routing and submit (module/src/apps/pairing/index.ts)**
- [ ] On submit, the code field and then the URL field each go through `parsePairingInput` first. A valid invite string in either field does all of the following in order, and the test asserts the order:
  1. It ignores the other field.
  2. It sets the client `gatewayUrl` to `''` if the invite's address equals the effective world default after `normalizeGatewayUrl`, and otherwise to the address.
  3. It awaits that write.
  4. It calls `getLinkClient().pair(code)`.

  The setting value never contains `#`.
- [ ] An invalid invite string in either field changes no setting and calls neither `pair` nor `start`. It shows one localized warning that does not contain the input.
- [ ] A bare code in the code field keeps today's behaviour against the URL field's value.
- [ ] An empty URL field now clears the client override (inherit) instead of returning silently. If it equals the world default, the stored value is `''`.
- [ ] A typed URL that equals the effective world default is stored as `''`, so a later change to the world default still applies.

**Wording and hint**
- [ ] When decision (e) says server mode:
  - the code field's label and hint use `Pairing.Invite.*` (paste the invite from your GM or the gateway operator; a bare code also works);
  - the window shows a `Pairing.Server.*` line telling the player to ask the GM or operator for an invite, with "Copy my ids" directly beside it;
  - `pairingRequired`, `pairingInvalid` and `codeRequired` are shown through `Pairing.Server.*` variants that say "invite".
- [ ] On loopback addresses, every existing local-mode string is shown unchanged. A test asserts the exact existing keys.
- [ ] The window always shows the effective address in display-safe form: scheme, host, port and path only, with no userinfo, query or fragment. If it is inherited from the world default, it says so.
- [ ] While the state is `disconnected` with reason `ERROR` (retrying), the window shows "Can't reach the gateway at <address>" (`Pairing.Address.unreachable`). While it is `connecting`, it shows "Connecting to <address>…". `updateStatus` refreshes both.
- [ ] The token and the code are never rendered. A test renders the context with a stored credential and an in-flight code, and asserts that neither string appears in any context value.
- [ ] The template adds no `{{{`, and dynamic text is set only through `{{ }}` or `textContent`. Checked by `rg -n '\{\{\{' templates/pairing` and `rg -n 'innerHTML' module/src/apps/pairing`, both empty.

**Gateway wording residual**
- [ ] gateway/src/mcp/status-tool.ts:18 and :36 and gateway/src/mcp/session.ts:283 say "invite" where they told the user to ask the operator. Local-mode wording ("the pairing code to enter …") is unchanged. No other line in those files changes.

**Gate**
- [ ] No file in protocol/** changes, and `git diff origin/main -- protocol` is empty.
- [ ] `npm run verify` passes.

## Out of scope
- Any change to the link protocol, `hello`, `welcome`, `reject` or the gateway handshake (gateway/src/link/**). For example, there is no server-mode flag on `welcome`.
- module/src/link/client.ts. Its URL binding of token and code is relied on as it is.
- Validating or restricting the player's typed override beyond rejecting fragments and credentials (decision (d)).
- Any other `--invite` behaviour (TTL, origin, storage), the other operator commands, and reading `--config` for the public URL.
- Editing existing lang/en.json values, and styles/agent-gateway.css.
- Docs: docs/server-mode.md (operator flow), gateway/docker/README.md:95-121 (the invite step: "set the gateway URL to `wss://<domain>/link` and enter the code" becomes "paste the invite string"; the GM sets the world default) and closing docs/plan/PLAN.md:147. These are for the scribe.
- GM-attested self-onboarding, and a gateway-served discovery endpoint.
