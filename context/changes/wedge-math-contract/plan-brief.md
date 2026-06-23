# Wedge-math Contract — Plan Brief

> Full plan: `context/changes/wedge-math-contract/plan.md`
> Research: `context/changes/wedge-math-contract/research.md`

## What & Why

Rollout Phase 2 of the test plan: turn Phase 1's single wedge test into a full
parameterized contract over `computeRecommendations`, covering Risk #1 (amounts
correct vs target/timeframe), Risk #2 (degenerate-input guards), and the new
Risk #3 (cut ranking highest→lowest, with a defined tie-break). This protects
the product's core promise across its whole input space, not just one happy path.

## Starting Point

Phase 1 (archived) left the runner fully bootstrapped — Vitest 3.2, node env,
`@/*` alias, `TZ=UTC` pinned in `vitest.config.ts` + scripts, a CI test step,
and `recommendations.test.ts` with fixture factories and a frozen-clock pattern.
The engine is pure; its only gaps for "full coverage" are ranking/tie-break,
rounding, the 5-cap, multi-goal, and the degenerate cases beyond finiteness.

## Desired End State

A parameterized suite (one file, a describe block per risk) pins the amount math
(incl. rounding, window boundary, null-category, multi-goal), the four
degenerate guards with the ratified expired-goal shape, and strict
highest→lowest ranking with a deterministic alphabetical tie-break. One small
production change makes ties predictable. A local Stryker run confirms the tests
actually kill mutants.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Ranking key | Order by category spend desc = "highest-impact" | PRD §Business Logic; assert the rule, not the comparator | Research |
| Rounding | `ceil` | "reach the goal" ⇒ must not fall short; round-down provably misses | Research |
| Expired goal | Ratify shipped: `isExpired` + aggressive cuts (months→1) | Documented design Key Decision ("keep suggestions, Expired badge") | Plan |
| Tie-break | Add alphabetical secondary key (name, then slug) | Test-plan Risk #3 requires "a defined tie-break"; kills insertion-order nondeterminism | Plan |
| Malformed date | Keep out-of-contract; retire the `it.todo` | DB `date NOT NULL` + API zod guarantee validity upstream | Plan |
| Mutation testing | One local-only Stryker pass (final phase) | The moment the test-plan §5 designates; proves not-vibe-tests | Plan |
| Test layout | One file, describe block per risk | Matches Phase 1; suite still small | Plan |
| Tie-break execution | Dedicated red→green phase, flag `/10x-tdd` | The only red-first change and only production edit — isolate it | Plan |

## Scope

**In scope:** parameterized #1/#2/#3 tests; one comparator change (tie-break);
retire the malformed-date `it.todo`; a local Stryker triage pass.

**Out of scope:** alerts/threshold (Phase 4, PRD Open Q2); malformed-date test or
guard; two-`category_id`s-same-slug (impossible — unique slug); empty/sentinel
for expired goals (ratified shipped instead); negative/non-finite amounts
(out-of-contract); a CI mutation gate; data-tier isolation & 3-goal cap (Phase 3).

## Architecture / Approach

All tests extend the existing `recommendations.test.ts` on the Phase-1
scaffolding (frozen UTC clock, fixtures). The single production change is a
one-line secondary sort key at `recommendations.ts:88`. Stryker reuses the
Vitest config directly (hence the `TZ=UTC` pin must live in the config, not just
the script — a Phase-1 impl-review fix that pays off here).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Risk #1 amounts & edges | rounding, window boundary, null-category, multi-goal | oracle-mirror; DST/clock nondeterminism |
| 2. Risk #2 degenerate contract | 4 parameterized guards; ratify expired shape; retire `it.todo` | asserting empty/sentinel instead of the ratified shape |
| 3. Risk #3 ranking & cap | strict order, minimum-set, 5-cap truncation | mirroring the comparator instead of the PRD rule |
| 4. Risk #3 tie-break (TDD) | failing alphabetical test → minimal comparator change | vacuously-green test (must insert ties reverse-alphabetically) |
| 5. Stryker triage (local) | mutants killed/triaged on the cut-math module | chasing cosmetic mutants / 100% |

**Prerequisites:** Phase 1 runner scaffolding (done, archived). Node 22.14.
**Estimated effort:** ~1 session across 5 small phases (Phase 4 is the only production edit; Phase 5 is a one-time local run).

## Open Risks & Assumptions

- Ranking/expired/5-cap tests land **green** by design (the code is already
  correct) — value is regression protection + contract documentation, not
  bug-finding. The tie-break is the only red→green.
- Stryker setup may surface version/runner friction with Vitest 3.2; resolve at
  install time (as Phase 1 did with Vitest).
- The expired-goal ratification is a product decision recorded here; if the PO
  later wants empty/sentinel, that's a new change, not a silent flip.

## Success Criteria (Summary)

- `npm run test` green across the parameterized #1/#2/#3 suite, with every oracle value sourced from PRD/domain.
- Equal-total categories order alphabetically (deterministic), backed by a failing-then-passing test.
- A local Stryker run on `recommendations.ts` shows survivors either killed or consciously ignored — no vibe-tests.
