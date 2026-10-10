# Distribution and licensing

The core remains free and MIT-licensed. Each pack is a separate module, free or
paid at its author's choice. A pack declares `agent-gateway` in
`relationships.requires`; the core never requires, recommends by manifest or
bundles a paid pack. The example is MIT-licensed; the release packaging contract excludes it from
the core bundle (the release builder is a later task). Core code performs no licensing checks or DRM; a pack author
owns distribution and access control. The core does not require obfuscation.

## Primary sources checked 2026-10-10

The [Software License](https://foundryvtt.com/article/license/), package-development
section, permits selling or leasing package content whose distribution rights
you hold. Packages must extend a licensed Foundry installation; this permission
does not transfer rights in someone else's content.

The [Publisher Handbook](https://foundryvtt.com/article/publisher-handbook/) describes
two routes. Self-publishing needs no extra agreement or fee, but lacks Foundry's
Premium Content protection. Authors choose their own distribution and access
controls, such as private manifests or store access. Premium Content partners
use content keys and may sell through DriveThruRPG, Itch, their own store or
Patreon. Protected manifests use `protected: true`; hosted manifests have no
`download` field. Foundry asks publishers to contact it for the agreement and
fee; the checked handbook publishes neither an amount nor a quarterly cadence.

The [AI Content Policy](https://foundryvtt.com/article/ai-policy/), revised March
18, 2026, governs official listings and marketplace packages. Its premium-content
section includes a transition for older provider agreements. Package authors
retain responsibility for compliance; paid distribution is not an exemption.
See [security](security.md) for the core author duties.

## Confirm before submitting

The specification records questions for Foundry: how self-published paid packs
relate to a listed free core; Premium Content fees and eligibility of code-only
modules; whether each pack needs the AI Tools category and a separate
attestation; rights to use compendium or game-system data as agent context;
minification or obfuscation; and the consent UI for runtime-generated code.
These are open questions, not established approvals. Recheck current primary
sources and obtain answers before claiming compliance or publication approval.
