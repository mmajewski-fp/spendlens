# Connect Simulated Bank (S-01) — Plan Brief

> Full plan: `context/changes/connect-simulated-bank/plan.md`
> Research: `context/changes/connect-simulated-bank/research.md`

## What & Why

Build the transaction-import pipeline: a signed-in user clicks "Connect Bank", an in-repo deterministic simulated source generates per-user transactions, each is auto-categorized into one of the 11 fixed categories, and the rows land under the user. This is the missing prerequisite (S-01) that lets a real user reach the already-built wedge (S-06 recommendations) and the downstream views (S-02/S-03) — today those only work on seeded test data.

## Starting Point

F-01 already shipped the entire data tier: `transactions` + `categories` tables, per-user RLS, the 11-slug taxonomy, and an **idempotent** bulk insert (`createTransactions` upserts on `UNIQUE(user_id, external_id)`). Import was explicitly deferred to this slice. The shipped recommendations empty-state already links to `/transactions/import` — a currently dangling link this slice resolves.

## Desired End State

From the dashboard or the recommendations CTA, the user lands on `/transactions/import`, clicks "Connect Bank", and sees "Imported N transactions" with a link onward. Their categorized transactions now exist under their account only; the dashboard and recommendations render real data. Re-connecting is a safe no-op showing "0 new — already imported".

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Simulated API model | In-repo deterministic module | No network, trivially deterministic + unit-testable, satisfies lessons.md | Research |
| Module split | Pure generator + pure mapper + impure orchestrator + route | Keeps deterministic logic DB-free and testable, mirrors `computeRecommendations` | Research |
| Idempotency | Stable `external_id = sim-${userId}-${index}` + existing upsert | Re-connect is idempotent by construction, no stored "connected" flag | Research |
| Route / URL | `/transactions/import` + `POST /api/transactions/import` | Matches the already-shipped recommendations CTA (no dangling link) | Plan |
| Entry points | Dashboard button + recommendations CTA (no Topbar link) | Satisfies roadmap "trigger from dashboard" + fixes existing CTA | Plan |
| "Landed" confirmation | New-imported count + onward link | Simple, matches roadmap outcome; 0 on re-connect | Plan |
| Dataset | ~30–50 txn/user: 1 salary + 6–8 category spread, 1 category >12% income | Gives S-02/S-06 real signal (income required, else wedge shows nothing) | Plan |
| Re-connect UX | Honest "0 new" | Leverages idempotency, zero extra logic | Plan |
| Categorization | Full keyword coverage + 1 intentional `Other` | Exercises the fallback path for downstream null-category handling | Plan |

## Scope

**In scope:** deterministic generator + categorizer (pure), import orchestrator, `POST` API route, `/transactions/import` SSR page + island, dashboard/recommendations entry points, unit + hermetic + integration tests.

**Out of scope:** real bank/OAuth integration, schema changes, transactions-list (S-03), dashboard summary (S-02), export (S-07), edit/delete transactions, persistent "connected" flag, Topbar link, e2e tests.

## Architecture / Approach

`Connect Bank` (dashboard / recommendations CTA) → `/transactions/import` SSR page → `ImportPanel` island → `POST /api/transactions/import` (auth-guarded, injects a UTC `today`) → `importTransactions` orchestrator → `generateTransactions(userId, today)` (pure, seeded PRNG) + `categorize(description)` (pure) → resolve slug→id via `getCategories` → `createTransactions` (idempotent upsert). Pure core is DB-free; only the orchestrator + route touch I/O.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Pure core | Deterministic generator + categorizer + unit tests | Non-determinism creeping in (dates/PRNG/locale) |
| 2. Orchestrator + route | Persist pipeline behind `POST` endpoint + hermetic tests | slug→id resolution / error contract |
| 3. Page + island + entry points | `/transactions/import` UI + dashboard/CTA wiring | SSR try/catch, island Props authority |
| 4. Integration tests | Real-Supabase idempotency + isolation proof | Docker/local Supabase setup (ad-hoc) |

**Prerequisites:** F-01 (done); Docker + `npx supabase start` for Phase 4 only.
**Estimated effort:** ~2–3 sessions across 4 phases.

## Open Risks & Assumptions

- The generator's `today` anchor shifts the 30-day window per run (intended); `external_id` is date-independent so re-connects stay idempotent.
- Amount sizing must deliberately push one category over the 12%-income alert threshold, or S-06 alerts never fire.
- Integration tests are ad-hoc (Docker), not part of CI — must be run locally before shipping.

## Success Criteria (Summary)

- A signed-in user can import categorized transactions and see the landed count; the data is theirs alone.
- Re-connecting never duplicates data.
- The dashboard and recommendations pages render real per-user data after import.
