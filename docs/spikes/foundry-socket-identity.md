# Spike 10b: does Foundry attest who sent a module socket message?

**Answer: yes.** For a message on `module.agent-gateway`, the Foundry server forwards the payload and
appends the sender's user id as the handler's second argument: `game.socket.on(channel, (data,
senderUserId) => …)`. The server takes that id from the user bound to the socket's login session, not
from anything the client sends, and a modified Player client could not change it in any of the
attempts below. The **payload** is entirely client-controlled, so any `from` or `userId` field inside
it means nothing. The same holds for document changes: the `userId` hook argument (4th argument of
`updateUser` and similar) and `_stats.lastModifiedBy` are set by the server, while a `userId` inside
the hook's `options` is a forgeable pass-through. Every proof needs a **trusted observer**: a Foundry
client the gateway already trusts (the GM's or host owner's paired link, or a headless agent), because
the gateway itself is not a Foundry client.

## Experiment (live, foundry.local v14, build 369)

Two headless Chromium contexts at once in world `test-world` (pf2e 8.6.0), module `agent-gateway`
0.1.0 at main 43b32a5 (`socket: true`): `dev-gm` (id `dJRmsvLjuYrn8GCl`, role 4) and `player1`
(id `i6YOI2WFj4ZEFtbX`, role 1). Run from the Mac test bed on 2026-10-09; no world settings changed,
and the test flag was removed afterwards. The GM registered:

```js
game.socket.on('module.agent-gateway', (...args) => window.__got.push(JSON.parse(JSON.stringify(args))));
Hooks.on('updateUser', (doc, change, options, userId) => window.__uu.push({ change, options, userId }));
```

| # | player1 did | GM saw |
|---|---|---|
| 3 | `emit(ch, {from: me, msg:'hello'})` | `argc 2: [{from: player1, msg:'hello'}, "i6YOI2WFj4ZEFtbX"]` |
| 3 | `emit(ch, payload, cb)` | same two args; `cb` never fired (see note) |
| 4 | `emit(ch, {from: gm, userId: gm, msg:'forged'})` | `[{from: gm, userId: gm, …}, "i6YOI2WFj4ZEFtbX"]`: payload forged, 2nd arg true |
| 5 | `emit(ch, {msg}, gmId, {userId: gmId})` | `argc 2: [{msg}, "i6YOI2WFj4ZEFtbX"]`: extra args dropped |
| 5 | `game.socket.auth = {userId: gmId}`, then emit | `[{msg}, "i6YOI2WFj4ZEFtbX"]` |
| 5 | raw `engine.send('42["module.agent-gateway",{…gm…},{userId: gm}]')` | nothing; the server dropped player1's socket, which reconnected. Later actions were still attributed to player1 |
| 7 | `game.user.setFlag('agent-gateway','nonce','N-12345')` | hook `userId "i6YOI2WFj4ZEFtbX"`, `change._stats.lastModifiedBy "i6YOI2WFj4ZEFtbX"` |
| 8 | `game.users.get(gmId).setFlag(…,'X')` | threw `User player1 lacks permission to update User [dJRmsvLjuYrn8GCl]`; no hook |
| 9 | `game.user.update({'flags.agent-gateway.nonce':'Y'}, {userId: gmId})` | `options.userId "dJRmsvLjuYrn8GCl"` (forged pass-through) but 4th arg `userId "i6YOI2WFj4ZEFtbX"` |

The GM does not receive its own broadcast. Note on the ack: the server reads the second argument as
options (`{recipients}`) and the third as the ack, so `emit(ch, data, cb)` passes `cb` as options and
it never fires. Use `emit(ch, data, {}, cb)`; the ack is called with no arguments.

Snippets used (abridged; the full script was a scratch file on the Mac and is not committed):

```js
game.socket.emit('module.agent-gateway', { from: gmId, userId: gmId, msg: 'forged' });
game.socket.emit('module.agent-gateway', { msg: 'extra-args' }, gmId, { userId: gmId });
game.socket.io.engine.send('42["module.agent-gateway",{"userId":"<gm>"},{"userId":"<gm>"}]');
await game.user.update({ 'flags.agent-gateway.nonce': 'Y' }, { userId: gmId });
```

## Why it holds (from source, the v14.369 server in a container)

The server code is minified, so locations are byte offsets; `common/` and `client/` have lines.

- **Relay.** `dist/server/sockets.mjs` @783 `handleCustomSocket(e,t,{recipients:o}={},s)`: forwards
  only `t`, emitting `(channel, t, this.user.id)` with `socket.broadcast`, or only to the sockets of
  each user in `recipients`; then calls `s()` if it is a function.
- **Registered only for socket packages.** `dist/packages/package.mjs` @12427 `registerCustomSocket`
  listens on `module.<id>` only if the manifest has `socket: true`. The list is every compatible
  installed module (`world.mjs` @~1197), not only enabled ones.
- **Authenticated only.** `World.socketListeners` is attached inside `o.userId&&(…)` in `activate()`
  (`sockets.mjs` @~1525–2400). The user comes from the `session` cookie (httpOnly, sameSite strict)
  looked up at connect time (`e.user=s,e.userId=o.userId=s.id` @1708) and is fixed for the socket.
  Handshake `auth` is not read.
- **Document attribution.** `dist/database/backend/server-backend.mjs` @~300 sets
  `t.userId = e.user.id` on every `modifyDocument`, overwriting any client value; the client passes
  `response.userId` as the hook argument (`client/data/client-backend.mjs` L291–337).
  `_stats.lastModifiedBy` comes from the authenticated user (`server-document.mjs` @~1844); client
  `_stats` are stripped.
- **Own User only.** `common/documents/user.mjs` L220–238 `#canUpdate` ends
  `return user.isGM || (user.id === doc.id)`, enforced server-side via `canUserModify`.
- **`userQuery`.** `dist/components/activity.mjs` `#o` takes the sender from `e.user`, needs
  `QUERY_USER`, and emits only to the target user's sockets. The client runs
  `CONFIG.queries[name](data, {user})` (`client/documents/collections/users.mjs` L218–241), and
  `User#query` returns the result. This is an attested request and response to one named user.

## What a GM client can verify about another user

| Fact | Trust | Source |
|---|---|---|
| Sender of a `module.*` message (2nd arg) | attested | verified-live; `sockets.mjs` @783 |
| Who made a document change (hook `userId`, `_stats.lastModifiedBy`) | attested | verified-live; `server-backend.mjs` @~300 |
| `options.userId` on a hook | **forgeable** | verified-live (step 9) |
| Role (`game.users.get(id).role`) | server data, changed only by permitted users | verified-live; `user.mjs` L220–238 |
| A Player wrote only their own User | enforced | verified-live (step 8) |
| `user.active`, idle, scene, cursor | **forgeable**: `userActivity` broadcasts a client-chosen user id unchecked | from-source `activity.mjs` `#r`, `users.mjs` L113+ |
| Reply to `User#query` comes from that user's client | attested | from-source `activity.mjs` `#o` |

## Candidate proofs for task 36

The threat: in server mode, a Player with a pairing code sends `hello` claiming another user, such as
the GM. Each proof needs a trusted observer, a module connection the gateway already trusts. The first
pairing in a world stays as today: the host owner enters the code the gateway printed.

**(a) Socket sender attestation.** The gateway gives the claimant a nonce over the new link; the
claimant's module emits it on `module.agent-gateway`; the observer reports `(nonce, senderUserId)`, and
the gateway accepts only if `senderUserId` equals the claimed user. *A malicious Player can* forge any
payload field, relay a nonce to an accomplice, or stay silent. *They cannot* make the 2nd argument
name anyone but themselves. Cost: one ephemeral message, nothing stored in the world.

**(b) Server-checked write.** The claimant's module sets `flags.agent-gateway.nonce` on its own User;
the observer's `updateUser` hook checks `doc.id === claimed`, the 4th-argument `userId`, and the nonce.
*Cannot defeat*: writing another User (permission error) or forging the 4th argument. *Can*: put a
fake `options.userId`, so code must never read it. Cost: a world write per pairing (sync, audit noise,
cleanup), and it fails if the world denies Players updating their own User.

**(c) One-time code shown only in the claimed user's client.** The observer emits a code with
`{recipients: [claimedUserId]}` (or uses `User#query`); the server delivers it only to that user's
sockets; the human enters it back at the gateway. *Cannot defeat*: receiving a message addressed to
another user. *Can*: socially engineer the real user into reading the code out. This also proves a
human is present, but needs the claimed user online and a manual step.

**Recommendation: (a)** for the automatic check, with `User#query` as the transport where available,
since it pairs an attested request with an attested reply in one call. Use (c) when an explicit human
confirmation is wanted, for example a GM-level claim. Do not use (b): it proves the same thing as (a)
but writes world data. In all cases, read identity only from the server-set argument (socket 2nd
argument, hook 4th argument, query `user`) and never from payloads, `options.userId` or `user.active`.
If no trusted observer is online, the claim stays pending, like an approval with no approver.

## v13

v13 pending: no v13 instance yet. Re-check on v13: the `handleCustomSocket` signature and the
appended sender id; whether handshake `auth` is ignored; hook `userId` versus `options.userId`; the
`#canUpdate` own-User rule; and whether `CONFIG.queries` and `User#query` exist (if not, fall back to
(a) with a plain socket message).
