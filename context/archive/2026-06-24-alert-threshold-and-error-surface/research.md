---
date: 2026-06-24T09:36:09+0000
researcher: Michał Majewski
git_commit: 097ecfd660b829952b0a284c8e53bdeb5706c4e4
branch: main
repository: spendlens
topic: "Phase 4 — Alert threshold oracle (#4, Q2 resolved) + SSR error surface (#7) + cookbook"
tags: [research, codebase, alerts, threshold, ssr-error, hermetic, error-contract, cookbook]
status: complete
last_updated: 2026-06-24
last_updated_by: Michał Majewski
---

# Research: Phase 4 — Threshold oracle (#4) + SSR error surface (#7)

**Date**: 2026-06-24T09:36:09+0000
**Researcher**: Michał Majewski
**Git Commit**: 097ecfd660b829952b0a284c8e53bdeb5706c4e4
**Branch**: main
**Repository**: spendlens (github.com/mmajewski-fp/spendlens)

## Research Question

Final rollout phase of `context/foundation/test-plan.md`: assert the
excessive-spending alert threshold (Risk #4, now that PRD Open Q2 is resolved)
and the SSR error contract (Risk #7), then fill the §6 cookbook. Confirm #4 is
assert-only against the resolved spec, and determine exactly what of #7 is
hermetically testable vs e2e.

## Summary

- **Risk #4 is assert-only and net-new.** The shipped alert branch matches the
  resolved PRD spec exactly, and alert *firing* is currently untested — so this
  phase adds unit tests to the existing `recommendations.test.ts` and changes no
  production code.
- **Risk #7's testable slice is the service error contract, not the page.** Both
  SSR pages already handle errors correctly (generic card, no leak, no 500), but
  that logic is inline `.astro` and only e2e-testable. The hermetic layer the
  test-plan prescribes targets the **service helpers**: each wraps a Supabase
  error into a clean `Error(message)` — never the raw `{code,details,hint}`
  object — which is the "error contract the page's try/catch is meant to catch."
- **No production change anywhere.** Both #4 (matches spec) and #7 (pages +
  services already correct) are regression-locking tests + docs.
- **Cookbook**: this phase fills §6.1 (unit) and §6.3 (hermetic stub-client);
  §6.5 per-phase notes is appended by `/10x-implement`.

### Risk #4 — alert logic matches the resolved spec (assert-only)

`recommendations.ts:75-90` (current line numbers), verbatim shape:
- `ALERT_INCOME_FRACTION = 0.12` ([:11](src/lib/services/recommendations.ts#L11)).
- `thresholdCents = Math.floor(monthlyIncomeCents * ALERT_INCOME_FRACTION)`.
- alert iff `bucket.totalCents > thresholdCents` — **strict `>`**.
- guarded by `if (!hasMissingIncome)` — **income 0 ⇒ no alerts**.
- `alerts.sort((a, b) => b.spendCents - a.spendCents)` — **spend desc**.
- `SpendingAlert = { categorySlug, categoryName, spendCents, thresholdCents }`
  ([types.ts:48-55](src/types.ts#L48)).

This is **identical** to the resolved PRD Open Q2 spec (recorded 2026-06-24):
`threshold = floor(monthly_income × 0.12)`, alert when `spend > threshold`
(strict), no alerts when income is 0. So the oracle is **sourced from the PRD
decision**, and asserting it is a regression lock — NOT an oracle-mirror of the
`0.12` constant (the test-plan Risk #4 anti-pattern). No production change.

**Current coverage gap** ([recommendations.test.ts](src/lib/services/recommendations.test.ts)):
the only alert assertions today are `alerts: []` (empty baseline `:92`,
missing-income `:289`) and finiteness of alert fields in `expectAllFieldsFinite`
(`:80-83`). The alert **firing** logic (threshold, strict boundary, sort) has
**zero coverage** — that is the net-new Phase-4 work.

**Hand-worked #4 oracle** (from the PRD rule + arithmetic, not the code):
income `1_000_000` ⇒ `threshold = floor(1_000_000 × 0.12) = 120_000`.
- category `200_000` (> 120_000) → **alert**
- category `120_001` (just over) → **alert**
- category `120_000` (== threshold) → **no alert** (strict `>`)
- category `50_000` (< threshold) → no alert
- alerts sorted desc: `[200_000, 120_001]`, each `thresholdCents: 120_000`,
  shape `{categorySlug, categoryName, spendCents, thresholdCents}`.
- *floor edge*: income `1_000_005` ⇒ `floor(120_000.6) = 120_000`; a category at
  `120_001` alerts (pins floor vs ceil — ceil would give 120_001, suppressing it).
- *missing income*: income 0 ⇒ `alerts: []`.

Tests run under the existing frozen clock + `TZ=UTC`; alert inputs are the same
30-day-window expense buckets used by the #1/#2/#3 tests, so fixtures must be
dated in-window (income + expenses), exactly as in the existing suite.

### Risk #7 — SSR error surface: pages correct, service contract is the testable slice

**Per page** (verbatim handling):
- `recommendations.astro:19-33` — wraps `getUserTransactions` + `getUserGoals` in
  `try/catch`; catch sets `fetchError = err instanceof Error ? err.message : "…"`.
  On error it renders a **generic** card ("Could not load recommendations" +
  contact-support hint, `:52-61`); `fetchError` is used **only** as a truthiness
  gate, never interpolated → no message leak, no blank 500 (catch → 200 + card).
- `goals.astro:15-23` — same pattern (`getUserGoals` in try/catch; generic
  "Could not load savings goals" card `:42-51`; `fetchError` not interpolated).
- `dashboard.astro:1-5` — **no DB call** (reads only `Astro.locals.user`); **not
  a Risk #7 surface**.
- Services ([savings-goals.ts:7,27,35](src/lib/services/savings-goals.ts#L7),
  [transactions.ts:15,28](src/lib/services/transactions.ts#L15)) each do
  `if (error) throw new Error(error.message)` — a **fresh Error carrying only the
  message string**, never the raw Supabase `{code,details,hint}` object or row
  data. `createGoal` has a second branch: `!data ⇒ throw new Error("Failed to
  create savings goal")`.

**Testability boundary (the decisive finding):**
- **Page-side** (catch → generic card, no leak, 200 not 500) is **inline `.astro`
  frontmatter** — not unit-testable without a full Astro page render (**e2e,
  Lesson 4, out of scope**). It is verified-correct by inspection here, but
  there is no extracted loader/util to unit-test.
- **Service-side** IS hermetically testable: stub the Supabase client to return
  `{ data: null, error: { message, code, details, hint } }` and assert the
  service **throws a clean `Error`** whose `.message` is exactly the Supabase
  message and which carries **none** of `code`/`details`/`hint` (no raw object /
  PII escapes the boundary). This is the "service error contract the page's
  try/catch is meant to catch" (test-plan Risk #7, cheapest layer). It is a real
  regression guard: a future `throw error` (raw) instead of `throw new
  Error(error.message)` would leak internal detail and fail this test.
- Note: `src/components/auth/ServerError.tsx` DOES render its `message` prop
  verbatim, but it is **auth-only** (SignIn/SignUp forms) and unused by the three
  pages above — out of scope for #7.

So Phase 4's #7 test = **hermetic service-error-contract tests** (each helper
throws a clean message-only Error on a stubbed client error). The page-side
graceful-card behavior is documented as correct-but-e2e (deferred).

### Cookbook state

`test-plan.md` §6.1 (unit) and §6.3 (hermetic stub-client) are both still "TBD";
§6.5 (per-phase notes) is appended by `/10x-implement`. This phase produces both
a unit example (#4 alerts) and a hermetic stub-client example (#7 service
contract), so it can fill §6.1 + §6.3.

## Code References

- `src/lib/services/recommendations.ts:11,75-90` — alert branch (floor, strict `>`, income-0 guard, sort)
- `src/types.ts:48-55` — `SpendingAlert` shape
- `src/lib/services/recommendations.test.ts:80-83,92,289` — existing alert assertions (finiteness + empty only)
- `src/pages/recommendations.astro:19-61` — try/catch + generic error card (fetchError not interpolated)
- `src/pages/goals.astro:15-51` — same try/catch + generic card
- `src/pages/dashboard.astro:1-5` — no DB call (not a #7 surface)
- `src/lib/services/savings-goals.ts:7,27,28,35`, `transactions.ts:15,28` — `throw new Error(error.message)` contract
- `src/components/auth/ServerError.tsx` — renders message verbatim; auth-only, out of scope
- `context/foundation/test-plan.md` §6.1/§6.3/§6.5 (cookbook), §2 Risk #4/#7 guidance

## Architecture Insights

- **#4 and #7 are both "verify, don't change."** The product was built correctly
  (alerts match the now-resolved spec; pages apply the SSR try/catch lesson).
  Phase 4 locks both as regressions — the value is documentation + a guard, not a
  fix. This is the right note to set expectations (green by design).
- **The error-surface protection is split across two layers**, and only the
  service half is unit-reachable. Honest coverage = hermetic service contract
  (no raw-object/PII at the throw) + an explicit note that the page-side card is
  e2e. Trying to assert the page-side hermetically would mean a brittle full-page
  snapshot — the exact test-plan Risk #7 anti-pattern.
- **Determinism lesson applies** to the #4 alert tests (the 30-day window uses
  the wall clock); reuse the frozen clock + `TZ=UTC`, dating fixtures in-window.

## Historical Context (from prior changes)

- The `lessons.md` "Wrap SSR data-fetching in try/catch" rule originated in
  `context/archive/2026-06-02-create-savings-goal/plan.md:28,59-62` — a real burn
  where an unguarded `getUserTransactions` Supabase error returned a blank 500.
  Phase 4 #7 tests the boundary that lesson is about.
- `context/archive/2026-06-22-testing-runner-bootstrap-wedge/` — the unit runner
  + `TZ=UTC` the #4 alert tests extend.
- `context/archive/2026-06-23-wedge-math-contract/` — `computeRecommendations`
  unit-test patterns (fixtures, frozen clock) the #4 alert tests reuse.
- `context/archive/2026-06-23-data-tier-guardrails/` — the hermetic stub-client
  pattern (mocked client) and §6.4 cookbook; §6.3 hermetic-test how-to is this
  phase's analog at the service layer.
- PRD §Open Questions Q2 — **resolved 2026-06-24** with the 12%-of-income spec
  that makes #4's oracle sourced rather than mirrored.

## Related Research

- `context/archive/2026-06-23-wedge-math-contract/research.md` — the
  `computeRecommendations` oracle + alert-threshold-as-Open-Q2 note (now resolved).
- `context/archive/2026-06-23-data-tier-guardrails/research.md` — hermetic vs
  integration layering; the service error-throwing shape.

## Open Questions

Resolved: #4 is assert-only (spec ⇄ code confirmed); #7's testable slice is the
service error contract. Remaining items are **plan-level scoping decisions**, not
oracle gaps:

1. **#7 depth** — hermetic service-error-contract tests only (the prescribed
   cheapest layer), or additionally extract the page loaders into a TS util to
   make the page-side card behavior unit-testable (a small production refactor)?
   Recommendation: contract-only + document the page-side as correct-but-e2e;
   extraction is a follow-up, not this phase.
2. **#7 breadth** — which service helpers to pin (all five, or just the read
   paths the SSR pages actually call: `getUserGoals` + `getUserTransactions`)?
3. **Cookbook** — fill §6.1 (unit) + §6.3 (hermetic) this phase (recommended,
   both patterns are now exemplified), and let `/10x-implement` append §6.5.
