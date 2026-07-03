---
project: SpendLens
version: 1
status: draft
created: 2026-05-25
updated: 2026-07-03
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
| F-01 | data-schema-foundation | (foundation) transactions, savings_goals, categories tables and RLS policies are live in Supabase | — | NFR (data isolation), FR-003, FR-006, FR-007 | done |
| S-01 | connect-simulated-bank | connect to the simulated banking API and have categorized transactions land in their account | F-01 | FR-003 | done |
| S-04 | create-savings-goal | create up to 3 active savings goals (target amount + timeframe) | F-01 | FR-006, FR-007 | done |
| S-06 | goal-anchored-recommendations | view ranked expense-cutting suggestions per active goal alongside excessive-spending alerts | S-01, S-04 | US-01, FR-009, FR-010 | done |
| S-02 | categorized-dashboard | view a spending summary dashboard with expenses grouped by category | S-01 | FR-004 | done |
| S-03 | transactions-list | view a full transactions list of all imported expenses and incomes | S-01 | FR-005 | done |
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
- **Status:** done (change-level: `implemented`, 2026-05-27 — migration `20260527000000_data_schema_foundation.sql` + service helpers + `src/types.ts` entities shipped; not yet archived)

## Slices

### S-01: Connect simulated bank → first imported transactions land

- **Outcome:** A signed-in user triggers "Connect Bank" from the dashboard, the simulated banking API returns transactions seeded against the user's account, and the import pipeline persists them under the user with auto-assigned categories. The user sees confirmation that data has landed (count or basic preview).
- **Change ID:** connect-simulated-bank
- **PRD refs:** FR-003
- **Prerequisites:** F-01
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:**
  - ~~Category taxonomy — fixed predefined list vs derived from transaction descriptions?~~ **Resolved 2026-07-01 (Open Roadmap Q3): fixed predefined taxonomy** — import maps each transaction onto one of the 11 seeded `categories` rows (`Other` fallback), setting `transactions.category_id`.
- **Risk:** This slice owns both the simulated-API contract and the auto-categorization pipeline — two pieces with separate failure modes. Surface them together so downstream slices can assume "transactions are in and categorized" without re-checking.
- **Status:** done

### S-04: Create savings goal (up to 3 active)

- **Outcome:** A signed-in user creates a savings goal by entering a target amount and a timeframe; the goal is persisted under their account; the user is prevented from creating a fourth active goal.
- **Change ID:** create-savings-goal
- **PRD refs:** FR-006, FR-007
- **Prerequisites:** F-01
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The 3-goal cap is a user-visible rule (FR-007); enforce it at both API and UI layers to avoid a race-condition window where a fourth goal sneaks in.
- **Status:** done

### S-06: Per-goal expense-cutting recommendations + excessive-spending alerts

- **Outcome:** A signed-in user with imported transactions and at least one active savings goal navigates to the recommendations section and sees, per active goal, a ranked list of expense-cutting suggestions (category + estimated saving amount, mathematically tied to the goal's target and timeframe), alongside excessive-spending alerts for categories above the income-relative threshold.
- **Change ID:** goal-anchored-recommendations
- **PRD refs:** US-01, FR-009, FR-010
- **Prerequisites:** S-01, S-04
- **Parallel with:** S-02, S-03, S-05
- **Blockers:** —
- **Unknowns:**
  - ~~Excessive-spending threshold definition — fixed percentage of income, historical average, or other baseline?~~ **Resolved 2026-06-24 (PRD Open Question 2): fixed percentage of monthly income** — `threshold = floor(monthly_income × 0.12)`, alert when `category_spend > threshold` (strict); no alerts when income is 0. FR-009 + FR-010 kept coupled in this slice per PRD §FR-009.
- **Risk:** This is the wedge. If the suggestions feel wrong (math, ranking, or category attribution), the entire product hypothesis takes the hit. Plan a verification path that sanity-checks the calculation against a hand-worked example before this ships.
- **Status:** done (change-level: `impl_reviewed`, 2026-05-28 — recommendations page/service/panel built and review-approved; pending `/10x-archive`. ⚠ Exercised only on seeded transactions until S-01 lands the real import.)

### S-02: Categorized spending dashboard

- **Outcome:** A signed-in user with imported transactions sees a dashboard view summarizing total spending grouped by category (totals + percentages) for the current period.
- **Change ID:** categorized-dashboard
- **PRD refs:** FR-004
- **Prerequisites:** S-01
- **Parallel with:** S-03, S-06, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The dashboard duplicates information that bank apps already show; the differentiating layer is the categorization. Keep this slice thin — it is not the wedge, but it is the first surface a user sees post-import.
- **Status:** done

### S-03: Full transactions list

- **Outcome:** A signed-in user with imported transactions can browse a full list of expenses and incomes from connected accounts, each row showing its assigned category.
- **Change ID:** transactions-list
- **PRD refs:** FR-005
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-06, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** A raw list duplicates the bank app's transactions view. The PRD's defense (FR-005 commentary) is the categorization layer — ensure category is visibly attached to every row, otherwise this slice is dead weight.
- **Status:** done

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
| F-01 | data-schema-foundation | Data schema: transactions, savings_goals, categories + RLS | done | Implemented 2026-05-27 (migration + services + types shipped); not yet archived |
| S-01 | connect-simulated-bank | Connect simulated bank API and auto-categorize imported transactions | yes | Unblocked — Q3 resolved (fixed taxonomy) and F-01 implemented. Run `/10x-new connect-simulated-bank` → `/10x-plan connect-simulated-bank` |
| S-04 | create-savings-goal | Create up to 3 active savings goals | no | Gated by F-01; run `/10x-plan create-savings-goal` once F-01 is done |
| S-06 | goal-anchored-recommendations | Per-goal recommendations + excessive-spending alerts (north star) | done | Built & review-approved (`impl_reviewed`), Q2 resolved; pending `/10x-archive`. Real reachability still needs S-01 (import). |
| S-02 | categorized-dashboard | Categorized spending dashboard | no | Gated by S-01; run `/10x-plan categorized-dashboard` once S-01 is done |
| S-03 | transactions-list | Full transactions list with categories | no | Gated by S-01; run `/10x-plan transactions-list` once S-01 is done |
| S-05 | delete-savings-goal | Delete savings goal | no | Gated by S-04; run `/10x-plan delete-savings-goal` once S-04 is done |
| S-07 | export-transactions | Export categorized transactions | no | Unblock by resolving Open Roadmap Q1 (export format); also gated by S-01 |

## Open Roadmap Questions

1. **Export format for FR-011** — which format should categorized transaction export use: CSV, PDF, or JSON? Owner: user. Block: S-07. (Copied verbatim from PRD §Open Questions.)
2. **Excessive-spending threshold definition** — what baseline defines "disproportionately high" spending in a category? Fixed percentages of income? Historical average? Owner: user. Block: S-06. (Copied verbatim from PRD §Open Questions.)
   > **Resolved (2026-06-24):** Fixed percentage of monthly income — a category is disproportionate when its 30-day spend exceeds `threshold = floor(monthly_income × 0.12)` (strict `>`); no alerts when income is 0. Chosen over a historical-average baseline because the simulated banking API does not guarantee multi-period history. This is the FR-009 spec; see PRD §Open Questions 2 and test-plan Risk #4.
3. **Category taxonomy** — predefined fixed category list (groceries, dining, transport, …) vs derived from transaction descriptions? Owner: user/dev. Block: S-01 (and S-02 / S-06 transitively, since both reference categories).
   > **Resolved (2026-07-01):** Fixed predefined taxonomy. The category set is the 11 seeded rows in the `categories` table (Groceries, Dining, Transport, Housing, Utilities, Entertainment, Healthcare, Shopping, Travel, Salary, Other) — already shipped and RLS-tested by F-01 (`data-schema-foundation`), with `transactions.category_id` a foreign key to `categories(id)`. Derived-from-description categories were rejected: they would break the FK model, make the category set non-deterministic (undermining the wedge math's per-category ranking and the fixed 12%-of-income alert threshold — both aggregate by a stable category), and require dynamic category creation at import time. Consequence for S-01: the import pipeline **maps** each imported transaction onto one of the 11 fixed categories (setting `category_id`), with `Other` as the fallback for anything unmatched — the mapping heuristic is an S-01 implementation detail, not a taxonomy question.

## Parked

- **Real banking API integration (Plaid / Open Banking / OAuth bank connections)** — Why parked: PRD §Non-Goals — real bank integration is its own project surface; the simulated API is sufficient to validate the wedge.
- **OAuth login (Google, Apple, …)** — Why parked: PRD §Non-Goals — email + password only for MVP; OAuth → v2.
- **Shared / household savings goals** — Why parked: PRD §Non-Goals — single-user product in MVP; shared finance introduces permission and conflict-resolution complexity out of scope for v1.
- **Native mobile app** — Why parked: PRD §Non-Goals — a responsive web app reaches mobile browsers without a separate build and release pipeline.
- **Editing a savings goal (changing amount or timeframe)** — Why parked: shape-notes v2-backlog decision — delete-only suffices for MVP to keep recalculation complexity bounded (FR-008 commentary).
- **Promotions checker / cheaper-alternatives suggestions** — Why parked: shape-notes §v2 backlog — scoped out so the MVP recommendations engine stays focused on category-level cuts.
- **Cross-goal deduplication of suggestions** — Why parked: FR-010 commentary — per-goal independence chosen for MVP; cross-goal conflict resolution is a v2 concern.

## Done

- **S-04: A signed-in user creates a savings goal by entering a target amount and a timeframe; the goal is persisted under their account; the user is prevented from creating a fourth active goal.** — Archived 2026-06-03 → `context/archive/2026-06-02-create-savings-goal/`. Lesson: —.
- **S-06: A signed-in user with imported transactions and at least one active savings goal navigates to the recommendations section and sees, per active goal, a ranked list of expense-cutting suggestions (category + estimated saving amount, mathematically tied to the goal's target and timeframe), alongside excessive-spending alerts for categories above the income-relative threshold.** — Archived 2026-07-01 → `context/archive/2026-05-27-goal-anchored-recommendations/`. Lesson: —.
- **S-01: A signed-in user triggers "Connect Bank" from the dashboard, the simulated banking API returns transactions seeded against the user's account, and the import pipeline persists them under the user with auto-assigned categories. The user sees confirmation that data has landed (count or basic preview).** — Archived 2026-07-01 → `context/archive/2026-07-01-connect-simulated-bank/`. Lesson: —.
- **S-02: A signed-in user with imported transactions sees a dashboard view summarizing total spending grouped by category (totals + percentages) for the current period.** — Archived 2026-07-02 → `context/archive/2026-07-02-categorized-dashboard/`. Lesson: —.
- **S-03: A signed-in user with imported transactions can browse a full list of expenses and incomes from connected accounts, each row showing its assigned category.** — Archived 2026-07-03 → `context/archive/2026-07-02-transactions-list/`. Lesson: —.
