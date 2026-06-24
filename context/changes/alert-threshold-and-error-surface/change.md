---
change_id: alert-threshold-and-error-surface
title: Threshold oracle + SSR error surface + cookbook (rollout Phase 4)
status: impl_reviewed
created: 2026-06-24
updated: 2026-06-24
archived_at: null
---

## Notes

Rollout Phase 4 (final) of context/foundation/test-plan.md: "Threshold oracle + SSR error surface + cookbook".

Risks covered: #4 (excessive-spending alert mis-fires — fires for normal categories or misses a disproportionate one because the threshold is wrong) and #7 (SSR page throws → blank 500, and raw Supabase error / PII leaks into the error surface, instead of a graceful error card).

Test types: unit / hermetic (stub Supabase client) + cookbook fill-in. No new infra — reuse the Vitest unit suite (TZ=UTC) and the hermetic patterns established in Phases 1–3.

Q2 IS NOW RESOLVED (recorded in PRD §Open Questions, 2026-06-24): the excessive-spending threshold is a FIXED PERCENTAGE OF MONTHLY INCOME — a category is disproportionately high when its 30-day spend exceeds 12% of monthly income (threshold = floor(monthly_income × 0.12), alert when category_spend > threshold, strict; no alerts when income is 0). This ratifies the shipped logic (ALERT_INCOME_FRACTION = 0.12) as a deliberate product spec, so Risk #4 is ASSERT-ONLY (no production change) — but the oracle now comes from the PRD decision, NOT mirrored from the shipped 0.12. This removes the Phase-4 blocker the test-plan flagged.

Risk response intent (oracle discipline):
- #4: prove an alert fires IFF a category's 30-day spend > floor(monthly_income × 0.12). Oracle = the resolved PRD spec (NOT the code constant). Cover edges: category exactly at the threshold (NOT alerted — strict >), just over (alerted), missing income → no alerts, multiple categories sorted by spend desc. Anti-pattern: oracle-mirror against the shipped 0.12 — assert against the PRD-defined rule + hand-worked numbers. This is in the SAME pure function computeRecommendations (alerts branch, lines ~70-85) already covered for #1/#2/#3, so it extends the existing unit suite.
- #7: prove a thrown service error (e.g. Supabase down) surfaces a clean error card — NO blank 500, NO raw Supabase error / PII in the response. lessons.md "Wrap SSR data-fetching in try/catch" is the relevant rule. Test layer = HERMETIC on the service error contract (stub the service/client to throw, assert the page's try/catch produces a safe error state); the full deployed page render is e2e and OUT OF SCOPE (Lesson 4). /10x-research must ground HOW the SSR pages (recommendations.astro, dashboard.astro, goals.astro) currently catch errors and what the error contract is (graceful card vs raw message), and whether the contract is testable hermetically without a full Astro page render.

Cookbook: fill the remaining §6 TBDs that belong to this phase — §6.3 (hermetic stub-client test how-to) and §6.5 (per-rollout-phase notes); also §6.1 (unit test how-to) if still TBD, since the unit pattern is now well established across Phases 1–4.

Apply lessons.md: the SSR try/catch rule (directly relevant to #7), the determinism rule (no ambient TZ/locale; pin), and the Phase-N+1 Props rule where relevant.

Lesson boundaries: hermetic stub-client tests are Lesson 2 (two-layer cost×signal). NOT e2e/Playwright/full-page render (Lesson 4); NOT hooks/debugging (Lesson 3); do NOT author CI/CD (Module 1 Lesson 5). Risk #4 alerts are unit (same pure function); Risk #7 is hermetic on the service error contract.

Open questions /10x-research must resolve before planning: how the SSR pages catch service errors today and the exact error contract to assert (and whether it's hermetically testable without rendering a full Astro page, or whether only the service-error boundary is in scope); confirm the shipped alert logic matches the resolved PRD spec exactly (floor(income×0.12), strict >, income-0 guard) so Risk #4 is genuinely assert-only; and which cookbook sections (§6.1/§6.3/§6.5) this phase should fill.
