---
date: 2026-06-22T17:28:31+0200
researcher: Michał Majewski
git_commit: 494166b6dc00becde80499d1ecf9ad7c39297ee0
branch: main
repository: spendlens
topic: "Phase 1 — Vitest runner bootstrap + first wedge test on cut-math (Risks #1, #2)"
tags: [research, codebase, recommendations, cut-math, vitest, test-bootstrap, oracle]
status: complete
last_updated: 2026-06-22
last_updated_by: Michał Majewski
---

# Research: Phase 1 — Runner bootstrap + first wedge test (Risks #1, #2)

**Date**: 2026-06-22T17:28:31+0200
**Researcher**: Michał Majewski
**Git Commit**: 494166b6dc00becde80499d1ecf9ad7c39297ee0
**Branch**: main
**Repository**: spendlens (github.com/mmajewski-fp/spendlens)

## Research Question

Rollout Phase 1 of `context/foundation/test-plan.md`: stand up the test runner
(Vitest hypothesis — confirm), wire it into CI, and land the first real
assertions on the cut-math, covering:

- **Risk #1** — cut-suggestion amount mathematically wrong vs the goal's
  target/timeframe. Oracle = a hand-worked example from PRD §Business Logic +
  US-01 AC, **never** from the implementation.
- **Risk #2** — degenerate goal inputs (timeframe 0, past goal date, ≤0
  surplus) produce NaN/Infinity that renders straight to the UI instead of a
  guarded result.

## Summary

The hypothesis holds and the engine is unit-testable, but with **one critical
caveat the test plan did not anticipate: `computeRecommendations` is not pure
with respect to time.** It calls `new Date()` internally
([recommendations.ts:38](src/lib/services/recommendations.ts#L38)) for both the
30-day transaction window and the months-remaining calculation. A test that
hard-codes calendar dates will silently drop its own transactions out of the
window and get a drifting month-count. **Phase 1 must control the clock**
(Vitest `vi.setSystemTime`) and date all fixtures relative to that fixed
"today." This is the single biggest determinant of how the first test is
written.

Findings against the two risks:

- **Risk #1 (math correctness) is real and testable as a pure-unit test.**
  `computeRecommendations(transactions, goals)`
  ([recommendations.ts:34](src/lib/services/recommendations.ts#L34)) takes plain
  data and returns plain data — no Supabase. I derived a hand-worked oracle
  from PRD §Business Logic (below, §Risk #1 Oracle). It happens to match the
  implementation today (the code is correct), so this assertion lands **green**
  and acts as a regression lock. The danger is oracle-mirror — the expected
  numbers below are derived from the PRD formula chain and arithmetic, not read
  off the code.

- **Risk #2 has two faces, and the "real" face is not the one the plan names.**
  For the three *named* inputs (timeframe 0, past date, ≤0 surplus), the code
  **already guards** via `Math.max(1, …)` on months
  ([recommendations.ts:25](src/lib/services/recommendations.ts#L25)) and
  `Math.max(0, …)` on the gap
  ([recommendations.ts:95](src/lib/services/recommendations.ts#L95)) — so those
  assertions land **green** as regression guards. The genuinely *unguarded*
  NaN vector is an **out-of-contract `target_date` string**
  ([recommendations.ts:16-19](src/lib/services/recommendations.ts#L16-L19)
  parses with `new Date(year, month-1, day)` and has no validity check), which
  cascades to `$NaN` on screen because the formatter does not guard either
  ([RecommendationsPanel.tsx:9-11](src/components/RecommendationsPanel.tsx#L9-L11)).
  Whether Phase 1 asserts only the reachable (green) guards or also the
  out-of-contract (red, needs-a-fix) case is a **scope decision** — see Open
  Questions.

- **Runner state confirmed: zero test base.** No `vitest`/`jest`/test files/
  test config anywhere; no `test` script; CI has no test step
  ([package.json](package.json), [ci.yml](.github/workflows/ci.yml)). Vitest is
  the correct fit (Vite-native; Astro 6 is Vite-based). For a pure-function
  test we need only `environment: 'node'` and `@/*` alias resolution — no
  jsdom/happy-dom (those are a Phase-2+ React-component concern).

**One blocking oracle ambiguity** (§Open Questions Q1): the change intent says
each degenerate input should return "a safe guarded result (**empty/sentinel**)",
but the shipped design deliberately returns the *opposite* for an expired goal
(clamp months→1, emit the **most aggressive** non-empty suggestions, "signals
urgency"). The PRD does not resolve which is correct. The **finiteness
invariant** (no NaN/Infinity) can be asserted regardless; the **shape** of an
expired goal's result cannot be asserted until this is resolved.

## Detailed Findings

### The engine: `computeRecommendations` (the unit under test)

- **Location / signature**:
  [src/lib/services/recommendations.ts:34-37](src/lib/services/recommendations.ts#L34-L37)
  ```ts
  export function computeRecommendations(
    transactions: TransactionWithCategory[],
    goals: SavingsGoal[],
  ): RecommendationsResult
  ```
- **Pure data in / data out — but time-impure.** No Supabase, no fetch. BUT
  [recommendations.ts:38-40](src/lib/services/recommendations.ts#L38-L40):
  ```ts
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowStart = new Date(today.getTime() - WINDOW_DAYS * MS_PER_DAY);
  ```
  Both the 30-day window filter
  ([:42-45](src/lib/services/recommendations.ts#L42-L45)) and `monthsRemaining`
  ([:93](src/lib/services/recommendations.ts#L93)) depend on the wall clock.
  **Testability constraint**: use `vi.useFakeTimers()` + `vi.setSystemTime(...)`
  in a fixed local "today", and date every fixture transaction *inside* the
  preceding 30 days, and every goal `target_date` relative to that today.

- **Formula chain as implemented** (matches PRD §Business Logic):
  - monthly income = Σ amount where `type === "income"`
    ([:50](src/lib/services/recommendations.ts#L50))
  - monthly expense = Σ amount where `type === "expense"`
    ([:53](src/lib/services/recommendations.ts#L53))
  - monthly surplus = income − expense
    ([:54](src/lib/services/recommendations.ts#L54))
  - per goal: months = `max(1, ceil(diffDays / 30))`
    ([:22-26](src/lib/services/recommendations.ts#L22-L26)); required monthly
    saving = `ceil(target_amount / months)`
    ([:94](src/lib/services/recommendations.ts#L94)); gap =
    `max(0, required − surplus)`
    ([:95](src/lib/services/recommendations.ts#L95))
  - greedy cut allocation: categories sorted by spend desc
    ([:88](src/lib/services/recommendations.ts#L88)); walk and take
    `cut = min(categoryTotal, remainingGap)` until gap closed or 5 suggestions
    ([:98-111](src/lib/services/recommendations.ts#L98-L111))

- **Important implementation details for the oracle**:
  - Income vs expense is the `type` column, **not** amount sign; all amounts are
    positive integer **cents** (confirmed in data-schema history below).
  - "Months" is a **30-day approximation** (`DAYS_PER_MONTH = 30`,
    [:14](src/lib/services/recommendations.ts#L14)), not calendar months. Choose
    oracle dates as exact multiples of 30 days to avoid this ambiguity.
  - `required = Math.ceil(target / months)` uses **ceiling** rounding. The PRD
    is silent on rounding direction. Choose oracle numbers where `target/months`
    is an exact integer so the assertion tests the *formula*, not the rounding.
  - There is **no "already-saved" field** on a goal (only `target_amount` +
    `target_date`), so required saving is the *full* target / months — confirmed
    from the data model (history below).

### Risk #1 Oracle — hand-worked example (derived from PRD, not code)

PRD §Business Logic ([prd.md:101-114](context/foundation/prd.md#L101-L114)):
surplus = income − spend; required = additional monthly saving to hit the goal
within its timeframe; rank categories highest→lowest; surface the minimum set of
cuts that closes the gap. US-01 AC
([prd.md:50-53](context/foundation/prd.md#L50-L53)): "Suggestions are
mathematically correct relative to the goal target and timeframe."

**Worked scenario** (all derived by hand from the rule above):

| Input | Value |
|-------|-------|
| Income (1 salary txn, `type: income`) | $4,000.00 = `400000`¢ |
| Expense — Dining | $800.00 = `80000`¢ |
| Expense — Shopping | $500.00 = `50000`¢ |
| Expense — Groceries | $400.00 = `40000`¢ |
| Expense — Transport | $200.00 = `20000`¢ |
| Goal target | $15,000.00 = `1500000`¢ |
| Goal timeframe | 5 months (target_date = today + 150 days) |

Hand-derivation (PRD rule → arithmetic, **no code consulted**):
- total expense = 80000+50000+40000+20000 = `190000`¢ ($1,900)
- surplus = 400000 − 190000 = **`210000`¢** ($2,100/mo)
- required monthly saving = 1,500,000 / 5 = **`300000`¢** ($3,000/mo)
- gap = 300000 − 210000 = **`90000`¢** ($900) to find via cuts
- rank desc: Dining(80000) > Shopping(50000) > Groceries(40000) > Transport(20000)
- minimum cuts to close $900: cut Dining fully ($800) → $100 left; cut Shopping
  $100 → gap closed. Groceries & Transport untouched.

**Expected output (the oracle):**
```
monthlyIncomeCents: 400000
goals[0].currentSurplusCents: 210000
goals[0].requiredMonthlySavingCents: 300000
goals[0].isOnTrack: false
goals[0].isExpired: false
goals[0].suggestions: [
  { categorySlug: "dining",   estimatedSavingCents: 80000 },  // $800.00
  { categorySlug: "shopping", estimatedSavingCents: 10000 },  // $100.00
]
// Σ suggestions == 90000 == gap; exactly 2 cuts (minimum set)
```

**Second behavioral scenario — "on track, no cuts"** (proves the lower bound of
"minimum set of cuts"): same income/expenses, but an easy goal — target
$5,000 = `500000`¢ over 5 months → required = `100000`¢ < surplus `210000`¢ →
gap = 0 → `isOnTrack: true`, `suggestions: []`. This is an edge case, not a
happy path, and catches a regression where the greedy walk emits cuts even when
the surplus already covers the goal.

> Oracle-mirror guard: the numbers above were produced by applying the PRD
> formula to chosen inputs and doing the arithmetic. They were **not** lifted
> from a code run. They match the current implementation because the code is
> correct — that is the point of a regression test.

### Risk #2 Oracle — degenerate inputs and the NaN/Infinity invariant

**The defensible, source-derived oracle**: for every degenerate input, every
numeric field in the output is a **finite number** (`Number.isFinite(x) ===
true`) — never `NaN`/`Infinity`. This comes from the change intent ("never
NaN/Infinity reaching the UI"), not from the implementation, so it is not an
oracle-mirror.

**Reachability matters.** A goal is created with a strictly-future date and a
positive amount (API zod refine,
[api/goals.ts:9-24](src/pages/api/goals.ts#L9-L24)), so the degenerate inputs
arise by a goal **aging past its date**, not at creation. Behavior today:

| Degenerate input | Code path | Result today | Finite? |
|------------------|-----------|--------------|---------|
| `target_date == today` (timeframe 0) | `months = max(1, ceil(0/30)) = 1` ([:25](src/lib/services/recommendations.ts#L25)) | required = full target; `isExpired` may be false | ✅ guarded |
| `target_date < today` (past) | `months = max(1, ceil(negative)) = 1`; `isExpired = true` ([:92](src/lib/services/recommendations.ts#L92)) | required = full target; aggressive non-empty suggestions | ✅ guarded |
| surplus ≤ 0 **with income > 0** | `gap = max(0, required − negativeSurplus)` ([:95](src/lib/services/recommendations.ts#L95)) | larger gap, finite, non-empty suggestions | ✅ guarded |
| surplus ≤ 0 **because income == 0** | `hasMissingIncome` short-circuit ([:51,99](src/lib/services/recommendations.ts#L51)) | `suggestions: []`, `alerts: []` (the only "empty/sentinel" case) | ✅ guarded |

So the three *named* inputs are **already finite** → those assertions go green
and lock the `max(1,…)`/`max(0,…)` guards against future removal.

**The genuinely unguarded NaN vector** (out-of-contract input): a malformed
`target_date` string. `toDateOnly`
([recommendations.ts:16-19](src/lib/services/recommendations.ts#L16-L19)) does
`new Date(year, month-1, day)` with no validity check; a non-numeric string →
`Invalid Date` → `getTime()` is `NaN` → `diffDays` `NaN` → `Math.max(1, NaN)` is
`NaN` → `requiredMonthlySavingCents` `NaN` → `gap = Math.max(0, NaN)` is `NaN` →
the greedy loop pushes `estimatedSavingCents: NaN` → renders `$NaN` (formatter
below). This **cannot** occur from the DB (`date NOT NULL`) or the API (regex +
validity refine), so it is reachable only by a caller passing bad data — exactly
what a unit test does. Asserting "finite even here" would be a **red** test
requiring a defensive guard the code lacks today.

**Render path confirms the stakes** —
[RecommendationsPanel.tsx:9-11](src/components/RecommendationsPanel.tsx#L9-L11):
```ts
function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
```
`toLocaleString` does **not** sanitize: `NaN → "$NaN"`, `Infinity → "$∞"`. The
result flows service → `recommendations.astro`
([:26,97](src/pages/recommendations.astro#L26)) → `<RecommendationsPanel
result={...} client:load />` unchanged, so any non-finite cent value reaches the
user verbatim. This is the concrete "renders straight to the UI" failure mode
from `lessons.md`.

### Runner / CI bootstrap state (Vitest hypothesis — CONFIRMED)

- **Zero test base** ([package.json](package.json)): no `test` script; no
  `vitest`/`jest`/`@testing-library/*`/`jsdom`/`happy-dom`; no `*.test.*`,
  `*.spec.*`, `vitest.config.*`, `vite.config.*`, or `__tests__/` anywhere.
  Astro `^6.3.1`, React `^19.2.6`, TypeScript `^5.9.3`, Node `22.14.0`
  ([.nvmrc](.nvmrc)). `package.json` already has `"overrides": { "vite":
  "^7.3.2" }`.
- **CI** ([.github/workflows/ci.yml](.github/workflows/ci.yml)): steps are
  `npm ci` → `npx astro sync` → `npm run lint` → `npm run build` (build gets
  `SUPABASE_URL`/`SUPABASE_KEY`). A unit-test step slots **after `npm run lint`,
  before `npm run build`** (fail fast on logic before the heavier build). Pure
  cut-math tests need **no** Supabase secrets.
- **Alias** ([tsconfig.json](tsconfig.json)): `@/*` → `./src/*`. The engine
  imports `@/types`, so the runner must resolve this. `astro.config.mjs` defines
  the alias only in tsconfig (not in the `vite` block), so a bare Vitest config
  will **not** auto-resolve `@/*` — wire it explicitly (see below).
- **ESLint** ([eslint.config.js](eslint.config.js)): `*.test.ts(x)` already
  matches the `**/*.{js,jsx,ts,tsx}` glob; no test override exists. Prefer
  **explicit imports** (`import { describe, it, expect, vi } from "vitest"`)
  over globals so no ESLint env/`types` change is needed.

### Recommended Vitest setup (grounded via web search — see §Stack note)

Astro 6 is Vite-based; the conventional runner is Vitest. Two viable configs:

1. **`getViteConfig` from `astro/config`** — replays the Astro/Vite setup into
   the test env; heavier (loads the Astro config) and not required for a pure
   function that never touches the Astro runtime.
2. **Plain `defineConfig` from `vitest/config` + explicit `@/*` resolution** —
   lighter, deterministic, sufficient for Phase 1. Resolve the alias with either
   `vite-tsconfig-paths` (reads `tsconfig.json` automatically) or a manual
   `resolve.alias` mapping `@` → `./src`.

For Phase 1 (pure cut-math), option 2 with `test.environment: 'node'` is the
cheapest real signal. jsdom/happy-dom are **not** needed (no DOM). Add scripts
`"test": "vitest run"` and `"test:watch": "vitest"`; CI runs `npm run test`.
Time control via `vi.useFakeTimers()` / `vi.setSystemTime(...)` /
`vi.useRealTimers()` is mandatory given the `new Date()` coupling above.

*(The plan/implement phase confirms exact package versions and the alias
mechanism; this research fixes the shape, not the lockfile.)*

## Code References

- `src/lib/services/recommendations.ts:34-132` — `computeRecommendations`, the unit under test
- `src/lib/services/recommendations.ts:38-45` — `new Date()` + 30-day window filter (time coupling)
- `src/lib/services/recommendations.ts:16-26` — `toDateOnly` (no validity guard) + `monthsRemaining` (`max(1,…)`)
- `src/lib/services/recommendations.ts:88-111` — sort desc + greedy cut allocation (ranking + minimum-set)
- `src/lib/services/recommendations.ts:94-96` — required/gap/on-track arithmetic
- `src/lib/services/recommendations.ts:11,70-85` — `ALERT_INCOME_FRACTION = 0.12` (Phase 4, NOT this phase)
- `src/components/RecommendationsPanel.tsx:9-11` — `formatCents` renders NaN/∞ literally
- `src/pages/recommendations.astro:26,97` — service → page → React island wiring
- `src/pages/api/goals.ts:9-24` — zod guards (positive amount, strictly-future date)
- `src/types.ts:29-39,41-77` — `SavingsGoal`, `Suggestion`, `SpendingAlert`, `GoalRecommendation`, `RecommendationsResult`
- `package.json`, `.github/workflows/ci.yml`, `tsconfig.json`, `astro.config.mjs`, `eslint.config.js`, `.nvmrc` — bootstrap surface

## Architecture Insights

- **Cents everywhere; divide by 100 only at display.** The engine and types are
  integer cents; the only `/100` is in `formatCents`. Oracles must be in cents.
- **Time is an implicit dependency.** The engine reads the wall clock instead of
  taking an injected `now`. This is the root testability friction and a latent
  design smell — a `now` parameter would make it fully pure. Phase 1 works
  around it with fake timers rather than refactoring (refactor is out of scope).
- **Guards are floor-based, not validation-based.** `max(1,…)`/`max(0,…)` clamp
  *numeric* degeneracy but assume *well-typed* inputs. Input validity is pushed
  entirely to the DB type + API zod; the pure function trusts its callers.
- **Alert threshold (0.12) is an unresolved oracle (PRD Open Q2)** → Phase 4.
  Do **not** assert alert amounts/threshold in Phase 1; that would oracle-mirror
  an undefined spec.

## Historical Context (from prior changes)

- `context/archive/2026-06-02-create-savings-goal/plan.md` — goal model:
  `target_amount` integer cents + `target_date` ISO date; **no months/timeframe
  column** and **no already-saved field**. 3-goal cap enforced by a DB
  `BEFORE INSERT` trigger and mapped to a 409 at the API.
- `context/changes/goal-anchored-recommendations/plan.md:57-72` — the algorithm
  spec the engine implements; `:81` documents the intentional choice "expired
  goal → `months_remaining = 1` → most aggressive saving — **signals urgency**"
  and "(net-negative surplus) accepted for MVP". `:317` sketches a worked
  scenario but records **no numeric expected-output table** (this doc supplies
  one). `:306` confirms "no test runner is configured … verification was a
  temporary scratch file."
- `context/changes/data-schema-foundation/plan.md:87-129` — transactions
  (`type` distinguishes income/expense; amounts positive cents), categories
  (11 seeded slugs incl. `groceries, dining, transport, shopping, other`),
  nullable `category_id` bucketed as `other`/"Other".
- `context/foundation/lessons.md` — render-to-UI failure mode and SSR try/catch
  prior burn (the Risk #2 surface).
- **No `research.md` exists for any prior change** — the oracle is assembled
  from the PRD + plans, exactly as done here.

## Related Research

- None — this is the first `research.md` in `context/`. Future Phase 2
  (wedge-math contract) and Phase 4 (threshold oracle) research should link back
  here for the formula chain and the time-coupling constraint.

## Open Questions

1. **(Blocking the *shape* of the Risk #2 assertion) What is the correct
   guarded result for an expired / past-date goal?** The change intent says
   "empty/sentinel"; the shipped design deliberately returns non-empty,
   maximally-aggressive suggestions (`months→1`, "signals urgency",
   `goal-anchored-recommendations/plan.md:81`). The PRD does not say. The
   **finiteness invariant** can be asserted now regardless; the shape (empty vs
   aggressive) cannot. **Recommend: confirm with the product owner.** Default if
   unresolved: assert only finiteness + `isExpired === true` for Phase 1, defer
   the shape assertion to Phase 2.
2. **(Scope) Does Phase 1 assert only the reachable green guards, or also the
   out-of-contract malformed-`target_date` NaN cascade (a red test needing a new
   guard)?** The latter is a real defect-in-depth gap but adds a code change to a
   "bootstrap + first wedge" phase. **Recommend: Phase 1 asserts the reachable
   guards (green, regression lock); log the malformed-date NaN cascade as a
   finding for Phase 2's contract coverage** rather than fixing it here.
3. **(Confirm in plan) Alias mechanism** — `vite-tsconfig-paths` vs manual
   `resolve.alias`? Both work; pick one in the plan so the implement phase has a
   single answer.

## Stack note (web-sourced, checked 2026-06-22)

Vitest + Astro/TypeScript path-alias setup confirmed against current docs:
- [Testing — Astro Docs](https://docs.astro.build/en/guides/testing/) — `getViteConfig` helper for Vitest
- [Configuring Vitest](https://vitest.dev/config/) — `environment`, `setupFiles`, `include`/`exclude`
- [Setting Up Vitest to Support TypeScript Path Aliases — Tim Santeford](https://www.timsanteford.com/posts/setting-up-vitest-to-support-typescript-path-aliases/) — `vite-tsconfig-paths`
- [Vitest + Astro/React workspace — raphberube.com](https://raphberube.com/technotes/vitest-setup-astro-react/)
