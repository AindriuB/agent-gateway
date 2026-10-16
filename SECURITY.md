# Security policy

## Reporting a vulnerability

Report vulnerabilities through GitHub private vulnerability reporting. Open the repository's Security tab, choose "Report a vulnerability", or go straight to <https://github.com/AindriuB/agent-gateway/security/advisories/new>.

Do not report a vulnerability in a public issue, pull request or discussion. Anything posted there is visible to everyone before a fix exists.

A private advisory is only for security problems. Questions, bugs without a security impact and conduct concerns belong elsewhere (see [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)).

## What to include

- The affected component: the Foundry module, the gateway, the plugin, or the Docker image.
- The version of that component (and the Foundry version if the module is involved).
- How to reproduce the problem, with the smallest steps you can manage.
- What an attacker gains, if you know.

Do not include real tokens, invite codes, pairing codes or passwords in a report. Redact them.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.4.x   | Yes       |
| < 0.4   | No        |

Only the latest minor release receives security fixes.

## Threat model

What the project defends against, and what it deliberately leaves to the operator, is written up in [docs/security.md](docs/security.md). Read it before reporting, so you can tell whether the behaviour is a documented limit or a gap.
