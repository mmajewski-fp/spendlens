# AI Registry — Distribution Model Decision

## Context

- **Artifacts to distribute**: the `code-review` skill and the team rules block (`rules/CLAUDE.md`), packaged as `@mmajewski-fp/ai-toolkit`.
- **Date**: 2026-08-12

## Decision table, applied

| Question | Answer |
|---|---|
| Who consumes these artifacts? | Developers inside the org, on repos already hosted on GitHub |
| Is the consumer external or gated? | No — internal only, no third-party or customer-facing distribution |
| Is there an existing cloud/registry footprint to reuse? | No dedicated AWS account or artifact registry in this context |
| Does anyone need programmatic access beyond `npm install`? | No |
| **Model chosen** | **Model 1 — GitHub Packages** |

## Rationale

The audience is a GitHub-hosted team, so the registry that already sits next to the
code wins on the only axis that matters here: nothing new to provision. Publishing
authenticates with the ephemeral `GITHUB_TOKEN`, which means there is no long-lived
secret to create, store, or rotate, and read access is governed by the same repo
permissions the team already has. Model 2 (CodeArtifact) would add a Terraform stack,
an AWS account boundary, and OIDC role wiring to solve a problem — cross-cloud or
non-GitHub consumers — that this team does not have, and Model 3 (full product with
API and CLI) only pays off once the consumer is external and gated, which is not the
case.

## Revisit if

- Consumers appear outside the GitHub org (contractors, another company, a client team).
- The team's primary infrastructure moves to AWS and artifact storage gets consolidated there.
- Artifacts need to be served to something that is not an npm client.

See `packages/ai-toolkit/README.md` for the resulting consumer setup, and
[opportunity-map.md](./opportunity-map.md) for the friction signals that motivated the `code-review` skill.
