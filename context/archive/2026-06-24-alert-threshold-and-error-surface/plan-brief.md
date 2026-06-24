# Alert Threshold + SSR Error Surface — Plan Brief

> Full plan: `context/changes/alert-threshold-and-error-surface/plan.md`
> Research: `context/changes/alert-threshold-and-error-surface/research.md`

## What & Why

The final rollout phase of the test plan: lock the last two risks as
regressions — Risk #4 (the excessive-spending alert threshold, now that PRD Open
Q2 is resolved) and Risk #7 (the SSR error surface) — and fill the §6 cookbook.
Closing these means all 7 test-plan risks are covered.

## Starting Point

The alert logic already matches the resolved Q2 spec (`floor(income×0.12)`,
strict `>`, income-0 guard) but its *firing* is untested; the SSR pages
(`recommendations.astro`, `goals.astro`) already render a generic error card with
no leak/no 500, and the services throw a clean `Error(message)`. So the product
is correct — what's missing is the tests that pin it.

## Desired End State

The unit suite gains Risk #4 alert-firing assertions (against the PRD oracle) and
Risk #7 hermetic service-error-contract tests (the two SSR read paths throw a
clean, message-only `Error`, no raw object/PII). Cookbook §6.1 + §6.3 are filled.
Everything runs per-commit, unit-only, no Docker, no production change.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Q2 threshold | Fixed 12% of monthly income | Single-period + deterministic; recorded in PRD as the spec | Research (PRD) |
| #4 oracle | The resolved PRD rule, not the `0.12` constant | Avoids the test-plan's oracle-mirror anti-pattern | Research |
| #4 production change | None — assert-only | Shipped logic already matches the spec | Research |
| #7 depth | Hermetic service-error-contract only | Page-side card is correct-by-inspection but inline `.astro` → e2e (Lesson 4) | Plan |
| #7 breadth | The 2 SSR read paths (`getUserGoals`, `getUserTransactions`) | They're the actual blank-500 surface; write paths are API concerns | Plan |
| Cookbook | Fill §6.1 (unit) + §6.3 (hermetic) | This phase exemplifies both; §6.1 has been TBD since Phase 1 | Plan |

## Scope

**In scope:** #4 alert-firing unit tests; #7 hermetic service-error-contract
tests (2 read paths); cookbook §6.1 + §6.3.

**Out of scope:** any production change; page-side / full-render #7 test (e2e,
Lesson 4); a page-loader refactor; write-path error contracts; `ServerError.tsx`;
integration/Docker/CI changes.

## Architecture / Approach

All new tests live in the existing Vitest unit suite (`TZ=UTC`, frozen clock).
#4 extends `recommendations.test.ts`; #7 adds co-located
`savings-goals.test.ts` + `transactions.test.ts` that stub a chainable Supabase
client and assert the clean-Error throw contract. Cookbook edits are prose in
`test-plan.md`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. #4 alert-firing tests | threshold/strict-boundary/floor/missing-income/sort assertions | oracle-mirroring the `0.12` constant instead of the PRD rule |
| 2. #7 service-error contract | 2 read paths throw a clean message-only Error (no raw object/PII) | over-asserting into e2e page-render territory |
| 3. Cookbook §6.1 + §6.3 | unit + hermetic how-tos | drift from what was built |

**Prerequisites:** none beyond the existing unit runner.
**Estimated effort:** ~1 short session (test + docs; no production change, no Docker).

## Open Risks & Assumptions

- All three phases land **green by design** — the product is already correct; value is regression protection + documentation, not bug-finding.
- Risk #7's page-side guarantee (catch → card → 200, no leak) is covered only by inspection here; the unit/hermetic layer pins the service boundary. Full coverage is e2e (a future Lesson-4 phase).

## Success Criteria (Summary)

- `npm run test` green with the new #4 alert oracle + #7 clean-Error contract tests, unit-only.
- §6.1 and §6.3 let a reader add a unit test and a hermetic stub-client test without re-deriving the approach.
- All 7 test-plan risks covered once this phase archives.
