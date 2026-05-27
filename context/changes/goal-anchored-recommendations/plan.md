# Goal-Anchored Recommendations Implementation Plan

## Overview

Implement the SpendLens wedge feature: a `/recommendations` page where a user with imported transactions and at least one active savings goal sees, per goal, a ranked list of expense-cutting suggestions mathematically tied to that goal's target and timeframe, plus excessive-spending alerts for categories exceeding the income-relative threshold. This is S-06 — the north star slice; if it works and feels correct, the core product hypothesis is proven.

## Current State Analysis

F-01 is fully complete. All three domain tables are live (`categories`, `transactions`, `savings_goals`) with RLS, correct per-operation policies, and integer-cent monetary storage. Service helpers are in place and typed:

- `getCategories(client)` — fetches all seeded categories
- `getUserTransactions(client)` — fetches all user transactions joined with `categories(name, slug)`
- `getUserGoals(client)` — fetches all user goals ordered by `created_at ASC`
- `src/types.ts` — exports `Category`, `Transaction`, `SavingsGoal`, `TransactionType`

The dashboard (`src/pages/dashboard.astro`) is a stub with no navigation structure. `Topbar.astro` exists at `src/components/Topbar.astro`. Auth middleware guards `PROTECTED_ROUTES`. No recommendations logic exists anywhere in the codebase.

S-01 and S-04 are prerequisites but are not yet implemented. This plan is written against what those slices will deliver: transactions in the `transactions` table with category assignment, and savings goals in the `savings_goals` table.

### Key Discoveries:

- `getUserTransactions()` already joins category `name` and `slug` — no extra query needed for the engine
- All monetary values are integer cents throughout; divide by 100 only at display time — this applies to all suggestion and alert amounts in this slice
- `TransactionWithCategory` type is already exported from `src/lib/services/transactions.ts`
- No React component or Astro page currently imports from the services layer — this slice establishes the first user-visible data surface
- `PROTECTED_ROUTES` array is in `src/middleware.ts`

## Desired End State

After this change:
- A signed-in user with imported transactions and at least one active savings goal navigates to `/recommendations` (linked from the top navigation)
- For each active goal: a tab shows up to 5 ranked expense-cutting suggestions (category + estimated saving amount in cents → displayed as currency) that would close the gap between current monthly surplus and required monthly saving; goals already on track show a success card
- Above the tabs: excessive-spending alerts for any category whose monthly spend exceeds 40% of a 30%-of-income budget threshold (~12% of monthly income)
- Goals whose `target_date` has passed display an "Expired" badge but still render suggestions
- When no income transactions exist in the 30-day window: a banner explains the gap and skips the calculation
- Smart empty states when no transactions or no goals exist, each with a targeted CTA
- `npm run lint`, `npx tsc --noEmit`, and `npm run build` all pass

### Key Discoveries:

- `src/lib/services/transactions.ts:TransactionWithCategory` — already the correct input type for the engine
- `src/types.ts` — engine output types (`Suggestion`, `SpendingAlert`, `GoalRecommendation`, `RecommendationsResult`) must be added here so downstream components are typed
- `src/middleware.ts:PROTECTED_ROUTES` — add `/recommendations`

## What We're NOT Doing

- No API route (`/api/recommendations`) — data is fetched server-side in the Astro page's frontmatter; the React island receives pre-computed data as props and handles only UI state (active tab)
- No cross-goal deduplication of suggestions — per-goal independence is MVP; dedup is v2 (PRD FR-010 commentary)
- No suggestion to "accelerate" a goal already on track — on-track state shows affirmation only
- No editing of goals — delete only (S-05 scope)
- No export of recommendations — out of MVP scope
- No real-time updates — page reflects data at SSR time; user refreshes to see updated recommendations
- No per-category budget setting — the threshold is computed automatically from income

## Implementation Approach

**Algorithm (pure TypeScript, no HTTP):**

1. Filter `getUserTransactions()` result to rolling 30-day window (`date >= today − 30 days`)
2. Separate into `income` and `expense` arrays by `transaction.type`
3. `monthly_income_cents = sum(income.amount)` — if 0, set missing-income flag
4. Group `expense` by `category_id` (or `"uncategorized"`) → `{ categoryId: { name, slug, totalCents } }`
5. `monthly_expense_cents = sum(all expense.amount)`
6. `monthly_surplus_cents = monthly_income_cents − monthly_expense_cents`
7. **Excessive-spending alerts**: `threshold_cents = monthly_income_cents × 0.12`; any category where `totalCents > threshold_cents` → alert
8. **Per-goal suggestions** (for each goal in `getUserGoals()`):
   - `is_expired = target_date < today`
   - `months_remaining = max(1, monthsBetween(today, target_date))` — floor at 1 to avoid division by zero on expiring goals
   - `required_monthly_saving_cents = Math.ceil(target_amount / months_remaining)`
   - `gap_cents = max(0, required_monthly_saving_cents − monthly_surplus_cents)`
   - If `gap_cents === 0`: `{ isOnTrack: true, suggestions: [] }`
   - Else: greedy walk — sort categories by `totalCents desc`; for each (up to 5): `cut = min(category.totalCents, remaining_gap)`; accumulate suggestions until `remaining_gap ≤ 0`

**Rendering:**

Full SSR Astro page fetches everything server-side and passes a single typed `RecommendationsResult` prop to a React island. The island handles only tab-switching state. No client-side data fetching.

## Critical Implementation Details

- **Monetary display** — all `Suggestion.estimatedSavingCents` and `SpendingAlert.spendCents` / `thresholdCents` are integer cents; the React island formats them with `(value / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })` — never store or pass display-formatted strings as data.
- **`months_remaining` floor** — use `max(1, ...)` to avoid dividing by zero for goals expiring this month or already expired. An expired goal gets `months_remaining = 1`, which produces the most aggressive (highest) required saving — intentional, it signals urgency.
- **Category join null handling** — `TransactionWithCategory.category` is `null` when `category_id` is null; group these under a synthetic `"uncategorized"` bucket with a display name of "Other" and slug `"other"`.

---

## Phase 1: Recommendations Engine + Types

### Overview

Add output types to `src/types.ts` and create `src/lib/services/recommendations.ts` — a pure computation function with no side effects and no HTTP calls. This is the mathematical heart of the feature; it must be independently verifiable before any UI is wired.

### Changes Required:

#### 1. Recommendation output types

**File**: `src/types.ts`

**Intent**: Add four interfaces that describe what the recommendations engine produces so the Astro page and React island share the same typed contract.

**Contract**:

```typescript
export interface Suggestion {
  categorySlug: string;
  categoryName: string;
  estimatedSavingCents: number; // cut amount, always > 0
}

export interface SpendingAlert {
  categorySlug: string;
  categoryName: string;
  spendCents: number;       // actual category spend in the 30-day window
  thresholdCents: number;   // 12% of monthly income
}

export interface GoalRecommendation {
  goalId: string;
  goalName: string;
  targetAmountCents: number;
  targetDate: string; // ISO YYYY-MM-DD
  isExpired: boolean;
  isOnTrack: boolean;
  requiredMonthlySavingCents: number;
  currentSurplusCents: number;
  suggestions: Suggestion[]; // max 5, empty when isOnTrack
}

export interface RecommendationsResult {
  hasMissingIncome: boolean;
  monthlyIncomeCents: number;
  alerts: SpendingAlert[];
  goals: GoalRecommendation[]; // same order as getUserGoals() (created_at ASC)
}
```

#### 2. Recommendations engine

**File**: `src/lib/services/recommendations.ts`

**Intent**: Export `computeRecommendations(transactions, goals)` — the pure function that applies the algorithm described in "Implementation Approach". No Supabase client dependency; takes already-fetched data as arguments so it is easily testable and callable from any Astro frontmatter or future API route.

**Contract**: `computeRecommendations(transactions: TransactionWithCategory[], goals: SavingsGoal[]): RecommendationsResult`

The function must:
- Return `hasMissingIncome: true` and empty `alerts` / `goals` if no income transactions exist in the window (goals array still contains goal metadata but with `suggestions: []` and `isOnTrack: false`)
- Apply the 30-day rolling window filter internally — callers pass the full transactions array and the function filters
- Represent today's date as `new Date()` for the window boundary and `target_date` comparison — no date library dependency; plain `Date` arithmetic suffices for month difference calculation (`Math.ceil((targetDate - today) / (1000 * 60 * 60 * 24 * 30))`)

### Success Criteria:

#### Automated Verification:

- TypeScript compilation passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`

#### Manual Verification:

- Call `computeRecommendations([], [])` from a scratch file — returns `{ hasMissingIncome: true, monthlyIncomeCents: 0, alerts: [], goals: [] }` without throwing
- Call with a sample transaction array (mix of income and expense) and one goal — verify suggestion amounts are mathematically correct against a hand-worked example; verify the greedy algorithm stops before 5 suggestions if the gap is closed

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the computation is mathematically correct before wiring the UI.

---

## Phase 2: /recommendations SSR Page

### Overview

Create the Astro page that fetches data server-side, runs the engine, handles all empty-state and missing-data branches, and passes a fully-typed `RecommendationsResult` to the React island. Add the route to `PROTECTED_ROUTES` so unauthenticated users are redirected to sign-in.

### Changes Required:

#### 1. PROTECTED_ROUTES update

**File**: `src/middleware.ts`

**Intent**: Add `/recommendations` to the protected routes array so unauthenticated requests are redirected before the page renders.

**Contract**: Append `"/recommendations"` to the existing `PROTECTED_ROUTES` array.

#### 2. /recommendations Astro page

**File**: `src/pages/recommendations.astro`

**Intent**: Server-side data orchestration layer. Fetch the user's Supabase client from `Astro.locals`, call `getUserTransactions()`, `getUserGoals()`, and `computeRecommendations()`. Determine which empty-state variant applies (no goals, no transactions, or all prerequisites met) and either render the smart empty state inline or pass the `RecommendationsResult` to `RecommendationsPanel`. Wrap the page in the existing `Layout` component.

**Contract**:
- Empty-state priority: check `goals.length === 0` first (CTA: "Create a savings goal"), then `transactions.length === 0` (CTA: "Connect your bank account"), then proceed to render the panel
- The Supabase client is obtained via `Astro.locals` (already resolved by middleware) — do not create a new client in the page
- Pass `result` (typed `RecommendationsResult`) and `goals` as props to `<RecommendationsPanel client:load />`; use `client:load` so the tab switcher is interactive on first paint

### Success Criteria:

#### Automated Verification:

- TypeScript compilation passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Navigate to `/recommendations` while unauthenticated — confirm redirect to sign-in
- Sign in and navigate to `/recommendations` with no goals and no transactions — confirm "Create a savings goal" CTA is shown
- Sign in with transactions but no goals — confirm "Create a savings goal" CTA
- Sign in with goals but no transactions — confirm "Connect your bank account" CTA

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the empty states and route protection work correctly before building the recommendations UI.

---

## Phase 3: RecommendationsPanel React Island

### Overview

Create the React island that renders the full recommendations UI: excessive-spending alerts section (always above tabs), a tab per active goal, and within each tab the suggestion list, on-track card, expired badge, or missing-income banner as appropriate.

### Changes Required:

#### 1. RecommendationsPanel component

**File**: `src/components/RecommendationsPanel.tsx`

**Intent**: Interactive tab-switching island that renders the full recommendations surface. Receives `result: RecommendationsResult` and `goals: SavingsGoal[]` as props. Manages a single piece of state: `activeGoalIndex` (0-based, defaults to 0).

**Contract**:

Props:
```typescript
interface Props {
  result: RecommendationsResult;
}
```

Rendering rules:
- **Missing income banner** (if `result.hasMissingIncome`): render a full-width info banner above everything else: "We couldn't detect income this month — make sure salary/income transactions are imported." Do not render alerts or tabs when missing income.
- **Alerts section** (if `result.alerts.length > 0`): a labeled section above the tabs showing each `SpendingAlert` as a card with category name, actual spend, and threshold (both formatted as currency).
- **Goal tabs**: a tab bar listing each goal by `goalName`. Expired goals show an "Expired" badge inline in the tab label.
- **Active tab content**:
  - `isOnTrack: true` → a success card: "You're on track for [goalName]! Your current surplus covers the required monthly saving."
  - `isExpired: true` + not on track → same suggestion list as normal, but headed with an expired notice
  - Suggestions exist → ordered list of up to 5 suggestion cards: category name + "Cut ~[amount]" (formatted currency)
  - No suggestions + no income → covered by the missing-income banner above
- All currency formatting: `(cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })`
- Use `cn()` from `@/lib/utils` for all conditional class merging — never concatenate classes manually

### Success Criteria:

#### Automated Verification:

- TypeScript compilation passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- With one on-track goal: tab shows success card; alerts still appear above if any
- With one goal behind schedule: tab shows ranked suggestions with correct currency amounts
- With an expired goal: tab label shows "Expired" badge; suggestion list still renders
- With two goals: tab switcher works; switching tabs shows the correct goal's data
- With a category exceeding the alert threshold: alert card appears above the tabs with correct amounts
- All states render within 2 seconds of navigation (NFR — page load, not client-side transition)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that all UI states render correctly and the math shown matches hand-worked expectations.

---

## Phase 4: Navigation

### Overview

Add a "Recommendations" link to the top navigation bar so users can reach the page without typing the URL.

### Changes Required:

#### 1. Topbar navigation link

**File**: `src/components/Topbar.astro`

**Intent**: Add a navigation item linking to `/recommendations` so the route is discoverable from any authenticated page. Style consistently with any existing nav items.

**Contract**: A standard anchor tag `<a href="/recommendations">Recommendations</a>` added to the Topbar's navigation area. Read the existing Topbar markup first and follow whatever pattern and class structure is already in use — do not introduce a new pattern.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- The "Recommendations" link is visible in the top navigation on the dashboard and on the recommendations page itself
- Clicking the link navigates to `/recommendations`
- Active/current-page styling (if any) applies correctly when on `/recommendations`

**Implementation Note**: This phase completes the slice. After all automated verification passes and the full end-to-end flow is manually confirmed (sign in → see nav link → click → see recommendations), the change is ready for review.

---

## Testing Strategy

### Unit Tests:

No test runner is configured (per AGENTS.md). Verification is TypeScript compilation + lint + manual spot-checks.

The `computeRecommendations()` function is pure and can be exercised via a temporary scratch file — this is the highest-value manual test since correctness of the algorithm is the wedge.

### Integration Tests:

- Supabase is exercised indirectly via the existing service helpers; no new Supabase queries are added in this slice
- End-to-end flow: sign in → import transactions (S-01 done) → create goal (S-04 done) → navigate to `/recommendations` → verify suggestions match a hand-calculated expected output

### Manual Testing Steps:

1. Compute expected output by hand before implementing: pick a sample monthly income (e.g., $5,000 = 500000¢), 3 expense categories with known totals, and a goal requiring $300/month more saving than current surplus. Verify the greedy algorithm produces the expected suggestions.
2. Sign in with a seeded test user, confirm the page renders within 2 seconds.
3. Test the missing-income state by using a test account with no income-type transactions.
4. Test the on-track state by using a goal whose `target_amount` is small enough that the current surplus already covers it.
5. Test the expired-goal state by inserting a goal with `target_date` in the past via Supabase Studio.
6. Test with 2 and 3 active goals to verify tab switching and per-goal isolation.
7. Test the excessive-spending alert threshold with a category that has >12% of monthly income in spend.

## Performance Considerations

The 2-second NFR (PRD) applies to the recommendations page. All data fetching is server-side (SSR); the Supabase queries are simple selects with no cross-user joins. Bottleneck risk is only if a user has a very large transaction history — acceptable at MVP scale (target_scale: small data volume per roadmap). No caching needed for MVP.

The recommendations computation is O(n) in transaction count and O(g × c) in goals × categories — negligible at MVP scale.

## Migration Notes

No new migrations required — this slice is read-only against the schema established by F-01. All three tables (`transactions`, `savings_goals`, `categories`) already exist with the correct structure.

## References

- Roadmap: `context/foundation/roadmap.md` — S-06
- PRD: `context/foundation/prd.md` — US-01, FR-009, FR-010, Business Logic section, NFR (2s render time)
- Data schema: `context/changes/data-schema-foundation/plan.md`
- Existing service helpers: `src/lib/services/transactions.ts`, `src/lib/services/savings-goals.ts`, `src/lib/services/categories.ts`
- Entity types: `src/types.ts`
- Supabase client: `src/lib/supabase.ts`
- Auth middleware: `src/middleware.ts`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Recommendations Engine + Types

#### Automated

- [x] 1.1 TypeScript compilation passes: `npx tsc --noEmit` — 5f132fa
- [x] 1.2 Lint passes: `npm run lint` — 5f132fa

#### Manual

- [x] 1.3 `computeRecommendations([], [])` returns correct zero state without throwing — 5f132fa
- [x] 1.4 Suggestion amounts match a hand-worked example; greedy stops when gap is closed — 5f132fa

### Phase 2: /recommendations SSR Page

#### Automated

- [x] 2.1 TypeScript compilation passes: `npx tsc --noEmit` — 480c4ee
- [x] 2.2 Lint passes: `npm run lint` — 480c4ee
- [x] 2.3 Build passes: `npm run build` — 480c4ee

#### Manual

- [x] 2.4 Unauthenticated request to `/recommendations` redirects to sign-in — 480c4ee
- [x] 2.5 No goals + no transactions → "Create a savings goal" CTA shown — 480c4ee
- [x] 2.6 Transactions present, no goals → "Create a savings goal" CTA shown — 480c4ee
- [x] 2.7 Goals present, no transactions → "Connect your bank account" CTA shown — 480c4ee

### Phase 3: RecommendationsPanel React Island

#### Automated

- [x] 3.1 TypeScript compilation passes: `npx tsc --noEmit` — af76610
- [x] 3.2 Lint passes: `npm run lint` — af76610
- [x] 3.3 Build passes: `npm run build` — af76610

#### Manual

- [x] 3.4 On-track goal shows success card; alerts still appear if any exist — af76610
- [x] 3.5 Behind-schedule goal shows ranked suggestions with correct currency amounts — af76610
- [x] 3.6 Expired goal tab shows "Expired" badge; suggestions still render — af76610
- [x] 3.7 Two active goals: tab switching shows correct per-goal data — af76610
- [x] 3.8 Category above alert threshold: alert card appears above tabs with correct amounts — af76610
- [x] 3.9 Page renders within 2 seconds of navigation — af76610

### Phase 4: Navigation

#### Automated

- [x] 4.1 Lint passes: `npm run lint` — 36ed471
- [x] 4.2 Build passes: `npm run build` — 36ed471

#### Manual

- [ ] 4.3 "Recommendations" link visible in top navigation on dashboard and recommendations page
- [ ] 4.4 Clicking the link navigates to `/recommendations`
