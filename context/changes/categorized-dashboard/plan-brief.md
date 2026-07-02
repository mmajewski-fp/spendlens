# Categorized Dashboard — Plan Brief

> Full plan: `context/changes/categorized-dashboard/plan.md`

## What & Why

Roadmap slice S-02 / FR-004: a signed-in user with imported transactions should see, on `/dashboard`, a summary of their spending grouped by category — dollar totals and percentages — for the current period. Today the dashboard is an empty stub, so the imported-transactions data has no home in the product's main view.

## Starting Point

`src/pages/dashboard.astro` is a placeholder (welcome card + Connect-bank button, no data, no island, no Topbar). The category-bucketing logic already exists — but only inline inside `computeRecommendations` (`recommendations.ts:62-95`). The `/recommendations` page (`recommendations.astro`) already demonstrates the exact SSR pattern to reuse: `try/catch` fetch, config/fetch/empty states, mount a `client:load` island.

## Desired End State

Opening `/dashboard` after an import shows a ranked list of expense categories for the current calendar month — each row with name, total, percentage, and a proportional CSS bar — plus a total-expenses figure and `Topbar`. Users with no import see a "no transactions" empty state with a Connect-bank CTA; DB/fetch failures render a graceful card, never a blank 500.

## Key Decisions Made

| Decision              | Choice                                          | Why (1 sentence)                                                            | Source |
| --------------------- | ----------------------------------------------- | -------------------------------------------------------------------------- | ------ |
| Period                | Current calendar month                          | Intuitive "this month's spending" framing for a headline dashboard.        | Plan   |
| Scope                 | Expenses grouped by category only (+ total)     | Matches S-02 / FR-004 wording; income lives on the recommendations flow.   | Plan   |
| Percentage base       | Share of total monthly expenses                 | Natural reading of "what portion of my spending went here."                | Plan   |
| Aggregation logic     | Extract shared `summarizeByCategory`, refactor recommendations onto it | One source of truth so the two pages can't drift (the lessons.md risk).    | Plan   |
| Visual                | Ranked list with inline CSS percentage bars     | Reads instantly, no chart dependency, testable DOM.                        | Plan   |
| Empty/error states    | Mirror `recommendations.astro` exactly          | Proven pattern; satisfies SSR try/catch lesson and the no-blank-screen NFR.| Plan   |
| Testing               | Unit-test the helper thoroughly + smoke-test island | Concentrates rigor on the pure logic; keeps recommendations suite green.| Plan   |

## Scope

**In scope:** shared `summarizeByCategory` + `computeSpendingSummary` helper; recommendations refactor onto it; `SpendingSummary` React island; dashboard page rewrite with states + Topbar; unit + island tests.

**Out of scope:** income/net figures; charts; new API/schema/auth; E2E tests; drill-down or date-range controls; changing the recommendations 30-day window; de-duping `formatCents`.

## Architecture / Approach

New pure module `src/lib/services/spending-summary.ts`: `summarizeByCategory(expenses)` is window-agnostic (buckets an already-filtered expense list, null→Other, deterministic codepoint sort) and is the single source of truth; `computeSpendingSummary(transactions, today)` wraps it for the dashboard (current-month filter + grand total + per-category percent). `computeRecommendations` is refactored to call `summarizeByCategory` on its own 30-day-filtered list. The dashboard page mirrors `recommendations.astro`'s SSR skeleton and mounts a new `SpendingSummary` island.

## Phases at a Glance

| Phase                                          | What it delivers                                          | Key risk                                                        |
| ---------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------- |
| 1. Shared helper + recommendations refactor    | Tested `summarizeByCategory` / `computeSpendingSummary`; recommendations consumes the helper | Refactor must not change recommendations output (guard: existing suite) |
| 2. Dashboard page + island                     | `SpendingSummary` island + rewritten `dashboard.astro` with all states | Correct current-month filter and percent/bar rendering         |

**Prerequisites:** S-01 (transaction import) — done as of 2026-07-01.
**Estimated effort:** ~1–2 sessions across 2 phases.

## Open Risks & Assumptions

- Assumes `getUserTransactions`'s `since` lower-bound plus no future-dated imports yields a correct current-month slice (no upper bound applied).
- Assumes the repo's Vitest setup supports a light component render test; if no `*.test.tsx` precedent exists, assertions stay to rendered text in the configured DOM environment.
- Percentage rounding (one decimal) means displayed rows may not sum to exactly 100% — acceptable for a summary.

## Success Criteria (Summary)

- A user with imported transactions sees an accurate, ranked, current-month category breakdown with totals, percentages, and bars.
- Empty and error states render gracefully; no blank 500.
- Recommendations behavior is unchanged after the shared-helper refactor (existing tests green).
