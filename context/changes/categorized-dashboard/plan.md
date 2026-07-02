# Categorized Dashboard Implementation Plan

## Overview

Turn the dashboard stub (`src/pages/dashboard.astro`) into a **spending summary view**: a signed-in user with imported transactions sees their expenses grouped by category — dollar totals and percentage-of-spending — for the **current calendar month**, rendered as a ranked list with inline percentage bars. This is roadmap slice **S-02** / **FR-004**.

To avoid the two pages ever disagreeing on how spending is bucketed, the category-aggregation logic is extracted into a shared pure helper (`summarizeByCategory`) that both the new dashboard and the existing recommendations engine consume.

## Current State Analysis

- **`src/pages/dashboard.astro:1-33`** is a placeholder: a welcome card with a "Connect Bank" button and a sign-out form. It fetches no data, mounts no island, and does not render `Topbar`.
- **`src/pages/recommendations.astro:1-100`** is the authoritative pattern to mirror: it creates the Supabase client, fetches transactions/goals in a `try/catch` inside the frontmatter, and branches on `configError` / `fetchError` / empty-states before mounting a `client:load` React island. It uses a **30-day rolling window** (`since` = today − 30 days, `recommendations.astro:21`).
- **Category bucketing already exists** inline in `computeRecommendations` (`src/lib/services/recommendations.ts:62-73`): a `Map<category_id, {name, slug, totalCents}>` over expense transactions, with `t.category_id ?? "uncategorized"` as key and `t.category?.name ?? "Other"` / `?? "other"` as the null-category fallback. A deterministic re-sort (`sortedBuckets`, `recommendations.ts:93-95`) orders by `totalCents` desc, then codepoint-compares `name`, then `slug`.
- **Reusable conventions**: `formatCents` (`RecommendationsPanel.tsx:9-10`, also duplicated in `GoalsManager.tsx:13`) — `(cents/100).toLocaleString("en-US", {style:"currency", currency:"USD"})`; integer-cents money throughout; deterministic codepoint `compareStrings` (`recommendations.ts:29-31`) mandated by `lessons.md` (no bare `localeCompare`); `Topbar.astro` already includes a Dashboard link.
- **Data access**: `getUserTransactions(client, since?)` (`src/lib/services/transactions.ts`) returns `TransactionWithCategory[]` (transaction + joined `category: {name, slug} | null`), ordered by date desc, lower-bounded by the optional ISO `since`.

### Key Discoveries:

- Reuse the recommendations SSR skeleton verbatim — only the fetch window, the compute call, and the island differ (`recommendations.astro:19-33`).
- The bucketing rule (`null → "Other"/"other"`, codepoint sort) is the exact drift risk `lessons.md` warns about — extracting it to one helper is the fix.
- The dashboard's period (calendar month) intentionally differs from recommendations' 30-day window. **The shared helper must therefore operate on an already-filtered expense list, not on window logic** — each caller owns its own window filter.
- `getUserTransactions`'s `since` is a lower bound only; passing `since` = first-of-month (and not importing future-dated data) yields current-month-to-today with no upper bound needed.

## Desired End State

A logged-in user who has imported transactions navigates to `/dashboard` and sees, within the cosmic layout with `Topbar`:

- A heading and a total-expenses-this-month figure.
- A list of expense categories for the current calendar month, ranked by spend descending, each row showing category name, dollar total, percentage of total monthly expenses, and a horizontal bar sized to that percentage.
- Graceful `configError` / `fetchError` cards and a "no transactions imported" empty state with a Connect-bank CTA — mirroring `/recommendations`.

Verified by: `npm run lint`, `npm run build`, and `npx vitest run` all pass; the aggregation helper's unit tests cover percentages, null→Other, zero-total divide guard, deterministic sort, and month-boundary filtering; existing `recommendations.test.ts` stays green after the refactor; manual check on `/dashboard` after an import shows the ranked list and states.

## What We're NOT Doing

- No income or net-surplus figures on the dashboard (expenses-only, per S-02 wording).
- No calendar-month change to the recommendations page — it keeps its 30-day rolling window.
- No charting library, pie/donut chart, or SVG — bars are CSS-only.
- No new API route, no schema/migration change, no auth change (read-only SSR page).
- No Playwright/E2E test in this plan — that's a follow-up via `/10x-e2e` once the feature is built.
- No per-category drill-down, no date-range picker, no multi-period comparison.
- No de-duplication of `formatCents` across components (out of scope; each island keeps its local copy per current convention).

## Implementation Approach

Bottom-up: land the pure, testable aggregation logic first (Phase 1), refactoring the existing recommendations engine onto it in the same phase so any divergence is caught immediately by the existing test suite. Then build the presentation layer (Phase 2) — a React island plus the SSR page that mirrors the proven recommendations skeleton.

The shared helper `summarizeByCategory(expenses)` is deliberately window-agnostic: it takes a pre-filtered list of expense transactions and returns sorted category buckets. `computeSpendingSummary(transactions)` wraps it for the dashboard — it applies the current-calendar-month filter, isolates expenses, and decorates each bucket with a percentage of the grand total. `computeRecommendations` calls `summarizeByCategory` on its own 30-day-filtered expense list.

## Critical Implementation Details

- **Percentage determinism** — compute the percentage inside `computeSpendingSummary` (a pure function), not in the island, so it is unit-tested and reproducible. Guard the denominator: when total expenses is 0, all percentages are 0 (no divide-by-zero, no `NaN`/`Infinity` reaching the UI — see the `recommendations.test.ts:69` precedent). Round to one decimal place with a fixed rule; the bar width uses the same value so the number and the bar never disagree.
- **Locale/timezone safety** (`lessons.md`) — reuse the existing codepoint `compareStrings` for sort tie-breaks; do not introduce `localeCompare`. Derive the month boundary from date-only components (mirror `toDateOnly`, `recommendations.ts:16-19`) rather than timezone-sensitive `Date` parsing, so the first-of-month cutoff is stable across hosts/CI.
- **SSR error safety** (`lessons.md`) — the dashboard's transaction fetch must be inside a `try/catch` that sets `fetchError`, exactly as `recommendations.astro:20-30`, so a transient Supabase error renders a card, not a blank 500.

## Phase 1: Shared aggregation helper + recommendations refactor

### Overview

Introduce a pure, window-agnostic bucketing helper and a dashboard-facing summary function, then refactor `computeRecommendations` to consume the helper so the two pages share one bucketing rule.

### Changes Required:

#### 1. Summary types

**File**: `src/types.ts`

**Intent**: Add the entity shapes the dashboard summary produces, alongside the existing `SpendingAlert` / `Suggestion` / `RecommendationsResult` types.

**Contract**: A per-category spend row and a whole-summary result. `CategorySpend` = `{ categoryName: string; categorySlug: string; totalCents: number }`. `SpendingSummary` = `{ totalExpensesCents: number; categories: (CategorySpend & { percent: number })[] }` where `percent` is the category's share of `totalExpensesCents` (0 when the total is 0). Field names follow the existing `categorySlug` / `categoryName` / `*Cents` naming in `src/types.ts:48-77`.

#### 2. Shared spending-summary service

**File**: `src/lib/services/spending-summary.ts` (new)

**Intent**: House the single source of truth for category bucketing (`summarizeByCategory`) and the dashboard's current-month summary (`computeSpendingSummary`).

**Contract**:
- `summarizeByCategory(expenses: TransactionWithCategory[]): CategorySpend[]` — buckets an already-filtered list of expense transactions by `category_id` (null → `{name:"Other", slug:"other"}`), summing `amount`, and returns them sorted by `totalCents` desc, then codepoint `name`, then `slug`. This is the extraction of `recommendations.ts:62-73` + `93-95`; reuse/relocate the `compareStrings` tie-break so both modules share one comparator.
- `computeSpendingSummary(transactions: TransactionWithCategory[], today: Date): SpendingSummary` — filters `transactions` to the current calendar month (first-of-month ≤ date ≤ today, using date-only comparison), keeps `type === "expense"`, calls `summarizeByCategory`, computes `totalExpensesCents`, and maps each bucket to include `percent` (share of total, guarded at 0 total, rounded to one decimal). Passing `today` in keeps it deterministic and testable rather than reading the clock internally.

#### 3. Refactor recommendations onto the shared helper

**File**: `src/lib/services/recommendations.ts`

**Intent**: Replace the inline bucket `Map` and `sortedBuckets` with a call to `summarizeByCategory`, so the recommendations engine and the dashboard bucket spending identically.

**Contract**: `computeRecommendations` continues to return the same `RecommendationsResult`. Internally, its 30-day-filtered `expenses` list is passed to `summarizeByCategory`; the returned sorted array drives both the alert loop (`recommendations.ts:79-89`) and the suggestion loop (`recommendations.ts:108-118`). No change to the 30-day window, the 12%-income alert threshold, or per-goal math. If `compareStrings` moves into the shared module, import it here.

#### 4. Aggregation unit tests

**File**: `src/lib/services/spending-summary.test.ts` (new)

**Intent**: Lock the aggregation contract where bugs hide, matching the `recommendations.test.ts` precedent.

**Contract**: Vitest cases covering: null-category → "Other" bucket; multiple transactions summing into one category; percentage = share of total; percentages are 0 (not `NaN`/`Infinity`) when total expenses is 0; deterministic sort (spend desc, then codepoint name/slug tie-break); month-boundary filtering (a transaction dated in the previous month is excluded, first-of-month is included) with a fixed injected `today`. Run under `TZ=UTC` per `lessons.md`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- New aggregation tests pass: `npx vitest run src/lib/services/spending-summary.test.ts`
- Existing recommendations tests stay green after refactor: `npx vitest run src/lib/services/recommendations.test.ts`
- Full unit suite passes: `npx vitest run`

#### Manual Verification:

- `summarizeByCategory` produces identical bucket ordering to the pre-refactor `sortedBuckets` for a representative transaction set (spot-check that recommendations output is unchanged).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Dashboard page + spending-summary island

### Overview

Build the presentation layer: a React island that renders the ranked category list with percentage bars, and the rewritten `dashboard.astro` that fetches current-month data, computes the summary, and mirrors the recommendations page's config/fetch/empty states.

### Changes Required:

#### 1. SpendingSummary island

**File**: `src/components/SpendingSummary.tsx` (new)

**Intent**: Render the spending breakdown as a ranked list with inline CSS percentage bars, in the existing card aesthetic.

**Contract**: `Props = { summary: SpendingSummary }` (this Props interface is the authoritative prop surface per `lessons.md`). Renders a total-expenses-this-month figure and one row per `summary.categories` entry (already sorted): category name, `formatCents(totalCents)`, `percent`, and a horizontal bar whose width is driven by `percent`. Reuse the local `formatCents` pattern from `RecommendationsPanel.tsx:9-10`. Styling follows the cosmic/`bg-white/10`/`backdrop-blur` idiom used across the app.

#### 2. Rewrite dashboard page

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the stub with an SSR page that fetches current-month transactions, computes the summary, mounts the island, and handles all states — structurally mirroring `recommendations.astro`.

**Contract**: Frontmatter creates the Supabase client, computes `since` = first-of-current-month (ISO `YYYY-MM-01`), fetches via `getUserTransactions(supabase, since)` inside a `try/catch` (sets `fetchError`), branches on `configError` (null client) / `fetchError` / no-transactions empty-state (Connect-bank CTA to `/transactions/import`, copy mirroring `recommendations.astro:81-95`), and otherwise calls `computeSpendingSummary(transactions, new Date())` and mounts `<SpendingSummary summary={summary} client:load />`. Renders `Topbar` inside the layout. Retains the existing "authenticated users only" framing implicitly via middleware (dashboard is already a protected route).

#### 3. Island render test

**File**: `src/components/SpendingSummary.test.tsx` (new)

**Intent**: Smoke-test the island wiring so prop/format/bar-width regressions are caught.

**Contract**: Render `SpendingSummary` with a small fixed `SpendingSummary` fixture and assert the category names, formatted totals, and percentages appear, and that rows render in the given order. Use the project's existing component-test setup (match whatever `*.test.tsx` / testing-library pattern the repo already uses; if none exists, keep assertions to rendered text via the configured Vitest DOM environment).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- Island render test passes: `npx vitest run src/components/SpendingSummary.test.tsx`
- Full unit suite passes: `npx vitest run`

#### Manual Verification:

- On `/dashboard` after importing transactions, the ranked category list renders with correct totals, percentages, and proportional bars, sorted by spend descending.
- The "no transactions imported" empty state shows (with a working Connect-bank link) for a user who has not imported.
- `configError` / `fetchError` cards render on a misconfigured DB / simulated fetch failure; no blank 500 page.
- `Topbar` renders and its Dashboard/Goals/Recommendations links work; page paints within ~2s (FR-004 NFR), no blank screen for a user with data.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `summarizeByCategory`: null→Other bucketing, summation, deterministic sort tie-breaks.
- `computeSpendingSummary`: percentage = share of total, zero-total divide guard (no `NaN`/`Infinity`), current-month boundary filtering with injected `today`, expenses-only isolation.
- `computeRecommendations`: unchanged behavior after refactor (existing suite).
- `SpendingSummary` island: renders names/totals/percentages in order.

### Integration Tests:

- None added; the SSR page is exercised manually and by the existing build.

### Manual Testing Steps:

1. Import transactions via `/transactions/import`, then open `/dashboard` — confirm the ranked list, totals, percentages, and bar widths.
2. As a fresh user (no import), open `/dashboard` — confirm the empty state and Connect-bank CTA.
3. Confirm `/recommendations` still shows identical category-driven alerts/suggestions after the Phase 1 refactor.

## Performance Considerations

Read-only, single SSR query bounded to the current month; aggregation is O(n) over a small transaction set. No new dependencies. Meets FR-004's ~2s / no-blank-screen NFR by mirroring the recommendations page's synchronous SSR render.

## Migration Notes

None — no schema or data changes.

## References

- Pattern to mirror: `src/pages/recommendations.astro:1-100`
- Bucketing logic being extracted: `src/lib/services/recommendations.ts:62-95`
- Money formatting: `src/components/RecommendationsPanel.tsx:9-10`
- Roadmap slice: `context/foundation/roadmap.md` (S-02); requirement FR-004 in `context/foundation/prd.md`
- Determinism rule: `context/foundation/lessons.md` (timezone/locale)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared aggregation helper + recommendations refactor

#### Automated

- [x] 1.1 Type checking passes: `npm run build`
- [x] 1.2 Linting passes: `npm run lint`
- [x] 1.3 New aggregation tests pass: `npx vitest run src/lib/services/spending-summary.test.ts`
- [x] 1.4 Existing recommendations tests stay green: `npx vitest run src/lib/services/recommendations.test.ts`
- [x] 1.5 Full unit suite passes: `npx vitest run`

#### Manual

- [x] 1.6 `summarizeByCategory` bucket ordering matches pre-refactor `sortedBuckets` on a representative set

### Phase 2: Dashboard page + spending-summary island

#### Automated

- [ ] 2.1 Type checking passes: `npm run build`
- [ ] 2.2 Linting passes: `npm run lint`
- [ ] 2.3 Island render test passes: `npx vitest run src/components/SpendingSummary.test.tsx`
- [ ] 2.4 Full unit suite passes: `npx vitest run`

#### Manual

- [ ] 2.5 `/dashboard` shows ranked category list with correct totals, percentages, proportional bars, sorted desc
- [ ] 2.6 No-transactions empty state renders with working Connect-bank link
- [ ] 2.7 `configError` / `fetchError` cards render; no blank 500 page
- [ ] 2.8 `Topbar` renders with working links; page paints within ~2s, no blank screen for a user with data
