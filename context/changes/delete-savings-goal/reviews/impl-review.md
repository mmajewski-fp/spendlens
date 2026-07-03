<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Delete Savings Goal

- **Plan**: context/changes/delete-savings-goal/plan.md
- **Scope**: Full plan (Phase 1 of 1)
- **Date**: 2026-07-03
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Global delete in-flight guard vs per-row disable

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; narrowly scoped
- **Dimension**: Safety & Quality (UX correctness)
- **Location**: src/components/goals/GoalsManager.tsx:46,147
- **Detail**: handleDelete early-returns if ANY delete is in flight (`if (deletingId) return`), but only the deleting row is visually disabled; other rows' Delete buttons stay enabled yet no-op during a delete. Harmless (guard holds, no double-submit), minor UX inconsistency on a 1-3 item list.
- **Fix**: Disable all Delete buttons while a delete is in flight (`disabled={deletingId !== null}`) or drop the global guard and rely on per-row disable.
- **Decision**: FIXED — GoalsManager.tsx Delete button now `disabled={deletingId !== null}` (the "Deleting…" label still keys to the active row). lint/build/85 tests green.

### F2 — `jsonResponse` duplicated across the two goal routes

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/goals.ts:26, src/pages/api/goals/[id].ts:7
- **Detail**: The 6-line jsonResponse helper is now copied in both goal route files. Low-risk duplication (plan didn't ask to extract), but a de-dup opportunity.
- **Fix**: Extract jsonResponse to a shared src/lib helper and import in both routes.
- **Decision**: FIXED — extracted to src/lib/api.ts; goals.ts and goals/[id].ts now import it and their local copies removed. lint/build/85 tests green.

### F3 — RLS cross-user ownership is untested

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — informational; no action required now
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/goals/[id].ts:32 (deleteGoal + RLS)
- **Detail**: Delete ownership rests entirely on the RLS policy (user_id = auth.uid()) since deleteGoal has no explicit user_id filter. The hermetic handler test mocks the service, so ownership isn't asserted in this change. Correct by construction (session-bound client + RLS) but untested; the local-only integration suite (not CI-wired) is where such a test would live.
- **Decision**: ACKNOWLEDGED — no action; correct by construction, integration-test gap noted for awareness.
