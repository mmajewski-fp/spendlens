<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Alert Threshold + SSR Error Surface

- **Plan**: context/changes/alert-threshold-and-error-surface/plan.md
- **Scope**: Full plan (Phases 1–3 of 3)
- **Date**: 2026-06-24
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success Criteria (verified fresh)

- `npm run test` → 29 passed (4 files): Risk #4 alert assertions in the 19-test `recommendations.test.ts`; +2 `savings-goals.test.ts`, +2 `transactions.test.ts`.
- `npm run lint` → exit 0 (only harmless `astro-eslint-parser` `projectService` notices).
- §6.1 and §6.3 contain no "TBD" (the sole remaining TBD at line 141 is the §6 preamble convention statement).
- `npx prettier --check context/foundation/test-plan.md` → clean.
- Manual Progress rows 1.3, 1.4, 2.3, 2.4, 3.3 remain unchecked **by design** (deferred during implementation) but each is evidenced in the diff: literal `120_000` oracle (no constant import), exactly-at-threshold exclusion + floor-pinning case, `code/details/hint` `toBeUndefined()` assertions, e2e-deferral header comments, and filled cookbook prose. Not rubber-stamped — honestly pending; `/10x-archive` will surface them as warn-only with the manual-only nudge toward archiving.

## Notes

- **Oracle discipline held** (the load-bearing Risk #4 check): expected threshold is the hand-worked literal `120_000`; no `0.12` / `ALERT_INCOME_FRACTION` import and no `Math.floor(income*0.12)` in any assertion. The floor-pinning case uses `income(1_000_005)` so floor and ceil diverge — kills the floor→ceil mutant.
- **Scope guardrails held**: zero production-code changes (`recommendations.ts`, `.astro` pages, `ServerError.tsx` untouched); no write-path tests; no integration/Docker/CI changes. Diff = 3 test files + `test-plan.md` + 1-line `prd.md` Q2 resolution + change-folder docs.
- **Hermetic stubs faithful**: thenable builder genuinely exercises the service `await` path; error tests assert `instanceof Error` + exact `.message` + absence of `code/details/hint`. Determinism double-pinned (`TZ=UTC` in npm scripts and `vitest.config.ts`).

## Findings

### F1 — getUserTransactions `since`/`.gte()` branch is unexercised

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria (coverage)
- **Location**: src/lib/services/transactions.test.ts; src/lib/services/transactions.ts:12
- **Detail**: The hermetic stub supports `.gte()`, but no test passes a `since` argument, so the optional `since → .gte("date", since)` filter branch is never driven. A regression that dropped the `.gte()` call (returning unfiltered rows) would pass this suite. Consistent with the change being scoped to the Risk #7 *error contract* (not filter behavior) — `since` filtering is currently untested at any layer.
- **Fix**: Leave as-is unless `since` filtering is itself a listed test-plan risk; if it becomes one, add a case asserting `.gte` is invoked with the boundary date.
- **Decision**: SKIPPED — `since` is not a listed risk; the phase is correctly scoped to the Risk #7 error contract. Left as-is by reviewer choice.
