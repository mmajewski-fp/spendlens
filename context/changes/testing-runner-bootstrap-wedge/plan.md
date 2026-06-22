# Runner Bootstrap + First Wedge Test — Implementation Plan

## Overview

Rollout Phase 1 of `context/foundation/test-plan.md`: stand up Vitest, wire it
into CI, and land the **first real assertions** on the cut-suggestion engine
(`computeRecommendations`) covering Risk #1 (math correct vs the goal
target/timeframe) and Risk #2 (degenerate inputs stay finite, never NaN/∞ on the
UI). This is deliberately the *first wedge*, not full coverage — the exhaustive
parameterized contract (ranking permutations, rounding direction, the
expired-goal result shape) is rollout **Phase 2's** job in a separate change.

## Current State Analysis

- **Zero test base** (confirmed in research): no `vitest`/`jest`, no `*.test.*`,
  no test config, no `test` script; CI is `npm ci → astro sync → lint → build`
  with no test step (`.github/workflows/ci.yml`).
- **Unit under test is pure data-in/data-out but time-impure.**
  `computeRecommendations(transactions, goals)`
  ([src/lib/services/recommendations.ts:34](src/lib/services/recommendations.ts#L34))
  takes plain arrays and returns a plain `RecommendationsResult` — no Supabase —
  but calls `new Date()` internally
  ([:38](src/lib/services/recommendations.ts#L38)) for the 30-day window filter
  ([:40-45](src/lib/services/recommendations.ts#L40-L45)) and `monthsRemaining`
  ([:93](src/lib/services/recommendations.ts#L93)). Tests must control the clock.
- **Alias `@/*` lives only in `tsconfig.json`**, not in the Astro `vite` block,
  so a bare runner will not resolve `@/types` — explicit alias wiring required.
- **Version floor**: Astro 6 ships Vite 7; Vite 7 needs **Vitest ≥ 3.2**
  ([Vitest config docs](https://vitest.dev/config/),
  [Vite 7 announcement](https://vite.dev/blog/announcing-vite7)).

## Desired End State

`npm run test` runs Vitest green locally and in CI. `recommendations.test.ts`
sits beside its source and proves: (a) the empty-input baseline, (b) the Risk #1
hand-worked oracle (correct amounts, highest→lowest ranking, minimum cut set,
and the on-track/no-cuts boundary), and (c) the Risk #2 finiteness invariant
across the four reachable degenerate inputs. Verify by running `npm run test`
(exit 0) and observing the CI "test" step pass on a branch push.

### Key Discoveries:

- Time coupling ([recommendations.ts:38](src/lib/services/recommendations.ts#L38))
  forces `vi.useFakeTimers()` + `vi.setSystemTime(...)`; fixtures must be dated
  relative to the fixed "today" or the 30-day filter silently drops them.
- The guards `Math.max(1, …)` ([:25](src/lib/services/recommendations.ts#L25))
  and `Math.max(0, …)` ([:95](src/lib/services/recommendations.ts#L95)) already
  hold for the three named degenerate inputs → those assertions land **green**
  (regression locks), not red.
- The one genuinely unguarded NaN vector is an out-of-contract malformed
  `target_date` string ([toDateOnly:16-19](src/lib/services/recommendations.ts#L16-L19))
  → not reachable from DB/API → logged as a Phase-2 follow-up, not fixed here.
- `formatCents` renders NaN/∞ literally as `$NaN`/`$∞`
  ([RecommendationsPanel.tsx:9-11](src/components/RecommendationsPanel.tsx#L9-L11)),
  which is why the finiteness invariant is the right Risk #2 oracle.
- Oracle numbers come from PRD §Business Logic + US-01 AC
  ([prd.md:101-114](context/foundation/prd.md#L101-L114)), worked by hand in
  `research.md` — never lifted from the implementation.

## What We're NOT Doing

- **No exhaustive math contract** — ranking permutations beyond the one worked
  scenario, rounding-direction (`Math.ceil`) pinning, 5-suggestion cap edge,
  and `it.each` parameterization are rollout **Phase 2** ("Wedge-math contract").
- **No expired-goal *shape* assertion** — whether an expired goal should return
  empty/sentinel vs the shipped aggressive cuts is an unresolved product
  question (research Open Q1); Phase 1 asserts only finiteness + `isExpired`.
- **No production-code changes** — we do not add a malformed-date guard, do not
  refactor the `new Date()` coupling to an injected clock. Logged for Phase 2.
- **No alert-threshold assertions** — the 0.12 fraction is PRD Open Question Q2
  (undefined oracle); routed to rollout Phase 4. Do not oracle-mirror it.
- **No jsdom / React-component tests, no integration/real-Supabase, no Stryker,
  no e2e** — later rollout phases.
- **No §6 cookbook write-up** — the test-plan assigns cookbook fill-in to a
  later phase; Phase 1 only establishes the convention the cookbook will cite.

## Implementation Approach

Three phases, environment-first (per test-plan §1: setup, then the rules that
depend on it). Phase 1 stands up the runner and proves the whole pipeline with a
*real* baseline assertion (not a throwaway). Phase 2 lands the headline Risk #1
oracle. Phase 3 lands the Risk #1-adjacent degenerate-input guards for Risk #2.
Each phase ends green in CI and is independently verifiable.

## Critical Implementation Details

- **Determinism via fixed clock + UTC.** `computeRecommendations` builds Dates
  from the wall clock *and* from `target_date` strings via `new Date(year,
  month-1, day)` (local time). Local-time day arithmetic crosses DST boundaries
  and can flip `Math.ceil(diffDays/30)` by a month (e.g. a 150-day gap spanning
  late-October DST computes as 150 + 1h → `ceil(5.0014)=6`). **Run tests in
  `TZ=UTC`** (set in the `test` script, see Phase 1) so every Date is UTC and
  day-counts are exact, and use `vi.setSystemTime` for "today". With UTC fixed,
  a `target_date` exactly 150 days after "today" yields `months = 5` reliably.
- **Fixture dating.** With "today" = `2026-06-01T00:00:00Z`, the 30-day window
  starts `2026-05-02`. Income/expense fixtures must be dated inside that window
  (e.g. `2026-05-20`) or they are filtered out and income reads as 0
  (`hasMissingIncome`), silently invalidating the oracle.
- **No Vitest globals.** Import `{ describe, it, expect, vi, beforeEach,
  afterEach }` from `"vitest"` explicitly so no ESLint env / `tsconfig.types`
  change is needed (the existing `**/*.{ts,tsx}` lint glob already covers test
  files).

## Phase 1: Runner Bootstrap & CI Wiring

### Overview

Install and configure Vitest so `npm run test` runs a real assertion green,
locally and in CI, with the `@/*` alias resolving.

### Changes Required:

#### 1. Dev dependencies

**File**: `package.json`

**Intent**: Add the runner and the alias resolver as devDependencies. No coverage
tooling, no DOM library (pure Node test).

**Contract**: Add `vitest` (`^3.2` — Vite 7 floor) and `vite-tsconfig-paths` to
`devDependencies`. The existing `"overrides": { "vite": "^7.3.2" }` stays; Vitest
3.2 is compatible with Vite 7.

#### 2. Test scripts

**File**: `package.json`

**Intent**: A CI-mode run and a watch-mode run, both pinned to UTC for
deterministic date math.

**Contract**: Add `"test": "TZ=UTC vitest run"` and `"test:watch": "TZ=UTC
vitest"` to `scripts`. (mac/linux honor the `TZ=` prefix; CI is ubuntu. If
Windows dev support is later needed, switch to `cross-env`.)

#### 3. Vitest config

**File**: `vitest.config.ts` (new, repo root)

**Intent**: Minimal standalone config: Node environment, co-located test glob,
and `@/*` resolution read straight from `tsconfig.json`.

**Contract**: Default-exports a `defineConfig` from `vitest/config` with the
`vite-tsconfig-paths` plugin and `test.environment: 'node'`,
`test.include: ['src/**/*.test.ts']`. Snippet (load-bearing — Phases 2–3 import
`@/...` and depend on this resolving):

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

#### 4. Baseline proof-of-life test

**File**: `src/lib/services/recommendations.test.ts` (new)

**Intent**: A single *real* behavioral assertion (not a throwaway) that proves
the import + alias + runner + CI work end to end: the empty-input contract.

**Contract**: `describe("computeRecommendations")` with one `it` asserting
`computeRecommendations([], [])` returns `hasMissingIncome: true`,
`monthlyIncomeCents: 0`, `alerts: []`, `goals: []`. Explicit `vitest` imports.

#### 5. CI test step

**File**: `.github/workflows/ci.yml`

**Intent**: Run the suite in CI between lint and build so logic failures fail
fast and cheap; no Supabase secrets (pure unit test).

**Contract**: Insert `- run: npm run test` after the `npm run lint` step and
before the `npm run build` step in the existing `ci` job. No `env:` block.

### Success Criteria:

#### Automated Verification:

- [ ] Dependencies install cleanly: `npm install`
- [ ] Test suite runs green: `npm run test`
- [ ] Lint passes on the new config + test file: `npm run lint`
- [ ] Build is unaffected: `npm run build`
- [ ] CI workflow contains a `npm run test` step between lint and build: `grep -n "npm run test" .github/workflows/ci.yml`

#### Manual Verification:

- [ ] On a branch push, the CI "test" step appears and passes (green) before build
- [ ] `npm run test:watch` starts watch mode locally and re-runs on file change

**Implementation Note**: After automated verification passes, pause for human
confirmation of the manual CI/watch checks before proceeding to Phase 2.

---

## Phase 2: Risk #1 — Cut-Math Correctness Wedge

### Overview

Land the headline assertion: per-category cut amounts are mathematically correct
versus the goal target/timeframe, against a hand-worked oracle derived from the
PRD — plus the on-track/no-cuts boundary.

### Changes Required:

#### 1. Deterministic clock setup

**File**: `src/lib/services/recommendations.test.ts`

**Intent**: Freeze "today" so the 30-day window and months-remaining are
deterministic.

**Contract**: `beforeEach(() => { vi.useFakeTimers();
vi.setSystemTime(new Date("2026-06-01T00:00:00Z")); })` and
`afterEach(() => vi.useRealTimers())`. (Combined with `TZ=UTC` from Phase 1.)

#### 2. Risk #1 "cuts needed" oracle test

**File**: `src/lib/services/recommendations.test.ts`

**Intent**: Prove the full formula chain and minimum-cut ranking against the
PRD-derived worked example. Expected values come from `research.md` (PRD
arithmetic), NOT from running the code.

**Contract**: Fixtures (all amounts positive integer cents; dates inside the
window): one `income` txn `400000`; four `expense` txns — Dining `80000`,
Shopping `50000`, Groceries `40000`, Transport `20000`, each with a
`category: { name, slug }`; one goal `target_amount: 1500000`,
`target_date: "2026-10-29"` (150 days out → `months = 5`). Assert on
`result.goals[0]`: `currentSurplusCents === 210000`,
`requiredMonthlySavingCents === 300000`, `isOnTrack === false`,
`isExpired === false`, and `suggestions` deep-equals
`[{ categorySlug: "dining", estimatedSavingCents: 80000 }, { categorySlug:
"shopping", estimatedSavingCents: 10000 }]` (order matters; Σ = 90000 = gap;
Groceries/Transport untouched). Also assert `result.monthlyIncomeCents ===
400000`.

#### 3. Risk #1 "on track → no cuts" boundary test

**File**: `src/lib/services/recommendations.test.ts`

**Intent**: Prove the lower bound of "minimum set of cuts" — when surplus already
covers the goal, zero cuts are emitted (catches a regression where the greedy
walk over-suggests).

**Contract**: Same income/expense fixtures; an easy goal `target_amount: 500000`,
`target_date: "2026-10-29"` (→ `months = 5`, required `100000` < surplus
`210000`). Assert `result.goals[0].isOnTrack === true` and
`result.goals[0].suggestions` is `[]`.

### Success Criteria:

#### Automated Verification:

- [ ] Risk #1 tests pass: `npm run test`
- [ ] Lint passes: `npm run lint`

#### Manual Verification:

- [ ] The expected numbers in the test match the hand-worked example in `research.md` (oracle-from-PRD, not lifted from code output)
- [ ] Temporarily breaking a constant (e.g. negate the gap) makes the oracle test fail — confirms the assertion bites

**Implementation Note**: After automated verification passes, pause for human
confirmation of the oracle-provenance and bite checks before Phase 3.

---

## Phase 3: Risk #2 — Degenerate-Input Guards (First Pass)

### Overview

Prove the four *reachable* degenerate inputs each return a finite result (no
NaN/∞ can reach `formatCents`), and record the out-of-contract malformed-date
NaN vector as a rollout-Phase-2 follow-up.

### Changes Required:

#### 1. Finiteness invariant across reachable degenerate inputs

**File**: `src/lib/services/recommendations.test.ts`

**Intent**: Lock the existing `max(1,…)`/`max(0,…)` guards by asserting every
numeric output field is `Number.isFinite`, for each degenerate case. These pass
green today (regression locks).

**Contract**: Four cases sharing the frozen `2026-06-01Z` clock. For each,
assert every numeric field — `monthlyIncomeCents`, and per goal
`requiredMonthlySavingCents`, `currentSurplusCents`, each
`suggestions[].estimatedSavingCents`, each `alerts[].spendCents` /
`alerts[].thresholdCents` — satisfies `Number.isFinite(x) === true` (never NaN,
never ±Infinity):
- **timeframe 0**: goal `target_date === "2026-06-01"` (== today). Also assert `isExpired === false` (strict `<`).
- **past date**: goal `target_date === "2026-05-15"` (< today). Also assert `isExpired === true`.
- **≤0 surplus with income present**: income `100000`, expense `150000` (surplus `-50000`), a feasible future goal. Assert results finite and (income > 0 ⇒) `hasMissingIncome === false`.
- **missing income (the sentinel case)**: no income txns, some expenses, a future goal. Assert `hasMissingIncome === true`, `goals[0].suggestions === []`, `alerts === []`.

#### 2. Log the malformed-date NaN vector for Phase 2

**File**: `src/lib/services/recommendations.test.ts`

**Intent**: Make the known unguarded out-of-contract vector visible in test
output without fixing production code now.

**Contract**: One `it.todo("malformed target_date string must not yield NaN —
add a guard + assertion in rollout Phase 2 (Wedge-math contract); see
research.md Open Q2")`. (Vitest reports it as a pending todo; no assertion runs.)

### Success Criteria:

#### Automated Verification:

- [ ] All Risk #2 cases pass: `npm run test`
- [ ] The malformed-date `it.todo` shows as a pending todo in the Vitest output
- [ ] Lint passes: `npm run lint`

#### Manual Verification:

- [ ] No degenerate case yields a NaN/∞ field (finiteness assertions all hold)
- [ ] The `it.todo` text clearly hands the malformed-date gap to rollout Phase 2

**Implementation Note**: After automated verification passes, pause for human
confirmation before closing the change.

---

## Testing Strategy

### Unit Tests:

- `computeRecommendations` empty-input baseline (Phase 1)
- Risk #1: PRD-oracle "cuts needed" scenario + "on track → no cuts" boundary (Phase 2)
- Risk #2: finiteness invariant across timeframe-0 / past-date / ≤0-surplus / missing-income (Phase 3)
- Key edge cases: window-boundary fixture dating, expired vs not-yet-expired `isExpired` flag, sentinel empty-result on missing income

### Integration Tests:

- None this phase (real-Supabase isolation + 3-goal cap are rollout Phase 3).

### Manual Testing Steps:

1. Push a branch; confirm the CI "test" step runs between lint and build and is green.
2. Run `npm run test:watch`, edit the test, confirm re-run.
3. Cross-check Phase 2 expected numbers against `research.md` §"Risk #1 Oracle".
4. Negate a constant in `recommendations.ts` and confirm the oracle test fails, then revert.

## Performance Considerations

Negligible — pure in-memory unit tests over tiny fixtures. The CI test step adds
a few seconds before build.

## Migration Notes

None — additive only (new dev deps, new config, new test file, one CI step). No
schema, no data, no production-code changes. Rollback = revert the commit.

## References

- Research: `context/changes/testing-runner-bootstrap-wedge/research.md`
- Test plan: `context/foundation/test-plan.md` §2 (Risks #1, #2), §3 (Phase 1), §4 (stack), §6.1 (cookbook target)
- Oracle source: `context/foundation/prd.md:101-114` (§Business Logic), `:50-53` (US-01 AC)
- Unit under test: `src/lib/services/recommendations.ts:34-132`
- Render risk: `src/components/RecommendationsPanel.tsx:9-11`
- Vitest ↔ Vite 7: https://vitest.dev/config/ , https://vite.dev/blog/announcing-vite7

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Runner Bootstrap & CI Wiring

#### Automated

- [x] 1.1 Dependencies install cleanly: `npm install` — 17ec489
- [x] 1.2 Test suite runs green: `npm run test` — 17ec489
- [x] 1.3 Lint passes on the new config + test file: `npm run lint` — 17ec489
- [x] 1.4 Build is unaffected: `npm run build` — 17ec489
- [x] 1.5 CI workflow contains a `npm run test` step between lint and build — 17ec489

#### Manual

- [ ] 1.6 On a branch push, the CI "test" step appears and passes before build
- [ ] 1.7 `npm run test:watch` starts watch mode and re-runs on file change

### Phase 2: Risk #1 — Cut-Math Correctness Wedge

#### Automated

- [x] 2.1 Risk #1 tests pass: `npm run test`
- [x] 2.2 Lint passes: `npm run lint`

#### Manual

- [ ] 2.3 Expected numbers match the hand-worked example in `research.md` (oracle-from-PRD, not from code)
- [ ] 2.4 Breaking a constant makes the oracle test fail (assertion bites)

### Phase 3: Risk #2 — Degenerate-Input Guards (First Pass)

#### Automated

- [ ] 3.1 All Risk #2 cases pass: `npm run test`
- [ ] 3.2 The malformed-date `it.todo` shows as a pending todo in Vitest output
- [ ] 3.3 Lint passes: `npm run lint`

#### Manual

- [ ] 3.4 No degenerate case yields a NaN/∞ field
- [ ] 3.5 The `it.todo` text clearly hands the malformed-date gap to rollout Phase 2
