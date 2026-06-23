---
date: 2026-06-23T07:13:30+0000
researcher: Michał Majewski
git_commit: 5c16c04869de62ff05e032992c1e34c2f6dbc6a6
branch: main
repository: spendlens
topic: "Phase 2 — Wedge-math contract: full coverage of amounts (#1), degenerate guards (#2), ranking (#3) + oracle resolution"
tags: [research, codebase, recommendations, cut-math, ranking, tie-break, oracle]
status: complete
last_updated: 2026-06-23
last_updated_by: Michał Majewski
---

# Research: Phase 2 — Wedge-math contract (Risks #1, #2, #3)

**Date**: 2026-06-23T07:13:30+0000
**Researcher**: Michał Majewski
**Git Commit**: 5c16c04869de62ff05e032992c1e34c2f6dbc6a6
**Branch**: main
**Repository**: spendlens (github.com/mmajewski-fp/spendlens)

## Research Question

Rollout Phase 2 of `context/foundation/test-plan.md`: "Wedge-math contract" —
upgrade Phase 1's single-scenario wedge to **full behavioral coverage** of
`computeRecommendations`, covering Risk #1 (amounts correct vs target/timeframe),
Risk #2 (degenerate-input guards), and the new **Risk #3 (cut ranking order
highest-impact → lowest, with a defined tie-break)** — and resolve the four
oracle questions Phase 1 deferred so every assertion has a source-grounded
expected value (no oracle-mirror).

## Summary

The engine is already fully unit-testable (pure data-in/data-out, time
controlled via the Phase-1 `vi.setSystemTime` + `TZ=UTC` scaffolding). All four
deferred oracle questions are now resolved — three from sources/domain, and
three product/design decisions taken this session:

- **Ranking key (#3)** — DEFINED by PRD §Business Logic ("ranks expense
  categories by the reduction amount needed, from highest-impact to lowest").
  Highest reduction-potential = highest category spend, so the oracle is
  *order by total category spend, descending*. Assert the **PRD rule**, never
  the code's `b.totalCents - a.totalCents` comparator.
- **Rounding** — resolved from domain: "reach the goal within its timeframe"
  ⇒ the monthly saving must not fall short ⇒ `Math.ceil`. Rounding *down* would
  provably miss the target. Assert `ceil` with a rounding-sensitive example.
- **5-cap & minimum-set** — DEFINED: cap = 5 (design doc, "beyond 5 the list
  becomes noise"); "minimum set of cuts that close the gap" (PRD). Assert both.
- **Multi-goal** — DEFINED (PRD FR-007/FR-010): per-goal, independent, output
  order = `created_at ASC` (engine preserves input order).
- **Decision — expired/past-date goal**: **ratify the shipped design** — assert
  `isExpired === true` AND suggestions are still computed (months floored to 1
  → aggressive cuts). Oracle source = the documented Key Decision in
  `goal-anchored-recommendations/plan-brief.md` ("show Expired badge, keep
  suggestions — user still owns the goal"). **No production change.**
- **Decision — tie-break**: **add a deterministic alphabetical tie-break**
  (secondary sort key: `categoryName`, then `categorySlug`) to the comparator,
  and assert it. This is a **small production change** (the test-plan Risk #3
  explicitly requires "a defined tie-break"; the current incidental insertion
  order must not be the oracle).
- **Decision — malformed `target_date`**: **keep out-of-contract**. The input is
  unreachable in production (DB `date NOT NULL` + API zod regex + future-refine).
  Document the guarantee and **resolve the Phase-1 `it.todo` as won't-fix** (no
  guard, no assertion). The only NaN→UI vector stays closed by the upstream
  contract, not by an engine guard.
- **Excluded**: excessive-spending alert threshold (`0.12`) — PRD Open Q2,
  routed to rollout Phase 4. Do **not** assert alerts.

**Net for the plan:** one production change (the tie-break secondary key), one
doc-only resolution (the malformed-date `it.todo`), and a parameterized test
suite covering the matrix in §"Coverage matrix" below. The Phase-1 canonical
scenario has all-distinct totals, so the tie-break change cannot break it.

## Detailed Findings

### Engine behavioral catalog (live code, exact refs)

`computeRecommendations(transactions, goals)`
([recommendations.ts:34](src/lib/services/recommendations.ts#L34)) — pure;
reads the wall clock at [:38](src/lib/services/recommendations.ts#L38)
(controlled in tests by fake timers + `TZ=UTC`).

- **Ranking sort** ([:88](src/lib/services/recommendations.ts#L88)):
  `[...buckets.values()].sort((a, b) => b.totalCents - a.totalCents)` — a
  **single-key** sort (total spend desc), **no tie-break**. Equal totals fall
  back to JS stable-sort = `Map` insertion order = first-seen transaction order
  ([:57-68](src/lib/services/recommendations.ts#L57-L68)) — non-deterministic
  from the user's perspective. *(This phase adds the secondary key.)*
- **Greedy allocation + 5-cap** ([:98-111](src/lib/services/recommendations.ts#L98-L111)):
  `MAX_SUGGESTIONS = 5` ([:12](src/lib/services/recommendations.ts#L12)); break
  on `remaining <= 0 || suggestions.length >= MAX_SUGGESTIONS`
  ([:102](src/lib/services/recommendations.ts#L102)). Each cut =
  `min(bucket.totalCents, remaining)`. **If the gap cannot be closed within 5
  categories, it returns 5 partial cuts and the sum falls short of the gap**
  (remainder silently unallocated) — this is the documented "beyond 5 is noise"
  behavior, not a bug.
- **30-day window** ([:40-45](src/lib/services/recommendations.ts#L40-L45)):
  `d >= windowStart` — **inclusive**; `windowStart = today − 30·MS_PER_DAY`. A
  transaction dated exactly 30 days ago is **included**; 31 days ago is excluded.
- **Bucketing** ([:57-68](src/lib/services/recommendations.ts#L57-L68)): key =
  `t.category_id ?? "uncategorized"`; null category → name `"Other"`, slug
  `"other"`. **Bucket key is `category_id`, not slug** — two distinct
  `category_id`s sharing a slug produce **two** buckets.
- **Multi-goal** ([:90](src/lib/services/recommendations.ts#L90)): `goals.map(...)`
  preserves input order; `sortedBuckets` is computed once and read (not mutated)
  per goal; no cross-goal budget sharing → **independent** per goal.
- **isOnTrack** ([:96](src/lib/services/recommendations.ts#L96)):
  `!hasMissingIncome && gapCents === 0`. Suggestion loop guarded by
  `!isOnTrack && !hasMissingIncome` ([:99](src/lib/services/recommendations.ts#L99)).
- **isExpired** ([:92](src/lib/services/recommendations.ts#L92)):
  `targetDate < today` — **strict `<`** (target_date == today ⇒ not expired).

### Oracle resolution table

| # | Question | Verdict | Resolution for this phase |
|---|----------|---------|---------------------------|
| A | Ranking key | DEFINED (PRD) | Order by total category spend desc = "highest-impact". Assert the PRD rule. |
| B | Tie-break (equal totals) | SILENT → **decided** | Add alphabetical secondary key (`categoryName`, then `slug`); assert it. *(prod change)* |
| C | Rounding direction | SILENT → domain-resolved | `Math.ceil` (must not fall short to "reach the goal"). Assert with a fractional example. |
| D | Expired-goal shape | SILENT(PRD)+conflict → **decided** | Ratify shipped design: `isExpired=true` + aggressive cuts (months→1). *(no prod change)* |
| E | 5-suggestion cap | DEFINED (design doc) | Assert ≤5 and "minimum set / stop when gap closed". |
| F | Multi-goal independence | DEFINED (PRD) | Per-goal independent; output order = input (created_at ASC). |
| G | Malformed `target_date` | SILENT → **decided** | Keep out-of-contract; resolve `it.todo` as won't-fix (no guard, no assert). |
| H | Alert threshold (0.12) | EXCLUDED (PRD Open Q2) | Do not assert alerts — Phase 4. |

### Coverage matrix (parameterized, oracle hand-derived)

All amounts in integer cents; clock frozen at `2026-06-01T00:00:00Z`, fixtures
dated inside the 30-day window; `months` chosen as exact 30-day multiples under
`TZ=UTC` (e.g. `target_date` = today + 30·N days). Oracle values derived from
PRD arithmetic, **not** from the implementation.

**Risk #1 — amounts**
- *Canonical multi-cut* (reuse Phase 1): income 400000; Dining 80000, Shopping
  50000, Groceries 40000, Transport 20000; target 1500000 / 5 mo → surplus
  210000, required 300000, gap 90000 → `[dining 80000, shopping 10000]`.
- *On-track → no cuts* (reuse Phase 1): target 500000 / 5 mo → required 100000
  < surplus 210000 → `isOnTrack`, `suggestions: []`.
- *Rounding (ceil)*: target 100000 / 3 mo (target_date = today + 90 days) →
  `requiredMonthlySavingCents === 33334` (= ⌈100000/3⌉ = ⌈33333.33⌉). Round
  *down* (33333) would give 99999 over 3 mo — falls short, so ceil is the oracle.
- *Window boundary*: a txn dated exactly 30 days before "today" is counted
  (`>=`); a txn 31 days before is excluded (changes income/expense totals).
- *Null-category bucketing*: an expense with `category_id: null` is bucketed and
  can appear as a suggestion with `categorySlug "other"`, `categoryName "Other"`.
- *Two category_ids, same slug*: produce two separate suggestions (key is
  `category_id`).
- *Multi-goal*: two goals (input order A then B) → `result.goals` order is
  [A, B]; each goal's suggestions computed independently from the same spend.

**Risk #2 — degenerate guards** (all assert every numeric field `Number.isFinite`)
- *timeframe 0* (`target_date == today`): `isExpired === false`; finite.
- *past date* (`target_date < today`): **`isExpired === true` AND suggestions
  still computed** (months→1, aggressive — per the ratified design); finite,
  non-empty when a gap exists.
- *≤0 surplus with income present*: `hasMissingIncome === false`; finite;
  negative `currentSurplusCents` is finite.
- *missing income*: `hasMissingIncome === true`; `suggestions: []`; `alerts: []`.
- *(malformed `target_date`: out-of-contract — NOT tested; `it.todo` resolved as
  a documenting won't-fix comment citing the DB+API guarantee.)*

**Risk #3 — ranking**
- *Strict order*: distinct spends A>B>C, gap requiring all three →
  `suggestions` slugs in `[A, B, C]` order (highest-impact first).
- *Tie-break (new)*: two equal-total categories inserted in reverse-alphabetical
  transaction order (e.g. "Dining" txn before "Apparel" txn, both 50000), gap
  large enough to cut both → assert `Apparel` precedes `Dining` (alphabetical),
  proving the secondary key overrides insertion order.
- *Minimum set*: cuts sum exactly to the gap and stop early (don't over-cut);
  lower-impact categories untouched (covered by canonical).
- *5-cap*: 6 distinct categories, gap unclosable within 5 → `suggestions.length
  === 5`, and they are the 5 highest-spend categories (gap may remain open).

## Code References

- `src/lib/services/recommendations.ts:88` — ranking comparator (tie-break key to be added here)
- `src/lib/services/recommendations.ts:98-111` — greedy allocation + 5-cap
- `src/lib/services/recommendations.ts:40-45` — 30-day window (`>=`, inclusive)
- `src/lib/services/recommendations.ts:57-68` — bucketing (key = category_id; null → Other/other)
- `src/lib/services/recommendations.ts:90-124` — per-goal map (independent; order preserved)
- `src/lib/services/recommendations.ts:92,96` — isExpired (strict `<`), isOnTrack
- `src/types.ts:41-77` — Suggestion / SpendingAlert / GoalRecommendation / RecommendationsResult (docs: "max 5", "always > 0")
- `src/lib/services/recommendations.test.ts` — Phase-1 suite + fixture factories (income/expense/makeGoal) + frozen-clock pattern to extend
- `vitest.config.ts` / `package.json` — TZ=UTC pin + scripts (Phase 1)

## Architecture Insights

- **The oracle for #3 is the PRD rule, realized as spend-desc ordering.** PRD
  says "reduction amount needed, highest→lowest"; in the greedy, the
  highest-spend category has the highest reduction *potential* and is cut first,
  so ordering by total spend desc faithfully implements "highest-impact first."
  Assert the order property, not the comparator expression.
- **The tie-break is the only behavioral change this phase makes to production.**
  Adding `(a,b) => b.totalCents - a.totalCents || a.categoryName.localeCompare(b.categoryName)`
  (then slug) makes the order deterministic and user-meaningful. It cannot affect
  any all-distinct-total scenario (incl. the Phase-1 canonical test).
- **The 5-cap can legitimately leave the gap open.** "Minimum set of cuts that
  close the gap" (PRD) is realized only when ≤5 categories suffice; beyond that
  the design intentionally truncates to the top 5. The contract asserts both the
  closes-the-gap case and the cap-truncation case as distinct behaviors.
- **Out-of-contract inputs are the boundary's job, not the engine's.** Malformed
  dates and non-finite amounts are excluded by the DB type + API zod; the engine
  trusts its callers. We document this rather than add redundant guards.

## Historical Context (from prior changes)

- `context/archive/2026-06-22-testing-runner-bootstrap-wedge/research.md` — Phase 1
  oracle for #1/#2, the time-coupling constraint, and the malformed-date NaN
  cascade analysis (carried forward here).
- `context/archive/2026-06-22-testing-runner-bootstrap-wedge/plan.md` — Phase 1
  scope explicitly deferred ranking, rounding, the 5-cap edge, and the
  expired-goal shape to "rollout Phase 2"; left the `it.todo` for malformed date.
- `context/changes/goal-anchored-recommendations/plan-brief.md` — Key Decisions:
  suggestion cap 5 ("beyond 5 the list becomes noise"); expired goal "show
  Expired badge, keep suggestions — user still owns the goal" (the ratified
  oracle for D); greedy "sort by spend desc, fill gap, stop at 5".
- `context/changes/goal-anchored-recommendations/plan.md:81` — "expired goal gets
  months_remaining = 1 … intentional, it signals urgency."
- `context/foundation/prd.md:101-114` (§Business Logic), `:43-53` (US-01 AC),
  `:79-90` (FR-007/FR-010), `:130` (Open Q2 threshold).
- `context/foundation/test-plan.md:47,75` — Risk #3 (ranking key + "defined
  tie-break"); `:48,76,92` — Risk #4 threshold is Phase 4 (excluded here).

## Related Research

- `context/archive/2026-06-22-testing-runner-bootstrap-wedge/research.md` — the
  Phase-1 research this builds directly on (formula chain, time-coupling, the
  finiteness invariant, the malformed-date vector).

## Open Questions

None blocking — the four deferred oracle questions are resolved (A/C/E/F from
sources/domain; B/D/G by decision this session). Two items are **plan inputs**,
not open questions:

1. The tie-break secondary key is a small production change to
   `recommendations.ts:88` — the plan must include it plus its assertion, and
   re-verify the Phase-1 canonical test still passes (it has no ties).
2. The malformed-date `it.todo` in `recommendations.test.ts` is to be **replaced**
   with a documenting won't-fix comment (citing the DB `date NOT NULL` + API zod
   guarantee), not deleted silently.

Deferred to later rollout phases (unchanged): excessive-spending threshold
(Phase 4, PRD Open Q2); SSR error surface (Phase 4); data-tier isolation & the
3-goal cap (Phase 3).
