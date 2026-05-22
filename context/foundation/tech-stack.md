---
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
---

## Why this stack

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
