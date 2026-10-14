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

## Review round 1 — findings

Reviewed HEAD: a6e74b3 (branch claude/task-86).

VERDICT: FIX

FINDINGS
- [P2] module/src/settings/index.ts:13-20 (client `gatewayUrl`, `config: true`) and :53-63 (`defaultGatewayUrl`, `config: true`). Foundry's Configure Settings form is a second way to enter the address, and it skips `parsePairingInput`. So an invite string, code included, can be stored as the gateway address. Decision (a) says "Every input path goes through the parser". The pairing window covers its own paste; the settings form does not.
  route: orchestrator. Fixing this needs an `onChange` or validation on the `gatewayUrl` registration. Owns allows only the `default:` and `hint:` lines to change there. Or it needs a new decision, for example that the pairing window takes over a stored invite string and redeems it. Either way it is outside what the task allows.
  input: a player opens Configure Settings → Agent Gateway → Gateway URL and pastes `wss://gw.example.com/link#ABCD-EFGH-JKMN` (the natural move for anyone told to "set the gateway URL").  →  The client setting stores the whole string, code included. The resolver marks it `clientInvalid` and silently falls back to the world default or localhost, so the invite is never redeemed. `_prepareContext` (module/src/apps/pairing/index.ts, `gatewayUrl: ... raw`) then puts the code into the URL input's value. The same thing happens if a GM pastes an invite into `defaultGatewayUrl`. That value is a world setting, so it reaches every client in the world, and the pairing window only shows the GM a generic "not a valid wss:// address" warning.
- [STYLE] module/test/settings/main.test.ts:13 is outside Owns. The edit changes the registered-setting count from 12 to 13.
  route: orchestrator. Owns must be amended. My view: accept it. The change is required, because adding `defaultGatewayUrl` breaks this assertion. It is one number and pins nothing new.
  rule: the task file's Owns list; PROJECT.md rule 2.
- [P3] module/src/link/gateway-url.ts:39-43 (`clientUsable`). The lenient credentials check only matches the `scheme://` shape. WHATWG URL parsing (and so `new WebSocket`) also reads userinfo out of `ws:\\u:p@host`, `ws:/u:p@host` and `ws:u:p@host`. Those values pass, and are returned as a connectable `source: 'client'` URL.
  route: implementer. The acceptance item "A client value with ... credentials is never returned as a connectable URL" already covers this. Loosening the regex to `^[a-z][a-z0-9+.-]*:[\\/]*[^/\\?]*@` would do it, and still needs no `URL` global.
  input: the client setting is `ws:\\u:p@evil.com/link`  →  `resolveGateway(c,'')` returns `{source:'client', clientInvalid:false}`, and `new URL` gives username `u`, password `p` (probed on a scratch copy). Only the player can set this value, so the impact is low. `displayAddress` strips the userinfo, so nothing is shown.
- [NOTE] gateway/test/bin/invite-cli.test.ts:33 (not owned, unchanged). Its spawn helper inherits `process.env` and does not blank `AGENT_GATEWAY_PUBLIC_URL`. On a machine or CI shell where that variable is set, the "bare code" test now fails, because stdout is the one-paste string. The new invite-string-cli.test.ts blanks it correctly. This is a candidate for a follow-up, not this task.
- [NOTE] module/src/link/gateway-url.ts:63-66. When the client value is invalid (fragment or credentials), the resolver falls back to the world default and the link connects there. Nothing goes to the bad address, but the acceptance wording "nothing is sent" could be read more strictly. The pairing window shows the invalid-address warning in either case.

Checked and found sound:
- **Parser:** it rejects every malicious form in the acceptance list, plus lookalike loopback hosts, an empty `?`, `..`-style path tricks, and backslash authority tricks. `reason` is a fixed enum, and warnings use a fixed localized key, so the input is never echoed. The returned url is rebuilt from the parsed parts, so it never carries a fragment.
- **Template:** it adds no `{{{`, and the lines are updated only through `textContent`. `displayAddress` drops userinfo, query and fragment.
- **Resolution:** the order is right, including the legacy `ws://localhost:7420` handling. `defaultGatewayUrl` is world-scoped and `restricted: true`.
- **CLI (gateway/src/bin/cli.ts, `invitePublicLink`):** it runs before `createInvite`, so a bad URL exits 2 with the table empty (and the test checks the table). The flag wins over the environment variable. The code goes only to stdout. Exiting inside the `try` matches the existing pattern at :302.
- **Wording:** the gateway changes are the three literals only, and no gateway test asserts the old text.
- **Protocol:** unchanged.

Mutation proofs (scratch copy, module/test/link/invite-string.test.ts only; baseline 38 passed):
- Removing the empty-`?` check failed 1 test.
- Removing the username/password check failed 2.
- Removing the pre-parse BAD_CHARS check failed 3 (newline and tab cases).
- Removing the ws-loopback restriction failed 2.

SCOPE: module/test/settings/main.test.ts

## Amendment 1 (Andrew, 2026-10-14)

Decisions on the review round 1 findings. Where this section conflicts with Owns, Acceptance or Out of scope above, this section wins.

1. **Foundry's Configure Settings form must not bypass the parser (P2).** Decision (a) says every input path goes through the parser, and the settings form is an input path. Telling someone to "set the gateway URL" makes pasting there the natural move, so leaving it open means invites silently fail and a code can be stored, rendered and, for the world setting, broadcast.
   - **Owns widens.** In module/src/settings/index.ts, the `gatewayUrl` registration (in `registerFoundation`) may gain an `onChange` (or equivalent) property, and `registerDefaultGatewayUrl` may gain one too. The handlers may live in module/src/settings/index.ts or in a new module/src/settings/gateway-url-guard.ts; module/src/settings/gateway-url-guard.ts (new) is added to Owns. No other existing line in module/src/settings/index.ts changes.
   - **Owns adds** module/test/settings/gateway-url-guard.test.ts (new). It sits beside the existing module/test/settings/settings.test.ts and main.test.ts, which is where the module tests its setting registrations.
   - **Client `gatewayUrl`.** If the stored value is an invite string, the handler stores only the address and redeems the code, the same way the pairing window does: the same address-or-`''` rule (equal to the effective world default after `normalizeGatewayUrl` means `''`), the write awaited, then `getLinkClient().pair(code)`. Reason: the player's intent is unambiguous, and doing what the pairing window does keeps one behaviour for one paste. Share the pairing window's redeem helper rather than duplicating it.
   - **World `defaultGatewayUrl`.** If the value is an invite string, the handler stores only the address, drops the code and shows the GM a localized warning that the code was not kept and must be given to each player. Reason: a world setting reaches every client in the world, so a code stored there would be handed to everyone, and redeeming it on the GM's client would pair the wrong user. If a pre-save hook (`preCreateSetting` / `preUpdateSetting` for key `agent-gateway.defaultGatewayUrl`, run on the writing client) is available on Foundry 13, prefer it, so the code is stripped before the write leaves the GM's browser. Otherwise use `onChange`, which acts only on a GM's client (`game.user.isGM`), so non-GM clients never write.
   - **Either setting: invalid value.** A value that fails its check (client: the lenient check of decision (d); world: the strict check) is reset (client to `''`; world to `''`). A localized notification is shown that never echoes the input. Reason: a stored invalid value currently falls back silently and is re-rendered into the pairing window's URL field.
   - The handler's own corrective write must not loop. A reset or address-only write re-enters the handler with a valid value and does nothing.
   - Insertions to lang/en.json for these notifications go under `AGENT_GATEWAY.Settings.gatewayUrlOverride.*` and `AGENT_GATEWAY.Settings.defaultGatewayUrl.*`, which are already in Owns.

   Added acceptance (each a test in module/test/settings/gateway-url-guard.test.ts, driving the handler through the registered `onChange` or hook, in the way module/test/events/offline-setting.test.ts:64 calls `onChange`):
   - [ ] Client `gatewayUrl` set to `wss://gw.example.com/link#ABCD-EFGH-JKMN` with no world default: the setting ends as `wss://gw.example.com/link`, and `pair('ABCD-EFGH-JKMN')` is called once, after the write resolved. The test asserts the order.
   - [ ] The same paste when the world default is `wss://gw.example.com/link`: the client setting ends as `''`, and `pair` is called once.
   - [ ] Client `gatewayUrl` set to an invalid invite string, or to a value with credentials or a fragment that does not parse as an invite: the setting ends as `''`; `pair` and `start` are not called; one notification is shown, and its text does not contain the input.
   - [ ] Client `gatewayUrl` set to a plain valid address (for example `ws://gw`): the handler does not write and does not notify.
   - [ ] World `defaultGatewayUrl` set by a GM to `wss://gw.example.com/link#ABCD-EFGH-JKMN`: the stored value ends as `wss://gw.example.com/link`; `pair` is not called; one warning is shown, and it does not contain the code. If a pre-save hook is used, the test asserts the data passed on to the write has no `#`.
   - [ ] World `defaultGatewayUrl` set to an invalid value (for example `http://gw.example.com` or `ws://gw.example.com`): the stored value ends as `''`, with one notification that does not contain the input.
   - [ ] World `defaultGatewayUrl` handler on a non-GM client: no setting write and no notification.
   - [ ] Neither handler writes again when called with the value it just wrote (no loop): the test counts `game.settings.set` calls.
   - [ ] After every case above, no stored setting value contains `#`. Each test asserts this.

2. **module/test/settings/main.test.ts (STYLE).** Accepted: adding `defaultGatewayUrl` makes 13 registered settings, so the assertion at :13 must change from 12 to 13. Owns adds module/test/settings/main.test.ts, limited to that count (and to any further count change this amendment's registrations cause, if a hook registration is counted there).

3. **`clientUsable` credentials regex (P3).** In spec: the acceptance item "A client value with a fragment or credentials is never returned as a connectable URL" already covers `ws:\\u:p@host`, `ws:/u:p@host` and `ws:u:p@host`. The implementer fixes module/src/link/gateway-url.ts in round 1 without a `URL` global, and adds those three inputs to module/test/link/gateway-url.test.ts as cases that are not returned with `source: 'client'`.

4. **gateway/test/bin/invite-cli.test.ts environment (NOTE).** Not this task. Residual for a follow-up: its spawn helper (:33) inherits `process.env` and does not blank `AGENT_GATEWAY_PUBLIC_URL`, so the "bare code" test fails in a shell where that variable is set. The file stays outside Owns.

The second NOTE (an invalid client value falls back to the world default) needs no change: with item 1, an invalid client value is reset to `''` as soon as it is written, so the fallback applies only to values stored before this task.

## Review round 2 — findings

Reviewed HEAD: dbc0ef9. The orchestrator routes the P2, the P3 and the NOTE on bare codes in the world setting to the implementer; the pre-save hook should strip or refuse any non-strict value. The other NOTEs need no action. Task 87's file ships with this PR (orchestrator decision).

VERDICT: FIX

FINDINGS
- [P2] /Users/Andrew/workspace/foundry-modules/agent-gateway/.claude/worktrees/task-86/module/src/settings/index.ts:64 and module/src/settings/gateway-url-guard.ts:36-47. The world `defaultGatewayUrl` guard uses `onChange`, so a pasted invite code is saved to the world DB and sent to every connected client before it is stripped. Amendment 1 item 1 says to prefer a pre-save hook if Foundry 13 has one. It does (evidence below).
  route: implementer. The amendment chose this already: it says "prefer it", and it allows "onChange (or equivalent)" with the handlers in gateway-url-guard.ts. The added acceptance item already covers the hook case ("the test asserts the data passed on to the write has no `#`"). Suggested shape: register `preUpdateSetting` / `preCreateSetting` handlers for key `agent-gateway.defaultGatewayUrl` that rewrite `changes.value` / `data.value` to the address only. That value is the JSON-encoded string from `#cleanJSON`, so parse it and stringify it again. Keep the `onChange` for the invalid-value reset and the warning.
  input: a GM pastes `wss://gw.example.com/link#ABCD-EFGH-JKMN` into Configure Settings → Default gateway URL, while a player has `Hooks.on('updateSetting', s => console.log(s.value))` running in their console  →  the player's console shows the full invite string. The GM client's corrective write lands one round trip later.
  impact, answering your question:
    - Seen by others: verified for the client side. In v13, `Setting#_onUpdate` / `_onCreate` (foundry.mjs:46956-46970) run `onChange(value, options, userId)` on every client that receives the update. That is why the guard needs `isGM`. `BaseSetting` (foundry.mjs:21606-21617) sets permissions only for create, update and delete, so nothing restricts reads. That the server sends world Setting updates to every player is GUESS (high confidence; I did not read the server code). Any player can catch the value with an `updateSetting` hook or a module. Nothing appears in a player's UI, so only an attacker who is already listening would see it.
    - Burn: verified. gateway/src/link/invites.ts:136-142 settles any world, user or origin mismatch as `mismatch`, which spends the invite. A player who pastes the code under their own identity destroys it.
    - Redeem: verified possible. gateway/src/link/server.ts (the claim built in the pairing-code branch, about :488-494) takes `worldId` and `userId` from `hello.world.id` / `hello.user.id`, and `origin` from the Origin header. Its own comment at :45 says that header is attacker-chosen. "Identity-bound" therefore means bound to ids the client asserts, not to Foundry's server-set user. Every player can see the world id and `game.users` ids. A player with the code can send a hand-built hello and pair as the target user, which is impersonation and not only a denial of service. This comes from task 68's design, not from this diff, but it is why the leak matters. A burn or a forged redeem does leave a trace: the gateway logs "no valid invite" with the claimed ids, and a forged redeem makes the real user's later redemption fail.
    - Window: one round trip plus the GM handler, if a GM client handles the update. The code stays stored if the writer has SETTINGS_MODIFY but is not a GM and no GM is online. That is a verified path: `#canModify` allows SETTINGS_MODIFY, and the guard returns early when `!isGM`. GUESS: the same happens if the GM's tab unloads before the update response arrives.
    - Persistence: Foundry keeps no history of setting values. `_stats` holds only `modifiedTime` / `lastModifiedBy` (foundry.mjs:10752-10753). GUESS: the old value stays in the world's `settings` LevelDB log/sst files until compaction, and is in any world backup taken during the window. Other clients hold world settings in memory only (GUESS).
  pre-write evidence. Source: the client bundle served by the live Foundry 13.351 instance at https://foundry13.local/scripts/foundry.mjs, cross-checked against 14.369 at https://foundry.local.
    - `ClientSettings#set` → `#setWorld` (v13 foundry.mjs:166941-166986) cleans the value, then calls `current.update({value: json})` or `Setting.create(...)`. No `onChange` runs before the write.
    - `ClientDatabaseBackend` calls `Hooks.call(\`preUpdate${type}\`, doc, changes, options, user.id)` at v13:58741, inside `#preUpdateDocumentArray`. That function runs before `#dispatchRequest` (v13:58692-58694) on the writing client. `preCreate${type}` is at v13:58616, and the data object it passes is the one pushed to `toCreate` (v13:58620). The same path is in v14 at :81365 and :81500, where `createData` is pushed after the hook.
    - The Configure Settings form saves through `game.settings.set` (v13:68166), so the hook covers it.
    - Another pre-write path, which I did not choose: `#cleanJSON` calls `setting.type.clean()` when `type` is a DataField (v13:166996-167000). Acceptance pins `type: String`, so the hook is the in-spec route.
- [P3] /Users/Andrew/workspace/foundry-modules/agent-gateway/.claude/worktrees/task-86/module/src/settings/gateway-url-guard.ts:37. The world guard runs on every GM client, not only on the client that wrote the value. With two GMs connected, both write corrections and both see the warning. A late correction from GM B can also overwrite a newer valid value that GM A has just saved.
  route: implementer. `onChange` receives `userId` as its third argument (v13 foundry.mjs:46960, :46969). Gating on `userId === game.user.id` keeps the amendment's "acts only on a GM's client" and makes the writer's client the only one that acts.
  input: GMs A and B are online. A saves `http://gw.example.com` and then quickly saves `wss://gw.example.com/link`  →  B's handler for the first event can write `''` after A's second save. B also gets a warning for A's paste.
- [NOTE] /Users/Andrew/workspace/foundry-modules/agent-gateway/.claude/worktrees/task-86/module/src/link/gateway-url.ts:44. The widened regex also refuses `ws://gw\a@b`. WHATWG reads that as a path, not userinfo. Refusing such an odd value does no harm.
- [NOTE] A bare code pasted into the client `gatewayUrl` (e.g. `ABCD-EFGH-JKMN`) passes the lenient check and stays in local storage. This is within decision (d), and the value is client-only, so it is not broadcast. On the world setting a bare code fails the strict check, but it is broadcast before the reset in the same way as the P2. The pre-save hook should strip or refuse any non-strict value, not only values containing `#`.
- [NOTE] The local `main` ref is behind the branch base (6672f9d), so `git diff main...HEAD` lists 127 files that do not belong to this task. I judged scope against the task's own commits.

FIXED
- [P2] Configure Settings bypasses the parser — FIXED for both settings. The client side matches the amendment, using the shared `redeemInvite` at module/src/apps/pairing/index.ts:85. The world side works but still writes before stripping; see the new P2 above.
- [STYLE] module/test/settings/main.test.ts outside Owns — FIXED. Amendment 1 item 2 accepted it, and this round did not change it further.
- [P3] `clientUsable` userinfo shapes — FIXED at module/src/link/gateway-url.ts:44, with three cases at module/test/link/gateway-url.test.ts:120-127.

Proofs I ran (scratch copy of HEAD, not the worktree): module/test/settings/gateway-url-guard.test.ts and module/test/link/gateway-url.test.ts pass, 42 tests. Putting the old regex back fails 4 tests. Removing the `isGM` check fails 1 test ("does nothing on a non-GM client").

DRIFT: none. The fix commit dbc0ef9 changes only files the amendment allows. The `redeemInvite` extraction is the shared helper the amendment asked for. No acceptance item or decision is weakened.

SCOPE: docs/plan/tasks/87-link-resilience-diagnostics.md (added on this branch by planner commit 490aede; it is another task's contract). route: orchestrator. Decide whether it ships with PR 86 or moves to its own plan commit on main.

## Review round 3 — findings

Reviewed HEAD: 34f8ada. The verdict was CLEAN with one optional P3. The orchestrator routes that P3 (the activeGM backstop gate) to the implementer, because it is cheap and closes the gap. This is the last allowed round.

VERDICT: CLEAN

FINDINGS
- [P3] /Users/Andrew/workspace/foundry-modules/agent-gateway/.claude/worktrees/task-86/module/src/settings/gateway-url-guard.ts:90. The `onChange` backstop no longer runs for a write that skips the hooks when the writer is not a GM. Its comment at :80-83 says it covers "writes that skip the hooks", but in that case no client acts.
  route: implementer. This stays inside Amendment 1 ("onChange, which acts only on a GM's client") and keeps the round 2 P3 fix. Suggested gate: act if `userId === game.user.id` and the user is a GM, or if the writer is not a GM and `game.user.isActiveGM`. `game.users.activeGM` returns one designated GM (v13 foundry.mjs:40953, `isActiveGM` at :47612), so two GMs still never both correct. Add one test for "non-GM writer, this client is the active GM". If that is not wanted, fix the comment so it does not claim more than the code does.
  input: a non-GM with SETTINGS_MODIFY runs `game.settings.storage.get('world').getSetting('agent-gateway.defaultGatewayUrl').update({value: JSON.stringify('wss://gw.example.com/link#ABCD-EFGH-JKMN')}, {noHook: true})`  →  `preUpdateSetting` is skipped. `noHook` is a real option, read from the operation at v13:58712 and checked at :58740. `onChange` then fires on every client with that writer's userId (v13:46966-46970). The writer's client returns at :89 (`!isGM`), and every GM client returns at :90 (`userId !== self`). The code stays in the world DB and is sent to every client on each load. Before round 2 every online GM would have corrected it.

- [NOTE] This answers your question about the backstop.
  - A non-GM with SETTINGS_MODIFY who saves normally (the Configure Settings form or `game.settings.set`) is still covered. `preWriteWorldGatewayUrl` (:51-68) has no `isGM` check and runs on the writing client. Its userId check (:57) always passes there, because the backend passes `user.id` of the local user. This closes the path round 2 called verified: "SETTINGS_MODIFY non-GM, no GM online".
  - The only gap is a script that deliberately uses `noHook: true` or a raw socket `modifyDocument`. A GM doing this is still corrected on their own client. A non-GM doing it is not corrected by anyone.
  - Offline DB edits never fire `onChange` on any client, before or after this fix. GUESS: I did not test this at world load.
  - Weighing the two: the round 2 P3 (two GMs both correcting, and a late correction overwriting a newer value) happened on ordinary use. The gap here needs a writer who is trusted with SETTINGS_MODIFY and who deliberately bypasses hooks. That same writer can already set any valid `wss://` address, which the guard never stops. They also already chose to broadcast the code: the update reaches every client before any correction could, so the backstop only limits how long it persists. I judge it an acceptable residual, which is why it is P3 and not P2. The `activeGM` gate above closes it cheaply without bringing back the two-GM race.
  - The pairing window's GM-only "not a valid wss:// address" warning (acceptance at the task file's Acceptance section) still tells a GM about the stuck value the next time they open the window. GUESS: that `isStrictGatewayUrl` rejects a value containing `#`. I did not re-read gateway-url.ts this round.
- [NOTE] I checked that the hook rewrite reaches the write in v13 13.351, using the bundle from https://foundry13.local, read in scratch. For create, the `d` passed to `preCreate${type}` is the same object pushed to `toCreate` (v13:58616-58620). For update, `changes` is mutated before `updateSource(changes, {dryRun})` computes the diff that is sent (v13:58741-58760). If the cleaned value equals the stored value, the diff is empty and the update is skipped (`isEmpty(diff)`), so no `onChange` fires and the one warning comes from the hook. I did not re-check v14 this round.

FIXED
- [P2] The world default was written before it was stripped. FIXED: module/src/settings/gateway-url-guard.ts:51-78, registered at module/src/settings/index.ts:70. The pre-write hooks rewrite `value` before dispatch. Mutation proof: removing `registerWorldGatewayUrlHooks()` makes 7 of 20 tests fail.
- [P3] Both GMs correcting. FIXED: gateway-url-guard.ts:90. Proof: removing the gate fails "onChange does nothing for a value another user wrote". Removing the userId gate in the hook (:57) fails "leaves other settings and other writers alone".
- [NOTE] A bare code or any non-strict value in the world setting. FIXED: `cleanWorld` (:38-45) refuses every non-strict value before the write. The `it.each` at the test file :154 covers `CODE`, `http://` and a `ws://` invite, on both the create and the update hook.

Unmodified at HEAD 34f8ada, the test file passes 20/20. I ran it in a scratch copy, not the worktree.

DRIFT: none. Commit 34f8ada touches only gateway-url-guard.ts, settings/index.ts (one inserted call plus the import) and gateway-url-guard.test.ts, all allowed by Amendment 1. It keeps `onChange` and the `isGM` check, and the non-GM `onChange` test (:147) still passes. The pre-write hook also runs for a non-GM writer, which goes beyond "a GM's client". That fits the amendment's "run on the writing client", and it stores nothing extra. The warning wording assumes the reader is a GM, so a non-GM with SETTINGS_MODIFY sees text written for a GM. That is cosmetic.

SCOPE: clean. This round's diff stays inside Owns. The task 87 file from round 2 was settled by the orchestrator: it ships with this PR.
