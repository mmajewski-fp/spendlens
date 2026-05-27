# Data Schema Foundation — Plan Brief

> Full plan: `context/changes/data-schema-foundation/plan.md`

## What & Why

SpendLens has no domain tables yet — no place to store transactions, savings goals, or categories. This change creates the entire data layer as a single Supabase migration, seeds a fixed category taxonomy, adds TypeScript entity types, and adds thin service helpers. Nothing else on the roadmap (S-01 through S-07) can start without it.

## Starting Point

`supabase/config.toml` exists and Supabase SSR auth is fully wired, but `supabase/migrations/` does not exist, `src/types.ts` does not exist, and there are no domain tables. The Supabase client in `src/lib/supabase.ts` is ready to query tables the moment they exist.

## Desired End State

A local `npx supabase db reset` produces three tables — `categories` (pre-seeded with 11 rows), `transactions`, and `savings_goals` — with RLS enabled and per-user ownership enforced at the database tier. `src/types.ts` exports typed interfaces for all three. `src/lib/services/` exposes typed helpers that downstream slices import without writing raw Supabase queries.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Monetary amount storage | Integer (cents) | Avoids PostgREST string-coercion of `numeric` and floating-point bugs across every slice. |
| Category taxonomy | Pre-seeded fixed list (11 categories) | S-01 auto-categorization needs a stable set to map against; open Roadmap Q3 is resolved here for F-01's purposes. |
| Goal timeframe format | `target_date` (calendar date) | Concrete date is more useful for the recommendations engine's monthly-saving calculation than a duration in months. |
| Savings goal name | Required `name` text field | User-defined label makes goals distinguishable in the UI when up to 3 are active simultaneously. |
| 3-goal cap | DB trigger + API layer | Trigger is the race-condition safety net; API layer provides a user-friendly error message. |
| categories access | Anon + authenticated can read; no writes | Enables future public surfaces and keeps the RLS model consistent — categories are migration-managed only. |
| Migration split | Single file | Atomic — all three tables either exist or don't; partial migrations can't leave a half-built schema. |
| TypeScript types | Hand-written interfaces | Avoids codegen dependency in CI; sufficient for MVP scale. |
| Service layer scope | Helpers for all three entities | Downstream slices import from services rather than writing raw `.from()` chains; consistent query patterns from day one. |

## Scope

**In scope:** `supabase/migrations/` directory + single migration file, RLS policies (per-operation, per-role), seeded category taxonomy, `src/types.ts`, `src/lib/services/{categories,transactions,savings-goals}.ts`

**Out of scope:** Any user-visible UI, simulated bank API integration (S-01), savings goal CRUD UI (S-04/S-05), Supabase generated types (`database.types.ts`), `updated_at` triggers, soft-delete

## Architecture / Approach

Pure data layer: one SQL migration file → three tables → RLS at the Postgres tier → TypeScript types → thin service helpers. The migration is the source of truth; types and helpers are derived from it. No application logic lives in this change — the recommendations engine, auto-categorization, and goal CRUD belong to downstream slices.

```
supabase/migrations/
  20260527000000_data_schema_foundation.sql
    ├── CREATE TABLE categories (seeded)
    ├── CREATE TABLE transactions (→ categories FK, per-user RLS)
    ├── CREATE TABLE savings_goals (per-user RLS, 3-goal trigger)
    └── RLS policies (per-operation, per-role)

src/
  types.ts               ← Category, Transaction, SavingsGoal, TransactionType
  lib/services/
    categories.ts        ← getCategories()
    transactions.ts      ← getUserTransactions(), createTransactions()
    savings-goals.ts     ← getUserGoals(), createGoal(), deleteGoal()
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Supabase Migration | All domain tables live in local Supabase with RLS and seeded categories | Migration fails silently if `supabase/migrations/` directory is missing — must be created first |
| 2. TypeScript Entity Types | `src/types.ts` with fully typed interfaces | Wrong amount type (`string` vs `number`) would cascade as a bug into every downstream slice — must reflect actual PostgREST behavior for `integer` columns |
| 3. Service Helpers | Typed query helpers for all three entities, ready for import | Over-specifying the helper API now could constrain S-01 — keep contracts minimal and let downstream slices extend as needed |

**Prerequisites:** Local Supabase running (`npx supabase start`) and `.env` / `.env.local` populated with `SUPABASE_URL` + `SUPABASE_KEY`.
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- The fixed category taxonomy (11 categories) is treated as final for F-01. Open Roadmap Q3 is still technically "owner: user/dev" for S-01 — if the simulated bank API requires a different taxonomy, S-01 may need a follow-up migration to add or rename categories.
- `integer` (cents) for monetary amounts is a permanent schema decision. Any future need for sub-cent precision requires a data migration.
- The `external_id` unique constraint on `(user_id, external_id)` assumes the simulated bank API will provide a stable transaction ID. If it doesn't, the upsert idempotency strategy in S-01 needs revisiting.

## Success Criteria (Summary)

- `npx supabase db reset` applies the migration cleanly and all three tables appear in Studio with RLS enabled
- `npx tsc --noEmit` and `npm run build` pass with zero errors after all three phases
- A 4th savings goal insert for the same user is rejected at the DB tier with the trigger's exception message
