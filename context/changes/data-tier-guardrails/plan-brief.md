# Data-tier Guardrails — Plan Brief

> Full plan: `context/changes/data-tier-guardrails/plan.md`
> Research: `context/changes/data-tier-guardrails/research.md`

## What & Why

Rollout Phase 3 of the test plan: prove the data-tier guardrails a mock can't —
Risk #5 (per-user data isolation via RLS) and Risk #6 (the 3-goal cap + the
API's server-side validation). These protect the product's hard guarantee
(no cross-user data access) and its server-side validation parity.

## Starting Point

Ownership is enforced **entirely by Supabase RLS** (`user_id = auth.uid()` on
every op; no service-layer filter, no service-role key) and the cap by a DB
`BEFORE INSERT` trigger — both confirmed by research. Recommendations are
computed, not stored. The unit runner (Vitest 3.2) exists but has never booted
real infra; Docker + the supabase CLI are available locally.

## Desired End State

`npm run test:integration` (local, Docker) boots Supabase, seeds two
authenticated users, and proves User A never reads or deletes User B's rows
(with positive controls) and a 4th goal is rejected by the trigger. The unit
suite gains a fast hermetic handler test (401/400/409) that runs per-commit, and
stays Docker-free. Cookbook §6.2/§6.4 are filled.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Test layer for #5/#6 cap | Integration (real Supabase, two users) | RLS + trigger have no service-layer guard a mock could fake | Research |
| Harness | Separate `vitest.config.integration.ts` + `tests/integration/`, `globalSetup` boots `supabase start`, `singleFork`, `TZ=UTC` | Keep unit suite fast/Docker-free; serialize DB access | Research |
| Auth | admin `createUser` (setup/teardown only) + per-user anon `signInWithPassword` clients | service_role bypasses RLS, so assertions must use real per-user JWTs | Research |
| #5 surface | SELECT isolation (both tables) + cross-user DELETE no-op | Covers the read leak + the sharpest RLS-only guard without an exhaustive matrix | Plan |
| #6 depth | Integration cap (real trigger) + hermetic handler test (401/400/409) | The validation-parity risk is "at the API" → test the handler; cap needs the real DB | Plan |
| Controls | Positive controls on every isolation test | A broken query / empty DB can't pass isolation vacuously (the F2 hardening, integration-side) | Plan |
| Gating | `test:integration` local/ad-hoc, NOT in CI | Docker is expensive + CI authoring is out of lesson scope | Research/Plan |
| Cookbook | Fill §6.2 + §6.4 now | Both literally say "see Phase 3"; capture the pattern while fresh | Plan |

## Scope

**In scope:** integration harness (config, globalSetup, two-user helper, script);
#5 isolation (reads both tables + cross-user delete + controls); #6 cap
(integration) + handler validation (hermetic, per-commit); cookbook §6.2/§6.4.

**Out of scope:** per-commit CI for integration / new CI workflow (Lesson 5);
full cookie→RLS e2e (Lesson 4); auth login/signup tests (§7); exhaustive RLS
matrix; new migrations/schema/CHECK; exposing `deleteGoal` via an endpoint.

## Architecture / Approach

A second Vitest config drives `tests/integration/**` with a `globalSetup` that
boots Supabase and publishes the local keys; a helper mints two anon-authed
clients (admin for setup only). Risk tests call the existing service helpers
(`getUserGoals`, `getUserTransactions`, `deleteGoal`, `createGoal`) directly with
each user's client — the risk lives in Postgres, not the HTTP handler. #6's
handler HTTP concerns are tested hermetically (module-mocked) in the unit suite.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Harness + proof-of-life | Integration config, Supabase boot, two-user helper, `test:integration`, one RLS round-trip | Glob leak into unit suite; cold-boot flake |
| 2. #5 isolation | A can't read/delete B's rows; positive controls | Vacuous pass without controls; asserting "no error" instead of "no-op" |
| 3. #6 cap + validation | Real trigger rejects 4th goal; hermetic handler 401/400/409 | `createGoal` WITH-CHECK gotcha; `astro:env` import in the handler test |
| 4. Cookbook §6.2/§6.4 | Integration + API-endpoint how-to | Drift from what was actually built |

**Prerequisites:** Docker running + `supabase` CLI (both confirmed); first `supabase start` pulls images (slow).
**Estimated effort:** ~1–2 sessions across 4 phases (Phase 1 is the bulk: new infra).

## Open Risks & Assumptions

- First `supabase start` is slow (image pull) — budgeted in `hookTimeout` (120s).
- Integration tests are **ad-hoc**: green depends on a contributor running them locally with Docker; CI won't catch regressions in them (by design).
- The hermetic handler test relies on module-mocking `@/lib/supabase` to dodge the `astro:env` virtual import — if that proves fragile, fall back to exporting the zod schema and unit-testing it directly.

## Success Criteria (Summary)

- `npm run test:integration` proves: A reads/deletes only A's rows (controls hold); the 4th goal is rejected by the trigger.
- `npm run test` stays unit-only, fast, and gains the hermetic 401/400/409 handler test (per-commit).
- §6.2/§6.4 cookbook let a reader run the suite and add an endpoint test without re-deriving the approach.
