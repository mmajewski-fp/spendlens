# Wedge-math Contract Implementation Plan

## Overview

Upgrade Phase 1's single-scenario wedge into a full parameterized contract over
`computeRecommendations` (`src/lib/services/recommendations.ts`), covering Risk
#1 (amounts correct vs target/timeframe), Risk #2 (degenerate-input guards), and
the new Risk #3 (cut ranking highest→lowest with a defined tie-break). Every
oracle value comes from `research.md` (PRD/domain), never from the
implementation. Exactly one production change — a deterministic alphabetical
tie-break — done test-first and isolated. A closing local-only Stryker pass
validates the contract isn't vibe-tests.

## Current State Analysis

- **Engine is pure and already unit-tested** at the wedge level. Phase 1
  installed Vitest 3.2 (node env, `@/*` via `vite-tsconfig-paths`, `TZ=UTC`
  pinned in **both** `vitest.config.ts` `test.env` and the npm scripts), a CI
  test step, and `src/lib/services/recommendations.test.ts` with fixture
  factories (`income`/`expense`/`makeGoal`) and a frozen-clock
  (`vi.setSystemTime("2026-06-01T00:00:00Z")`) pattern.
- **Behavioral catalog** (from research, exact refs):
  ranking sort single-key `b.totalCents - a.totalCents`
  ([recommendations.ts:88](src/lib/services/recommendations.ts#L88), **no
  tie-break**); 5-cap greedy ([:98-111](src/lib/services/recommendations.ts#L98-L111));
  30-day window `>=` inclusive ([:40-45](src/lib/services/recommendations.ts#L40-L45));
  bucket key = `category_id`, null → `Other`/`other`
  ([:57-68](src/lib/services/recommendations.ts#L57-L68)); per-goal independent
  map preserving input order ([:90](src/lib/services/recommendations.ts#L90));
  `isExpired = targetDate < today` strict ([:92](src/lib/services/recommendations.ts#L92)).
- **All four deferred oracle questions are resolved** (research §"Oracle
  resolution table"): ranking key = spend desc (PRD); rounding = `ceil`
  (domain); 5-cap + minimum-set (design+PRD); multi-goal independent (PRD);
  expired-goal = ratify shipped (aggressive + `isExpired`); tie-break =
  alphabetical (decided); malformed date = out-of-contract (decided).

## Desired End State

`npm run test` runs a parameterized suite (one `recommendations.test.ts`, a
describe block per risk) that pins: correct amounts incl. rounding/window/
null-category/multi-goal; the four degenerate guards with the ratified
expired-goal shape; strict highest→lowest ranking with a deterministic
alphabetical tie-break (backed by a one-line comparator change); and the 5-cap.
A local Stryker run on `recommendations.ts` shows surviving mutants triaged.
Verify with `npm run test` (green) and `npx stryker run --mutate
"src/lib/services/recommendations.ts"` (report produced, survivors triaged).

### Key Discoveries:

- The tie-break is the **only** production change and the **only** red→green in
  this plan; everything else asserts already-correct behavior (regression locks).
- `categories.slug` is **unique** (data-schema), so `category_id ↔ slug` is 1:1
  — "two category_ids sharing a slug" is impossible in valid data and is NOT
  tested (out-of-contract), despite the bucket key being `category_id`.
- Stryker spawns Vitest **directly** (not via the npm script), so the `TZ=UTC`
  pin in `vitest.config.ts` `test.env` (added by Phase-1 impl-review F1) is what
  keeps mutation runs deterministic. This is why F1 mattered.
- The existing `expense(slug, …)` factory derives `category_id` from the slug;
  the null-category and multi-bucket cases need a small inline-transaction
  variant (explicit `category_id: null`).

## What We're NOT Doing

- **No alerts / threshold assertions** — the `0.12` fraction is PRD Open Q2
  (undefined oracle), routed to rollout Phase 4. Never oracle-mirror it.
- **No malformed-`target_date` test or guard** — out-of-contract (DB `date NOT
  NULL` + API zod regex+future-refine). The Phase-1 `it.todo` is *retired* into
  a documenting comment, not turned into a test or a production guard.
- **No two-`category_id`s-same-slug test** — impossible (unique slug constraint).
- **No empty/sentinel change for expired goals** — we ratify the shipped
  aggressive-cuts design instead (research decision D).
- **No non-finite / negative-amount input tests** — `amount` is "always
  positive" integer cents per `src/types.ts:13`; out-of-contract.
- **No CI mutation gate** — Stryker is local-only, selective, run once here.
- **No data-tier work** (ownership isolation, 3-goal cap) — rollout Phase 3.
- **No engine change beyond the tie-break secondary key.**

## Critical Implementation Details

- **Determinism.** Keep the frozen clock + `TZ=UTC`. Choose `months` as exact
  30-day multiples via `target_date = today + 30·N days` (e.g. the rounding case
  uses today + 90 days → exactly 3 months under UTC; `⌈100000/3⌉ = 33334`).
- **The tie-break test must distinguish the new key from insertion order.**
  Insert the two equal-total categories in **reverse-alphabetical transaction
  order** (e.g. a "Dining" txn *before* an "Apparel" txn, both 50000). Against
  current code the suggestion order is `[dining, apparel]` (insertion order) —
  the test asserts `[apparel, dining]`, so it is genuinely red until the
  secondary key lands, and not vacuously green.
- **Stryker ↔ Vitest.** Stryker runs Vitest directly; rely on the config-level
  `TZ=UTC`, not the npm script. Use the Vitest test-runner plugin.

## Phase 1: Risk #1 — Amounts & Coverage Edges

### Overview

Parameterized coverage of the amount math beyond Phase 1's canonical scenario:
rounding, the 30-day window boundary, null-category bucketing, and multi-goal
independence. All assertions are green against current code (regression locks).

### Changes Required:

#### 1. Risk #1 parameterized tests

**File**: `src/lib/services/recommendations.test.ts`

**Intent**: Add a `describe("Risk #1: amounts")` block extending the existing
fixtures/clock, asserting oracle values from `research.md` (PRD/domain-derived,
not code). Add a small inline-transaction helper where `category_id: null` is
needed (the `expense()` factory derives `category_id` from the slug).

**Contract**: New tests assert, under the frozen UTC clock:
- **Rounding**: goal `target_amount 100000`, `target_date = today + 90 days`
  (→ 3 months) ⇒ `goals[0].requiredMonthlySavingCents === 33334` (`⌈100000/3⌉`;
  round-down 33333 × 3 = 99999 falls short, so `ceil` is the oracle).
- **Window boundary**: an `income` txn dated exactly `today − 30 days`
  (`2026-05-02`) is counted; an `expense` dated `today − 31 days` (`2026-05-01`)
  is excluded ⇒ assert `monthlyIncomeCents` includes the former and the latter
  contributes to neither surplus nor any bucket.
- **Null-category**: an expense with `category_id: null` (and `category: null`)
  surfaces as a suggestion with `categorySlug: "other"`, `categoryName: "Other"`.
- **Multi-goal independence**: two goals (input order A, B; differing
  targets/timeframes) ⇒ `result.goals` is `[A, B]` and each goal's `suggestions`
  reflect its own gap (proving independence; same shared spend pool).

### Success Criteria:

#### Automated Verification:

- All Risk #1 tests pass: `npm run test`
- Lint passes: `npm run lint`

#### Manual Verification:

- The rounding/window/null-category/multi-goal expected values trace to the
  `research.md` coverage matrix (oracle from PRD/domain, not lifted from code)

**Implementation Note**: After automated verification passes, pause for human
confirmation of the oracle-provenance check before Phase 2.

---

## Phase 2: Risk #2 — Degenerate-Input Contract

### Overview

Parameterize the four reachable degenerate inputs, ratify the expired-goal
shape, and retire the Phase-1 malformed-date `it.todo`.

### Changes Required:

#### 1. Parameterized degenerate-input cases

**File**: `src/lib/services/recommendations.test.ts`

**Intent**: Convert the Phase-1 degenerate cases into a parameterized
(`it.each`) `describe("Risk #2: degenerate guards")` block; every case asserts
the finiteness invariant (reuse `expectAllFieldsFinite` + the
`expect(result.goals.length).toBe(1)` guard from Phase-1 impl-review F2) plus its
case-specific expectation.

**Contract**: Cases — timeframe-0 (`target_date == today`, `isExpired===false`);
**past-date (ratify shipped): `isExpired===true` AND `suggestions` non-empty
(aggressive, months→1) when a gap exists**; ≤0-surplus-with-income
(`hasMissingIncome===false`, negative `currentSurplusCents` finite);
missing-income (`hasMissingIncome===true`, `suggestions: []`, `alerts: []`).

#### 2. Retire the malformed-date `it.todo`

**File**: `src/lib/services/recommendations.test.ts`

**Intent**: Resolve the Phase-1 `it.todo` as won't-fix per research decision G —
the input is out-of-contract.

**Contract**: Remove the `it.todo("malformed target_date …")` and replace it with
a plain comment documenting why it is out-of-contract (DB `date NOT NULL` + API
zod regex + future-date refine guarantee a valid ISO date upstream; the engine
trusts its callers). No test, no production guard.

### Success Criteria:

#### Automated Verification:

- All Risk #2 parameterized cases pass: `npm run test`
- The `it.todo` is gone, replaced by a documenting comment: `grep -n "it.todo" src/lib/services/recommendations.test.ts` returns nothing
- Lint passes: `npm run lint`

#### Manual Verification:

- The past-date case asserts the ratified shipped shape (isExpired + aggressive cuts), matching research decision D — not "empty/sentinel"

**Implementation Note**: Pause for human confirmation before Phase 3.

---

## Phase 3: Risk #3 — Ranking Order & Cap

### Overview

Assert the PRD ranking rule (highest-impact → lowest), the minimum-set property,
and the 5-cap. All green against current code (distinct totals → tie-break not
exercised here).

### Changes Required:

#### 1. Ranking, minimum-set, and 5-cap tests

**File**: `src/lib/services/recommendations.test.ts`

**Intent**: Add a `describe("Risk #3: ranking")` block asserting order and the
cap as PRD-derived properties — **not** by quoting the comparator.

**Contract**:
- **Strict order**: distinct spends A>B>C with a gap requiring all three ⇒
  `suggestions` slugs in `[A, B, C]` (highest-impact first).
- **Minimum set**: cuts sum exactly to the gap and the walk stops early; lower
  categories beyond the gap are untouched (`suggestions.length` < category count).
- **5-cap**: six distinct-spend categories with a gap unclosable in five ⇒
  `suggestions.length === 5`, the five are the highest-spend categories, and the
  cut sum may be `< gap` (documented truncation, not a bug).

### Success Criteria:

#### Automated Verification:

- Ranking / minimum-set / 5-cap tests pass: `npm run test`
- Lint passes: `npm run lint`

#### Manual Verification:

- Ordering assertions express the PRD "highest-impact → lowest" rule, not the implementation's comparator expression
- The 5-cap "gap may remain open" behavior is asserted as documented (not flagged as a bug)

**Implementation Note**: Pause for human confirmation before Phase 4.

---

## Phase 4: Risk #3 — Deterministic Tie-break (TDD red→green)

### Overview

The one production change: add a deterministic alphabetical tie-break so
equal-total categories order predictably. Test-first — write the failing
assertion, then the minimal comparator change. Recommended executor: `/10x-tdd`.

### Changes Required:

#### 1. Failing tie-break test (RED)

**File**: `src/lib/services/recommendations.test.ts`

**Intent**: Assert the alphabetical tie-break before the code supports it.

**Contract**: Two equal-total categories (both `50000`), their transactions
inserted in **reverse-alphabetical order** ("Dining" before "Apparel"), gap large
enough to cut both ⇒ assert `suggestions` slugs are `["apparel", "dining"]`.
Fails against current insertion-order code (`["dining", "apparel"]`).

#### 2. Comparator secondary key (GREEN)

**File**: `src/lib/services/recommendations.ts`

**Intent**: Make the sort deterministic and user-meaningful via a secondary key;
the minimal change to green the test.

**Contract**: Extend the sort at line 88 with `categoryName` then `categorySlug`
tiebreakers (signature/order other tests depend on):

```ts
const sortedBuckets = [...buckets.values()].sort(
  (a, b) =>
    b.totalCents - a.totalCents ||
    a.name.localeCompare(b.name) ||
    a.slug.localeCompare(b.slug),
);
```

### Success Criteria:

#### Automated Verification:

- The tie-break test is RED before the comparator change, GREEN after (demonstrate the red first): `npm run test`
- Full suite green, including the Phase-1 canonical scenario (distinct totals, unaffected): `npm run test`
- Lint passes: `npm run lint`

#### Manual Verification:

- The tie-break fixture inserts equal-total categories in reverse-alphabetical order (proves the assertion isn't vacuously green on insertion order)
- The comparator change is minimal — secondary key only, no other behavior touched

**Implementation Note**: Pause for human confirmation before Phase 5.

---

## Phase 5: Mutation Triage (Stryker, local-only)

### Overview

Run Stryker once, narrow-scoped to `recommendations.ts`, to verify the contract
actually kills mutants. Selective, local-only — not a CI gate, not a coverage chase.

### Changes Required:

#### 1. Stryker dev deps + config

**File**: `package.json`, `stryker.conf.json` (new)

**Intent**: Add Stryker with the Vitest runner, scoped to the cut-math module.

**Contract**: Add devDeps `@stryker-mutator/core` + `@stryker-mutator/vitest-runner`.
Config sets `testRunner: "vitest"`, `mutate: ["src/lib/services/recommendations.ts"]`,
HTML + clear-text reporters. (Relies on the `TZ=UTC` pin in `vitest.config.ts`,
since Stryker invokes Vitest directly.)

#### 2. Triage survived mutants

**File**: `src/lib/services/recommendations.test.ts` (assertions as needed)

**Intent**: For each survivor, ask "would this change hurt a user/the business?"
Yes → add an assertion that kills it. No (equivalent/cosmetic) → ignore
consciously and note it. Do not chase 100%.

**Contract**: New assertions (if any) target user-meaningful mutants only; a short
note records consciously-ignored equivalent mutants.

### Success Criteria:

#### Automated Verification:

- Stryker dev deps install cleanly: `npm install`
- Stryker runs and produces a report: `npx stryker run --mutate "src/lib/services/recommendations.ts"`
- Full unit suite still green: `npm run test`
- Lint passes: `npm run lint`

#### Manual Verification:

- Survived mutants triaged; user-meaningful ones killed with new assertions; equivalent/cosmetic ones consciously ignored and documented
- No CI mutation gate was added; Stryker remains local-only and selective

**Implementation Note**: Final phase — after automated verification and triage, pause for human confirmation before closing the change.

---

## Testing Strategy

### Unit Tests:

- Risk #1: rounding (`ceil`), 30-day window boundary, null-category bucketing, multi-goal independence (+ Phase-1 canonical & on-track retained)
- Risk #2: parameterized timeframe-0 / past-date(ratified) / ≤0-surplus / missing-income; finiteness invariant
- Risk #3: strict highest→lowest order, minimum-set, 5-cap truncation, alphabetical tie-break

### Integration Tests:

- None (data-tier isolation + 3-goal cap are rollout Phase 3).

### Manual Testing Steps:

1. Confirm Phase-4 tie-break test fails before the comparator change, passes after.
2. Cross-check Phase-1/2/3 expected values against `research.md` coverage matrix.
3. Open the Stryker HTML report; confirm survivors are either killed or consciously ignored.

## Performance Considerations

Negligible for the unit suite. Stryker is heavier (mutates + re-runs) but is a
one-time local action, narrow-scoped to a single file.

## Migration Notes

Additive except the one-line comparator change at `recommendations.ts:88` (adds
tiebreakers; cannot alter any distinct-total ordering). Rollback = revert the
commit(s).

## References

- Research: `context/changes/wedge-math-contract/research.md`
- Phase 1 (archived): `context/archive/2026-06-22-testing-runner-bootstrap-wedge/` (runner, fixtures, frozen-clock, TZ=UTC, impl-review F1/F2)
- Engine: `src/lib/services/recommendations.ts` (sort `:88`, greedy/cap `:98-111`, window `:40-45`, bucketing `:57-68`)
- Oracle source: `context/foundation/prd.md:101-114` (§Business Logic), `:43-53` (US-01 AC)
- Test-plan: `context/foundation/test-plan.md` §2 (Risks #1/#2/#3), §3 (Phase 2), §5 (Stryker optional after Phase 2)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Risk #1 — Amounts & Coverage Edges

#### Automated

- [x] 1.1 All Risk #1 tests pass: `npm run test` — 375485a
- [x] 1.2 Lint passes: `npm run lint` — 375485a

#### Manual

- [ ] 1.3 Rounding/window/null-category/multi-goal expected values trace to the research.md matrix (oracle from PRD/domain)

### Phase 2: Risk #2 — Degenerate-Input Contract

#### Automated

- [x] 2.1 All Risk #2 parameterized cases pass: `npm run test` — b471d7e
- [x] 2.2 The `it.todo` is gone, replaced by a documenting comment (`grep` returns nothing) — b471d7e
- [x] 2.3 Lint passes: `npm run lint` — b471d7e

#### Manual

- [ ] 2.4 Past-date case asserts the ratified shipped shape (isExpired + aggressive cuts), not empty/sentinel

### Phase 3: Risk #3 — Ranking Order & Cap

#### Automated

- [x] 3.1 Ranking / minimum-set / 5-cap tests pass: `npm run test` — c9f669a
- [x] 3.2 Lint passes: `npm run lint` — c9f669a

#### Manual

- [ ] 3.3 Ordering asserts the PRD highest→lowest rule (not the comparator); 5-cap truncation asserted as documented

### Phase 4: Risk #3 — Deterministic Tie-break (TDD red→green)

#### Automated

- [x] 4.1 Tie-break test RED before the comparator change, GREEN after: `npm run test`
- [x] 4.2 Full suite green incl. Phase-1 canonical (distinct totals unaffected): `npm run test`
- [x] 4.3 Lint passes: `npm run lint`

#### Manual

- [ ] 4.4 Tie-break fixture inserts equal-total categories in reverse-alphabetical order (not vacuously green)
- [ ] 4.5 Comparator change is minimal — secondary key only

### Phase 5: Mutation Triage (Stryker, local-only)

#### Automated

- [ ] 5.1 Stryker dev deps install cleanly: `npm install`
- [ ] 5.2 Stryker runs and produces a report: `npx stryker run --mutate "src/lib/services/recommendations.ts"`
- [ ] 5.3 Full unit suite still green: `npm run test`
- [ ] 5.4 Lint passes: `npm run lint`

#### Manual

- [ ] 5.5 Survived mutants triaged — user-meaningful killed, equivalent/cosmetic consciously ignored and documented
- [ ] 5.6 No CI mutation gate added; Stryker remains local-only
