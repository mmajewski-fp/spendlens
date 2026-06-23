---
date: 2026-06-23T11:51:20+0000
researcher: Michał Majewski
git_commit: 9498042c086be997c024a48ae22444914d084943
branch: main
repository: spendlens
topic: "Phase 3 — Data-tier guardrails: ownership isolation (#5) + 3-goal cap/validation (#6); enforcement mechanism + integration-test infra"
tags: [research, codebase, rls, supabase, integration-tests, vitest, isolation, savings-goals]
status: complete
last_updated: 2026-06-23
last_updated_by: Michał Majewski
---

# Research: Phase 3 — Data-tier guardrails (Risks #5, #6)

**Date**: 2026-06-23T11:51:20+0000
**Researcher**: Michał Majewski
**Git Commit**: 9498042c086be997c024a48ae22444914d084943
**Branch**: main
**Repository**: spendlens (github.com/mmajewski-fp/spendlens)

## Research Question

Rollout Phase 3 of `context/foundation/test-plan.md`: "Data-tier guardrails" —
prove ownership isolation (#5: a user can never read/mutate another user's
rows) and the 3-goal cap + server-side validation (#6) hold against real DB
constraints a mock would lie about. Resolve the two questions that gate the
plan: **(a) where ownership is enforced** (RLS vs service-layer filter →
integration vs hermetic), and **(b) how to run real-local-Supabase integration
tests under Vitest**, ad-hoc, separate from the unit suite.

## Summary

Both risks live **entirely in the database tier**, with **no service-layer
guard a mock could stand in for** — so the test-plan's prediction holds:
**integration against real local Supabase with two authenticated users is the
correct, cheapest-real-signal layer for both #5 and #6.**

- **Ownership (#5) = pure Supabase RLS.** Every table has RLS enabled with
  per-operation `user_id = auth.uid()` policies
  ([migration:66-85, 100-121](supabase/migrations/20260527000000_data_schema_foundation.sql#L66)).
  The service layer adds **no** explicit `user_id` filter on reads
  (`getUserGoals`/`getUserTransactions` are bare `.select("*")`; `deleteGoal` is
  `.eq("id", id)` only), and there is **no service-role key anywhere** — the only
  client is the cookie-bound SSR client carrying the user's JWT
  ([supabase.ts:9](src/lib/supabase.ts#L9)). A stub client cannot prove an RLS
  policy holds, so #5 **must** be integration with two real authenticated users.
- **Recommendations are computed, not stored** — `computeRecommendations` is the
  pure function from Phases 1–2; the page fetches the user's own
  transactions+goals (RLS-scoped) then computes
  ([recommendations.astro:22-27](src/pages/recommendations.astro#L22)). So
  "User A reads User B's recommendations" reduces to the transactions/goals RLS
  SELECT — **no separate recommendation surface to test.**
- **3-goal cap (#6) = a DB `BEFORE INSERT` trigger.** `check_savings_goal_limit()`
  raises `'A user may not hold more than 3 active savings goals'` at COUNT ≥ 3
  ([migration:127-139](supabase/migrations/20260527000000_data_schema_foundation.sql#L127));
  `createGoal` re-throws it and the API string-matches → **409**
  ([api/goals.ts:67-68](src/pages/api/goals.ts#L67)). The count is real DB state
  → a mock would lie → integration.
- **Server-side input validation (#6) = zod at the API, not the DB.** There is
  **no DB CHECK** on `target_amount > 0` or `target_date` future; the goals zod
  schema enforces them ([api/goals.ts:11-24](src/pages/api/goals.ts#L11)):
  positive amount (rejects 0/neg/NaN/Infinity), `YYYY-MM-DD` + future-date refine.
  This is a fast **unit-of-schema / route-handler** assertion, separate from the
  DB-tier integration tests.
- **Infra is runnable here.** Docker 29.5.3 daemon is RUNNING and the `supabase`
  CLI is a devDep (`^2.23.4`); `supabase/config.toml` exists (API :54321, PG17).
  So the ad-hoc gate can actually run locally.
- **Recommended approach** (web-grounded): a **separate
  `vitest.config.integration.ts`** (`*.integration.test.ts` glob, node env,
  `TZ=UTC`, `globalSetup` boots `supabase start` + reads keys from `supabase
  status -o json`, `pool: 'forks'` + `singleFork`, long hook timeout), a
  two-user helper (admin `createUser` for setup/teardown ONLY; per-user **anon**
  client via `signInWithPassword` for the assertions), unique-id isolation +
  `deleteUser` cascade teardown, and a `test:integration` script **kept out of
  per-commit CI** (Docker-gated). Exercise the data tier by calling the existing
  **service helpers directly** with each user's anon client.

**No blocking oracle ambiguity.** The correct behavior is unambiguous (RLS →
"empty result, not an error"; trigger → 409; zod → 400). The open items are
**scoping** decisions for the plan (how far to cover #6's API-handler layer;
whether to test the unexposed `deleteGoal` isolation) — see Open Questions.

## Detailed Findings

### Enforcement tier — RLS only, no service filter, no service-role (the #5 decider)

Ownership is enforced **solely at the DB tier by RLS**; the app relies on the
JWT-bound client, not explicit filters:

| Path | File:line | Owning filter? |
|------|-----------|----------------|
| `getUserTransactions` | [transactions.ts:6-17](src/lib/services/transactions.ts#L6) | **No** — bare `.select(...)`; RLS only |
| `getUserGoals` | [savings-goals.ts:4-9](src/lib/services/savings-goals.ts#L4) | **No** — bare `.select("*")`; RLS only |
| `deleteGoal` | [savings-goals.ts:32-36](src/lib/services/savings-goals.ts#L32) | **No** — `.eq("id", id)` only; RLS is the *sole* guard (sharpest case) |
| `createGoal` | [savings-goals.ts:16-30](src/lib/services/savings-goals.ts#L16) | sets `user_id: userId` in payload; guarded by RLS `WITH CHECK` |
| `createTransactions` | [transactions.ts:19-30](src/lib/services/transactions.ts#L19) | `user_id` from rows; guarded by RLS `WITH CHECK` |

- **Client**: one cookie-bound `createServerClient(SUPABASE_URL, SUPABASE_KEY, …)`
  ([supabase.ts:9](src/lib/supabase.ts#L9)); runs as Postgres role
  `authenticated` with `auth.uid()` = the logged-in user. **No service-role /
  admin key exists anywhere** in the app (only `SUPABASE_KEY`).
- **Middleware** resolves `locals.user` via `auth.getUser()` and gates page
  *access* for `/dashboard`, `/recommendations`, `/goals`
  ([middleware.ts:4,10-21](src/middleware.ts#L4)) — access gating, not row
  ownership.
- **Implication**: isolation behavior lives in Postgres policy evaluation under
  each user's JWT. **A hermetic stub would lie** (it returns whatever you tell
  it) → integration with two authenticated users is mandatory (test-plan §1
  anti-pattern).

### Risk #5 oracle — RLS policies (verbatim refs)

RLS enabled on `transactions` ([migration:64](supabase/migrations/20260527000000_data_schema_foundation.sql#L64))
and `savings_goals` ([migration:100](supabase/migrations/20260527000000_data_schema_foundation.sql#L100)),
each with four policies — SELECT/INSERT/UPDATE/DELETE — all
`USING/WITH CHECK (user_id = auth.uid())`
([transactions :66-85](supabase/migrations/20260527000000_data_schema_foundation.sql#L66),
[savings_goals :102-121](supabase/migrations/20260527000000_data_schema_foundation.sql#L102)).
`categories` is a shared taxonomy — SELECT-only for anon+authenticated, no
user data ([migration:18-30](supabase/migrations/20260527000000_data_schema_foundation.sql#L18)) — **not** a #5 surface.

**Oracle** (from `data-schema-foundation/plan.md:16`): reading another user's row
returns an **empty result, not an error**. So the assertions are:
- User A's `getUserGoals` / `getUserTransactions` return **only A's rows** (B's
  are absent, no error) when run on A's authenticated client.
- A mutation as User A against User B's row is a **no-op** (RLS filters it):
  e.g. `deleteGoal(clientA, goalB.id)` leaves B's goal intact; an UPDATE as A on
  B's row affects 0 rows.
- FK `ON DELETE CASCADE` to `auth.users` ([migration:53,93](supabase/migrations/20260527000000_data_schema_foundation.sql#L53))
  makes `deleteUser` teardown clean.

### Risk #6 oracle — the 3-goal cap trigger + the API contract

- **Trigger** ([migration:127-139](supabase/migrations/20260527000000_data_schema_foundation.sql#L127)):
  `BEFORE INSERT ON savings_goals`, `RAISE EXCEPTION 'A user may not hold more
  than 3 active savings goals'` when `COUNT(*) WHERE user_id = NEW.user_id >= 3`.
  No UPDATE trigger (updating an existing goal does not re-check). This is the
  **only** DB enforcement of the cap.
- **API mapping** ([api/goals.ts:58-71](src/pages/api/goals.ts#L58)): POST relies
  on the trigger (no pre-count), catches the error, `message.includes("3 active
  savings goals")` → **409**, else 500. 401 if `!locals.user`
  ([:34](src/pages/api/goals.ts#L34)).
- **zod schema** ([api/goals.ts:11-24](src/pages/api/goals.ts#L11)): `name`
  1–100 chars; `target_amount_dollars` `z.number().positive()` (rejects 0, neg,
  NaN, Infinity); `target_date` regex `^\d{4}-\d{2}-\d{2}$` + refine `> today`
  (rejects past + malformed). **No DB CHECK backs these** — the zod schema is the
  whole server-side guard for amount/date
  ([migration has no CHECK on target_amount/target_date](supabase/migrations/20260527000000_data_schema_foundation.sql#L91)).
- **API surface is small**: only `POST /api/goals` + the 3 auth routes exist.
  **No transactions/export/goal-DELETE endpoints.** `deleteGoal`/
  `createTransactions` services exist but are **not exposed via any handler**
  ([api/goals.ts](src/pages/api/goals.ts) is POST-only) — relevant to scoping
  (see Open Questions).

### `createGoal` ↔ RLS gotcha (critical for the test author)

`createGoal(client, userId, goalData)` inserts `user_id: userId`
([savings-goals.ts:21-24](src/lib/services/savings-goals.ts#L21)), while the
INSERT policy is `WITH CHECK (user_id = auth.uid())`
([migration:110](supabase/migrations/20260527000000_data_schema_foundation.sql#L110)).
So `userId` **must equal the calling client's authenticated `auth.uid()`** or the
insert is rejected by **RLS** (not the trigger). To exercise the cap: seed 3
goals for a user via that user's own authenticated client, then attempt a 4th and
assert the **trigger** error / 409 — don't accidentally trip the WITH CHECK
instead.

### Integration-test infrastructure (web-grounded recommendation)

Keep the existing unit config untouched (`vitest.config.ts`, glob
`src/**/*.test.ts`, `env: { TZ: "UTC" }`). Add a **separate** integration config
so the heavy Docker boot never loads during `npm run test`:

- `vitest.config.integration.ts`: `include: ['**/*.integration.test.ts']`,
  `environment: 'node'`, `env: { TZ: 'UTC' }` (carry the determinism lesson — the
  goals future-date refine uses local-time `new Date()`), `globalSetup` (boot),
  `testTimeout: 30_000`, `hookTimeout: 120_000`, `pool: 'forks'` +
  `poolOptions.forks.singleFork: true` + `fileParallelism: false` (serialize
  against the one shared DB). ([Vitest projects](https://vitest.dev/guide/projects), [pool](https://vitest.dev/config/pool))
- `globalSetup`: `supabase start` (idempotent; applies migrations + seed), then
  read URL/keys from `supabase status -o json` into `process.env`. ([Supabase CLI start](https://supabase.com/docs/reference/cli/start))
- **Two-user helper**: admin client (service_role from `supabase status`) for
  `auth.admin.createUser({ email, password, email_confirm: true })` and
  `deleteUser` teardown — **setup/teardown ONLY, never the assertion**; per-user
  **anon** client via `signInWithPassword` for everything asserted (so
  `auth.uid()` resolves per user). ([Supabase testing overview](https://supabase.com/docs/guides/local-development/testing/overview), [service_role bypasses RLS](https://supabase.com/docs/guides/troubleshooting/why-is-my-service-role-key-client-getting-rls-errors-or-not-returning-data-7_1K9z))
- **Isolation**: unique IDs per suite (`crypto.randomUUID()`); `deleteUser` in
  `afterAll` (cascades rows). Avoid `db reset` per-test (too slow); no
  transaction-rollback isolation via supabase-js. ([Supabase testing overview](https://supabase.com/docs/guides/local-development/testing/overview))
- **Gate**: `"test:integration": "vitest run --config vitest.config.integration.ts"`,
  **NOT** added to `.github/workflows/ci.yml` (no Docker in CI; ad-hoc per
  test-plan §5). service_role key is local-only (read at runtime, never committed).
- **Exercise the data tier via the service helpers directly** (`getUserGoals`,
  `createGoal`, `deleteGoal`, `getUserTransactions`, `createTransactions`) with
  each user's anon client — the risk lives in Postgres, not the HTTP handler, so
  no need to fabricate an Astro `APIContext`. ([Astro testing](https://docs.astro.build/en/guides/testing/))

## Code References

- `supabase/migrations/20260527000000_data_schema_foundation.sql` — tables, RLS (`:66-85`, `:100-121`), 3-goal trigger (`:127-139`), no amount/date CHECK
- `src/lib/supabase.ts:9` — sole cookie-bound client; no service-role key
- `src/lib/services/savings-goals.ts` — `getUserGoals` (`:4-9`), `createGoal` (`:16-30`), `deleteGoal` (`:32-36`)
- `src/lib/services/transactions.ts:6-30` — `getUserTransactions`, `createTransactions`
- `src/pages/api/goals.ts:11-24,34,58-71` — zod schema, 401, cap→409 mapping
- `src/pages/recommendations.astro:22-27` — computed (not stored) recommendations
- `src/middleware.ts:4,10-21` — `locals.user`, protected-route access gating
- `supabase/config.toml` — local stack (API :54321, PG17, email confirmations off, min password 6)
- `vitest.config.ts` / `package.json` — existing unit config + scripts to stay separate from

## Architecture Insights

- **RLS is the whole isolation story** — there is zero defense-in-depth at the
  service layer. This is clean (one enforcement point) but brittle: `deleteGoal`
  would happily delete any id if RLS were ever dropped. That's *why* the test
  must hit real RLS, and it's the strongest argument for the integration layer.
- **Two enforcement layers for #6, two test layers**: the **cap** is DB (trigger
  → integration), the **amount/date validation** is API zod (→ fast unit/handler
  test). They're independent; the plan can cover both cheaply.
- **A genuinely new test type** — first time the project boots real infra in a
  test. The separate-config + `singleFork` + ad-hoc-gate shape is the load-bearing
  decision; it keeps `npm run test` fast and CI green-without-Docker.
- **Determinism lesson applies** ([lessons.md](context/foundation/lessons.md)):
  pin `TZ=UTC` in the integration config too, and choose `target_date` fixtures
  safely relative to UTC "today" (the API refine uses local-time `new Date()`).

## Historical Context (from prior changes)

- `context/changes/data-schema-foundation/plan.md` — designed the schema, RLS
  policies, and the cap trigger; `:16` records the isolation oracle ("empty
  result, not an error"); `:246-258` deferred data-tier tests (imagined as
  `db reset` + throwaway routes) — Phase 3 makes them real.
- `context/archive/2026-06-02-create-savings-goal/` — the goals API + the 409
  mapping; the data layer was complete before the UI.
- `context/archive/2026-06-22-testing-runner-bootstrap-wedge/` — the unit Vitest
  config + `TZ=UTC` impl-review F1 (the integration config mirrors the TZ pin).
- `context/archive/2026-06-23-wedge-math-contract/` — the `test:mutation`
  separate-invocation pattern (precedent for a separate `test:integration`).

## Related Research

- `context/archive/2026-06-22-testing-runner-bootstrap-wedge/research.md` and
  `context/archive/2026-06-23-wedge-math-contract/research.md` — the unit-layer
  oracle + runner; this phase adds the integration layer above them.

## Open Questions

Resolved: the enforcement mechanism (RLS + trigger → integration) and the infra
approach. These remaining items are **scoping decisions for the plan**, not
oracle gaps:

1. **#6 coverage depth** — integration cap test only, or also a route-handler
   slice asserting the API's `401` / `400` (zod) / `409` (cap) mapping? The zod
   validation can be proven cheaply as a unit-of-schema test (no DB); the full
   POST handler needs a mocked `APIContext`. (test-plan §6.4 mentions endpoint
   coverage.)
2. **`deleteGoal` isolation** — it's the sharpest RLS-only guard but is **not
   exposed via any API handler** today. Test its cross-user isolation at the
   service level as a forward-looking guard, or scope it out as unexposed?
3. **Which read paths to assert for #5** — goals + transactions both, or goals
   only (transactions isolation is the same RLS shape)? Recommendation: both,
   since they're independent policies and cheap once the harness exists.
4. **Prerequisite (implement-time)**: `supabase start` pulls Docker images on
   first run (slow, network). Docker is confirmed running here; budget the cold
   boot in the `hookTimeout` and the first-run time.
