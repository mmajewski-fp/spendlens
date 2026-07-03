# Export Transactions — Plan Brief

> Full plan: `context/changes/export-transactions/plan.md`

## What & Why

Roadmap slice S-07 / FR-011 (nice-to-have): let a signed-in user download their categorized transactions as a file. Open Roadmap Q1 resolved the format to **CSV** (2026-07-03) — universal, spreadsheet/accountant-friendly, zero-dependency. This is the last roadmap slice.

## Starting Point

The data and fetch already exist (`getUserTransactions` returns all `TransactionWithCategory[]`), the API-route pattern is established (`/api/goals.ts` + shared `jsonResponse` in `src/lib/api.ts`), and the transactions page is a pure-Astro surface ready for a download link. Nothing exists yet for export itself.

## Desired End State

On `/transactions` (with data), an "Export CSV" link downloads `spendlens-transactions-YYYY-MM-DD.csv`: a header row plus one row per transaction (date, description, category, type, amount as positive decimal dollars), all fields safely escaped and formula-injection-guarded. Empty accounts get a valid header-only CSV; unauthenticated endpoint hits return 401.

## Key Decisions Made

| Decision        | Choice                                                        | Why (1 sentence)                                                        | Source   |
| --------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- | -------- |
| Format          | CSV                                                           | Universal, portable, zero-dep; JSON too dev-facing, PDF too heavy.     | Q1 (roadmap) |
| Columns         | date, description, category, type, amount (positive dollars) | Spreadsheet-friendly — pivot/sum by type; category per row per FR-011. | Plan     |
| Amount format   | Plain `(cents/100).toFixed(2)`, not formatCents              | `$`/thousands-commas would corrupt CSV columns.                       | Plan     |
| Filename        | Dated `spendlens-transactions-YYYY-MM-DD.csv`                | Re-exports don't collide; self-documenting.                           | Plan     |
| Empty case      | Always downloadable — header-only CSV                        | Simplest; valid empty CSV, no special UI state.                      | Plan     |
| Trigger         | `<a download>` link on the transactions page                 | Natural "export what I'm viewing" spot; native download, no JS.       | Plan     |
| Testing         | Unit-test `toCsv` + hermetic endpoint test                   | Concentrates coverage on escaping/injection + route auth/headers.    | Plan     |

## Scope

**In scope:** `toCsv` serializer (escaping + injection guard); `GET /api/transactions/export` (self-gated, dated attachment); Export CSV link on transactions page; serializer + endpoint tests.

**Out of scope:** JSON/PDF; column config / date-range filtering; internal ids in output; pagination/streaming; dashboard export control; client-side JS; E2E.

## Architecture / Approach

New pure `src/lib/transactions-csv.ts` (`toCsv`) handles header, row mapping, RFC-4180 escaping, and `= + - @` formula-injection guarding. New `src/pages/api/transactions/export.ts` GET route: 401 gate + `createClient` 500 (mirroring goals routes), `getUserTransactions` → `toCsv` → `text/csv` response with a dated `Content-Disposition: attachment`. `transactions.astro` gains a native download link in its populated view.

## Phases at a Glance

| Phase                                                    | What it delivers                                   | Key risk                                   |
| ------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------ |
| 1. CSV serializer + export endpoint + link + tests       | Downloadable CSV of categorized transactions       | CSV escaping / formula-injection correctness |

**Prerequisites:** S-01 (import) — done; data + route patterns in place.
**Estimated effort:** ~1 session, single phase.

## Open Risks & Assumptions

- MVP transaction volume is small enough to serialize in one response (no pagination).
- Amount as positive dollars + a `type` column is the desired convention (vs a signed amount).
- The `<a download>` trigger is manually verified (no jsdom / download E2E in this slice).

## Success Criteria (Summary)

- A user can download a well-formed CSV of their categorized transactions that opens cleanly in a spreadsheet.
- Tricky fields (commas, quotes, leading `=`) are escaped and injection-guarded; empty accounts get a header-only file.
- The endpoint rejects unauthenticated requests; serializer + endpoint tests + lint + build green.
