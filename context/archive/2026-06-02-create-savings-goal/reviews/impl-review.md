<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Create Savings Goal

- **Plan**: `context/changes/create-savings-goal/plan.md`
- **Scope**: Full plan (Phases 1–3)
- **Date**: 2026-06-03
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 3 observations

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

### F1 — Topbar not shown on `/goals` or `/recommendations`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `src/pages/goals.astro`, `src/pages/recommendations.astro`
- **Detail**: Phase 3 added a Goals link to `Topbar.astro`, but Topbar is only imported on `Welcome.astro` (home). Signed-in users on `/goals` or `/recommendations` do not see the nav bar, so the new link is only discoverable from the home page unless they bookmark or use in-page links.
- **Fix A ⭐ Recommended**: Import `<Topbar />` at the top of `goals.astro` and `recommendations.astro` (same layout shell as other authenticated flows once dashboard grows).
  - Strength: Makes Phase 3 navigation match user expectations; one-line import per page.
  - Tradeoff: Slight layout duplication until a shared authenticated layout exists.
  - Confidence: HIGH — matches how Welcome already composes Topbar.
  - Blind spot: None significant.
- **Fix B**: Leave as-is and document that primary nav lives on home for MVP.
  - Strength: Zero code change; scope stays minimal.
  - Tradeoff: Goals link is easy to miss after landing on `/goals` from recommendations CTA.
  - Confidence: MEDIUM — acceptable if product intent is “hub on home only.”
  - Blind spot: Haven’t validated user navigation paths in analytics.
- **Decision**: FIXED via Fix A (Topbar on goals + recommendations pages)

### F2 — `createGoal` insert omits `user_id`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/goals.ts:59`, `src/lib/services/savings-goals.ts:20`
- **Detail**: RLS `INSERT` policy requires `user_id = auth.uid()`. The API calls `createGoal` with only `name`, `target_amount`, and `target_date`. Manual verification reported 201 success, so the deployed path works today; omitting `user_id` is still implicit and would fail if defaults/triggers differ between environments.
- **Fix**: Pass `user_id: context.locals.user.id` into `createGoal` (extend service to accept it or add an overload) so inserts are explicit and portable across Supabase setups.
- **Decision**: FIXED

### F3 — Prettier-only edits outside plan file list

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `src/lib/services/recommendations.ts`, `src/lib/services/transactions.ts`
- **Detail**: Phase 2 commit included formatting fixes in two service files not listed in the plan. Behavior unchanged; enabled full-repo `npm run lint` to pass.
- **Fix**: No action required; note in plan addendum if strict file-scope commits matter.
- **Decision**: SKIPPED

### F4 — 3-goal cap error detected by substring

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Reliability
- **Location**: `src/pages/api/goals.ts:67`
- **Detail**: 409 mapping checks `message.includes("3 active savings goals")`. Matches current trigger text; already listed as open risk in `plan-brief.md`. A migration wording change would surface 500 instead of 409.
- **Fix**: Later: map on Postgres error code or add API-side `getUserGoals().length >= 3` pre-check before insert.
- **Decision**: SKIPPED

### F5 — “Past due” vs future target date in same month

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/components/goals/GoalsManager.tsx:25-30`
- **Detail**: `getMonthsRemainingLabel` returns “Past due” when month delta is 0, even if `target_date` is still in the future within the current month (plan allowed this coarse month math).
- **Fix**: Compare calendar dates (or days remaining) instead of month buckets only.
- **Decision**: FIXED

## Plan drift matrix (summary)

| Planned item | Verdict |
|--------------|---------|
| `POST /api/goals` + zod + auth + 409 cap | MATCH |
| `/goals` protected + SSR + try/catch | MATCH |
| `GoalsManager` props + fetch form + cap UI | MATCH |
| Recommendations link → `/goals` | MATCH |
| Topbar Goals link (authenticated branch) | MATCH |
| Topbar on goals page | DRIFT (optional in plan; not implemented) |

## Success criteria verification

| Check | Result |
|-------|--------|
| `npm run lint` | PASS |
| `npm run build` | PASS |
| Progress manual items 1.3–3.5 | All `[x]` with SHAs `935eb07`, `b7a57b7`, `97f9c74` |

## Commits reviewed

`935eb07` (p1) → `b7a57b7` (p2) → `97f9c74` (p3) → `844b616` (epilogue)
