---
change_id: data-tier-guardrails
title: Data-tier guardrails — ownership isolation and the 3-goal cap against real DB constraints
status: archived
created: 2026-06-23
updated: 2026-06-24
archived_at: 2026-06-24T07:40:02Z
---

## Notes

Rollout Phase 3 of context/foundation/test-plan.md: "Data-tier guardrails" — prove ownership isolation and the 3-goal cap hold against real DB constraints a mock would lie about.

Risks covered: #5 (cross-user data leak — a user reads another user's transactions, goals, or recommendations; broken ownership / IDOR, violating the hard per-user isolation guardrail) and #6 (3-goal cap bypassed or weak server-side validation — a 4th active goal, or a negative/zero/absurd amount or timeframe, accepted at the API even when the UI blocks it).

Test types: integration (real local Supabase via `npx supabase start` + Docker), run as an AD-HOC gate — NOT per-commit CI (local infra is expensive; per test-plan §4/§5). Keep this suite separate from the fast unit suite so `npm run test` stays unit-only.

Builds on rollout Phases 1–2 (archived at context/archive/2026-06-22-testing-runner-bootstrap-wedge/ and context/archive/2026-06-23-wedge-math-contract/): Vitest 3.2 is the runner, but integration is a NEW test type — it needs real-Supabase setup (seed two users, authenticate AS each so RLS is exercised, isolation/teardown between tests), likely a separate vitest config/include-glob + a `test:integration` script. Do not re-bootstrap the runner.

Risk response intent (oracle discipline carried from prior phases):
- #5: prove "a request authenticated as User A can NEVER return User B's rows" (transactions, goals, recommendations). Challenge "logged in implies authorized". /10x-research MUST ground whether ownership is enforced by Supabase RLS (DB tier) or by an explicit user_id filter in the service layer — this decides integration (real DB, two users) vs hermetic. Anti-pattern: over-mocking the DB — a mock cannot prove an RLS policy holds.
- #6: prove a 4th active-goal insert is REJECTED, and negative/zero/absurd amounts and timeframes are rejected SERVER-SIDE. Challenge "the UI blocks it, so the API is safe". /10x-research MUST ground where the cap is enforced (data-schema-foundation added a BEFORE INSERT trigger; create-savings-goal maps it to a 409 at the API) and what the goals API zod schema actually validates. Anti-pattern: a mock that lies about the current goal count.

Apply lessons.md — especially the determinism rule (no ambient timezone/locale dependence; pin) and the SSR try/catch rule where relevant.

Lesson boundaries: this is integration (real DB) per Lesson 2's two-layer cost×signal strategy. It is NOT e2e/Playwright/MCP/browser (that is Lesson 4), and it is NOT the auth login/signup flow (out of scope per test-plan §7 — data ownership/isolation is a separate concern that IS in scope).

Open questions /10x-research must resolve before planning: how to stand up and authenticate real-Supabase integration tests under Vitest (local CLI, two-user seeding, per-user JWT clients for RLS, test isolation + teardown); how to gate them ad-hoc (separate script/config) so they don't run on every commit/CI; and confirm the actual enforcement mechanism per risk (RLS vs service-layer filter; DB trigger vs API check) to pick integration vs hermetic.
