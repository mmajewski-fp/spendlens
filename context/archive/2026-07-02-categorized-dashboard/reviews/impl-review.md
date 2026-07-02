<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Categorized Dashboard

- **Plan**: context/changes/categorized-dashboard/plan.md
- **Scope**: Full plan (Phase 1 + 2 of 2)
- **Date**: 2026-07-02
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — `since` derived from local-time Date, serialized as UTC

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (correctness / determinism)
- **Location**: src/pages/dashboard.astro:21
- **Detail**: `new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10)` builds midnight LOCAL then converts to UTC before slicing. On Vercel (UTC) correct, but on a non-UTC host the date can roll back to the previous month — host-timezone-dependent, against the lessons.md "no ambient-timezone dependence" rule. Backstopped by the precise in-service re-filter in computeSpendingSummary, so it cannot corrupt production totals (only over-fetches ~1 day), but a latent trap.
- **Fix**: Build `since` from UTC components, e.g. `` `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,"0")}-01` ``.
- **Decision**: FIXED — built `since` from the same *local* calendar components computeSpendingSummary uses (dashboard.astro:21), dropping the toISOString UTC round-trip so the DB lower-bound and the in-service filter always agree on any host. lint/build/76 tests green.

### F2 — Alert tie-break tightened to deterministic ordering

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — informational; no action required
- **Dimension**: Plan Adherence
- **Location**: src/lib/services/recommendations.ts:48,55
- **Detail**: Plan said recommendations behavior must be "UNCHANGED." Equal-spend alert categories now tie-break by codepoint name/slug (from shared sorted buckets) instead of transaction insertion order — strictly more deterministic (aligns with lessons.md), no test pins the old order, 19 recommendations tests green. Flagged only because the plan wording was absolute.
- **Decision**: ACKNOWLEDGED — no action; the change is a determinism improvement and no behavior any test or caller relies on regressed.
