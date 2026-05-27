# Data Schema Foundation — Implementation Plan

## Overview

Create the domain data layer for SpendLens: a single Supabase migration file that establishes the `categories`, `transactions`, and `savings_goals` tables with per-user RLS, seeds the category taxonomy, and enforces the 3-goal cap at the database tier. Alongside the migration, add TypeScript entity types to `src/types.ts` and thin typed service helpers in `src/lib/services/`. No user-visible surface ships in this change.

## Current State Analysis

The codebase has a working Supabase SSR client (`src/lib/supabase.ts`), auth middleware, and `supabase/config.toml` for local dev, but no migration directory and no domain tables. `src/types.ts` and `src/lib/services/` do not exist yet.

### Key Discoveries:

- `supabase/migrations/` does not exist — the directory must be created alongside the first migration file
- `src/lib/supabase.ts` returns `null` if env vars are absent; service helpers must accept a non-null client (callers are always behind the auth middleware which guarantees the client is present)
- Supabase PostgREST returns `numeric` columns as `string` values in JSON, not `number` — storing monetary amounts as integers (cents) side-steps this entirely and avoids floating-point precision bugs
- The Supabase JS client uses `auth.uid()` as the current user identifier inside RLS policies

## Desired End State

After this change:
- `supabase/migrations/20260527000000_data_schema_foundation.sql` exists and applies cleanly against a fresh local Supabase instance (`npx supabase db reset`)
- All three domain tables exist with RLS enabled and correct per-operation policies; attempting to read another user's row returns an empty result, not an error
- A fourth savings goal INSERT for the same user is rejected at the database tier with a clear exception
- `src/types.ts` exports `Category`, `Transaction`, `SavingsGoal` interfaces matching the schema
- `src/lib/services/categories.ts`, `transactions.ts`, and `savings-goals.ts` compile cleanly, pass lint, and are importable from any Astro or API route file

## What We're NOT Doing

- No user-facing pages or React components — purely the data layer
- No simulated bank API integration (that is S-01's job)
- No savings goal creation/delete UI (S-04, S-05)
- No Supabase generated types (`database.types.ts`) — hand-written interfaces are sufficient for MVP scale and avoid a codegen step in CI
- No `updated_at` trigger or soft-delete — not needed for MVP; add in a targeted migration when a downstream slice requires it

## Implementation Approach

Single migration file, three-phase SQL:

1. `categories` first — no foreign keys, seeds the fixed taxonomy
2. `transactions` second — references `categories.id`
3. `savings_goals` third — standalone, followed by the 3-goal trigger

All monetary amounts are stored as integers representing cents (`integer NOT NULL`). The choice eliminates PostgREST string-coercion and floating-point bugs across every downstream slice. Converting: `$12.50` → `1250` cents on write; `/ 100` on display.

## Critical Implementation Details

- **Monetary integers** — `amount` in `transactions` and `target_amount` in `savings_goals` are `integer` (cents). S-01 must multiply incoming decimal amounts by 100 and round; UI components must divide by 100 before display. This decision is baked into the schema and non-negotiable without a follow-up migration.
- **categories RLS** — `anon` role needs `SELECT` granted so the category list is accessible before login (e.g., for a future public marketing page). Both `anon` and `authenticated` policies must be created separately; a single policy with `TO public` does not cover the anon role in Supabase's PostgREST setup.
- **3-goal trigger** — the `BEFORE INSERT` trigger on `savings_goals` must count rows `WHERE user_id = NEW.user_id` (not a global count). The API layer enforces the same rule, but the trigger is the safety net against race conditions.

---

## Phase 1: Supabase Migration

### Overview

Create `supabase/migrations/20260527000000_data_schema_foundation.sql` with all three tables, RLS, seeded categories, and the 3-goal trigger. Running `npx supabase db reset` against a local instance (or applying the migration against production) must produce the correct schema from scratch.

### Changes Required:

#### 1. Migration directory

**File**: `supabase/migrations/` (directory)

**Intent**: Create the directory that Supabase CLI uses to discover and apply migration files in order. Without it, `supabase db push` and `supabase db reset` silently skip all migrations.

**Contract**: Empty directory — the presence of `supabase/migrations/` is sufficient; no placeholder file needed.

#### 2. Migration file

**File**: `supabase/migrations/20260527000000_data_schema_foundation.sql`

**Intent**: Define the full domain schema — categories, transactions, savings_goals — with RLS enabled on every table, per-operation policies for each role, the seeded category taxonomy, and a trigger preventing a user from holding more than 3 active savings goals.

**Contract**: The file must be idempotent when applied in sequence (no `IF NOT EXISTS` needed for the first migration; subsequent migrations must be idempotent). Tables, types, trigger function, and seed `INSERT ... ON CONFLICT DO NOTHING` all live in this file. Policy names follow the convention `<table>_<role>_<operation>` (e.g., `transactions_authenticated_select`).

Schema at a glance:

```sql
-- categories
CREATE TABLE categories (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE
);

-- transactions
CREATE TABLE transactions (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id uuid    REFERENCES categories(id),
  amount      integer NOT NULL,        -- cents; positive for income, positive for expense
  type        text    NOT NULL CHECK (type IN ('income', 'expense')),
  description text,
  date        date    NOT NULL,
  external_id text,                    -- idempotency key for simulated API import
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, external_id)
);

-- savings_goals
CREATE TABLE savings_goals (
  id             uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           text    NOT NULL,
  target_amount  integer NOT NULL,     -- cents
  target_date    date    NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
```

Seeded category slugs: `groceries`, `dining`, `transport`, `housing`, `utilities`, `entertainment`, `healthcare`, `shopping`, `travel`, `salary`, `other`.

3-goal trigger:

```sql
CREATE OR REPLACE FUNCTION check_savings_goal_limit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT COUNT(*) FROM savings_goals WHERE user_id = NEW.user_id) >= 3 THEN
    RAISE EXCEPTION 'A user may not hold more than 3 active savings goals';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_savings_goal_limit
  BEFORE INSERT ON savings_goals
  FOR EACH ROW EXECUTE FUNCTION check_savings_goal_limit();
```

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against a fresh local Supabase instance: `npx supabase db reset` completes without error
- All three tables exist: `npx supabase db diff` shows no pending schema changes after reset
- Lint passes: `npm run lint`

#### Manual Verification:

- Sign in to the local Supabase Studio (`http://localhost:54323`), navigate to Table Editor — confirm `categories`, `transactions`, `savings_goals` appear under the `public` schema
- RLS is shown as enabled on all three tables in Studio → Authentication → Policies
- The 11 seeded categories are visible in the `categories` table
- Insert a test row directly in Studio as a non-auth user — confirm RLS blocks it on `transactions` and `savings_goals`; confirm `categories` is readable without auth

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: TypeScript Entity Types

### Overview

Create `src/types.ts` with TypeScript interfaces that exactly mirror the migration schema. Every downstream slice imports from here — getting the types wrong here forces a cascading fix across S-01 through S-07.

### Changes Required:

#### 1. src/types.ts

**File**: `src/types.ts`

**Intent**: Export `Category`, `Transaction`, and `SavingsGoal` interfaces matching the Supabase schema, plus the `TransactionType` string union, so downstream API routes and service helpers are fully typed without depending on generated Supabase types.

**Contract**:
- `amount` and `target_amount` are `number` (integer cents — matches JS `integer` column behavior from PostgREST)
- `date` and `target_date` are `string` (ISO `YYYY-MM-DD` — PostgREST returns date columns as strings)
- `created_at` is `string` (ISO 8601 — PostgREST returns timestamptz as string)
- `category_id` is `string | null` (nullable FK)
- `external_id` is `string | null`

### Success Criteria:

#### Automated Verification:

- TypeScript compilation passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`

#### Manual Verification:

- Import `Transaction` in a scratch file and confirm IDE autocomplete resolves all fields correctly

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 3: Service Helpers

### Overview

Create three thin typed service files under `src/lib/services/` that encapsulate Supabase queries for each entity. Downstream slices import these rather than writing raw `.from()` chains, keeping query patterns consistent and the Supabase client usage centralized.

### Changes Required:

#### 1. src/lib/services/categories.ts

**File**: `src/lib/services/categories.ts`

**Intent**: Export `getCategories` — fetches all rows from the `categories` table ordered by name. Used by the import pipeline (S-01) and the recommendations engine (S-06) to resolve category names.

**Contract**: `getCategories(client: SupabaseClient): Promise<Category[]>` — returns all categories; throws on Supabase error. `SupabaseClient` is the return type of `createServerClient` from `@supabase/ssr`.

#### 2. src/lib/services/transactions.ts

**File**: `src/lib/services/transactions.ts`

**Intent**: Export `getUserTransactions` and `createTransactions`. `getUserTransactions` fetches all transactions for the authenticated user (joined with category name for convenience). `createTransactions` bulk-inserts an array of transaction rows, used by S-01's import pipeline.

**Contract**:
- `getUserTransactions(client): Promise<(Transaction & { category: Pick<Category, 'name' | 'slug'> | null })[]>` — selects `*, categories(name, slug)`, ordered by `date DESC`
- `createTransactions(client, rows: Omit<Transaction, 'id' | 'created_at'>[]): Promise<Transaction[]>` — uses `.upsert()` on `(user_id, external_id)` to make import idempotent

#### 3. src/lib/services/savings-goals.ts

**File**: `src/lib/services/savings-goals.ts`

**Intent**: Export `getUserGoals`, `createGoal`, and `deleteGoal` for the authenticated user's savings goals.

**Contract**:
- `getUserGoals(client): Promise<SavingsGoal[]>` — ordered by `created_at ASC`
- `createGoal(client, data: Omit<SavingsGoal, 'id' | 'user_id' | 'created_at'>): Promise<SavingsGoal>` — single insert; re-throws the DB exception message if the 3-goal trigger fires, so the API route can surface it to the client
- `deleteGoal(client, id: string): Promise<void>` — deletes by `id`; RLS ensures only the owner can delete

### Success Criteria:

#### Automated Verification:

- TypeScript compilation passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- From the Astro dev server, hitting a test API route that calls `getCategories()` returns the 11 seeded categories as JSON
- `getUserTransactions()` called for a user with no transactions returns an empty array without error
- `createGoal()` called four times for the same user fails on the fourth call with the trigger's exception message

**Implementation Note**: After completing this phase and all automated verification passes, this plan is complete. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

No test runner is configured in this project (per AGENTS.md). Verification is via TypeScript compilation, lint, and manual spot-checks.

### Integration Tests:

- `npx supabase db reset` against local Supabase is the integration gate for the migration
- Test API routes written inline (and deleted after verification) validate service helper behavior end-to-end

### Manual Testing Steps:

1. `npx supabase start` → `npx supabase db reset` — confirm migration applies cleanly
2. Open Supabase Studio at `http://localhost:54323` — confirm tables and RLS policies
3. Spin up the dev server (`npm run dev`) and add a temporary test route that exercises each service helper; delete after verification
4. Attempt a 4th goal insert via Studio SQL editor to confirm the trigger fires

## Migration Notes

This is the first migration. The `supabase/migrations/` directory starts empty; this file is migration `001` by naming convention. Future migrations must use a timestamp **after** `20260527000000` to be applied in correct order.

Monetary amounts are integers (cents) from day one. If this ever needs to change (e.g., sub-cent precision), it requires a data migration — all downstream slices must be updated simultaneously.

## References

- Roadmap: `context/foundation/roadmap.md` — F-01
- PRD: `context/foundation/prd.md` — NFR (data isolation), FR-003, FR-006, FR-007
- Supabase client: `src/lib/supabase.ts`
- Supabase config: `supabase/config.toml`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Supabase Migration

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` completes without error — 077ddaf
- [x] 1.2 No pending schema changes: `npx supabase db diff` shows empty diff after reset — 077ddaf
- [x] 1.3 Lint passes: `npm run lint` — 077ddaf

#### Manual

- [x] 1.4 All three tables visible in Supabase Studio Table Editor — 077ddaf
- [x] 1.5 RLS enabled on all three tables (Studio → Authentication → Policies) — 077ddaf
- [x] 1.6 11 seeded categories visible in the categories table — 077ddaf
- [x] 1.7 RLS blocks unauthenticated inserts on transactions and savings_goals; categories readable without auth — 077ddaf

### Phase 2: TypeScript Entity Types

#### Automated

- [x] 2.1 TypeScript compilation passes: `npx tsc --noEmit`
- [x] 2.2 Lint passes: `npm run lint`

#### Manual

- [x] 2.3 IDE autocomplete resolves all entity fields correctly from an import of `Transaction`

### Phase 3: Service Helpers

#### Automated

- [ ] 3.1 TypeScript compilation passes: `npx tsc --noEmit`
- [ ] 3.2 Lint passes: `npm run lint`
- [ ] 3.3 Build passes: `npm run build`

#### Manual

- [ ] 3.4 `getCategories()` returns 11 seeded categories via test route
- [ ] 3.5 `getUserTransactions()` returns empty array for user with no transactions
- [ ] 3.6 4th `createGoal()` call for same user fails with trigger exception message
