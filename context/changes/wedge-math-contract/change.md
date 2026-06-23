---
change_id: wedge-math-contract
title: Wedge-math contract — full behavioral coverage of the cut engine
status: implementing
created: 2026-06-23
updated: 2026-06-23
archived_at: null
---

## Notes

Rollout Phase 2 of context/foundation/test-plan.md: "Wedge-math contract" — full behavioral coverage of the cut engine (src/lib/services/recommendations.ts: computeRecommendations).

Risks covered: #1 (cut-suggestion amount mathematically wrong vs goal target/timeframe), #2 (degenerate goal inputs — NaN/Infinity reaching the UI), #3 (cut RANKING order wrong — categories not ordered highest-impact → lowest, so the "minimum set of cuts" is wrong even when each number is right).

Test types: unit (parameterized + edge), e.g. it.each — this phase upgrades Phase 1's single-scenario wedge to full coverage.

Builds on Phase 1 (archived at context/archive/2026-06-22-testing-runner-bootstrap-wedge/): Vitest 3.2 is already wired into CI (lint → test → build), node env + @/* alias + TZ=UTC pinned in both vitest.config.ts and the npm scripts, tests co-located at src/lib/services/recommendations.test.ts with existing fixture factories (income/expense/makeGoal) and a frozen-clock (vi.setSystemTime) pattern. Reuse that scaffolding; do not re-bootstrap.

Oracle discipline (carried from Phase 1): #1 and #3 oracles MUST come from PRD §Business Logic + US-01 AC, never from the implementation (oracle-mirror is the trap). For #3 specifically: do NOT mirror the implementation's comparator (stable sort by totalCents desc) — assert the PRD ordering rule "ranks expense categories by the reduction amount needed, from highest-impact to lowest" with a DEFINED tie-break.

Open questions this phase must resolve (flagged by Phase 1 research/review — resolve in /10x-research before asserting):
- Expired-goal result SHAPE: change-intent said "empty/sentinel" but shipped code returns aggressive non-empty cuts with isExpired=true; PRD is silent. Phase 1 deferred this — Phase 2 must decide (likely a product-owner call).
- Malformed target_date string: the one genuinely unguarded NaN vector (toDateOnly has no validity check). Phase 1 logged it as an it.todo for this phase — decide whether to add a production guard + assertion or keep as out-of-contract.
- Rounding direction: required = Math.ceil(target/months); PRD is silent on rounding — pin only if the oracle defines it.
- Tie-break rule for equal category totals (Risk #3) — currently relies on JS stable-sort insertion order; the oracle/tie-break must come from PRD/domain, not the comparator.

Do NOT touch the excessive-spending alert threshold (0.12) — that is PRD Open Question Q2, routed to rollout Phase 4, undefined oracle.
