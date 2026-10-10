# Compatibility and versions

`packApiVersion` is the core's API major.minor string, currently `1.0`. A pack
supplies `apiVersion` independently of its own package `version`. The API major
must match; an unparsable version or different major throws `API_VERSION`.
Same-major minors are additive, so `1.7` is accepted by a `1.0` core. Acceptance
alone does not supply features introduced by a newer minor: authors must avoid
requiring an unavailable feature or declare a suitable core dependency.

The compatibility policy is to keep accepting the previous API major for at
least one core minor release after introducing a new major. The current core
implements only major 1; that future transition policy does not mean major 0
or 2 is accepted today. Deprecations will be announced in the changelog.

The pack's `version` uses the bounded package-version syntax in [naming](naming.md).
Change it when releasing tools or schemas. Registered definitions are frozen
for the lifecycle; reload Foundry to register updated definitions. The gateway
compares listed schemas and descriptions as well as names, so schema-only
changes can notify clients that the tool list changed.

Declare the core module in `relationships.requires`, and test both Foundry
versions named by your compatibility manifest. The hello pack targets minimum
13 and verified 14; a manifest claim is not a substitute for live evidence.
