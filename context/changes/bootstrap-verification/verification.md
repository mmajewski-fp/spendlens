---
bootstrapped_at: 2026-05-19T13:59:00Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: spendlens
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: spendlens
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
```

SpendLens is a 3-week after-hours MVP built solo, targeting medium user scale
with a relational data model (transactions, savings goals, categorized
recommendations) and mandatory auth from day one (FR-001, FR-002). The 10x
Astro Starter is the recommended default for `(web-app, js)` — it ships
Supabase (PostgreSQL + auth + TypeScript SDK) and Cloudflare Pages in a single
opinionated bundle, removing all infrastructure decisions from week one.
The starter clears all four agent-friendly quality gates: TypeScript throughout
with explicit Zod schemas, file-based routing conventions that a stranger would
recognise, top presence in AI training data, and current docs. With a tight
timeline and no team slack to absorb framework churn, the opinionated defaults
are the right trade-off. CI runs on GitHub Actions with auto-deploy on merge to
main — what the starter ships with and the simplest viable flow for a solo
developer.

## Pre-scaffold verification

| Signal      | Value                                              | Severity | Notes                         |
| ----------- | -------------------------------------------------- | -------- | ----------------------------- |
| npm package | not run                                            | —        | cmd_template uses git clone; npm check skipped |
| GitHub repo | przeprogramowani/10x-astro-starter pushed 2026-05-17 | fresh  | from card.docs_url; 2 days ago |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 20
**Conflicts (.scaffold siblings)**: none
**.gitignore handling**: moved silently (no .gitignore in cwd prior to scaffold)
**.bootstrap-scaffold cleanup**: deleted

Files moved to cwd:
`.husky`, `wrangler.jsonc`, `node_modules`, `astro.config.mjs`, `supabase`,
`README.md`, `public`, `.prettierrc.json`, `.gitignore`, `package-lock.json`,
`package.json`, `.nvmrc`, `.github`, `components.json`, `tsconfig.json`,
`eslint.config.js`, `.env.example`, `.vscode`, `CLAUDE.md`, `src`

`context/` was not present in the scaffold; cwd `context/` preserved verbatim.

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 10 MODERATE, 0 LOW
**Direct vs transitive**:
- Direct: 0 CRITICAL, 0 HIGH, 3 MODERATE, 0 LOW
- Transitive: 0 CRITICAL, 1 HIGH, 7 MODERATE, 0 LOW

#### HIGH findings

- **devalue** (transitive via Astro build toolchain)
  Advisory: GHSA-77vg-94rm-hx3p — "Svelte devalue: DoS via sparse array deserialization"
  Affected range: 5.6.3–5.8.0 | CVSS: 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H)
  Fix available: `npm audit fix`
  Context: build-time / dev toolchain dependency; not a production runtime path for SpendLens

#### MODERATE findings (10 total; 3 direct, 7 transitive)

**Direct (3)**:
- **@astrojs/check** — via `@astrojs/language-server` → `volar-service-yaml` → `yaml-language-server` (YAML DoS chain). Dev-only linting tool.
- **@astrojs/cloudflare** — via `wrangler`/`@cloudflare/vite-plugin` → `ws` (uninitialized memory disclosure in ws <8.20.1). Deploy-time adapter.
- **wrangler** — via `miniflare` → `ws` (same ws advisory). Dev/deploy CLI tool.

**Transitive (7)**:
`@astrojs/language-server`, `@cloudflare/vite-plugin`, `miniflare`,
`volar-service-yaml`, `ws`, `yaml`, `yaml-language-server`

All MODERATE findings are in dev/build/deploy toolchain packages, not in SpendLens production runtime code.

## Hints recorded but not acted on

| Hint                    | Value              |
| ----------------------- | ------------------ |
| bootstrapper_confidence | first-class        |
| quality_override        | false              |
| path_taken              | standard           |
| self_check_answers      | null               |
| team_size               | solo               |
| deployment_target       | cloudflare-pages   |
| ci_provider             | github-actions     |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true               |
| has_payments            | false              |
| has_realtime            | false              |
| has_ai                  | false              |
| has_background_jobs     | false              |

These hints are carried forward for the future M1L4 skill (agent context setup — `CLAUDE.md`, `AGENTS.md`, CI workflow files). No automated action taken in v1.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log.
