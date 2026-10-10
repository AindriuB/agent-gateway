# Security and trust

A pack is a Foundry module with full JavaScript in the user's browser. The core
cannot sandbox it: a pack can call Foundry's document API directly, patch the
core, or read anything the user can read. The core's guarantees (policy, rate
limit, approval, audit) hold for every call that goes through the dispatcher,
and only for those. Installing a pack means trusting its author, exactly as
with any other Foundry module. The GM enabling the module in the world is that
decision. This is the trust model in the [project specification](../plan/specs/2026-10-09-agent-gateway.md).

Registered calls use validated arguments, role checks and the shared stages.
The public API provides no way to obtain another handler or bypass a stage.
Copied definitions and a frozen handler view prevent accidental alteration of
validated metadata or approval state; they do not isolate installed JavaScript.
A malformed result or exception fails that call with `INTERNAL`.

Descriptions and results remain untrusted content. Plain-text restrictions and
gateway provenance labels reduce ambiguity; they do not prove a pack is honest.
Never put secrets, tokens, credentials or private world information in tool
names, descriptions, defaults or enums. Return only information the calling
user may access. Resolve that user's permissions before each read or mutation.

Choose the true category, await audit snapshots before mutations and pass audit
call options to document operations. Escape untrusted text before placing it in
HTML. Do not collect other modules' content as AI context without appropriate
rights; this is a project requirement and a publishing question to resolve
with Foundry for specific data sources.

For official listings, authors must understand and maintain AI-assisted code.
Prepared text, media and marketing require human authorship; runtime-generated
code requires readable presentation and explicit user confirmation before
execution. The March 18, 2026 policy covers premium packages with transition
provisions for older agreements. Read the [AI Content Policy](https://foundryvtt.com/article/ai-policy/)
(checked 2026-10-10) before submitting. [Distribution](distribution.md) records
remaining publishing questions.
