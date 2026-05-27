---
project: SpendLens
version: 1
status: draft
created: 2026-05-25
updated: 2026-05-25
prd_version: 1
main_goal: market-feedback
top_blocker: capacity
---

# Roadmap: SpendLens

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

SpendLens helps a goal-saver — someone who has set a concrete savings target (vacation, emergency fund, major purchase) and has a connected bank account — close the gap between "what I spent" and "what I should cut to reach my goal." Existing tools surface raw transactions or require manual categorization without surfacing action; SpendLens auto-categorizes from a simulated banking API and tells the user, per active goal, which categories to cut and by how much. The product wedge — the one trait that, if removed, makes SpendLens indistinguishable from a generic budgeting tool — is that recommendations are *goal-anchored*: each suggestion is mathematically tied to a specific savings target and timeframe.

## North star

**S-06: Per-goal expense-cutting recommendations + excessive-spending alerts** — until a logged-in user with imported transactions and an active savings goal sees ranked, category-specific cuts tied to that goal, the core product hypothesis ("spending insight is only useful when it is goal-anchored and actionable") is untested.

> "North star" here means the smallest end-to-end slice whose successful delivery would prove the core product hypothesis. It is placed as early as Prerequisites allow because everything else only matters if this slice works.

## At a glance

| ID | Change ID | Outcome (user can …) | Prerequisites | PRD refs | Status |
|---|---|---|---|---|---|
| F-01 | data-schema-foundation | (foundation) transactions, savings_goals, categories tables and RLS policies are live in Supabase | — | NFR (data isolation), FR-003, FR-006, FR-007 | ready |
| S-01 | connect-simulated-bank | connect to the simulated banking API and have categorized transactions land in their account | F-01 | FR-003 | blocked |
| S-04 | create-savings-goal | create up to 3 active savings goals (target amount + timeframe) | F-01 | FR-006, FR-007 | proposed |
| S-06 | goal-anchored-recommendations | view ranked expense-cutting suggestions per active goal alongside excessive-spending alerts | S-01, S-04 | US-01, FR-009, FR-010 | blocked |
| S-02 | categorized-dashboard | view a spending summary dashboard with expenses grouped by category | S-01 | FR-004 | proposed |
| S-03 | transactions-list | view a full transactions list of all imported expenses and incomes | S-01 | FR-005 | proposed |
| S-05 | delete-savings-goal | delete an existing savings goal | S-04 | FR-008 | proposed |
| S-07 | export-transactions | export categorized transactions to a downloadable file | S-01 | FR-011 | blocked |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme | Chain | Note |
|---|---|---|---|
| A | Wedge & validation | `F-01` → `S-01` → `S-04` → `S-06` | Backbone of the `market-feedback` main goal. `S-04` is parallel with `S-01` (both depend only on `F-01`); the chain shows the read order, not a strict sequential gate. |
| B | Spending visibility | `S-02` / `S-03` | Joins Stream A at `S-01`. Two read-only views — pick up in parallel with `S-06` once `S-01` lands. |
| C | Goal management | `S-05` | Joins Stream A at `S-04`. Small lifecycle enhancement; useful once at least one goal exists. |
| D | Export (gated) | `S-07` | Joins Stream A at `S-01`. Stays `blocked` until Open Roadmap Q1 (export format) resolves. |

## Baseline

What's already in place in the codebase as of 2026-05-25 (auto-researched + user-confirmed). Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 SSR + React 19 islands + Tailwind 4 + shadcn/ui scaffold. Pages: `src/pages/index.astro`, `src/pages/dashboard.astro`. Components: `Banner.astro`, `Topbar.astro`, `Welcome.astro`, `src/components/ui/`.
- **Backend / API:** partial — Astro API-route scaffold at `src/pages/api/auth/{signin,signup,signout}.ts`. No domain routes (transactions, goals, recommendations) yet.
- **Data:** absent — `supabase/config.toml` exists for local dev, but no `supabase/migrations/` directory and no domain tables.
- **Auth:** present — `src/middleware.ts` resolves user via Supabase SSR client and gates `PROTECTED_ROUTES`; UI pages at `src/pages/auth/{signin,signup,confirm-email}.astro`; form components at `src/components/auth/`. Email + password — **satisfies FR-001 (sign-up) and FR-002 (sign-in)**.
- **Deploy / infra:** present — `@astrojs/vercel` adapter wired in `astro.config.mjs`; `infrastructure.md` chose Vercel with full operational story; `.github/workflows/ci.yml` runs lint + build on push/PR to `main`.
- **Observability:** absent — no Sentry / Datadog / OTel / logging library in deps; Vercel Speed Insights mentioned in `infrastructure.md` risk register but not wired.

## Foundations

### F-01: Data schema for transactions, savings goals, and categories

- **Outcome:** (foundation) The domain data layer is live — `transactions`, `savings_goals`, and `categories` entities exist with strict per-user isolation enforced at the database tier; migrations are versioned; the server data client can read/write all three under an authenticated session. No user-visible surface yet.
- **Change ID:** data-schema-foundation
- **PRD refs:** NFR (strict per-user data isolation), FR-003, FR-006, FR-007
- **Unlocks:** S-01 (transactions table needed for bank-connect import), S-04 (savings_goals table needed for goal creation), and transitively S-02 / S-03 / S-05 / S-06 / S-07
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Once user data lands in production, schema changes become migration work. Investing in a clean shape here keeps every downstream slice cheap; under-investing surfaces as recurring data migrations later.
- **Status:** ready

## Slices

### S-01: Connect simulated bank → first imported transactions land

- **Outcome:** A signed-in user triggers "Connect Bank" from the dashboard, the simulated banking API returns transactions seeded against the user's account, and the import pipeline persists them under the user with auto-assigned categories. The user sees confirmation that data has landed (count or basic preview).
- **Change ID:** connect-simulated-bank
- **PRD refs:** FR-003
- **Prerequisites:** F-01
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:**
  - Category taxonomy — fixed predefined list vs derived from transaction descriptions? Owner: user. Block: yes (see Open Roadmap Q3).
- **Risk:** This slice owns both the simulated-API contract and the auto-categorization pipeline — two pieces with separate failure modes. Surface them together so downstream slices can assume "transactions are in and categorized" without re-checking.
- **Status:** blocked

### S-04: Create savings goal (up to 3 active)

- **Outcome:** A signed-in user creates a savings goal by entering a target amount and a timeframe; the goal is persisted under their account; the user is prevented from creating a fourth active goal.
- **Change ID:** create-savings-goal
- **PRD refs:** FR-006, FR-007
- **Prerequisites:** F-01
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The 3-goal cap is a user-visible rule (FR-007); enforce it at both API and UI layers to avoid a race-condition window where a fourth goal sneaks in.
- **Status:** proposed

### S-06: Per-goal expense-cutting recommendations + excessive-spending alerts

- **Outcome:** A signed-in user with imported transactions and at least one active savings goal navigates to the recommendations section and sees, per active goal, a ranked list of expense-cutting suggestions (category + estimated saving amount, mathematically tied to the goal's target and timeframe), alongside excessive-spending alerts for categories above the income-relative threshold.
- **Change ID:** goal-anchored-recommendations
- **PRD refs:** US-01, FR-009, FR-010
- **Prerequisites:** S-01, S-04
- **Parallel with:** S-02, S-03, S-05
- **Blockers:** —
- **Unknowns:**
  - Excessive-spending threshold definition — fixed percentage of income, historical average, or other baseline? Owner: user. Block: yes (see Open Roadmap Q2). FR-010 suggestions could ship without FR-009 alerts in principle, but PRD §FR-009 commentary states alert + action are "neither useful alone" — keep them coupled in this slice.
- **Risk:** This is the wedge. If the suggestions feel wrong (math, ranking, or category attribution), the entire product hypothesis takes the hit. Plan a verification path that sanity-checks the calculation against a hand-worked example before this ships.
- **Status:** blocked

### S-02: Categorized spending dashboard

- **Outcome:** A signed-in user with imported transactions sees a dashboard view summarizing total spending grouped by category (totals + percentages) for the current period.
- **Change ID:** categorized-dashboard
- **PRD refs:** FR-004
- **Prerequisites:** S-01
- **Parallel with:** S-03, S-06, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The dashboard duplicates information that bank apps already show; the differentiating layer is the categorization. Keep this slice thin — it is not the wedge, but it is the first surface a user sees post-import.
- **Status:** proposed

### S-03: Full transactions list

- **Outcome:** A signed-in user with imported transactions can browse a full list of expenses and incomes from connected accounts, each row showing its assigned category.
- **Change ID:** transactions-list
- **PRD refs:** FR-005
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-06, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** A raw list duplicates the bank app's transactions view. The PRD's defense (FR-005 commentary) is the categorization layer — ensure category is visibly attached to every row, otherwise this slice is dead weight.
- **Status:** proposed

### S-05: Delete savings goal

- **Outcome:** A signed-in user can delete one of their existing savings goals; the goal disappears from the goal list and from any recommendations that referenced it.
- **Change ID:** delete-savings-goal
- **PRD refs:** FR-008
- **Prerequisites:** S-04
- **Parallel with:** S-02, S-03, S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Deletion may leave dangling references in already-shown recommendations (S-06). Decide whether deleted goals invalidate prior suggestion lists or whether recommendations are recomputed on each view.
- **Status:** proposed

### S-07: Export categorized transactions

- **Outcome:** A signed-in user with imported transactions can export their categorized transactions to a downloadable file.
- **Change ID:** export-transactions
- **PRD refs:** FR-011 (nice-to-have)
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03, S-06
- **Blockers:** —
- **Unknowns:**
  - Export format — CSV, PDF, or JSON? Owner: user. Block: yes (see Open Roadmap Q1).
- **Risk:** PRD marks this nice-to-have; the format decision is the only thing holding it from being implementable. If capacity stays tight, this is the easiest slice to defer to v2.
- **Status:** blocked

## Backlog Handoff

| Roadmap ID | Change ID | Suggested issue title | Ready for `/10x-plan` | Notes |
|---|---|---|---|---|
| F-01 | data-schema-foundation | Data schema: transactions, savings_goals, categories + RLS | yes | Run `/10x-plan data-schema-foundation` |
| S-01 | connect-simulated-bank | Connect simulated bank API and auto-categorize imported transactions | no | Unblock by resolving Open Roadmap Q3 (category taxonomy); also gated by F-01 |
| S-04 | create-savings-goal | Create up to 3 active savings goals | no | Gated by F-01; run `/10x-plan create-savings-goal` once F-01 is done |
| S-06 | goal-anchored-recommendations | Per-goal recommendations + excessive-spending alerts (north star) | no | Unblock by resolving Open Roadmap Q2 (excessive-spending threshold); also gated by S-01 + S-04 |
| S-02 | categorized-dashboard | Categorized spending dashboard | no | Gated by S-01; run `/10x-plan categorized-dashboard` once S-01 is done |
| S-03 | transactions-list | Full transactions list with categories | no | Gated by S-01; run `/10x-plan transactions-list` once S-01 is done |
| S-05 | delete-savings-goal | Delete savings goal | no | Gated by S-04; run `/10x-plan delete-savings-goal` once S-04 is done |
| S-07 | export-transactions | Export categorized transactions | no | Unblock by resolving Open Roadmap Q1 (export format); also gated by S-01 |

## Open Roadmap Questions

1. **Export format for FR-011** — which format should categorized transaction export use: CSV, PDF, or JSON? Owner: user. Block: S-07. (Copied verbatim from PRD §Open Questions.)
2. **Excessive-spending threshold definition** — what baseline defines "disproportionately high" spending in a category? Fixed percentages of income? Historical average? Owner: user. Block: S-06. (Copied verbatim from PRD §Open Questions.)
3. **Category taxonomy** — predefined fixed category list (groceries, dining, transport, …) vs derived from transaction descriptions? Owner: user/dev. Block: S-01 (and S-02 / S-06 transitively, since both reference categories).

## Parked

- **Real banking API integration (Plaid / Open Banking / OAuth bank connections)** — Why parked: PRD §Non-Goals — real bank integration is its own project surface; the simulated API is sufficient to validate the wedge.
- **OAuth login (Google, Apple, …)** — Why parked: PRD §Non-Goals — email + password only for MVP; OAuth → v2.
- **Shared / household savings goals** — Why parked: PRD §Non-Goals — single-user product in MVP; shared finance introduces permission and conflict-resolution complexity out of scope for v1.
- **Native mobile app** — Why parked: PRD §Non-Goals — a responsive web app reaches mobile browsers without a separate build and release pipeline.
- **Editing a savings goal (changing amount or timeframe)** — Why parked: shape-notes v2-backlog decision — delete-only suffices for MVP to keep recalculation complexity bounded (FR-008 commentary).
- **Promotions checker / cheaper-alternatives suggestions** — Why parked: shape-notes §v2 backlog — scoped out so the MVP recommendations engine stays focused on category-level cuts.
- **Cross-goal deduplication of suggestions** — Why parked: FR-010 commentary — per-goal independence chosen for MVP; cross-goal conflict resolution is a v2 concern.

## Done

(Empty on first generation. `/10x-archive` appends an entry here — and flips that item's `Status` to `done` — when a change whose Change ID matches an item is archived. Do NOT pre-populate.)
