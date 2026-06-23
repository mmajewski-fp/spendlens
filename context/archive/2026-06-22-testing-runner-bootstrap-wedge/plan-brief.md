# Runner Bootstrap + First Wedge Test — Plan Brief

> Full plan: `context/changes/testing-runner-bootstrap-wedge/plan.md`
> Research: `context/changes/testing-runner-bootstrap-wedge/research.md`

## What & Why

Rollout Phase 1 of the test plan: stand up Vitest, wire it into CI, and land the
first real assertions on the cut-suggestion engine. This protects the product's
core promise — Risk #1 (cut amounts must be mathematically correct vs the goal
target/timeframe) and Risk #2 (degenerate goal inputs must never push NaN/∞ to
the UI). The codebase currently has **zero tests**.

## Starting Point

`computeRecommendations` ([recommendations.ts:34](src/lib/services/recommendations.ts#L34))
is a pure data-in/data-out function — ideal for cheap unit tests — but it reads
the wall clock internally (`new Date()` for the 30-day window and
months-remaining), and the `@/*` import alias lives only in `tsconfig.json`.
There is no runner, no test script, and CI runs only lint + build.

## Desired End State

`npm run test` runs Vitest green locally and in CI. A co-located
`recommendations.test.ts` proves the empty-input baseline, the PRD-derived Risk
#1 oracle (correct amounts, highest→lowest ranking, minimum cut set, plus the
on-track/no-cuts boundary), and the Risk #2 finiteness invariant across the four
reachable degenerate inputs. The test foundation and conventions are set for
rollout Phases 2–4.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Runner | Vitest ≥ 3.2 | Vite-native; Astro 6 is Vite 7, which needs Vitest 3.2+ | Research |
| Runner config | `vitest/config` + `environment:'node'` + `vite-tsconfig-paths` | Lightest fit for a pure function; alias stays synced with tsconfig | Plan |
| Test layout | Co-located (`src/lib/services/*.test.ts`) | Conventional Vitest default; trivial discovery; sets the project convention | Plan |
| Determinism | `TZ=UTC` + `vi.setSystemTime` | Function reads the clock and does local-time date math → DST can flip the month-count without UTC | Research/Plan |
| Risk #1 oracle | Hand-worked PRD example (surplus 210000¢, required 300000¢, gap 90000¢ → cuts `[dining 80000, shopping 10000]`) | Oracle from PRD §Business Logic + US-01 AC, never from the implementation | Research |
| Expired-goal result | Assert finiteness + `isExpired` only; defer shape | "empty/sentinel" vs shipped "aggressive cuts" is an unresolved product question | Plan |
| Risk #2 reach | Reachable inputs (green guards) + `it.todo` for malformed date | Locks existing guards now; surfaces the real NaN vector without scope creep | Plan |
| CI placement | `npm run test` step between lint and build, no secrets | Fail fast on logic before the heavier build; pure unit test needs no Supabase | Research |

## Scope

**In scope:** Vitest + `vite-tsconfig-paths` install; `vitest.config.ts`;
`test`/`test:watch` scripts; CI test step; one test file with the baseline, the
Risk #1 oracle (+ on-track edge), and the Risk #2 finiteness cases (+ a todo).

**Out of scope:** exhaustive math contract / ranking permutations / rounding
pinning (rollout Phase 2); the expired-goal shape decision; any production-code
change (incl. a malformed-date guard or clock injection); alert-threshold tests
(PRD Open Q2 → Phase 4); jsdom/component, integration/real-Supabase, Stryker,
e2e (later phases); §6 cookbook write-up.

## Architecture / Approach

One co-located Vitest spec exercises the pure `computeRecommendations`. A fixed
UTC clock (`TZ=UTC` + fake timers) makes the internal `new Date()` and
`target_date` day-math deterministic; fixtures are dated inside the 30-day window
so income isn't silently zeroed. CI gains a single `npm run test` step between
lint and build.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Runner bootstrap & CI wiring | Vitest installed/configured, scripts, CI step, green empty-input baseline test | Alias not resolving in the runner; Vitest/Vite 7 version mismatch |
| 2. Risk #1 cut-math wedge | PRD-oracle "cuts needed" test + on-track/no-cuts boundary | Oracle-mirror (lifting expected values from code); DST/clock non-determinism |
| 3. Risk #2 degenerate guards | Finiteness invariant across 4 reachable inputs + malformed-date todo | Asserting the contested expired-goal *shape* instead of just finiteness |

**Prerequisites:** Node 22.14 (`.nvmrc`); npm install access. No DB/secrets.
**Estimated effort:** ~1 session across 3 small phases.

## Open Risks & Assumptions

- Local-time date math in the engine is DST-sensitive; mitigated by `TZ=UTC` —
  if that's ever dropped, the month-count oracle can drift.
- Phase 1/2 land **green** (the guards/math are already correct); their value is
  regression protection, not bug-finding — by design for a "first wedge".
- The real NaN vector (malformed `target_date`) is logged, not fixed; it stays
  open until rollout Phase 2 picks it up.

## Success Criteria (Summary)

- `npm run test` is green locally and as a CI step between lint and build.
- The Risk #1 oracle test asserts PRD-derived numbers and *fails* if a constant is broken.
- Every degenerate-input case yields only finite numeric fields — no `$NaN`/`$∞` can reach the UI.
