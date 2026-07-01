# Goal-Anchored Recommendations — Plan Brief

> Full plan: `context/changes/goal-anchored-recommendations/plan.md`

## What & Why

Implement the SpendLens north star: a `/recommendations` page where a signed-in user with imported transactions and at least one active savings goal sees ranked, category-specific expense-cutting suggestions mathematically tied to each goal, alongside excessive-spending alerts. This is the feature that proves the core product hypothesis — "spending insight is only useful when it is goal-anchored and actionable."

## Starting Point

F-01 is fully complete: `categories`, `transactions`, and `savings_goals` tables are live in Supabase with RLS and integer-cent monetary storage. Typed service helpers (`getUserTransactions`, `getUserGoals`, `getCategories`) are in place. The dashboard is currently a stub with no navigation and no data surface. S-01 (bank import) and S-04 (goal creation) are prerequisites that must land before this slice is implemented.

## Desired End State

A signed-in user navigates to `/recommendations` via a top-nav link, selects a goal tab, and sees up to 5 ranked expense cuts (category + dollar amount) that would close the gap between their current monthly surplus and the required monthly saving for that goal. Excessive-spending alerts (categories above ~12% of monthly income) appear above all tabs. Goals already on track show a success card. Expired goals keep their tab with a badge. Missing income shows an explanatory banner.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Excessive-spending threshold | 30% income total budget; alert at 40% of that (~12% of income per category) | Provides a concrete, income-relative rule without requiring the user to set budgets manually | Plan |
| Transaction window | Rolling 30 days ending today | More stable than a calendar month for users who check mid-month; simpler than historical averaging | Plan |
| Cut distribution algorithm | Greedy (sort by spend desc, fill gap, stop at 5) | Matches PRD "minimum set of cuts" language; surfaces the fewest, highest-impact changes | Plan |
| Suggestion cap | 5 per goal | Beyond 5 the list becomes noise; the gap is almost always closed by then | Plan |
| On-track state | "You're on track!" card + still show alerts if any | Affirms progress while keeping the alerts section useful for spending hygiene | Plan |
| Expired goal handling | Show "Expired" badge on tab, keep suggestions | User still owns the goal until they delete it; forcing them to act on deletion before seeing data is poor UX | Plan |
| Missing income handling | Informational banner, skip calculation | Calculating without income data produces misleading results; the banner explains why | Plan |
| Rendering approach | Full SSR Astro page + React island for tabs only | All data is available at page load; client-side fetch adds latency with no benefit | Plan |
| Entry point | New page at `/recommendations` | Clean separation; avoids crowding the dashboard stub | Plan |
| Multi-goal layout | Tabs (one per goal), alerts above | Tabs scale to 3 goals cleanly; alerts are goal-agnostic and belong above the tab boundary | Plan |

## Scope

**In scope:**
- `src/lib/services/recommendations.ts` — pure computation engine
- New recommendation types in `src/types.ts`
- `src/pages/recommendations.astro` — SSR data orchestration + smart empty states
- `src/components/RecommendationsPanel.tsx` — React island with tabs, suggestions, alerts, banners
- `src/components/Topbar.astro` — nav link to `/recommendations`
- `src/middleware.ts` — add `/recommendations` to `PROTECTED_ROUTES`

**Out of scope:**
- API route for recommendations (SSR is sufficient; no separate endpoint)
- Cross-goal suggestion deduplication (v2)
- Accelerate-on-track suggestions (v2)
- Real-time updates (page refresh is sufficient for MVP)
- Goal editing (S-05 scope is delete-only)

## Architecture / Approach

The recommendations engine is a pure TypeScript function with no Supabase dependency — it takes already-fetched `TransactionWithCategory[]` and `SavingsGoal[]` and returns a fully typed `RecommendationsResult`. The Astro page fetches data server-side, calls the engine, and passes the result as a prop to the `RecommendationsPanel` React island. The island manages only tab-switching state (no data fetching). All monetary values travel as integer cents; the island formats them for display. The 2-second NFR is met by SSR — no client-side data fetches block the initial render.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Engine + Types | Pure `computeRecommendations()` function + output interfaces | Math correctness — verify against a hand-worked example before wiring UI |
| 2. SSR Page | `/recommendations` route with server-side data fetch, route protection, and smart empty states | Empty-state logic must correctly detect which prerequisite is absent |
| 3. React Island | Full recommendations UI: tabs, suggestions, alerts, on-track/expired/missing-income states | All visual states must render correctly across 1–3 goals |
| 4. Navigation | "Recommendations" link in Topbar | Low-risk; follow existing nav pattern |

**Prerequisites:** S-01 (transactions in DB) and S-04 (goals in DB) must be done before implementation begins. F-01 (data schema) is already complete.

**Estimated effort:** ~2-3 sessions across 4 phases. Phase 1 is the mathematical core and warrants the most careful manual verification.

## Open Risks & Assumptions

- **S-01 and S-04 still pending** — this plan cannot be implemented until both prerequisites land; the plan is written against what they will deliver
- **Income transaction detection** — assumes S-01 imports salary/income transactions with `type = 'income'`; if S-01 only imports expenses, the missing-income banner will always show
- **Negative surplus edge case** — if expenses exceed income (net negative), `monthly_surplus_cents` is negative; the gap calculation correctly shows a larger-than-target shortfall, which is accurate but could look alarming to users; accepted for MVP
- **Date arithmetic precision** — month-difference calculation uses `/ 30 days` approximation; goals ending in the same month as creation will have `months_remaining = 1` (floored) — intentional but worth noting

## Success Criteria (Summary)

- A user with transactions and a goal sees at least one suggestion on the `/recommendations` page
- Each suggestion names the expense category and the estimated saving amount in correct dollars
- The page renders within 2 seconds of navigation (PRD NFR)
