<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Edit Savings Goal

- **Plan**: context/changes/edit-savings-goal/plan.md
- **Scope**: Full plan (Phases 1–3 of 3)
- **Date**: 2026-07-06
- **Verdict**: APPROVED (with 1 minor warning)
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Both review agents independently confirmed zero drift, nothing missing, no unplanned
scope. All 7 key plan intents verified. Automated criteria: lint, 104 unit tests, 11
integration tests, build — all pass.

## Findings

### F1 — Raw DB error message echoed to client in 500 responses

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/goals/[id].ts:95-96 (PUT); pre-existing in :41-42 (DELETE) and goals.ts:50-54 (POST)
- **Detail**: The PUT catch block returns `error.message` verbatim to the client on any unexpected DB failure. The service rethrows `new Error(error.message)` from Supabase, so Postgres/PostgREST phrasing (constraint/column names, "relation … does not exist") can surface in the 500 body. The project rule is met at the service boundary (structured `{code,details,hint}` fields are dropped), but the handler relays the message string. Pre-existing whole-module pattern, not new drift.
- **Fix A ⭐ Recommended**: Generic 500 message + server-side log, PUT only
  - Strength: Tightens the new code this change owns; mirrors POST's own fallback ("Failed to create savings goal"). Narrow, low-risk.
  - Tradeoff: Leaves DELETE/POST relaying raw messages — module stays inconsistent until a follow-up.
  - Confidence: HIGH — POST already models the generic-fallback shape.
  - Blind spot: None significant.
- **Fix B**: Fix the pattern module-wide (PUT + DELETE + POST)
  - Strength: Removes internal-phrasing exposure everywhere; leaves module uniform.
  - Tradeoff: Broadens scope beyond this change; touches two handlers the plan didn't cover.
  - Confidence: MED — straightforward but wider blast radius.
  - Blind spot: Tests assert status codes, not bodies — low regression risk; re-run to confirm.
- **Decision**: FIXED via Fix A — PUT 500 now returns a generic message + `console.error` the real one (goals/[id].ts). DELETE/POST left as a follow-up.

### F2 — Timezone: client "tomorrow" vs server future-check near midnight

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — edge-only
- **Dimension**: Safety & Quality
- **Location**: src/lib/goal-validation.ts:26-32 (isFutureDate)
- **Detail**: isFutureDate uses server-local `new Date()`; the UI's date `min` and tomorrow-default use browser-local time. Tests pin TZ=UTC so they're deterministic. At runtime a user west of UTC near midnight could pick a date the client shows valid that the server rejects with 400. Edge-only, consistent with the existing create flow.
- **Fix**: None required. Note if goal create/edit draws cross-timezone bug reports.
- **Decision**: ACKNOWLEDGED — observation only, no fix (edge-only, consistent with create flow).

### F3 — Read-then-update TOCTOU is benign

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — informational
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/goals/[id].ts:72-92
- **Detail**: A concurrent delete between the 404 check and the UPDATE makes updateGoal match 0 rows → `.single()` errors → 500 (instead of 404). No cross-user write or corruption possible (RLS-scoped). Only cost: a lost race surfaces as 500 rather than 404. Acceptable.
- **Fix**: None required.
- **Decision**: ACKNOWLEDGED — observation only, no fix (RLS-scoped, no corruption possible).
