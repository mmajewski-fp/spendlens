<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Runner Bootstrap + First Wedge Test

- **Plan**: context/changes/testing-runner-bootstrap-wedge/plan.md
- **Scope**: Phases 1–3 of 3
- **Date**: 2026-06-23
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS (2 observations) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS (automated pass; manual deferred) |

## Findings

### F1 — TZ=UTC guarantee lives only in the npm scripts

- **Severity**: 🟢 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Determinism)
- **Location**: package.json:13-14 / vitest.config.ts
- **Detail**: The engine's `toDateOnly` uses a local-time Date constructor while fixtures use UTC "Z" strings. The oracle (esp. "2026-10-29 = 150 days = 5 months") holds only because TZ=UTC is pinned — but that pin lives only in the `test`/`test:watch` scripts. A direct `npx vitest` on a non-UTC machine could desync the dates and flip month-boundary assertions. The sanctioned entry points (npm run test, CI) are safe.
- **Fix**: Also pin TZ in vitest.config.ts (`test.env: { TZ: "UTC" }`) so the guarantee survives a direct `vitest` invocation, then re-run to confirm it takes effect in the worker.
- **Decision**: FIXED — added `env: { TZ: "UTC" }` to vitest.config.ts; verified by running `npx vitest run` (no script TZ) on a +0200 machine: still green, proving the config pin takes effect in the worker.

### F2 — expectAllFieldsFinite is silent on an empty goals/alerts array

- **Severity**: 🟢 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/lib/services/recommendations.test.ts:54-68
- **Detail**: The finiteness helper loops `result.goals` / `goal.suggestions` / `result.alerts`. If a regression made a goal silently disappear, the loop body wouldn't run and the degenerate-input test would still pass green. Current cases all build exactly one goal, so it's safe today.
- **Fix**: Add `expect(result.goals.length).toBe(1)` to the degenerate-input cases so the helper can't pass vacuously.
- **Decision**: FIXED — added `expect(result.goals.length).toBe(1)` to all four degenerate-input cases.
