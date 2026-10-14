# Foundry Agent Gateway plugin for ChatGPT

This private plugin connects to Andrew's existing deployment:

- Foundry: <https://foundry.aindriub.app>
- MCP endpoint: <https://gw.aindriub.app/mcp>
- OAuth resource metadata: <https://gw.aindriub.app/.well-known/oauth-protected-resource>

It supplies a focused Foundry workflow skill and a Streamable HTTP connection.
The gateway's existing OAuth grants, Foundry permissions and approval controls
still govern tool use. World data returned to ChatGPT is processed by the AI
service; connect only the Foundry user and scopes you intend to use.

## Build and inspect

From the repository root, with Node.js 22.13+ and the `zip` and `unzip` command-line tools:

```sh
node --test scripts/test/chatgpt-plugin.test.mjs
node scripts/build-chatgpt-plugin.mjs
unzip -Z1 dist/release/foundry-agent-gateway-chatgpt.zip
npm run verify
```

The archive is `dist/release/foundry-agent-gateway-chatgpt.zip`. It contains exactly:

```text
foundry-agent-gateway/plugin.json
foundry-agent-gateway/mcp.json
foundry-agent-gateway/skills/foundry-workflow/SKILL.md
```

The packer snapshots and validates those three files, then creates the archive
outside the source directory. All other files, including notes, dependency
folders and unreferenced assets, are omitted. Required symlinks (including parent
directories) and a symlinked output directory are refused. Each input is limited
to 1 MiB. Validation failure preserves the previous archive; do not mistake an
older archive for a successful new build.

The local package-contract validator v1 deliberately supports only this package's
small profile. It checks identity, strict SemVer, required metadata, subtitle
length, the skill header, and the HTTPS MCP URL. It rejects extra manifest fields,
asset references, app bindings and authentication headers. New package features
need explicit validator and test updates. The validator does not certify prose
or detect every possible secret: review all three source files before saving.
No credentials, consent codes or world data belong in them.

No icon or custom colors are required for this private package. It does not use
the gateway consent page's branding assets. Packaging is independent of the
module release script and does not upload anything.

## Save privately and connect

The supported account-save route documented by plugin-creator 0.1.26 is its
`create_plugin` tool, passing the absolute local ZIP path as `archive`. It saves
a private plugin in the authenticated account's active workspace, or the personal
account when no workspace is active. Use the returned plugin URL and retain the
returned plugin and release IDs for updates. Check for an existing Foundry plugin
first and update it rather than creating duplicates. If an upload result is
uncertain, inspect the account before retrying.

Saving the package does not sign the user in to the gateway. Open the resulting
plugin in the host and enable/install it. For the documented ChatGPT plugin
quickstart, switch from Chat to Work, start a new Work chat and select the plugin
with `@`. Use its supported connection action to start OAuth. If that host does not offer a supported
installation or OAuth flow, retain the ZIP and report that exact blocker rather
than substituting a static token or claiming success. The save route above is
available in Codex's plugin-creator integration; successful use in ChatGPT must
be verified separately. No host build number has yet been recorded for live
acceptance.

In the gateway consent flow, select the intended world and Foundry user and
request `read` for inspection. The user completes the consent code shown in their
paired Foundry session. Add `write` only for user-requested changes; `destructive`
and `code` are not needed for the acceptance check. Keep the paired Foundry
session available. Credentials and codes stay in the supported host and Foundry
interfaces, never in this package or an agent transcript.

To disconnect, use Foundry's Agent Gateway **Connected apps** interface to revoke
the test grant. The same plugin connection must then lose authenticated access.
Only reconnect through fresh consent if the user wants to reconnect. Revocation
of a test grant does not require removing the plugin or revoking the underlying
Foundry pairing.

The existing [Claude Desktop](guides/claude-desktop.md) and
[Claude Code](guides/claude-code.md) guides describe those separate clients.
A general ChatGPT guide and the shared compatibility matrix belong to tasks 43
and 40; this document records package-specific steps and evidence only.

## Connection diagnosis: observed, documented and unverified

**Reported by Andrew:** the gateway works, and Codex registered and used a live
OAuth grant. Installing the plugin through ChatGPT settings exposed its skill
but no Foundry MCP tools in a Chat-mode conversation. This is evidence about
those observed surfaces; it does not establish that the plugin is Codex-only or
that OAuth grants are shared between hosts.

**Documented:** the [plugin quickstart](https://developers.openai.com/plugins/quickstart)
tests installed plugins in a new Work chat after switching from Chat and selecting
the plugin with `@`. The [custom MCP guide](https://developers.openai.com/api/docs/guides/custom-mcp-server)
also describes adding a server with explicit authentication configuration,
installing the resulting plugin and refreshing its tools in app settings.

The [packaging guide](https://developers.openai.com/plugins/build/plugins)
describes a local-testing route that first registers the MCP connection, then
maps its verified `plugin_asdk_app...` identifier through `.app.json`. This is a
specific documented workflow, not proof that every portable package requires
that mapping. The same guide documents per-server OAuth configuration in
`mcp.json` at `extensions.com.openai.auth`, with `type: "oauth"` and optional
`client: { "mode": "dcr" }`. Discovery can supply the endpoints; secrets do not
belong in the package.

**Source inspection:** the saved 0.1.0 release contains the endpoint in portable
`mcp.json` and generated `.mcp.json`, but neither declares authentication: the URL-only package relies on host
discovery rather than explicit auth configuration. Its inventory has no `.app.json` mapping. The repository's narrow validator currently
rejects server extension fields. No verified registered-connection ID has been
identified, so none should be invented or copied from documentation examples.

**Next checks / inference:** first test the existing installation in Work and
inspect its connection and tool discovery. If the connection is absent or cannot
authenticate, investigate the registered-connection route and the documented
explicit OAuth declaration. An explicit OAuth declaration is a documented configuration improvement,
not a proven fix of the Chat-mode symptom. Adding it requires a reviewed
package/validator/test change and a new private release. No such package or live
plugin change has been made by this diagnosis. Work OAuth, read, approved write
and revocation acceptance remain untested.

## Verification record

As of 2026-10-14:

| Check                        | Evidence                                                                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public MCP resource          | Planning checked the live metadata and confirmed `https://gw.aindriub.app/mcp`, issuer `https://gw.aindriub.app`, and read/write/destructive/code scopes. This is not authenticated discovery. |
| Portable schemas             | Both manifests passed the published Agent Plugins 1.0.0 JSON schemas with Python `jsonschema` 4.26.0 (`Draft202012Validator`). Schemas were fetched from their `$schema` URLs on 2026-10-14.   |
| Package contract             | Local validator v1, Node.js 24.19.0: 10 package tests passed; the built archive contains exactly the three listed files with matching source bytes.                                            |
| Style                        | ESLint and Prettier passed for the new scripts and JSON.                                                                                                                                       |
| Full repository gate         | Passed on reviewed commit `74750c5` with Node.js 24.19.0: build, lint, 4,396 regular tests, 2,227 slow tests and 73 script tests (including the 10 package tests).                             |
| Private account save         | Succeeded 2026-10-14 via `create_plugin`: version 0.1.0, USER / PRIVATE. Installation and OAuth are separate, pending checks.                                                                  |
| ChatGPT host/build and OAuth | Chat-mode install exposed the skill but no Foundry MCP tools (Andrew report). Work OAuth and host/build capture remain pending.                                                                |
| Tool discovery and read      | Codex OAuth use reported by Andrew; ChatGPT Work tool discovery and read remain pending.                                                                                                       |
| Approved write               | Pending; Andrew selects a harmless change with Foundry approval enabled. Confirm it remains unapplied before approval and applies only after approval.                                         |
| Revocation                   | Pending; revoke the test grant in Foundry and confirm that same connection can no longer make an authenticated call.                                                                           |

Private package: [Foundry Agent Gateway](https://chatgpt.com/plugins/plugins_6acfb1accddc8191939dfe027ef9ef5c).
Plugin ID: `plugins_6acfb1accddc8191939dfe027ef9ef5c`; release ID:
`pluginrel_6acfb1ae6e7881919154c7aa5f52b95f`. These identify the saved release for
updates; saving it does not prove installation, OAuth or tool access.

Record redacted outcomes and the host/build used when completing the pending
checks. Do not store tool payloads, tokens or codes as evidence. The task remains
incomplete until its live acceptance and full repository verification pass.

## Self-hosting and updates

For another deployment, first verify its public OAuth resource metadata and
actual HTTPS `/mcp` endpoint. Change only the URL in `plugins/foundry-agent-gateway/mcp.json`,
then update the deployment wording in `plugin.json` and these notes. The source
test currently asserts Andrew's endpoint; deliberately update that assertion for
your fork. Rerun the package tests, packer, archive inspection and authenticated
acceptance. No automatic per-user endpoint setting in ChatGPT is claimed.

The portable format is pinned by the manifests' schema identifiers. Recheck the
installed plugin-creator package instructions before changing the format or
saving a new private release. Update the package version intentionally; this
standalone package is not wired into the gateway's version-bump/release scripts.
Public directory submission and workspace-wide sharing are separate work.
