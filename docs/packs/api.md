# Pack API 1.0

The frozen `game.modules.get('agent-gateway').api` object has exactly three keys:

| Key                  | Meaning                                                   |
| -------------------- | --------------------------------------------------------- |
| `packApiVersion`     | Core API major.minor string, currently `1.0`              |
| `registerPack(spec)` | Atomically validate and register one active module's pack |
| `isSealed()`         | Whether registration has ended for this page load         |

Register in the `agentGateway.registerPacks` hook. The core installs its API in
`init`, fires the hook with the API in `setup`, and seals registration at the
start of its `ready` handler, before the link starts. Direct calls are accepted
after the core's `init` and before that seal. A reload starts a new lifecycle.

```js
Hooks.once('agentGateway.registerPacks', (api) => {
  api.registerPack({
    id: 'my-tool-pack',
    version: '1.0.0',
    apiVersion: '1.0',
    prefix: 'mytools',
    tools: [
      {
        name: 'greeting',
        description: 'Return a greeting for the calling user.',
        category: 'read',
        minRole: 'player',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
          type: 'object',
          properties: { greeting: { type: 'string', description: 'Greeting text.' } },
          required: ['greeting'],
          additionalProperties: false,
        },
        handler: (ctx) => ({ text: 'Hello.', structured: { greeting: 'Hello.' } }),
      },
    ],
  });
});
```

## Registration fields

| Field                  | Required value                                                         |
| ---------------------- | ---------------------------------------------------------------------- |
| `id`                   | Active Foundry module id, not `agent-gateway`; see [naming](naming.md) |
| `version`              | Pack version in the bounded version syntax in naming.md                |
| `apiVersion`           | API major.minor; major must match the core                             |
| `prefix`               | Unique, non-reserved namespace from naming.md                          |
| `tools`                | Array of tool specifications within `TOOL_LIMITS.toolsPerPack`         |
| `tools[].name`         | Local name, without prefix; registered as `<prefix>-<name>`            |
| `tools[].description`  | Plain text describing the operation                                    |
| `tools[].category`     | `read`, `write`, `destructive` or `code`                               |
| `tools[].minRole`      | `player` or `gm`; `player` also permits a GM                           |
| `tools[].inputSchema`  | Conservative JSON Schema object for arguments                          |
| `tools[].outputSchema` | Conservative JSON Schema object for structured results                 |
| `tools[].handler`      | Function receiving the context below; may return a promise             |

Definitions are copied and deeply frozen, excluding handler functions. Caller
mutation after registration cannot change validated metadata. A failed pack
registers no tools. Registration refuses collisions instead of replacing tools.

## Handler context

| Field                    | Meaning                                                                 |
| ------------------------ | ----------------------------------------------------------------------- |
| `user`                   | Frozen `{id, isGM}` for the calling Foundry user                        |
| `agent`                  | Frozen `{id, headless}`; no owner credential or live agent object       |
| `sessionId`              | Calling session identifier                                              |
| `tool`                   | Full registered tool name                                               |
| `args`                   | Validated argument view, including applied top-level defaults           |
| `callOptions`            | Audit correlation options when present; pass to every document mutation |
| `snapshot(uuid)`         | When present, await before updating or deleting each target             |
| `created(uuid, parent?)` | When present, await after creating a document                           |
| `intendCreate(parent?)`  | When present, await before creating documents                           |

The view is frozen and never the live operation context. Audit helpers are
bound forwarding functions and can be absent when audit did not install them.
A write handler should refuse to mutate if it requires audit helpers that are
absent. Check document permissions using `ctx.user.id`; approval does not grant
Foundry ownership. Use `ctx.callOptions` as document operation options so the
GM witness can correlate the server-set user and mutation hooks.

## Results and errors

Return `{text: string, structured: object}`. Both representations are required;
structured data must validate against `outputSchema`. Return plain useful text
and escaped display content where appropriate. Invalid results become
`INTERNAL` with a pack-identifying message and a logged reason. A thrown
handler affects that call; other tools remain usable.

A handler may instead return `{error: {code, message}}` with `code` equal to
`INVALID_ARGS` or `FORBIDDEN` and a message of at most 500 characters. Other
codes are refused as `INTERNAL`. These handler errors are separate from the
registration exception codes below.

| `PackError.code` | Registration refusal                                               |
| ---------------- | ------------------------------------------------------------------ |
| `SEALED`         | Registration window has ended; use the setup hook on the next load |
| `API_VERSION`    | Unparseable API version or incompatible major                      |
| `INACTIVE`       | Pack module is unknown, inactive, or is the core module            |
| `PREFIX_TAKEN`   | Reserved prefix or another pack already owns it                    |
| `DUPLICATE`      | This module id already registered a pack                           |
| `INVALID_TOOL`   | Invalid metadata/schema/category/handler or too many tools         |

Refusals log one error line. The API exposes no dispatch function, stage list,
registry, handler lookup, licensing service, system adapter or cross-tool call.
There is no additional pack-specific handler timeout beyond the gateway timeout.

## Schema and text rules

Both schema roots must be `type: "object"`. Types are single strings, objects
must set `additionalProperties: false`, each property needs a description,
and nesting is limited to depth 3 by the runtime checker. Allowed keywords:
`type`, `properties`, `required`, `additionalProperties`, `description`, `items`,
`enum`, `default`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`,
`minLength`, `maxLength`, `minItems`, `maxItems`. References, composition,
patterns, formats, titles and all other keywords are rejected. Property names
`__proto__` and `constructor` are rejected.

Descriptions, enum strings and string defaults must be nonempty plain text:
no Unicode Cc/Cf controls, U+2028/U+2029, angle brackets, backticks, `](` or
`://`. Validation applies top-level defaults to a copy of the arguments and
never mutates the supplied input.

## Limits

These are the values exported by `protocol/src/tools/limits.ts` as
`TOOL_LIMITS`; byte limits count UTF-8 bytes.

| Constant                    | Maximum                             |
| --------------------------- | ----------------------------------- |
| `schemaBytes`               | 16 KiB for each input/output schema |
| `properties`                | 32 per object                       |
| `enumValues`                | 50 strings or finite numbers        |
| `enumStringLength`          | 64 characters                       |
| `toolDescriptionLength`     | 500 characters                      |
| `propertyDescriptionLength` | 200 characters                      |
| `toolsPerPack`              | 32                                  |
| `announcementTools`         | 64                                  |
| `announcementBytes`         | 256 KiB                             |
| `sessionPackTools`          | 24                                  |
| `resultTextBytes`           | 64 KiB                              |
| `resultStructuredBytes`     | 64 KiB                              |

The gateway lists only this user's permitted tools. It lists core tools first,
then pack tools by name, retaining at most 24 pack tools per session. It adds
`[Third-party tool pack <prefix>: <id> <version>]` to each pack description and
validates arguments again before sending a call to Foundry. Changing a listed
schema or description triggers tool-list change detection. A disabled module's
tools disappear after the Foundry reload.
