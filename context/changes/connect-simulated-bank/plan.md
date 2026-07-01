# Connect Simulated Bank (S-01) Implementation Plan

## Overview

Add the transaction-import pipeline for SpendLens: a signed-in user triggers "Connect Bank", an **in-repo deterministic** simulated banking source generates per-user transactions, each is auto-assigned one of the 11 fixed categories, the rows are persisted under the user via the existing idempotent insert, and the UI confirms how many landed. This is the roadmap slice S-01 — the prerequisite that makes the already-built wedge (S-06 recommendations) and the downstream views (S-02/S-03) reachable by a real user instead of only by seeded test data.

## Current State Analysis

- **Data tier is complete and untouched by this slice.** F-01 shipped `transactions` + `categories` with per-user RLS, the 11-slug taxonomy, and an idempotent bulk insert. Import was explicitly deferred to S-01 (`context/changes/data-schema-foundation/plan.md:31`).
- `createTransactions(client, rows)` already upserts with `onConflict: "user_id,external_id", ignoreDuplicates: true` and returns only newly-inserted rows (`src/lib/services/transactions.ts:19-30`). Idempotency is therefore a schema-level guarantee — the pipeline only needs a **stable** `external_id`.
- `getCategories(client)` returns `{id,name,slug}` (`src/lib/services/categories.ts:4-9`); **no lookup-by-slug helper exists** — the orchestrator builds a `Map<slug,id>`.
- RLS is the **only** isolation mechanism — no service-layer `user_id` filter, no service-role key. Import must run under the user's own authenticated client with each row's `user_id = auth.uid()` (`supabase/migrations/20260527000000_data_schema_foundation.sql:66-85`).
- The vertical-slice pattern to mirror is the shipped goals feature: SSR page → `POST` API route (zod, auth guard, `jsonResponse`, try/catch) → React island (authoritative `Props`) → service (`src/pages/goals.astro`, `src/pages/api/goals.ts`, `src/components/goals/GoalsManager.tsx`).
- The shipped recommendations empty-state CTA **already links to `/transactions/import`** (`src/pages/recommendations.astro:87-92`) — currently a dangling link this slice resolves.
- The S-06 engine reads a rolling 30-day window off "today" and **suppresses everything when there is no in-window income** (`src/lib/services/recommendations.ts:44-56,77-78`).

### Key Discoveries:

- Idempotency is free via `UNIQUE(user_id, external_id)` + existing upsert (`transactions.ts:25`).
- The generator must emit ≥1 `income` (salary) row inside the 30-day window or the wedge shows nothing (`recommendations.ts:52-56`).
- Determinism is mandatory: no `Math.random()` / `Date.now()` / ambient locale; pin `TZ=UTC`; codepoint comparison not bare `localeCompare` (`context/foundation/lessons.md`).
- SSR frontmatter service calls must be wrapped in try/catch to avoid blank 500s (`context/foundation/lessons.md`).
- The island's `Props` interface is the authoritative prop surface (`context/foundation/lessons.md`).

## Desired End State

A signed-in user clicks "Connect Bank" (from the dashboard or the recommendations empty-state CTA), lands on `/transactions/import`, triggers the import, and sees "Imported N transactions" with a link onward to the dashboard/recommendations. Their transactions now exist, categorized, under their account only. Re-triggering shows "0 new — already imported". The dashboard (S-02) and recommendations (S-06) now have real per-user data to render. Verifiable via: unit tests on the pure core, hermetic tests on the route, and ad-hoc real-Supabase integration tests proving idempotency and per-user isolation.

## What We're NOT Doing

- No real bank / Plaid / OAuth integration — simulated in-repo only (PRD Non-Goal).
- No schema changes / migrations — F-01 covers the data tier.
- No transactions-list view (S-03), no categorized dashboard summary (S-02), no export (S-07) — those are separate slices; this slice only lands + confirms data.
- No editing/deleting imported transactions.
- No "connected" persistent flag or button-disabling — re-connect is handled by idempotency, not by stored state.
- No Topbar nav link (entry points are the dashboard button + the recommendations CTA).
- No e2e/browser tests (Lesson 4 scope).

## Implementation Approach

Build the slice bottom-up so each phase is independently verifiable: (1) the pure, DB-free core (generator + mapper) with unit tests; (2) the impure orchestrator + API route with hermetic tests; (3) the SSR page + island + entry-point wiring; (4) the ad-hoc real-Supabase integration guardrails (idempotency + isolation). The pure/impure split keeps the deterministic logic unit-testable without mocking Supabase, mirroring the existing `computeRecommendations` vs its wiring.

## Critical Implementation Details

- **Determinism & the `today` anchor.** The pure generator must not read the wall clock. The orchestrator/route computes a UTC `today` (`YYYY-MM-DD`) and injects it; the generator derives each `date` as `today − offsetDays` (`offsetDays ∈ [0,29]`) so every row lands in the S-06 window. All randomness comes from a seeded PRNG (FNV-1a hash of `userId` over UTF-16 code units → mulberry32), never `Math.random()`.
- **`external_id` is date-independent.** Use `sim-${userId}-${index}` — a pure function of `userId`+slot index only. This keeps re-connects on different days idempotent (same slots update in place) even though the `date` shifts with `today`.
- **Income must exceed the alert threshold for one category.** Size the salary and at least one expense category so that category's 30-day spend exceeds `floor(monthly_income × 0.12)` — otherwise S-06 alerts never fire and the demo is weak.

## Phase 1: Pure core — generator + mapper

### Overview

Two pure, DB-free modules plus co-located unit tests. No Astro, no Supabase.

### Changes Required:

#### 1. Simulated bank generator

**File**: `src/lib/services/simulated-bank.ts`

**Intent**: Deterministically produce a per-user set of simulated bank transactions for a given day, so the same user always gets the same data and re-connecting is stable. Emits raw transactions (no category ids yet).

**Contract**: Export a `SimulatedTransaction` type `{ amount: number /* positive cents */, type: "income" | "expense", description: string, date: string /* YYYY-MM-DD */, external_id: string }` and a function `generateTransactions(userId: string, today: string): SimulatedTransaction[]`. Deterministic: seed a mulberry32 PRNG from an FNV-1a hash of `userId` (over UTF-16 code units — no locale). Produce ~30–50 rows across ~6–8 expense category themes plus exactly one `salary` income row; all `date`s = `today − offsetDays` for `offsetDays ∈ [0,29]`; `external_id = sim-${userId}-${index}`. Sizing must guarantee one expense theme's total exceeds 12% of the salary. At least one description must be authored to fall through to the mapper's `Other` bucket. No `Math.random`/`Date.now`/`new Date()` inside.

#### 2. Description → category mapper

**File**: `src/lib/services/transaction-categorizer.ts`

**Intent**: Map a free-text transaction description onto one of the 11 fixed category slugs, with `Other` as the fallback, deterministically and locale-safely.

**Contract**: Export `categorize(description: string): string` returning one of the seeded slugs (`groceries|dining|transport|housing|utilities|entertainment|healthcare|shopping|travel|salary|other`). Implementation: an ordered keyword→slug table matched via lowercased substring `includes`; no match → `"other"`. Any ordering/tie-break uses codepoint comparison, never bare `localeCompare`. Keyword coverage is total-by-design for the generator's descriptions except the one intentional `Other` case.

#### 3. Unit tests

**File**: `src/lib/services/simulated-bank.test.ts`, `src/lib/services/transaction-categorizer.test.ts`

**Intent**: Pin the deterministic contracts with hand-worked oracles (not mirrors of the implementation).

**Contract**: Explicit `vitest` imports (no globals), run under the existing `TZ=UTC` script. Assert: same `(userId, today)` → identical output (determinism); all dates within `[today-29, today]`; ≥1 `income` row; ≥1 expense theme total > 12% of income; `external_id` stable and unique; `categorize` maps representative descriptions to the expected slugs and the intentional case to `other`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Unit tests pass: `npm run test`

#### Manual Verification:

- Generated dataset "looks like" a plausible month (spot-check descriptions, amounts, category spread).

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Orchestrator + API route

### Overview

Wire the pure core to persistence behind an authenticated `POST` endpoint. Hermetic tests only (no Docker).

### Changes Required:

#### 1. Import orchestrator

**File**: `src/lib/services/import-transactions.ts`

**Intent**: Turn generated transactions into persisted, categorized rows for the authenticated user and report how many are new.

**Contract**: Export `importTransactions(client: SupabaseClient, userId: string, today: string): Promise<{ imported: number }>`. Steps: `getCategories(client)` → build `Map<slug,id>`; `generateTransactions(userId, today)`; for each, `categorize(description)` → resolve slug→id (missing slug → `other` id → else `null`); shape `Omit<Transaction,"id"|"created_at">` rows with `user_id: userId`; `createTransactions(client, rows)`; return `{ imported: result.length }` (upsert returns only new rows). Let service errors propagate (route handles them).

#### 2. API route

**File**: `src/pages/api/transactions/import.ts`

**Intent**: Authenticated endpoint that runs the import for the current user and returns the landed count, mirroring the goals route conventions.

**Contract**: `export const prerender = false`; `export const POST: APIRoute`. Guard `!context.locals.user` → 401; `createClient(context.request.headers, context.cookies)`, `!supabase` → 500. Compute `today` as a UTC `YYYY-MM-DD`. Call `importTransactions(supabase, context.locals.user.id, today)` in try/catch; success → `jsonResponse({ imported }, 200)`; error → `jsonResponse({ error }, 500)` with message-only error (no PII). Reuse the `jsonResponse` helper pattern from `api/goals.ts:26-30`. No request body / zod needed (no user input).

#### 3. Hermetic tests

**File**: `src/pages/api/transactions/import.test.ts` (and orchestrator error-contract coverage as needed)

**Intent**: Prove the route's auth gate, success shape, and error contract without a real DB.

**Contract**: `vi.mock("@/lib/supabase")` + mock the orchestrator/service; invoke exported `POST` with a mocked `APIContext`. Assert: 401 when unauthenticated; 200 `{ imported: N }` on success; 500 with message-only error on service throw. Follow `src/pages/api/goals.test.ts` and cookbook §6.3/§6.4.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Unit + hermetic tests pass: `npm run test`

#### Manual Verification:

- `POST /api/transactions/import` while signed in returns `{ imported: N }` (via browser devtools or curl with a session cookie).

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: SSR page + island + entry points

### Overview

The user-facing surface at `/transactions/import` plus the two entry points, following the goals slice pattern.

### Changes Required:

#### 1. SSR import page

**File**: `src/pages/transactions/import.astro`

**Intent**: Protected page that hosts the import action and renders a graceful error card on failure.

**Contract**: Get the client via `createClient(Astro.request.headers, Astro.cookies)`; any frontmatter service call wrapped in try/catch with `configError`/`fetchError` flags (per lessons.md); render the island gated on no-error. Uses the shared Layout/Topbar like `goals.astro`.

#### 2. Import island

**File**: `src/components/transactions/ImportPanel.tsx`

**Intent**: Client component with the "Connect Bank" button that calls the API and shows the outcome.

**Contract**: Define the authoritative `Props` interface (the page passes exactly what this declares). `fetch("/api/transactions/import", { method: "POST" })`; handle loading, error, and success states; success renders "Imported N transactions" (and "0 new — already imported" when `imported === 0`) plus a link onward to `/dashboard` (and/or `/recommendations`). Mirror the state handling in `GoalsManager.tsx:37-100`.

#### 3. Route protection

**File**: `src/middleware.ts`

**Intent**: Require auth for the new page.

**Contract**: Add `"/transactions/import"` to `PROTECTED_ROUTES` (line 4). The API route self-guards via `locals.user`, so no middleware entry is needed for it.

#### 4. Entry points

**File**: `src/pages/dashboard.astro`, `src/pages/recommendations.astro`

**Intent**: Give the user discoverable ways to reach the import surface.

**Contract**: Add a "Connect Bank" button/link on the dashboard pointing to `/transactions/import`, following the Topbar link markup pattern. Verify the existing recommendations CTA (`recommendations.astro:87-92`) already targets `/transactions/import` and adjust only if the href differs.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- Tests pass: `npm run test`

#### Manual Verification:

- Unauthenticated visit to `/transactions/import` redirects to sign-in.
- Signed-in: dashboard button and recommendations CTA both navigate to `/transactions/import`.
- Clicking "Connect Bank" imports data and shows "Imported N transactions" with a working onward link.
- Re-clicking shows "0 new — already imported".
- After import, `/dashboard` and `/recommendations` render real per-user data.

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 4.

---

## Phase 4: Integration tests (real Supabase, ad-hoc)

### Overview

Prove the two DB-level guarantees a mock cannot: idempotency and per-user isolation. Ad-hoc gate (Docker), not CI.

### Changes Required:

#### 1. Idempotency integration test

**File**: `tests/integration/transaction-import.integration.test.ts`

**Intent**: Prove re-running the import creates no duplicates.

**Contract**: Using the existing harness (`helpers/users.ts`, `vitest.config.integration.ts`), seed via a test user's OWN client: call `importTransactions(userA.client, userA.id, today)` twice. Assert the first returns `imported > 0`, the second returns `imported === 0`, and `getUserTransactions(userA.client)` count is unchanged between the two.

#### 2. Isolation integration test

**File**: same file or a sibling under `tests/integration/`

**Intent**: Prove User A's imported data is never visible to User B (Risk #5).

**Contract**: Import for User A and User B via their own clients; assert `getUserTransactions(userA.client)` returns only A's rows (positive control: A sees its own) and none of B's, and symmetrically for B. Use `adminClient()` for setup/teardown ONLY. Model on `tests/integration/isolation.integration.test.ts:41-63,77-82`.

### Success Criteria:

#### Automated Verification:

- Integration tests pass: `npm run test:integration` (requires Docker + `npx supabase start`).

#### Manual Verification:

- Confirmed the integration suite was run locally (it is ad-hoc, not part of CI).

**Implementation Note**: This is the final phase; integration is an ad-hoc gate per `test-plan.md §5`.

---

## Testing Strategy

### Unit Tests:

- Generator determinism, 30-day window, ≥1 income, category spread, threshold-exceeding category, stable/unique `external_id`.
- Categorizer: representative description→slug mappings + the intentional `Other` fallback; codepoint-safe.

### Integration Tests:

- Idempotency: import ×2 → 0 new, count unchanged (real `UNIQUE` + upsert).
- Per-user isolation: A never sees B, with positive controls.

### Hermetic Tests:

- Route auth gate (401), success shape (`{ imported }`), error contract (500, message-only, no PII).

### Manual Testing Steps:

1. Sign in; from the dashboard click "Connect Bank" → land on `/transactions/import`.
2. Click "Connect Bank" → see "Imported N transactions".
3. Click again → "0 new — already imported".
4. Visit `/recommendations` and `/dashboard` → real data renders.
5. Sign out; visit `/transactions/import` → redirected to sign-in.

## Performance Considerations

~30–50 rows per import is trivial; a single bulk upsert. No pagination or batching needed.

## Migration Notes

None — no schema changes. Imported rows are ordinary `transactions` rows removed by the existing `ON DELETE CASCADE` when a user is deleted.

## References

- Related research: `context/changes/connect-simulated-bank/research.md`
- Data tier: `context/changes/data-schema-foundation/plan.md`
- Slice pattern: `src/pages/api/goals.ts`, `src/pages/goals.astro`, `src/components/goals/GoalsManager.tsx`
- Downstream consumer: `context/archive/2026-05-27-goal-anchored-recommendations/plan.md`
- Integration harness: `tests/integration/isolation.integration.test.ts`, `tests/integration/helpers/users.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Pure core — generator + mapper

#### Automated

- [x] 1.1 Type checking passes: `npx astro check` — 588e69c
- [x] 1.2 Linting passes: `npm run lint` — 588e69c
- [x] 1.3 Unit tests pass: `npm run test` — 588e69c

#### Manual

- [x] 1.4 Generated dataset looks like a plausible month (descriptions, amounts, category spread) — 588e69c

### Phase 2: Orchestrator + API route

#### Automated

- [x] 2.1 Type checking passes: `npx astro check` — 69a7c54
- [x] 2.2 Linting passes: `npm run lint` — 69a7c54
- [x] 2.3 Unit + hermetic tests pass: `npm run test` — 69a7c54

#### Manual

- [x] 2.4 `POST /api/transactions/import` while signed in returns `{ imported: N }` — 69a7c54

### Phase 3: SSR page + island + entry points

#### Automated

- [x] 3.1 Type checking passes: `npx astro check` — ab89ec9
- [x] 3.2 Linting passes: `npm run lint` — ab89ec9
- [x] 3.3 Build passes: `npm run build` — ab89ec9
- [x] 3.4 Tests pass: `npm run test` — ab89ec9

#### Manual

- [x] 3.5 Unauthenticated visit to `/transactions/import` redirects to sign-in — ab89ec9
- [x] 3.6 Dashboard button and recommendations CTA both navigate to `/transactions/import` — ab89ec9
- [x] 3.7 "Connect Bank" imports data and shows "Imported N transactions" with a working onward link — ab89ec9
- [x] 3.8 Re-clicking shows "0 new — already imported" — ab89ec9
- [x] 3.9 After import, `/dashboard` and `/recommendations` render real per-user data — ab89ec9

### Phase 4: Integration tests (real Supabase, ad-hoc)

#### Automated

- [x] 4.1 Integration tests pass: `npm run test:integration` (Docker + `npx supabase start`) — ca3c69a

#### Manual

- [x] 4.2 Confirmed the integration suite was run locally (ad-hoc, not CI) — ca3c69a
