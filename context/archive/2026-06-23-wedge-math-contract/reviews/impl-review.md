<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Wedge-math Contract

- **Plan**: context/changes/wedge-math-contract/plan.md
- **Scope**: Phases 1–5 of 5
- **Date**: 2026-06-23
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS (3 observations) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS (automated green; manual deferred) |

## Findings

### F1 — Unpinned localeCompare in the tie-break is locale-dependent

- **Severity**: 🟢 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Determinism)
- **Location**: src/lib/services/recommendations.ts:89
- **Detail**: The tie-break uses `a.name.localeCompare(b.name)` with no locale argument → runtime default-locale ICU collation, which can differ across machines/CI/Stryker workers (same bug class as TZ). Neutralized today: category taxonomy is a closed set of 11 Capitalized ASCII names with SELECT-only RLS, so ordering is stable. Upgrades to a real bug if categories ever become user-editable; the "Apparel" vs "Dining" tie-break test would go locale-fragile.
- **Fix**: Pin deterministically — codepoint compare (`a.name < b.name ? -1 : a.name > b.name ? 1 : 0`) or `a.name.localeCompare(b.name, "en")`. Zero behavioral change for the current set; removes the bug class.
- **Decision**: FIXED — added a `compareStrings` codepoint helper; replaced both `localeCompare` calls. 16 tests green, lint clean.

### F2 — Tertiary slug key is unreachable dead code

- **Severity**: 🟢 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/lib/services/recommendations.ts:89
- **Detail**: `categories.name` is UNIQUE, so two buckets never share a name; the `|| a.slug.localeCompare(b.slug)` tertiary key can never fire and no test covers it. Harmless defensive dead code.
- **Fix**: Keep as defensive (no action) or drop the tertiary key. Low stakes.
- **Decision**: SKIPPED — kept as a cheap defensive safety net against future name-unique changes.

### F3 — Stryker config comment misattributes the TZ guarantee

- **Severity**: 🟢 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency (Docs)
- **Location**: stryker.conf.json (_comment)
- **Detail**: The `_comment` says determinism "relies on the TZ=UTC pin in vitest.config.ts" — but the robust guarantee is the `TZ=UTC` prefix in the `test:mutation` script (Stryker workers don't inherit the config pin). Residual risk: a contributor running bare `npx stryker run` gets no TZ and boundary-day assertions could shift.
- **Fix**: Correct the comment to credit the script; add a "run via `npm run test:mutation`" note.
- **Decision**: FIXED — rewrote the `_comment` to credit the script's TZ=UTC prefix and warn against bare `npx stryker run`.
