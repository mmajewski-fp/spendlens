# Alert Threshold + SSR Error Surface Implementation Plan

## Overview

Final rollout phase: lock the two remaining test-plan risks as regressions —
Risk #4 (excessive-spending alert threshold, now that PRD Open Q2 is resolved)
and Risk #7 (SSR error surface) — and fill the §6 cookbook. **No production code
changes**: the alert logic already matches the resolved spec and the SSR pages
already render a safe error card, so this phase is assert-only + docs.

## Current State Analysis

- **#4 alert logic matches the resolved spec.** `recommendations.ts:75-90`:
  `thresholdCents = Math.floor(monthlyIncomeCents * 0.12)`, alert iff
  `bucket.totalCents > thresholdCents` (strict), guarded by `!hasMissingIncome`
  (income 0 → no alerts), sorted by `spendCents` desc; `SpendingAlert =
  {categorySlug, categoryName, spendCents, thresholdCents}`
  ([types.ts:48-55](src/types.ts#L48)). This is **identical** to the PRD Open Q2
  resolution (2026-06-24: 12% of monthly income, `floor`, strict `>`, income-0
  guard). Alert *firing* is currently **untested** — only `alerts: []`
  (baseline/missing-income) + finiteness in `expectAllFieldsFinite`
  ([recommendations.test.ts:80-83,92,289](src/lib/services/recommendations.test.ts#L80)).
- **#7 SSR error handling is already correct.** `recommendations.astro:19-61`
  and `goals.astro:15-51` wrap service calls in try/catch, set `fetchError`, and
  render a **generic** card; `fetchError` is only a truthiness gate, never
  interpolated → no raw-error/PII leak, no blank 500. `dashboard.astro` makes no
  DB call (not a #7 surface). Services
  ([savings-goals.ts:7](src/lib/services/savings-goals.ts#L7),
  [transactions.ts:15](src/lib/services/transactions.ts#L15)) each
  `throw new Error(error.message)` — a clean message-only Error, not the raw
  Supabase object.
- **The page-side card behavior is inline `.astro`** → only testable by a full
  page render (e2e, Lesson 4, out of scope). The **service error contract** is
  the hermetically-testable slice and the test-plan's prescribed cheapest layer.

## Desired End State

`npm run test` (unit) gains: Risk #4 alert-firing assertions (against the PRD
oracle) and Risk #7 hermetic service-error-contract tests for the two SSR read
paths. `test-plan.md` §6.1 + §6.3 are filled. All green, unit-only, no Docker,
no production change. Verify with `npm run test` + `npm run lint`.

### Key Discoveries:

- #4 oracle = the resolved PRD Q2 spec (sourced, not the `0.12` constant) —
  asserting it is a regression lock, not an oracle-mirror.
- #7 testable boundary = the service throw site (clean Error, no raw
  `{code,details,hint}`/PII); the page catch→card→200 link is e2e.
- `ServerError.tsx` renders its message prop verbatim but is **auth-only**
  (SignIn/SignUp) — out of scope for #7.

## What We're NOT Doing

- **No production code changes** — neither the alert logic nor the SSR pages need
  fixing (both verified-correct); this phase only adds tests + docs.
- **No page-side / full-render test** for #7 — that's e2e (Lesson 4). We do NOT
  extract the page loaders into a testable util (working pages, scope creep) and
  we do NOT write a brittle full-page snapshot (the Risk #7 anti-pattern).
- **No write-path error-contract tests** — only the two SSR read paths
  (`getUserGoals`, `getUserTransactions`); `createGoal`/`deleteGoal`/
  `createTransactions` are behind API routes, not the SSR #7 surface.
- **No alert-threshold production change** — the `0.12` constant already matches
  the resolved spec; we assert it, not change it.
- **No `ServerError.tsx` change** — auth-only, out of scope.
- **No integration/Docker, no CI changes** — all new tests are pure unit/hermetic
  and run in the existing per-commit suite.

## Critical Implementation Details

- **#4 oracle provenance.** Assert against the PRD rule + hand-worked numbers
  (research §"Hand-worked #4 oracle"), NOT the `ALERT_INCOME_FRACTION` constant —
  the test-plan's #4 anti-pattern is oracle-mirroring an (now-resolved) spec.
- **Determinism.** Alert inputs flow through the 30-day window (wall clock), so
  reuse the existing frozen clock + `TZ=UTC`; date income/expense fixtures
  in-window, exactly as the #1/#2/#3 tests do.
- **#7 stub shape.** The hermetic test stubs a chainable Supabase client:
  `getUserGoals` calls `.from().select().order()`; `getUserTransactions` calls
  `.from().select().order()` (+ `.gte()` only when `since` is passed). The stub's
  terminal call resolves `{ data: null, error: {message, code, details, hint} }`;
  assert the thrown value is an `Error`, `.message === error.message`, and it does
  NOT carry `code`/`details`/`hint` (no raw object escapes).

## Phase 1: Risk #4 — Alert-Firing Unit Tests

### Overview

Pin the excessive-spending alert oracle in the existing unit suite.

### Changes Required:

#### 1. Risk #4 alert tests

**File**: `src/lib/services/recommendations.test.ts`

**Intent**: Add a `describe("Risk #4: excessive-spending alerts")` block (reusing
the frozen-clock `beforeEach`/`afterEach`) asserting the alert oracle from the
resolved PRD spec.

**Contract**: With income `1_000_000` (→ `threshold = 120_000`): a category at
`200_000` and one at `120_001` each produce a `SpendingAlert`
(`{categorySlug, categoryName, spendCents, thresholdCents: 120_000}`); a category
at `120_000` (== threshold) produces **none** (strict `>`); a category below does
not; `result.alerts` is sorted by `spendCents` desc. Plus: a floor-pinning case
(income `1_000_005` → `floor(120_000.6)=120_000`, a `120_001` category alerts)
and a missing-income case (income 0 → `alerts: []`). Oracle from PRD/hand-worked,
not the `0.12` constant.

### Success Criteria:

#### Automated Verification:

- Risk #4 alert tests pass: `npm run test`
- Lint passes: `npm run lint`

#### Manual Verification:

- Expected alert numbers trace to the resolved PRD spec + hand-worked oracle (not lifted from the `ALERT_INCOME_FRACTION` constant)
- The exactly-at-threshold case asserts NO alert (strict `>`), and the floor edge pins `floor` over `ceil`/`round`

**Implementation Note**: After automated verification passes, pause for human confirmation before Phase 2.

---

## Phase 2: Risk #7 — Hermetic Service-Error Contract

### Overview

Prove the SSR read paths throw a clean, message-only `Error` on a Supabase
failure — the boundary the page's try/catch is meant to catch — without a full
page render.

### Changes Required:

#### 1. getUserGoals error contract

**File**: `src/lib/services/savings-goals.test.ts` (new)

**Intent**: Hermetically assert `getUserGoals` wraps a Supabase error into a
clean `Error` and never re-exposes the raw error object.

**Contract**: stub a chainable client whose `.from().select().order()` resolves
`{ data: null, error: { message: "boom", code, details, hint } }`; assert
`getUserGoals(stub)` rejects with an `Error` where `.message === "boom"` and the
thrown object carries none of `code`/`details`/`hint`. Add a success-path
assertion (`{ data: [...], error: null }` → returns the rows).

#### 2. getUserTransactions error contract

**File**: `src/lib/services/transactions.test.ts` (new)

**Intent**: Same clean-Error contract for the transactions read path.

**Contract**: stub `.from().select().order()` (no `since`) resolving
`{ data: null, error }`; assert a clean `Error(message)` with no raw fields. (The
`since`/`.gte()` branch is exercised only if convenient; the error contract is
the focus.)

### Success Criteria:

#### Automated Verification:

- Both service-error-contract tests pass inside the unit suite: `npm run test`
- Lint passes: `npm run lint`

#### Manual Verification:

- The tests assert the thrown value is a clean `Error` (message only) — no `code`/`details`/`hint`/PII survives the throw
- The plan/PR notes the page-side card behavior is verified-by-inspection but e2e (Lesson 4), not asserted here

**Implementation Note**: Pause for human confirmation before Phase 3.

---

## Phase 3: Cookbook §6.1 + §6.3

### Overview

Fill the two cookbook sections this phase exemplifies.

### Changes Required:

#### 1. Unit-test cookbook (§6.1)

**File**: `context/foundation/test-plan.md`

**Intent**: Replace §6.1 "TBD" with the unit-test how-to.

**Contract**: document — co-located `*.test.ts` + explicit `vitest` imports;
`TZ=UTC` + `vi.setSystemTime` frozen clock for the 30-day window; assert the
cut-math/alert oracle against a hand-worked example / the PRD (never the
implementation constant); `npm run test`.

#### 2. Hermetic stub-client cookbook (§6.3)

**File**: `context/foundation/test-plan.md`

**Intent**: Replace §6.3 "TBD" with the hermetic stub-client how-to.

**Contract**: document — when to stub the Supabase client (partial-failure /
error-contract branches real infra can't easily trigger, e.g. the service
error-contract); the chainable-stub shape; assert the throw contract (clean
`Error`, no raw object); and when a hermetic test would lie (DB constraints,
cascades, RLS — use integration instead, §6.2).

### Success Criteria:

#### Automated Verification:

- §6.1 and §6.3 no longer contain "TBD" (inspect `context/foundation/test-plan.md`)
- Markdown is Prettier-clean: `npx prettier --check context/foundation/test-plan.md`

#### Manual Verification:

- A reader can follow §6.1 to add a unit test and §6.3 to add a hermetic stub-client test without re-deriving the approach

**Implementation Note**: Final phase — pause for human confirmation before closing the change.

---

## Testing Strategy

### Unit Tests:

- Risk #4: alert fires (>), no-alert at threshold (strict), just-over, floor edge, missing-income → [], sorted desc, `SpendingAlert` shape (extend `recommendations.test.ts`).
- Risk #7 (hermetic): `getUserGoals` + `getUserTransactions` throw a clean message-only `Error` on a stubbed Supabase error; success path returns rows.

### Integration Tests:

- None (no new DB behavior; #7 page render is e2e, out of scope).

### Manual Testing Steps:

1. `npm run test` — all new #4 + #7 tests green, unit-only.
2. Cross-check #4 numbers against the resolved PRD Q2 spec.
3. Read §6.1/§6.3 and confirm a newcomer could follow them.

## Performance Considerations

Negligible — pure unit/hermetic tests over tiny fixtures; no Docker.

## Migration Notes

Additive only (test files + cookbook prose). No schema, no production code.
Rollback = revert the commits.

## References

- Research: `context/changes/alert-threshold-and-error-surface/research.md`
- Resolved spec: `context/foundation/prd.md` §Open Questions Q2 (2026-06-24)
- Alert logic: `src/lib/services/recommendations.ts:75-90`; `src/types.ts:48-55`
- SSR error handling: `src/pages/recommendations.astro:19-61`, `src/pages/goals.astro:15-51`
- Service throw contract: `src/lib/services/savings-goals.ts:7`, `transactions.ts:15`
- Hermetic-mock precedent: `context/archive/2026-06-23-data-tier-guardrails/` (`src/pages/api/goals.test.ts`)
- Test-plan: §2 Risk #4/#7 guidance, §6.1/§6.3/§6.5 cookbook

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Risk #4 — Alert-Firing Unit Tests

#### Automated

- [x] 1.1 Risk #4 alert tests pass: `npm run test` — c6c45c3
- [x] 1.2 Lint passes: `npm run lint` — c6c45c3

#### Manual

- [ ] 1.3 Expected alert numbers trace to the resolved PRD spec + hand-worked oracle (not the constant)
- [ ] 1.4 Exactly-at-threshold asserts NO alert (strict `>`); floor edge pins `floor`

### Phase 2: Risk #7 — Hermetic Service-Error Contract

#### Automated

- [x] 2.1 Both service-error-contract tests pass inside the unit suite: `npm run test` — a673024
- [x] 2.2 Lint passes: `npm run lint` — a673024

#### Manual

- [ ] 2.3 Thrown value is a clean `Error` (message only) — no `code`/`details`/`hint`/PII survives
- [ ] 2.4 Page-side card behavior noted as verified-by-inspection but e2e (Lesson 4), not asserted here

### Phase 3: Cookbook §6.1 + §6.3

#### Automated

- [x] 3.1 §6.1 and §6.3 no longer contain "TBD" (inspect `context/foundation/test-plan.md`)
- [x] 3.2 Markdown is Prettier-clean: `npx prettier --check context/foundation/test-plan.md`

#### Manual

- [ ] 3.3 A reader can follow §6.1 (unit) and §6.3 (hermetic) without re-deriving the approach
