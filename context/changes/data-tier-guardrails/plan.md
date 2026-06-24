# Data-tier Guardrails Implementation Plan

## Overview

Stand up a **separate, ad-hoc real-local-Supabase integration test suite** that
proves the data-tier guardrails a mock would lie about: Risk #5 (RLS ownership
isolation between two authenticated users) and Risk #6 (the 3-goal cap trigger).
Add a **hermetic per-commit handler test** for #6's server-side validation
(401/400/409). Keep the unit suite fast and CI Docker-free — the integration
suite runs locally on demand only.

## Current State Analysis

- **Enforcement is pure DB-tier** (research): RLS `user_id = auth.uid()` on all
  ops for `transactions` + `savings_goals`
  ([migration:66-85,100-121](supabase/migrations/20260527000000_data_schema_foundation.sql#L66));
  the 3-goal cap is a `BEFORE INSERT` trigger
  ([:127-139](supabase/migrations/20260527000000_data_schema_foundation.sql#L127));
  services add **no** explicit `user_id` filter and there is **no service-role
  key** ([supabase.ts:9](src/lib/supabase.ts#L9)). A stub can't prove RLS →
  integration with two real users is mandatory.
- **Recommendations are computed, not stored** → #5 for recs reduces to the
  transactions/goals RLS reads (no separate surface).
- **The goals API** ([api/goals.ts](src/pages/api/goals.ts)) is the only
  user-data write endpoint: zod (`positive` amount, `YYYY-MM-DD` + future
  refine), 401 if no `locals.user`, cap → 409 via string-match on the trigger
  message. `deleteGoal` exists but is **unexposed** (no DELETE route).
- **Runner**: Vitest 3.2 with `vitest.config.ts` (`src/**/*.test.ts`,
  `TZ=UTC`). **Docker 29.5.3 daemon is running** and the `supabase` CLI is a
  devDep — the ad-hoc gate is runnable here.

## Desired End State

`npm run test:integration` (local, Docker) boots Supabase, seeds two users, and
proves: User A never reads/deletes User B's rows (with positive controls), and a
4th goal insert is rejected by the trigger. `npm run test` (unit, per-commit)
gains a hermetic `goals.ts` handler test (401/400/409) and stays fast +
Docker-free. The test-plan §6.2/§6.4 cookbook sections are filled. Verify:
`npm run test:integration` green locally; `npm run test` + `npm run lint` green
and unit-only (no integration test picked up).

### Key Discoveries:

- **RLS oracle**: reading another user's row returns an **empty result, not an
  error** (`data-schema-foundation/plan.md:16`). Assertions = "A sees only A's
  rows" + "A's mutation of B's row is a no-op".
- **`createGoal` ↔ RLS gotcha**: `createGoal(client, userId, …)` inserts
  `user_id: userId` against INSERT `WITH CHECK (user_id = auth.uid())`
  ([savings-goals.ts:21-24](src/lib/services/savings-goals.ts#L21)) — the cap
  test MUST seed via the user's **own** authenticated client, or it trips the
  WITH CHECK instead of the trigger.
- **service_role bypasses RLS** — admin client is for setup/teardown ONLY; every
  asserted query goes through a per-user anon client.
- **Determinism** ([lessons.md](context/foundation/lessons.md)): pin `TZ=UTC` in
  the integration config too (the goals future-date refine uses local-time
  `new Date()`); choose `target_date` fixtures relative to UTC "today".

## What We're NOT Doing

- **No per-commit CI for the integration suite** — ad-hoc/local only (test-plan
  §5; no Docker in CI). We do NOT author a new CI workflow (lesson boundary:
  CI/CD authoring is Module 1 Lesson 5).
- **No full cookie→middleware→RLS e2e** through the real HTTP handler — the
  handler's RLS path under real cookies is e2e (Lesson 4). We test the handler's
  HTTP concerns hermetically and the RLS/trigger via direct service calls.
- **No auth login/signup flow tests** — out of scope (test-plan §7); isolation
  is the in-scope concern.
- **No exhaustive RLS matrix** — SELECT isolation (both tables) + the sharpest
  cross-user DELETE no-op; not every op × table (same policy shape).
- **No new migrations / schema changes / DB CHECK additions** — we test the
  existing guardrails, not add new ones.
- **No exposing `deleteGoal` via an API route** — we test the service's RLS
  isolation directly (forward-looking), without adding an endpoint.

## Critical Implementation Details

- **Glob isolation.** Integration tests live in `tests/integration/` (OUTSIDE
  the unit glob `src/**/*.test.ts`) so `npm run test` never tries to run them
  without Docker. Add `exclude: ["**/*.integration.test.ts"]` to the unit config
  as defensive belt-and-suspenders.
- **Serialize against the one DB.** The integration config must use
  `pool: "forks"` + `poolOptions.forks.singleFork: true` + `fileParallelism:
  false`, with `hookTimeout` ≥ 120s (first `supabase start` pulls images) and
  `testTimeout` ~30s.
- **`astro:env` in the handler test.** Importing `src/pages/api/goals.ts` pulls
  `@/lib/supabase` → `astro:env/server`, a virtual module plain Vitest can't
  resolve. The hermetic handler test must `vi.mock("@/lib/supabase", …)` (and
  mock `@/lib/services/savings-goals`' `createGoal`) so that virtual import is
  never evaluated — this keeps the test in the fast unit suite with no Astro
  vite plugin.
- **Cap test must use the user's own client** (see the `createGoal` gotcha above).

## Phase 1: Integration Harness + Proof-of-Life

### Overview

Stand up the separate integration config, the Supabase boot, the two-user
helper, and the `test:integration` script — proven by one real RLS round-trip.

### Changes Required:

#### 1. Integration Vitest config

**File**: `vitest.config.integration.ts` (new, repo root)

**Intent**: A separate config so the heavy Docker boot never loads during
`npm run test`. Node env, distinct glob, serialized, TZ-pinned.

**Contract**: `defineConfig` from `vitest/config` with `tsconfigPaths()`;
`test.include: ["tests/integration/**/*.test.ts"]`, `environment: "node"`,
`env: { TZ: "UTC" }`, `globalSetup: ["./tests/integration/globalSetup.ts"]`,
`testTimeout: 30_000`, `hookTimeout: 120_000`, `pool: "forks"`,
`poolOptions.forks.singleFork: true`, `fileParallelism: false`.

#### 2. Unit config defensive exclude

**File**: `vitest.config.ts`

**Intent**: Guarantee the unit run never picks up an integration test.

**Contract**: add `exclude: ["**/*.integration.test.ts"]` to the `test` block
(keep the existing `include`/`env`).

#### 3. Global setup — boot Supabase, export connection

**File**: `tests/integration/globalSetup.ts` (new)

**Intent**: Bring up local Supabase (idempotent) and publish the local URL +
keys to the test env.

**Contract**: default-export an async fn that runs `supabase start` then
`supabase status -o json`, setting `process.env.SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (service-role read at runtime —
never committed). Migrations apply automatically on first boot.

#### 4. Two-user test helper

**File**: `tests/integration/helpers/users.ts` (new)

**Intent**: Mint two isolated authenticated users for a test, plus teardown.

**Contract**: a helper that, given the env, uses an **admin** client
(service_role) to `auth.admin.createUser({ email, password, email_confirm: true
})` with unique ids/emails (`crypto.randomUUID()`), and returns for each user an
**anon-key client signed in via `signInWithPassword`** (so `auth.uid()` resolves
to that user under RLS). Provide a `cleanup()` that `auth.admin.deleteUser(id)`s
both (cascades their rows). The admin client is setup/teardown ONLY — never used
in an assertion.

#### 5. `test:integration` script

**File**: `package.json`

**Intent**: Ad-hoc local runner; not wired into CI.

**Contract**: add `"test:integration": "TZ=UTC vitest run --config vitest.config.integration.ts"`.

#### 6. Proof-of-life round-trip

**File**: `tests/integration/harness.integration.test.ts` (new)

**Intent**: Prove the whole pipeline (boot → user → auth → RLS write+read)
before the risk tests pile on.

**Contract**: with one seeded user, `createGoal(userClient, user.id, {valid
goal})` succeeds (proves INSERT `WITH CHECK` satisfied), and
`getUserGoals(userClient)` returns exactly that goal (proves SELECT + harness).
Teardown removes the user.

### Success Criteria:

#### Automated Verification:

- Integration suite boots Supabase and the round-trip passes: `npm run test:integration`
- Unit suite is unaffected and unit-only (no integration test collected): `npm run test`
- Lint passes on new config/helpers/test: `npm run lint`

#### Manual Verification:

- `supabase start` cold-boot time is acceptable; `supabase stop` afterwards if desired
- The admin (service_role) client is used only for create/delete, never in an assertion

**Implementation Note**: After automated verification passes, pause for human confirmation before Phase 2.

---

## Phase 2: Risk #5 — Ownership Isolation

### Overview

Prove that an authenticated user can never read another user's data, nor mutate
it — with positive controls so the tests can't pass vacuously.

### Changes Required:

#### 1. Isolation tests

**File**: `tests/integration/isolation.integration.test.ts` (new)

**Intent**: Assert RLS isolation on the read paths and the sharpest mutation,
both directions guarded by positive controls.

**Contract**: seed user A and user B, each with one goal and one transaction
(via each user's own client). Assert:
- **SELECT isolation**: `getUserGoals(clientA)` returns A's goal and **not** B's;
  `getUserTransactions(clientA)` returns A's txn and **not** B's (and symmetric
  spot-check for B). Positive control: each user's own row IS present (correct
  count), so an empty DB / broken query can't pass the test vacuously.
- **Cross-user DELETE no-op**: `deleteGoal(clientA, bGoalId)` does not error but
  removes nothing — `getUserGoals(clientB)` still returns B's goal afterward
  (RLS filters the DELETE to zero rows).

### Success Criteria:

#### Automated Verification:

- Isolation tests pass: `npm run test:integration`
- Unit suite still green and unit-only: `npm run test`
- Lint passes: `npm run lint`

#### Manual Verification:

- Each isolation assertion is paired with a positive control (own row present), confirmed by reading the test
- The cross-user delete asserts B's goal SURVIVES (no-op), not merely "no error"

**Implementation Note**: Pause for human confirmation before Phase 3.

---

## Phase 3: Risk #6 — 3-Goal Cap + Server-Side Validation

### Overview

Prove the cap at the DB tier (real trigger, integration) and the API's
server-side validation hermetically (per-commit unit test of the handler).

### Changes Required:

#### 1. Cap enforcement (integration)

**File**: `tests/integration/goal-cap.integration.test.ts` (new)

**Intent**: Prove the real trigger rejects a 4th goal — the count constraint a
mock would lie about.

**Contract**: with one seeded user, create 3 goals via that user's own client
(`createGoal(clientA, A.id, …)` ×3 succeed), then attempt a 4th and assert it
**rejects with the trigger message** (`/3 active savings goals/`). (Seeding via
the user's own client is required so the INSERT `WITH CHECK` passes and the
*trigger* is what fires on the 4th — see Critical Implementation Details.)

#### 2. Handler HTTP concerns (hermetic, unit suite)

**File**: `src/pages/api/goals.test.ts` (new)

**Intent**: Prove the POST handler's auth gate, zod validation, and cap→409
mapping — fast, no DB, runs per-commit in CI.

**Contract**: `vi.mock("@/lib/supabase")` (createClient → truthy stub) and
`vi.mock("@/lib/services/savings-goals")` (createGoal controllable), then invoke
`POST` with a mocked `APIContext` and assert:
- **401** when `locals.user` is null (no client built);
- **400** when the body fails zod (0 / negative / NaN / past date / malformed date);
- **409** when `createGoal` throws an error whose message includes `"3 active
  savings goals"` (the mapping), and **500** for any other thrown error.
The mocks keep `astro:env/server` from being evaluated (see Critical
Implementation Details).

### Success Criteria:

#### Automated Verification:

- Cap integration test passes (4th goal rejected by the trigger): `npm run test:integration`
- Handler hermetic tests pass and run inside the unit suite: `npm run test`
- Lint passes: `npm run lint`

#### Manual Verification:

- The cap test seeds the 3 goals via the user's OWN client (the 4th fails on the trigger, not the WITH CHECK)
- The handler 400 cases cover the bad-amount AND bad-date branches; 409 asserts the string-match mapping

**Implementation Note**: Pause for human confirmation before Phase 4.

---

## Phase 4: Cookbook §6.2 + §6.4

### Overview

Fill the two cookbook sections the test-plan parks on Phase 3, while the pattern
is fresh.

### Changes Required:

#### 1. Integration cookbook (§6.2)

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.2 "TBD — see §3 Phase 3" with the real how-to.

**Contract**: document — prerequisites (Docker + `supabase` CLI), the separate
`vitest.config.integration.ts` + `tests/integration/` layout, the two-user
helper pattern (admin create/teardown, per-user anon clients), unique-id
isolation, the ad-hoc run command (`npm run test:integration`), and the
`createGoal` WITH-CHECK gotcha.

#### 2. API-endpoint cookbook (§6.4)

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.4 "TBD — see §3 Phase 3" with the hermetic-vs-integration guidance.

**Contract**: document — test the handler's HTTP concerns (auth/zod/status
mapping) hermetically with a mocked `APIContext` + module mocks (the `astro:env`
gotcha), prove the real DB constraint (cap) via a direct-service integration
test, and note when the full cookie→middleware→RLS path forces e2e (Lesson 4).

### Success Criteria:

#### Automated Verification:

- §6.2 and §6.4 no longer contain "TBD": `grep -n "6.2\|6.4" context/foundation/test-plan.md` and inspect
- Lint/format passes on the markdown: `npm run lint` (or prettier via lint-staged on commit)

#### Manual Verification:

- A reader can follow §6.2 to run the integration suite and §6.4 to add an endpoint test without re-deriving the approach

**Implementation Note**: Final phase — pause for human confirmation before closing the change.

---

## Testing Strategy

### Integration Tests (ad-hoc, real Supabase):

- Harness round-trip (Phase 1); SELECT isolation both tables + cross-user delete no-op + positive controls (Phase 2); 3-goal cap trigger rejects the 4th (Phase 3).

### Unit Tests (per-commit):

- Hermetic goals handler: 401 / 400 (zod amount+date) / 409 (cap mapping) / 500 (Phase 3).

### Manual Testing Steps:

1. `npm run test:integration` locally (Docker running) — all integration green.
2. `npm run test` — unit-only, fast, includes the new handler test; no integration test collected.
3. Confirm `supabase status` keys are read at runtime (service_role never committed).

## Performance Considerations

First `supabase start` pulls Docker images (minutes); subsequent runs are fast.
`singleFork` serializes DB access (correctness over speed). The unit suite is
unaffected and stays sub-second.

## Migration Notes

Additive only — new config, helper, tests, one script, and cookbook prose. No
schema/migration changes. The integration suite is opt-in (not in CI); rollback
= revert the commits.

## References

- Research: `context/changes/data-tier-guardrails/research.md`
- Schema/RLS/trigger: `supabase/migrations/20260527000000_data_schema_foundation.sql`
- Services: `src/lib/services/savings-goals.ts`, `transactions.ts`; API: `src/pages/api/goals.ts`
- Unit runner precedent: `context/archive/2026-06-22-testing-runner-bootstrap-wedge/` (config + TZ pin)
- Test-plan: `context/foundation/test-plan.md` §3 (Phase 3), §4 (stack), §5 (gates), §6.2/§6.4 (cookbook)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Integration Harness + Proof-of-Life

#### Automated

- [x] 1.1 Integration suite boots Supabase and the round-trip passes: `npm run test:integration` — d90a490
- [x] 1.2 Unit suite unaffected and unit-only (no integration test collected): `npm run test` — d90a490
- [x] 1.3 Lint passes on new config/helpers/test: `npm run lint` — d90a490

#### Manual

- [ ] 1.4 `supabase start` cold-boot acceptable; admin client used only for setup/teardown, never an assertion

### Phase 2: Risk #5 — Ownership Isolation

#### Automated

- [x] 2.1 Isolation tests pass: `npm run test:integration` — bd9d81c
- [x] 2.2 Unit suite still green and unit-only: `npm run test` — bd9d81c
- [x] 2.3 Lint passes: `npm run lint` — bd9d81c

#### Manual

- [ ] 2.4 Each isolation assertion paired with a positive control (own row present)
- [ ] 2.5 Cross-user delete asserts B's goal SURVIVES (no-op), not merely "no error"

### Phase 3: Risk #6 — 3-Goal Cap + Server-Side Validation

#### Automated

- [x] 3.1 Cap integration test passes (4th goal rejected by the trigger): `npm run test:integration`
- [x] 3.2 Handler hermetic tests pass inside the unit suite: `npm run test`
- [x] 3.3 Lint passes: `npm run lint`

#### Manual

- [ ] 3.4 Cap test seeds the 3 goals via the user's OWN client (4th fails on the trigger, not the WITH CHECK)
- [ ] 3.5 Handler 400 covers bad-amount AND bad-date; 409 asserts the string-match mapping

### Phase 4: Cookbook §6.2 + §6.4

#### Automated

- [ ] 4.1 §6.2 and §6.4 no longer contain "TBD" (inspect `context/foundation/test-plan.md`)
- [ ] 4.2 Lint/format passes on the markdown: `npm run lint`

#### Manual

- [ ] 4.3 A reader can follow §6.2 to run the suite and §6.4 to add an endpoint test without re-deriving the approach
