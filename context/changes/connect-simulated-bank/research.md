---
date: 2026-07-01T10:58:03+02:00
researcher: Michał Majewski
git_commit: 12b46cebb23af95211c06cf9b18612d9e0cd346d
branch: main
repository: mmajewski-fp/spendlens
topic: "S-01 connect-simulated-bank — import pipeline: simulated bank API + auto-categorization"
tags: [research, codebase, transactions, categories, import, simulated-bank, categorization]
status: complete
last_updated: 2026-07-01
last_updated_by: Michał Majewski
---

# Research: connect-simulated-bank (S-01)

**Date**: 2026-07-01T10:58:03+02:00
**Researcher**: Michał Majewski
**Git Commit**: 12b46cebb23af95211c06cf9b18612d9e0cd346d
**Branch**: main
**Repository**: mmajewski-fp/spendlens

## Research Question

For roadmap slice **S-01**: a signed-in user triggers "Connect Bank", the simulated banking API returns transactions seeded against their account, and an import pipeline persists them under the user with auto-assigned categories, then confirms data landed. What is the exact reuse surface, the vertical-slice conventions to mirror, the design of the (decided) **in-repo deterministic** simulated-API + categorization modules, and the cheapest test layer for each concern?

## Summary

- **This slice is purely additive — no schema work.** The entire data tier (tables, RLS, idempotent insert, category taxonomy) shipped in F-01 and explicitly deferred "import" to S-01. S-01 adds a generation + mapping + orchestration layer *in front of* `createTransactions`.
- **Decided approach (this session): an in-repo deterministic module**, not an HTTP mock. Split into three modules: a **pure generator**, a **pure description→category mapper**, and an **impure orchestrator** that resolves category ids and persists — plus a `POST` API route mirroring `goals.ts`.
- **Idempotency is free.** `transactions` has `UNIQUE (user_id, external_id)` and `createTransactions` already upserts with `onConflict: "user_id,external_id", ignoreDuplicates: true`. If the generator emits a **stable** `external_id` per transaction, re-connecting is idempotent by construction.
- **Two hard invariants for the wedge to work end-to-end:** (1) the generator MUST emit at least one `income` (salary) row **dated inside the last 30 days**, or S-06 suppresses all recommendations/alerts (no income baseline); (2) all logic must be deterministic — no `Math.random()` / `Date.now()` / ambient locale (per `lessons.md`).
- **Route reconciliation needed:** the shipped `recommendations.astro` empty-state CTA already links to **`/transactions/import`** — the connect surface should live there (or the CTA must be updated). This is the main open decision for planning.
- **Test layering (cost × signal):** category mapping + amount conversion = **unit** (pure); import idempotency + per-user isolation = **integration, real Supabase** (a mock can't prove a UNIQUE constraint or RLS); SSR/route error contract = **hermetic/unit**. All three harnesses already exist and are directly reusable.

## Detailed Findings

### 1. F-01 data-layer reuse surface (the insert target)

**Schema — `supabase/migrations/20260527000000_data_schema_foundation.sql`**

- `transactions` table (lines 51–62): `amount integer NOT NULL` (**cents, always positive** — sign carried by `type`, never the amount); `type text NOT NULL CHECK (type IN ('income','expense'))` (56); `category_id uuid REFERENCES categories(id)` — **nullable** (54); `external_id text` (59) "idempotency key for simulated API import"; `date date NOT NULL` (58); `UNIQUE (user_id, external_id)` (61).
- **RLS** (66–85): SELECT/INSERT/UPDATE/DELETE all scoped `user_id = auth.uid()`, INSERT is `WITH CHECK (user_id = auth.uid())` (71–74). **Pure DB-tier isolation — no service-layer `user_id` filter, no service-role key.** ⇒ the import must run under the **user's own** authenticated client and set each row's `user_id` to that user, or the INSERT is rejected.
- `categories` (12–15): `{id, name, slug}`, seeded with the **11 fixed rows** `ON CONFLICT (slug) DO NOTHING` (33–45): `groceries, dining, transport, housing, utilities, entertainment, healthcare, shopping, travel, salary, other`. Readable by anon + authenticated (21–30).

**Service layer**

- `src/lib/services/transactions.ts:19–30` — `createTransactions(client, rows: Omit<Transaction,"id"|"created_at">[]): Promise<Transaction[]>`. Uses `.upsert(rows, { onConflict: "user_id,external_id", ignoreDuplicates: true }).select()`. **Duplicates are silently skipped and NOT returned** — a second import returns only newly-inserted rows (often `[]`). Throws message-only `Error` on failure.
- `src/lib/services/transactions.ts:6–17` — `getUserTransactions(client, since?): Promise<TransactionWithCategory[]>`, `select("*, category:categories(name, slug)")`, optional `.gte("date", since)`. RLS-filtered automatically.
- `src/lib/services/categories.ts:4–9` — `getCategories(client): Promise<Category[]>`, `select("id, name, slug").order("name")`. **There is no lookup-by-slug helper** — the orchestrator must fetch all and build a `Map<slug,id>`.

**Types — `src/types.ts`**: `TransactionType = "income"|"expense"` (1); `Category {id,name,slug}` (3–7); `Transaction` (9–23) with `amount` cents/positive, `date` `YYYY-MM-DD`, `external_id` nullable; `TransactionWithCategory = Transaction & { category: Pick<Category,"name"|"slug"> | null }` (25–27).

**Insert contract** (what the pipeline must hand `createTransactions`, per row):
`{ user_id: <auth user uuid>, category_id: <uuid|null>, amount: <positive int cents>, type: "income"|"expense", description: <string|null>, date: "YYYY-MM-DD", external_id: <stable string> }`.

### 2. Vertical-slice conventions to mirror (S-04 create-savings-goal)

The shipped goals feature is the exact template. Copy the page → api-route → island → service shape.

- **Astro SSR page** `src/pages/goals.astro`: `const supabase = createClient(Astro.request.headers, Astro.cookies)` (9); service calls wrapped in **try/catch** with `configError` / `fetchError` flags (11–23, per `lessons.md`); island gated + props passed `<GoalsManager client:load initialGoals={goals} />` (53). No `prerender` on pages.
- **API route** `src/pages/api/goals.ts`: `export const prerender = false` (7); `export const POST: APIRoute` (33); auth guard `if (!context.locals.user) → 401` (34–36); `createClient(context.request.headers, context.cookies)`, `!supabase → 500` (38–41); `await context.request.json()` in try/catch → 400 (43–48); **zod** `schema.safeParse` → 400 with `issues[0].message` (11–24, 50–54); dollars→cents `Math.round(x * 100)` (56); service call in try/catch mapping errors to status codes (409 for business rule, 500 otherwise) (58–71); `jsonResponse(payload, status)` helper (26–30).
- **React island** `src/components/goals/GoalsManager.tsx`: `interface Props { initialGoals: SavingsGoal[] }` (8–10) — **authoritative prop surface** (`lessons.md`); `fetch("/api/goals", { method:"POST", ... })` (71–80); `useState(initialGoals)`, loading/error/success handling (37–100).
- **Middleware** `src/middleware.ts`: sets `context.locals.user` for every request (7–16); `PROTECTED_ROUTES = ["/dashboard","/recommendations","/goals"]` (4) with `startsWith` redirect to `/auth/signin` (18–22). API routes need **no** middleware entry (they self-guard via `locals.user`); a new protected *page* route must be added here.
- **Client factory** `src/lib/supabase.ts:5–24` — `createClient(requestHeaders: Headers, cookies: AstroCookies): SupabaseClient | null`.
- **Nav** `src/components/Topbar.astro:13–21` — authenticated links (Dashboard / Goals / Recommendations); a "Connect Bank" link follows the same markup.

### 3. Simulated-API + categorization design (decided: in-repo deterministic module)

**Greenfield verdict: definitively greenfield.** No generator, fixture, `faker`, seed script, or connect endpoint exists anywhere. `scripts/` is empty; the only "simulat"/`external_id` matches are the schema/type surface that *anticipates* this slice and one integration test that hand-writes rows.

**Proposed module split** (matches roadmap's "two pieces with separate failure modes"):

| Module | Path (proposed) | Responsibility | Pure? |
| --- | --- | --- | --- |
| Generator | `src/lib/services/simulated-bank.ts` | `(userId, today) → SimulatedTransaction[]` (amount cents, type, description, date, external_id). No DB, no category ids. | pure |
| Mapper | `src/lib/services/transaction-categorizer.ts` | `description → category slug` (one of 11, `other` fallback). Keyword lookup. | pure |
| Orchestrator | `src/lib/services/import-transactions.ts` | generator → mapper → resolve slug→id via `getCategories` → shape rows → `createTransactions`. | impure (I/O) |
| API route | `src/pages/api/.../*.ts` | `POST`, `prerender=false`, auth guard, calls orchestrator, returns landed count/preview. Mirrors `goals.ts`. | impure (I/O) |

Keeping generator + mapper **DB-free and pure** makes them unit-testable without mocking Supabase — same house style as the pure `computeRecommendations` vs its wiring.

**Deterministic seeding (no `Math.random`/`Date.now`/ambient locale — `lessons.md`):**
- Derive a 32-bit seed from `userId` (FNV-1a over UTF-16 code units — codepoint-stable, locale-free), feed a small pure PRNG (mulberry32/xorshift32). Same `userId` ⇒ same transaction set every connect.
- **Dates:** the pure generator must not read the wall clock — the orchestrator/route injects a `today` (`YYYY-MM-DD`) anchor derived from UTC, and the generator computes `date = today − offsetDays` for PRNG `offsetDays ∈ [0,29]`, so every row lands in the S-06 30-day window. Emitting plain `YYYY-MM-DD` avoids TZ shift (`recommendations.ts` parses via `iso.split("-")`).
- **Idempotency:** `external_id = sim-${userId}-${index}` (a pure function of `userId`+index, **date-independent**). Re-connecting regenerates the same ids ⇒ the existing upsert no-ops duplicates. No "clear then re-insert" path needed.

**Description→category mapping:**
- Static ordered keyword→slug table (e.g. `grocer|market → groceries`, `restaurant|cafe → dining`, `uber|fuel|transit → transport`, `rent|mortgage → housing`, `electric|water|internet → utilities`, `salary|payroll → salary`, …); no match → `"other"`.
- Case/locale-safe: lowercase + substring `includes` on the ASCII keyword set (locale-independent); for any ordering/tie-break use **codepoint comparison** (`recommendations.ts:29–31` `compareStrings`), never bare `localeCompare`.
- Slug→id resolution lives in the **orchestrator** (`getCategories` → `Map<slug,id>`); missing slug → `other` id → else `null` (`category_id` is nullable and `recommendations.ts` already treats null as Other).

**Generator invariants (must hold or downstream breaks):**
- `amount` positive integer cents for both types; sign via `type`.
- `type ∈ {income, expense}` (CHECK constraint).
- **≥1 `income` (salary) row inside the 30-day window**, sized so at least one expense category can exceed 12% of monthly income (so S-06 recommendations *and* the alert threshold have signal). Zero in-window income ⇒ S-06 sets `hasMissingIncome` and shows nothing.
- Expenses spread across several category slugs so S-02 dashboard + S-06 ranking are non-degenerate.
- `external_id` non-null and stable; `user_id` = authenticated user (satisfies RLS `WITH CHECK`).

**Failure/edge handling:**
- Empty generation → upsert `[]` → return `{ imported: 0 }` (0 is a valid, displayable count per the roadmap outcome).
- Re-connect → returns only new rows (often `[]`); **decide in the plan** whether the UI shows "N new imported" or the user's total count (a follow-up `getUserTransactions`).
- DB errors → API route mirrors `goals.ts` try/catch → JSON error + status; any SSR page frontmatter call must be try/caught to render an error card, not a blank 500 (`lessons.md`).

### 4. Testing strategy (cheapest layer per concern)

| Concern | Layer | Why | Reuse |
| --- | --- | --- | --- |
| Category mapping; decimal→cents; source→row shape | **unit** (pure, co-located `*.test.ts`) | deterministic transform, no I/O; cheapest real signal. Oracle discipline: assert hand-worked mappings, never mirror the lookup table | `vitest.config.ts` glob `src/**/*.test.ts`, `TZ=UTC`; cookbook §6.1; explicit `vitest` imports |
| Import idempotency (`UNIQUE`+upsert) | **integration, real Supabase** | a mock can't prove a DB UNIQUE/upsert-conflict behavior | copy `tests/integration/goal-cap.integration.test.ts`; `vitest.config.integration.ts` + `globalSetup.ts` |
| Per-user isolation (Risk #5) | **integration, real Supabase, two users** | a mock cannot prove an RLS policy holds | direct clone of `tests/integration/isolation.integration.test.ts` (41–63, 77–82) |
| SSR/route error contract (Risk #7) | **hermetic / unit** | full-page render = e2e = deferred; stub the chainable client, assert `Error` message-only (no PII) | cookbook §6.3 + `savings-goals.test.ts`; route via `vi.mock("@/lib/supabase")` + mocked `APIContext`, cf. `api/goals.test.ts` (§6.4) |

**Seed + assert recipe (from the existing harness):** `adminClient()` for setup/teardown ONLY (never assert through it) → `createTestUser(admin)` returns an anon-key client signed in AS that user → **seed via the user's OWN client** (call the real import entry point with `userA.client`) → assert with a **positive control** (`getUserTransactions(userA.client)` sees A's rows, not B's; and symmetric) → idempotency: import same `external_id` set twice, second `.select()` is `[]` and count unchanged → teardown `deleteTestUser` (FK cascade). Run ad-hoc: `npm run test:integration` (Docker; not CI).

## Code References

- `supabase/migrations/20260527000000_data_schema_foundation.sql:33-45` — 11 seeded category slugs
- `supabase/migrations/20260527000000_data_schema_foundation.sql:51-62` — transactions columns, CHECK, `UNIQUE(user_id, external_id)`
- `supabase/migrations/20260527000000_data_schema_foundation.sql:66-85` — transactions RLS (all ops `user_id = auth.uid()`)
- `src/lib/services/transactions.ts:19-30` — `createTransactions` idempotent upsert (persist target)
- `src/lib/services/transactions.ts:6-17` — `getUserTransactions`
- `src/lib/services/categories.ts:4-9` — `getCategories` (slug→id source; no by-slug helper)
- `src/types.ts:1,9-27` — `TransactionType`, `Transaction`, `Category`, `TransactionWithCategory`
- `src/pages/api/goals.ts:7,26-72` — API route pattern (prerender, auth guard, zod, cents conversion, try/catch, status mapping, `jsonResponse`)
- `src/pages/goals.astro:9,11-23,53` — SSR page pattern (client factory, try/catch, island props)
- `src/components/goals/GoalsManager.tsx:8-10,71-80` — island Props (authoritative) + fetch call
- `src/middleware.ts:4,7-22` — `locals.user`, `PROTECTED_ROUTES`
- `src/lib/supabase.ts:5-24` — `createClient(headers, cookies)`
- `src/components/Topbar.astro:13-21` — authenticated nav links
- `src/pages/recommendations.astro:87-92` — **existing empty-state CTA linking to `/transactions/import`** (route reconciliation)
- `src/lib/services/recommendations.ts:10,44-56,77-78,93-95` — 30-day window, income requirement, 12% threshold, bucket ranking (why income + spread matter)
- `tests/integration/isolation.integration.test.ts:41-63,77-82` — seed-via-own-client + positive-control isolation pattern
- `tests/integration/goal-cap.integration.test.ts` — constraint-under-real-DB pattern for idempotency
- `tests/integration/helpers/users.ts:21-52` — `adminClient` / `createTestUser` / `deleteTestUser`

## Architecture Insights

- **Pure core, impure shell.** The repo consistently separates a pure business function (`computeRecommendations`) from its Supabase/Astro wiring. S-01 should follow it: pure generator + pure mapper, impure orchestrator + route. This is what makes the unit layer cheap and the determinism rule enforceable.
- **Idempotency is a schema-level guarantee, not app logic.** `UNIQUE(user_id, external_id)` + `ignoreDuplicates` upsert means the app never needs "have I imported before?" logic — it just needs *stable* `external_id`s.
- **RLS is the only isolation mechanism.** No service-layer `user_id` filter exists; correctness depends on running under the user's own client. Any import path that used a service-role/admin client would silently bypass isolation — an anti-pattern to avoid.
- **The wedge is coupled to income + recency.** S-06 (the north star) shows nothing unless imported data has in-window income and category spread. S-01's generator design is therefore also a *fixture-quality* decision for the whole product demo.

## Historical Context (from prior changes)

- `context/changes/data-schema-foundation/plan.md:31` — "No simulated bank API integration (that is S-01's job)" — import explicitly deferred to this slice.
- `context/changes/data-schema-foundation/plan.md:47` — "S-01 must multiply incoming decimal amounts by 100 and round" (cents contract binding on S-01).
- `context/changes/data-schema-foundation/plan.md:96,199-201,207-211` — `external_id` as idempotency key; `getCategories` named for the S-01 import; `createTransactions` "used by S-01's import pipeline".
- `context/archive/2026-05-27-goal-anchored-recommendations/plan.md:41,59-65,142,237` — S-06 consumes `TransactionWithCategory[]`, requires in-window income (else `hasMissingIncome` banner), 12%-income alert threshold, groups by `category_id` (null→Other).
- `context/archive/2026-06-23-data-tier-guardrails/plan.md:20-23,54-57` — services add no explicit `user_id` filter (RLS-only); integration fixtures should date relative to UTC "today".
- `context/foundation/lessons.md` — SSR try/catch (avoid blank 500); determinism (TZ=UTC, codepoint, no ambient locale); Phase N+1 Props authority.
- `context/foundation/roadmap.md:80-90,184,186` — S-01 spec; 12% threshold; Q3 resolved (fixed 11-category taxonomy, `Other` fallback).

## Related Research

- `context/archive/2026-05-27-goal-anchored-recommendations/` — the downstream consumer (S-06) plan + impl-review.
- `context/archive/2026-06-23-data-tier-guardrails/` — the integration-test harness this slice's isolation/idempotency tests reuse.
- `context/changes/data-schema-foundation/plan.md` — the schema this slice writes into.

## Open Questions

1. **Route/URL for the connect surface.** The shipped `recommendations.astro` CTA links to **`/transactions/import`**. Either (a) put the connect page there (and the API route under a matching path), or (b) update the CTA. Decide in the plan; (a) is lower-risk since the CTA already ships. (This supersedes the sub-agent's placeholder `/api/bank/connect`.)
2. **Trigger surface & UX.** Roadmap says "trigger from the dashboard"; the recommendations empty-state also points to import. Confirm the primary entry point (dashboard button, Topbar link, or the recommendations CTA) and whether a dedicated page or an inline action is wanted.
3. **"Landed" confirmation semantics.** Show newly-inserted count (0 on re-connect) or total transaction count via a follow-up `getUserTransactions`? Affects the island's Props + a possible `GET`.
4. **Generator dataset size/shape.** How many transactions, what income magnitude, and category distribution — enough to make S-02 dashboard and S-06 recommendations visibly meaningful without being noisy. A fixture-quality product decision.
5. **Keyword table ownership.** The description→category keyword map is authored alongside the generator's descriptions (coverage can be total-by-design). Confirm at least one description intentionally falls through to `Other` so the fallback path is exercised.
