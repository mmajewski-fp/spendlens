# Transactions List Implementation Plan

## Overview

Add a new `/transactions` page (roadmap **S-03** / **FR-005**): a signed-in user with imported transactions browses a full, chronological list of every expense and income, each row showing its assigned category. The differentiator from a raw bank statement — and the PRD's explicit defense of this slice — is that **the category is visibly attached to every row**. Built as a pure Astro SSR page (no React island), mirroring the `dashboard.astro` / `recommendations.astro` skeleton.

## Current State Analysis

- **No transactions-list page exists.** There is `src/pages/transactions/import.astro` (the import flow) but no list view at `/transactions`.
- **The data helper already returns exactly what's needed, unchanged**: `getUserTransactions(client, since?)` (`src/lib/services/transactions.ts:5-17`) called *without* `since` returns all `TransactionWithCategory[]`, ordered by `date` descending, with the category `{name, slug}` joined per row (`null` category when uncategorized).
- **`TransactionWithCategory`** (`src/types.ts:25-27`) = `Transaction & { category: {name, slug} | null }`; `Transaction` carries `amount` (positive integer cents), `type` ("income" | "expense"), `description` (nullable), `date` (ISO `YYYY-MM-DD`).
- **Two proven SSR patterns to mirror**: `src/pages/dashboard.astro` (just shipped) and `src/pages/recommendations.astro` — both do `createClient` → `if (supabase)` `try/catch` fetch → `configError` / `fetchError` / empty-state branches → render, with `Topbar` inside a `bg-cosmic` layout.
- **`Topbar.astro`** links Dashboard / Goals / Recommendations for signed-in users; it has no Transactions link yet.
- **Money formatting convention**: `formatCents(cents)` = `(cents/100).toLocaleString("en-US", {style:"currency", currency:"USD"})`, duplicated per-component (`RecommendationsPanel.tsx:9-10`, `SpendingSummary.tsx:7-9`, `GoalsManager.tsx:13`).
- **`/dashboard` and `/transactions/import` are protected** via `src/middleware.ts` `PROTECTED_ROUTES`; `/transactions` will need adding there (verify exact array).

### Key Discoveries:

- The full list is a single `getUserTransactions(supabase)` call (no `since`) — no service, schema, type, or API-route changes.
- The only genuinely testable logic is turning a positive-cents `amount` + `type` into a signed, formatted string — worth extracting into one pure helper.
- Roadmap risk note (S-03): a raw list duplicates the bank app; the category layer is the justification — every row must show its category (fallback "Other" for null).

## Desired End State

A signed-in user navigates to `/transactions` (via a new `Topbar` link) and sees, within the cosmic layout with `Topbar`:

- A heading and a "Showing N transactions" count.
- A vertically stacked list of cards, one per transaction, newest first, each showing: date, description (or a graceful fallback when null), a category badge (category name, "Other" when null), and a signed, color-coded amount — expenses as `−$X` (rose), incomes as `+$X` (emerald).
- Graceful `configError` / `fetchError` cards and a "No transactions imported" empty state with a Connect-bank CTA — mirroring `/dashboard`.

Verified by: `npm run lint`, `npm run build`, and `npx vitest run` all pass; the `formatSignedAmount` helper has unit tests (income, expense, zero); manual check on `/transactions` after an import shows the list, count, category badges, signed amounts, and the empty/error states.

## What We're NOT Doing

- No filtering, sorting UI, or search (would force client-side interactivity — out of scope for this thin slice).
- No pagination / infinite scroll — render all transactions (MVP data volume is bounded).
- No React island / client-side JS — the list is static.
- No date-grouping, no separate income/expense sections — one chronological list.
- No new service, type, API route, schema, or migration.
- No edit/delete of transactions.
- No de-duplication of the existing `formatCents` copies (out of scope).
- No Playwright/E2E test in this plan — a follow-up via `/10x-e2e` if desired.

## Implementation Approach

Single phase. Add one small pure helper (`formatSignedAmount`) with unit tests, then build the SSR page that fetches all transactions and renders the card list, reusing the proven `dashboard.astro` state-handling skeleton. Add a `Transactions` link to `Topbar` and register `/transactions` as a protected route.

## Critical Implementation Details

- **SSR error safety** (lessons.md): the transaction fetch must sit inside a `try/catch` that sets `fetchError`, exactly as `dashboard.astro` / `recommendations.astro:20-30`, so a transient Supabase error renders a card, not a blank 500.
- **Accessibility of the amount**: color alone must not carry the income/expense distinction — the `+`/`−` sign (and the natural amount) must make it legible without color.

## Phase 1: Transactions list page + signed-amount helper

### Overview

Add the tested signed-amount helper, the `/transactions` SSR page with card rows and all states, and the `Topbar` link + protected-route registration.

### Changes Required:

#### 1. Signed-amount helper

**File**: `src/lib/format-money.ts` (new)

**Intent**: Turn a positive-cents `amount` + transaction `type` into a signed, currency-formatted string so the page (and any future caller) has one tested place for this logic.

**Contract**: `formatSignedAmount(cents: number, type: TransactionType): string` — returns `+$X.XX` for `income` and `−$X.XX` for `expense`, formatting the (positive) cents via the existing `formatCents` convention (`(cents/100).toLocaleString("en-US", {style:"currency", currency:"USD"})`). Use a true minus sign consistent with the UI copy. Keep it pure (no clock/locale ambiguity — currency locale is fixed "en-US" per existing convention).

#### 2. Helper unit tests

**File**: `src/lib/format-money.test.ts` (new)

**Intent**: Lock the sign + formatting contract.

**Contract**: Vitest cases: expense → leading `−` and `$` amount; income → leading `+`; zero cents; a multi-dollar amount formats with thousands separator as `toLocaleString` does. Runs under the existing `TZ=UTC` unit config (`src/**/*.test.ts`, node env).

#### 3. Transactions list page

**File**: `src/pages/transactions.astro` (new)

**Intent**: SSR page that fetches all transactions and renders the chronological card list with category badges and signed amounts, mirroring `dashboard.astro`'s structure and states.

**Contract**: Frontmatter creates the Supabase client, fetches `getUserTransactions(supabase)` (no `since`) inside a `try/catch` (sets `fetchError`), and branches on `configError` (null client) / `fetchError` / no-transactions empty-state (Connect-bank CTA to `/transactions/import`, copy mirroring `dashboard.astro`). Otherwise renders `Topbar`, a heading, a "Showing N transactions" count, and a `.map()` over transactions to card rows — each row: `date`, `description` (fallback label when null), a category badge (`category?.name ?? "Other"`), and `formatSignedAmount(amount, type)` styled emerald for income / rose for expense. Static markup (no `client:*`). Note: `/transactions` and `/transactions/import` must both resolve — confirm the new page does not shadow the existing import route (distinct paths, so fine).

#### 4. Topbar link + protected route

**Files**: `src/components/Topbar.astro`, `src/middleware.ts`

**Intent**: Make the page reachable and gated like the rest of the app.

**Contract**: Add a `Transactions` nav link (to `/transactions`) in `Topbar`'s signed-in link group, following the existing link markup. Add `/transactions` to `PROTECTED_ROUTES` in `middleware.ts` so unauthenticated users are redirected, consistent with `/dashboard`.

### Success Criteria:

#### Automated Verification:

- Type checking / build passes: `npm run build`
- Linting passes: `npm run lint`
- Helper unit tests pass: `npx vitest run src/lib/format-money.test.ts`
- Full unit suite passes: `npx vitest run`

#### Manual Verification:

- After importing transactions, `/transactions` shows all of them newest-first as cards, each with date, description, a category badge, and a correctly signed/colored amount; the "Showing N transactions" count matches.
- Uncategorized transactions show an "Other" badge (no blank/broken category).
- The "No transactions imported" empty state renders with a working Connect-bank link for a user who hasn't imported.
- `configError` / `fetchError` cards render on a misconfigured DB / simulated fetch failure; no blank 500 page.
- `Topbar` shows a working Transactions link; unauthenticated access to `/transactions` redirects to sign-in.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before the phase-end commit.

---

## Testing Strategy

### Unit Tests:

- `formatSignedAmount`: expense (leading `−`), income (leading `+`), zero, large amount with separator.

### Integration Tests:

- None added; the SSR page is exercised manually and by the build.

### Manual Testing Steps:

1. Import transactions via `/transactions/import`, then open `/transactions` — confirm the card list, count, category badges, and signed/colored amounts.
2. As a fresh user (no import), open `/transactions` — confirm the empty state and Connect-bank CTA.
3. Sign out and hit `/transactions` directly — confirm redirect to sign-in.

## Performance Considerations

Read-only, single query; renders all of a user's own (RLS-scoped) transactions. No pagination for MVP volumes; revisit if histories grow large. No new dependencies, no shipped JS.

## Migration Notes

None — no schema or data changes.

## References

- Pattern to mirror: `src/pages/dashboard.astro`, `src/pages/recommendations.astro:1-100`
- Data helper: `src/lib/services/transactions.ts:5-17`
- Money formatting convention: `src/components/SpendingSummary.tsx:7-9`
- Roadmap slice S-03 + FR-005: `context/foundation/roadmap.md`, `context/foundation/prd.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Transactions list page + signed-amount helper

#### Automated

- [x] 1.1 Type checking / build passes: `npm run build`
- [x] 1.2 Linting passes: `npm run lint`
- [x] 1.3 Helper unit tests pass: `npx vitest run src/lib/format-money.test.ts`
- [x] 1.4 Full unit suite passes: `npx vitest run`

#### Manual

- [x] 1.5 `/transactions` shows all transactions newest-first as cards with date, description, category badge, and correctly signed/colored amount; count matches
- [x] 1.6 Uncategorized transactions show an "Other" badge
- [x] 1.7 No-transactions empty state renders with working Connect-bank link
- [x] 1.8 `configError` / `fetchError` cards render; no blank 500 page
- [x] 1.9 `Topbar` Transactions link works; unauthenticated `/transactions` redirects to sign-in
