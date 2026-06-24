# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-22

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data. For SpendLens the
   interview converged on one area three times over (the wedge cut-math) —
   that convergence is the strongest signal in this plan.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/` (excluding
`src/components/ui/`, build output, lockfiles).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                                          | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Cut-suggestion **amount is mathematically wrong** relative to the goal's target/timeframe; the user trusts it, under-saves, and the product's core promise is broken             | High   | High       | PRD §Business Logic + US-01 AC ("Suggestions are mathematically correct relative to the goal target and timeframe"); interview Q1; hot-spot dir `src/lib/services/` (3 commits/30d) |
| 2   | Degenerate goal inputs (timeframe 0, goal date in the past, zero/negative surplus) produce **NaN / Infinity that renders straight to the UI** instead of a guarded result        | High   | High       | interview Q2; PRD FR-006 (amount + timeframe inputs); `lessons.md` (render-to-UI failure mode)                                                                                      |
| 3   | **Cut ranking order is wrong** — categories not ordered highest-impact → lowest, so the suggested "minimum set of cuts" is incorrect even when each number is right              | Medium | High       | interview Q3 ("roulette"); PRD §Business Logic ("ranks expense categories by the reduction amount needed, from highest-impact to lowest"); hot-spot dir `src/lib/services/`         |
| 4   | **Excessive-spending alert mis-fires** — fires for normal categories (noise) or misses a disproportionate one — because the threshold is wrong                                   | Medium | Medium     | PRD FR-009; **Open Question Q2 — threshold baseline UNRESOLVED (oracle gap)**                                                                                                       |
| 5   | **Cross-user data leak** — a user reads another user's transactions, goals, or recommendations (broken ownership / IDOR), violating the hard isolation guardrail                 | High   | Medium     | PRD NFR (strict per-user isolation) + §Access Control; abuse lens (authorization/ownership); hot-spot dir `src/pages/` (API churn)                                                  |
| 6   | **3-goal cap bypassed or weak server-side validation** — a 4th active goal, or a negative / zero / absurd amount or timeframe, is accepted at the API even when the UI blocks it | Medium | Medium     | PRD FR-007; roadmap S-04 risk ("enforce at both API and UI to avoid a race-condition window"); abuse lens (server-side validation parity)                                           |
| 7   | **SSR page throws → blank 500** (and raw Supabase error / PII leaks into the error surface) instead of a graceful error card                                                     | Medium | Medium     | `lessons.md` (documented prior burn); hot-spot dir `src/pages/` (6 commits/30d)                                                                                                     |

**Impact × Likelihood rubric.** High = user loses access/data/money or the
failure is publicly visible / area changes weekly or already burned us.
Medium = feature degrades with a workaround / touched occasionally and has
been a bug source. Low = cosmetic / stable code. Rows ordered by impact ×
likelihood; #1 and #2 (High × High) are protected first. #5 is High-impact ×
Medium-likelihood but is grouped with #6 in §3 Phase 3 to batch the
real-infrastructure setup cost — a deliberate cost × signal trade, not a
priority demotion.

**Abuse / security lens.** SpendLens has auth, per-user financial data, and
user input, so the map carries abuse rows: #5 (authorization / ownership —
the endpoint must verify _this resource is yours_, not just _you are logged
in_) and #6 (server-side validation parity — the server must not trust the
client). Secret/PII leakage is folded into #7 (error surface). Rate-limit /
resource-abuse is out of scope for this MVP (§7).

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                 | Must challenge                                      | Context `/10x-research` must ground                                                                                                         | Likely cheapest layer                                                                             | Anti-pattern to avoid                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| #1   | A hand-worked example (income, spend, goal target, timeframe → expected per-category cut amounts) matches the output                        | "It returns a number, so it must be right"          | the exact formula chain: monthly surplus, additional monthly saving required, per-category reduction                                        | unit (pure function)                                                                              | **oracle mirror** — expected value lifted from the implementation rather than a hand-worked example |
| #2   | Timeframe = 0, past goal date, and ≤ 0 surplus each return a **safe guarded result** (empty / sentinel), never NaN/Infinity reaching the UI | "valid goals are the only inputs the function sees" | what the function does at each boundary today, and where the guard belongs                                                                  | unit (edge cases)                                                                                 | happy-path-only; asserting the current NaN/Infinity output as "expected"                            |
| #3   | Given known per-category reductions, the output is strictly ordered highest → lowest, with a defined tie-break                              | "the sort looks right by eye"                       | the ranking key and the tie-break rule                                                                                                      | unit (parameterized)                                                                              | mirroring the implementation's comparator instead of asserting the PRD ordering rule                |
| #4   | An alert fires **iff** a category exceeds the _defined_ threshold                                                                           | "the threshold the code already uses is correct"    | **resolve Open Question Q2 first** — the threshold baseline is undefined; the oracle must come from the user/PRD, not from the shipped code | unit                                                                                              | **oracle mirror against an undefined spec** — the single most dangerous trap here                   |
| #5   | A request authenticated as User A can never return User B's rows                                                                            | "logged in implies authorized"                      | whether ownership is enforced by Supabase RLS (DB tier) or by an explicit `user_id` filter in the service layer                             | integration (real DB, two users) — or hermetic if a service-level filter is the only guard        | over-mocking the DB — a mock cannot prove an RLS policy holds                                       |
| #6   | A 4th active-goal insert is rejected, and negative / zero / absurd amounts and timeframes are rejected **server-side**                      | "the UI blocks it, so the API is safe"              | where the cap is enforced, the count constraint, and what the zod schema actually validates                                                 | integration (real count constraint)                                                               | a mock that lies about the current goal count                                                       |
| #7   | A thrown service error surfaces a clean error card — no blank 500, no raw Supabase error or PII in the response                             | "it works locally, so it's fine"                    | the error contract the SSR page's try/catch is meant to catch                                                                               | unit / hermetic on the service error contract (full page render → e2e, out of scope this rollout) | brittle full-page snapshot that breaks on cosmetic change                                           |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                                      | Goal (one line)                                                                                      | Risks covered | Test types                               | Status  | Change folder                                      |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------- | ------- | -------------------------------------------------- |
| 1   | Runner bootstrap + first wedge test             | Stand up Vitest, wire it into CI, and land the first real assertion on the cut-math                  | #1, #2        | unit                                     | planned | context/changes/testing-runner-bootstrap-wedge/    |
| 2   | Wedge-math contract                             | Full behavioral coverage of the cut engine: correct amounts, degenerate-input guards, ranking order  | #1, #2, #3    | unit (parameterized + edge)              | planned | context/changes/wedge-math-contract/               |
| 3   | Data-tier guardrails                            | Prove ownership isolation and the 3-goal cap hold against real DB constraints a mock would lie about | #5, #6        | integration (real Supabase, ad-hoc gate) | planned | context/changes/data-tier-guardrails/              |
| 4   | Threshold oracle + SSR error surface + cookbook | Assert the (resolved) alert threshold and the SSR error contract; fill in §6 cookbook                | #4, #7        | unit / hermetic + cookbook               | planned | context/changes/alert-threshold-and-error-surface/ |

**Status vocabulary** (fixed — parser literals): `not started` → `change opened`
→ `researched` → `planned` → `implementing` → `complete`.

Phase 1 deliberately bundles runner bootstrap with the first wedge-math
assertion (the test base is `none`; nothing is testable until the runner
exists). Phase 4's Risk #4 is **blocked on resolving Open Question Q2** — the
excessive-spending threshold — before any assertion can be written without
mirroring the shipped code.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer                    | Tool                                                            | Version  | Notes                                                                                           |
| ------------------------ | --------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| unit + integration       | Vitest (Vite-native; hypothesis — research confirms in Phase 1) | none yet | none yet — see §3 Phase 1. Astro is Vite-based, so Vitest is the conventional fit               |
| hermetic / stub client   | stubbed Supabase client                                         | none yet | none yet — see §3 Phase 4 (partial-failure and error-contract branches)                         |
| integration (real infra) | local Supabase (`npx supabase start`, Docker)                   | n/a      | none yet — see §3 Phase 3. Ad-hoc gate (not every commit) — local infra is expensive            |
| mutation (selective)     | Stryker                                                         | none yet | optional, narrow-scope after §3 Phase 2 on the cut-math module only — not a CI gate             |
| e2e                      | Playwright                                                      | n/a      | deferred — full SSR page render verification is out of scope for this rollout (course Lesson 4) |
| accessibility            | axe-core                                                        | n/a      | not planned this rollout                                                                        |

**Stack grounding tools (current session):**

- Docs: none — Context7 / framework-docs MCP not available in current session; Vitest/Astro/Supabase test setup must be grounded via web search during Phase 1 research; checked: 2026-06-22
- Search: web search MCP available — use to confirm current Vitest + Astro config and Supabase local-test patterns before Phase 1; checked: 2026-06-22
- Runtime/browser: none used — Playwright/browser MCP not relevant this rollout (e2e deferred to Lesson 4); checked: 2026-06-22
- Provider/platform: Supabase (local CLI for integration) — relevant to §3 Phase 3 real-DB tests; Trigger.dev MCP present but irrelevant; checked: 2026-06-22

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase <N>" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate                                       | Where            | Required?                                          | Catches                                               |
| ------------------------------------------ | ---------------- | -------------------------------------------------- | ----------------------------------------------------- |
| lint + typecheck (`eslint`, `astro check`) | local + CI       | required (already wired)                           | syntactic / type drift                                |
| unit                                       | local + CI       | required after §3 Phase 1                          | cut-math logic regressions                            |
| integration (real Supabase)                | local, ad-hoc    | required after §3 Phase 3 (ad-hoc, not per-commit) | isolation / constraint regressions                    |
| mutation (Stryker, narrow scope)           | local, selective | optional after §3 Phase 2                          | tests that pass without really asserting the cut-math |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase <N>."

### 6.1 Adding a unit test

- **Where**: co-locate `*.test.ts` next to the source (e.g.
  `src/lib/services/recommendations.test.ts`); the unit config collects
  `src/**/*.test.ts`. Use explicit `vitest` imports (no globals).
- **Runner**: `npm run test` (CI) / `npm run test:watch` — both set `TZ=UTC`. The
  cut-math reads the wall clock (30-day window, months-remaining), so freeze it
  with `vi.useFakeTimers()` + `vi.setSystemTime("2026-06-01T00:00:00Z")` in a
  per-`describe` `beforeEach`/`afterEach`, and date fixtures inside the window.
- **Oracle discipline**: assert a hand-worked value from the PRD / domain (the cut
  amounts; the alert threshold `floor(income × 0.12)`), NEVER the implementation
  constant — an oracle-mirror passes against a bug. Add at least one edge per risk
  (boundary, missing input, degenerate). See `recommendations.test.ts`.

### 6.2 Adding an integration test (real Supabase)

- **Prerequisites**: Docker running + the `supabase` CLI (devDep). The first
  `supabase start` pulls images (slow); later runs are fast.
- **Layout**: integration specs live in `tests/integration/*.integration.test.ts`
  (OUTSIDE the unit glob `src/**/*.test.ts`) and run via the separate
  `vitest.config.integration.ts` — `globalSetup` boots Supabase and `provide()`s
  the URL/keys to workers; `pool: forks` + `singleFork` serialize against the one
  DB; `TZ=UTC`. The unit config `exclude`s `**/*.integration.test.ts`.
- **Two users**: use `tests/integration/helpers/users.ts`. `adminClient()`
  (service_role/secret) is for `createTestUser` / `deleteTestUser` ONLY — it
  bypasses RLS, so never assert through it. Each `TestUser.client` is an anon-key
  client signed in AS that user, so `auth.uid()` resolves under RLS.
- **Assert isolation** by calling the service helpers (`getUserGoals`,
  `getUserTransactions`, `deleteGoal`) with each user's client, pairing every
  "A can't see B" assertion with a positive control ("A sees its own") so it
  can't pass vacuously. See `tests/integration/isolation.integration.test.ts`.
- **Gotcha**: `createGoal(client, userId, …)` inserts `user_id: userId` against
  INSERT `WITH CHECK (user_id = auth.uid())` — seed via the user's OWN client so
  the row passes the policy (and, for the cap, the _trigger_ is what fires on the
  4th — see `goal-cap.integration.test.ts`).
- **Run** (ad-hoc, NOT in CI): `npm run test:integration`.

### 6.3 Adding a hermetic (stub-client) test

- **When**: for partial-failure / error-contract branches real infra can't easily
  trigger — e.g. a service wrapping a Supabase error into a clean message-only
  `Error` (the SSR error contract, Risk #7), or an API handler's status mapping.
  Runs in the fast unit suite (`npm run test`), no Docker.
- **How**: stub a chainable client (the query builder is a thenable — chain
  methods return the same object; `then` resolves `{ data, error }`) and pass it
  to the service; assert the contract (e.g. the thrown value is an `Error` with
  only `.message` — no raw `{code,details,hint}`/PII). See
  `src/lib/services/savings-goals.test.ts`. For a route handler, `vi.mock` the
  client + service and invoke it with a mocked `APIContext` (mocking
  `@/lib/supabase` also dodges the `astro:env` virtual import) — see
  `src/pages/api/goals.test.ts`.
- **When a hermetic test LIES**: it can't prove DB constraints, cascades, or RLS
  (a stub returns whatever you tell it) — use a real-Supabase integration test
  (§6.2) for those.

### 6.4 Adding a test for a new API endpoint

- **Two layers, by cost × signal.** Test the handler's HTTP concerns (auth gate,
  zod validation, status mapping) **hermetically** in the unit suite; prove the
  real DB side-effect (e.g. the cap) via a direct-service **integration** test (§6.2).
- **Hermetic handler test** (`src/pages/api/<route>.test.ts`, runs per-commit):
  `vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => ({})) }))` and mock
  the service module, then invoke the exported `POST`/`GET` with a mocked
  `APIContext` (`{ locals: { user }, request: new Request(...), cookies: {} }`).
  Mocking `@/lib/supabase` also stops the `astro:env/server` virtual import from
  being evaluated under plain Vitest. Assert status + mapping (401 unauth, 400
  zod, 409 from a thrown cap message, 500 otherwise). See
  `src/pages/api/goals.test.ts`.
- **When the full deployed shape forces e2e**: exercising the route through real
  request cookies → middleware → RLS is e2e (Lesson 4) — out of scope for the
  unit + integration layers here.

### 6.5 Per-rollout-phase notes

(After each phase lands, `/10x-implement` appends a 2–3 line note here
capturing anything surprising the phase taught.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Supabase email/password auth (login/signup) flow** — it is the starter's, gated by RLS, and trusted. Re-evaluate if auth moves off the starter or gains OAuth. (Source: Phase 2 interview Q5.) Note: this is the _authentication_ flow only — _data ownership / isolation_ (Risk #5) is in scope and is a separate concern.
- **shadcn/ui components** — vendored; the upstream library is the test. Snapshot tests here break on cosmetic change and catch nothing. Re-evaluate if a component is forked and given custom logic. (Source: Phase 2 interview Q5.)
- **Static landing / marketing page** — cosmetic, no domain logic. (Source: Phase 2 interview Q5.)
- **Rate-limiting / resource-abuse / magic-link floods** — not an MVP concern at this scale; revisit if the product opens to untrusted signups. (Source: abuse-lens review; not raised as a top-N risk.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-22
- Stack versions last verified: 2026-06-22
- AI-native tool references last verified: 2026-06-22

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
