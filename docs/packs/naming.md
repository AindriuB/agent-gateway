# Tool-pack naming

Pack tools use `<prefix>-<name>`, for example `hello-world_clock`. The runtime
checks the declared prefix as well as the full tool name. Names are ASCII and
case-sensitive; they are never silently rewritten or truncated.

| Field | Rule |
| --- | --- |
| Prefix | `^[a-z][a-z0-9]{1,9}$` (2–10 characters) |
| Local tool name | `^[a-z][a-z0-9_]{1,24}$` (2–25 characters) |
| Full tool name | Prefix, one hyphen, local name; at most 36 characters |
| Reserved prefixes | `ag`, `agent`, `core`, `foundry`, `gateway`, `mcp` |
| Pack id | `^[a-z0-9][a-z0-9_-]{0,63}$` |
| Pack version | `^\d{1,4}\.\d{1,4}\.\d{1,4}(-[0-9A-Za-z.]{1,20})?$` |

Core tool names retain `^[a-z][a-z0-9_]{2,40}$`. Pack names must use their
namespace and cannot masquerade as core names. The pack id and version are
metadata, not model-visible tool names; their punctuation rules differ.

## Checked vendor rules

These primary sources were checked on **2026-10-10**. They describe the vendor
surface, while the runtime deliberately accepts the smaller project subset
above.

| Surface | Documented name rule | Source | Date checked |
| --- | --- | --- | --- |
| MCP tools (2025-11-25 specification) | Recommends 1–128 characters, case sensitivity, and ASCII letters, digits, underscore, hyphen or dot; names should be unique within a server. | [Tool Names](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#tool-names) | 2026-10-10 |
| Anthropic user-defined client tools | Requires `^[a-zA-Z0-9_-]{1,128}$`. | [Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools#specifying-client-tools) | 2026-10-10 |
| OpenAI function tools | ASCII letters, digits, underscores and dashes; maximum 64 characters. | [Create chat completion, tools.function.name](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) | 2026-10-10 |
| Gemini FunctionDeclaration | Letters, digits, underscores, colons, dots and dashes; maximum 128 characters. | [FunctionDeclaration](https://ai.google.dev/api/generate-content#FunctionDeclaration) | 2026-10-10 |

No checked rule is stricter than the project's pack-name patterns. Anthropic
and Gemini currently document 128-character names; their increased allowance
does not relax this contract. OpenAI's 64-character limit remains the limiting
vendor budget. Dots and colons are excluded because they are outside OpenAI's
allowed set; hyphens and underscores are accepted by all four surfaces.

The 36-character cap reserves room for a client namespace. Under the project's
Claude Code naming assumption, `mcp__foundry-agent-gateway__` takes 27 characters.
The available budget is therefore 64 − 27 = 37; the contract rounds down to 36,
so the combined identifier is at most 63 characters. This is a project budget
assumption, not a guarantee about every client's prefixing behavior. A different
server name or client transformation must be checked against its own limit.

The prefix and local-name maxima also yield 10 + 1 + 25 = 36. Lowercase names,
a letter first, one namespace separator and reserved prefixes make ownership
clear and avoid punctuation-dependent adaptation by clients.
