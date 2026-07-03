# Export Transactions Implementation Plan

## Overview

Let a signed-in user download their categorized transactions as a **CSV** file (roadmap **S-07** / **FR-011**, nice-to-have; format resolved to CSV in Open Roadmap Q1, 2026-07-03). A pure `toCsv` serializer feeds a self-gated `GET /api/transactions/export` route that returns a `text/csv` attachment, triggered by a plain download link on the transactions page.

## Current State Analysis

- **Data + fetch already exist**: `getUserTransactions(supabase)` (`src/lib/services/transactions.ts:5-17`) returns all `TransactionWithCategory[]` — `date`, `description` (nullable), `category` `{name, slug} | null`, `type` ("income"|"expense"), `amount` (positive integer cents), ordered date desc. No change needed.
- **API route pattern is established**: `src/pages/api/goals.ts` — `export const prerender = false`, a `context.locals.user` → 401 gate, `createClient` (500 if null), and the shared `jsonResponse` helper now in `src/lib/api.ts`.
- **Auth**: `/api/transactions/export` is NOT covered by middleware `PROTECTED_ROUTES` (that matches `/transactions`, not `/api/...`), so the handler must self-gate with its own 401 — exactly like the goals routes.
- **The transactions page** (`src/pages/transactions.astro`) is pure Astro with a populated-list branch — the natural home for a `<a href download>` export link (no JS).
- **Money formatting**: `formatCents` (`src/lib/format-money.ts`) renders `$` + thousands separators — **unsuitable for CSV** (the `$` and commas would corrupt columns). The CSV amount must be a plain decimal.

### Key Discoveries:

- Everything needed exists; this is a serializer + a GET route + one link, mirroring shipped patterns.
- CSV correctness has two real hazards to handle in the serializer: RFC-4180 field escaping (commas, quotes, newlines in `description`) and spreadsheet formula injection (fields starting with `= + - @`).
- Amount representation: `(cents / 100).toFixed(2)` (e.g. `12.50`) — plain, no `$`, no separators.

## Desired End State

On `/transactions` (populated view), a signed-in user sees an "Export CSV" link. Clicking it downloads `spendlens-transactions-YYYY-MM-DD.csv` containing a header row (`date,description,category,type,amount`) and one row per transaction (newest first), amounts as positive decimal dollars with a separate `type` column, category name per row, all fields safely escaped and injection-guarded. A user with no transactions still gets a valid header-only CSV. Unauthenticated requests to the endpoint get 401.

Verified by: `npm run lint`, `npm run build`, `npx vitest run` all pass; `toCsv` unit tests cover escaping, injection guard, and the empty case; the hermetic endpoint test covers the 401 gate and the `text/csv` + `Content-Disposition` response; manual check downloads a well-formed CSV that opens cleanly in a spreadsheet.

## What We're NOT Doing

- No JSON or PDF export (Q1 resolved to CSV; JSON is a trivial future add-on if ever needed).
- No column configuration, date-range filtering, or export options UI.
- No internal ids/UUIDs (`id`, `external_id`, `category_id`, `created_at`, `slug`) in the output — user-facing columns only.
- No pagination/streaming — serialize all of the user's (RLS-scoped) rows in one response (MVP volume).
- No export control on the dashboard (transactions page only for now).
- No client-side JS / blob handling — a native `<a download>` GET.
- No Playwright/E2E in this plan (follow-up via `/10x-e2e` if desired).

## Implementation Approach

Single phase, bottom-up: a pure `toCsv` serializer (fully unit-testable), then the GET route that fetches + serializes + sets download headers (mirroring the goals route's gate/pattern), then a link on the transactions page. Hermetic endpoint test mirrors `goals.test.ts`.

## Critical Implementation Details

- **CSV amount is a plain decimal**, `(cents/100).toFixed(2)` — never `formatCents` (its `$`/commas corrupt CSV). Expenses export as positive amounts alongside the `type` column (per the chosen column design).
- **Field safety, applied in order**: (1) formula-injection guard — if a field's text starts with `= + - @` (or tab/CR), prefix with a single quote `'`; (2) RFC-4180 quote-escape — if the field contains a comma, double-quote, or newline, wrap it in double quotes and double any internal quotes. `description` is the primary risk field (free text, nullable → emit empty).
- **Determinism** (lessons.md): the filename date is built from UTC components (server runs UTC on Vercel), not a locale/timezone-sensitive conversion.

## Phase 1: CSV serializer + export endpoint + download link + tests

### Overview

Add the pure serializer, the self-gated export route, the download link, and tests.

### Changes Required:

#### 1. CSV serializer

**File**: `src/lib/transactions-csv.ts` (new)

**Intent**: Pure function turning transactions into a CSV string — the single place escaping and injection-guarding live, so it's fully unit-testable.

**Contract**: `toCsv(transactions: TransactionWithCategory[]): string`. Emits a header `date,description,category,type,amount` then one line per transaction in the given order: `date` (the ISO `YYYY-MM-DD` string as-is), `description` (`?? ""`), `category` (`category?.name ?? "Other"`), `type`, and `amount` as `(amount / 100).toFixed(2)`. Every field passes through a shared escape step: formula-injection guard (prefix `'` when the value starts with `= + - @`) then RFC-4180 quoting (wrap + double internal quotes when the value contains `,` `"` or newline). Lines joined with `\r\n` (RFC-4180). Empty input → header row only.

#### 2. Export API route

**File**: `src/pages/api/transactions/export.ts` (new)

**Intent**: Authenticated GET that streams the user's transactions as a downloadable CSV.

**Contract**: `export const prerender = false` + `export const GET: APIRoute`. 401 (via shared `jsonResponse`) when `context.locals.user` is absent; 500 when `createClient` returns null; otherwise `getUserTransactions(supabase)` → `toCsv(...)` → `new Response(csv, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": \`attachment; filename="spendlens-transactions-<YYYY-MM-DD>.csv"\` } })`. Date built from UTC components. Wrap the fetch in try/catch → 500 (lessons.md SSR-safety analogue for the data call).

#### 3. Export link on the transactions page

**File**: `src/pages/transactions.astro`

**Intent**: Give the populated transactions view a native download link.

**Contract**: In the `hasTransactions` branch (near the heading / "Showing N transactions" count), add `<a href="/api/transactions/export" download>Export CSV</a>` styled with the existing cosmic button classes. Only rendered when transactions exist (so the empty state has no link).

#### 4. Tests

**Files**: `src/lib/transactions-csv.test.ts` (new), `src/pages/api/transactions/export.test.ts` (new)

**Intent**: Cover the serializer's escaping/injection logic and the route's auth + download headers.

**Contract**:
- `transactions-csv.test.ts`: header present; row field mapping incl. `Other` fallback and empty description; amount `cents → N.NN`; comma/quote/newline escaping (RFC-4180); formula-injection guard for `=`, `+`, `-`, `@`; empty input → header-only.
- `export.test.ts`: mirror `goals.test.ts` hermetic style (`vi.mock("@/lib/supabase")`, `vi.mock` the transactions service). Cases: 401 when unauthenticated (service not called); 200 on success with `Content-Type: text/csv…` and a `Content-Disposition: attachment; filename=…` header.

### Success Criteria:

#### Automated Verification:

- Type checking / build passes: `npm run build`
- Linting passes: `npm run lint`
- Serializer + endpoint tests pass: `npx vitest run src/lib/transactions-csv.test.ts src/pages/api/transactions/export.test.ts`
- Full unit suite passes: `npx vitest run`

#### Manual Verification:

- On `/transactions` (with data), the Export CSV link downloads `spendlens-transactions-<today>.csv`.
- The file opens cleanly in a spreadsheet: header + one row per transaction, amounts as decimals, category on every row, type column correct.
- A description containing a comma/quote and one starting with `=` are escaped/guarded (no broken columns, no formula execution).
- A user with no transactions gets a valid header-only CSV (or no link, per the empty-state view).
- Unauthenticated `GET /api/transactions/export` returns 401.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before the phase-end commit.

---

## Testing Strategy

### Unit Tests:

- `toCsv`: header, field mapping (Other fallback, empty description), amount decimal, RFC-4180 escaping, formula-injection guard, empty → header-only.
- Export route: 401 gate; 200 with correct content-type + disposition.

### Integration Tests:

- None added; RLS scoping is covered by existing conventions, not required here.

### Manual Testing Steps:

1. Import transactions, open `/transactions`, click Export CSV, open the file in a spreadsheet.
2. Verify a tricky description (comma, quote, leading `=`) is escaped/guarded.
3. Sign out and hit `/api/transactions/export` — expect 401.

## Performance Considerations

Single query, in-memory string build over the user's own RLS-scoped rows; negligible for MVP volume. No new dependencies. No pagination (revisit only if a user can import very large histories).

## Migration Notes

None — no schema or data changes.

## References

- Data helper: `src/lib/services/transactions.ts:5-17`
- Route + hermetic test pattern: `src/pages/api/goals.ts`, `src/pages/api/goals.test.ts`, shared `src/lib/api.ts`
- Trigger page: `src/pages/transactions.astro`
- Q1 resolution (CSV) + notes: `context/foundation/roadmap.md` (Open Roadmap Q1), `context/foundation/prd.md` (Open Question 1)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: CSV serializer + export endpoint + download link + tests

#### Automated

- [x] 1.1 Type checking / build passes: `npm run build` — 1f399e5
- [x] 1.2 Linting passes: `npm run lint` — 1f399e5
- [x] 1.3 Serializer + endpoint tests pass: `npx vitest run src/lib/transactions-csv.test.ts src/pages/api/transactions/export.test.ts` — 1f399e5
- [x] 1.4 Full unit suite passes: `npx vitest run` — 1f399e5

#### Manual

- [x] 1.5 Export CSV link downloads `spendlens-transactions-<today>.csv` from `/transactions` — 1f399e5
- [x] 1.6 File opens cleanly in a spreadsheet: header + one row per transaction, decimal amounts, category + type per row — 1f399e5
- [x] 1.7 Tricky description (comma/quote/leading `=`) is escaped and injection-guarded — 1f399e5
- [x] 1.8 No-transactions user gets a header-only CSV (or no link per empty state) — 1f399e5
- [x] 1.9 Unauthenticated `GET /api/transactions/export` returns 401 — 1f399e5
