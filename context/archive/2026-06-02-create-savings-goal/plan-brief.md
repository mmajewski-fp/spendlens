# Create Savings Goal — Plan Brief

> Full plan: `context/changes/create-savings-goal/plan.md`

## What & Why

S-04 from the roadmap: a signed-in user can create up to 3 active savings goals (name,
target amount, target date). Goals are the prerequisite for S-06 (goal-anchored
recommendations) — the core product hypothesis depends on them existing. The data layer
is already done; this slice builds the API and UI on top of it.

## Starting Point

The `savings_goals` table, RLS policies, 3-goal `BEFORE INSERT` trigger, `SavingsGoal`
TypeScript type, and `getUserGoals`/`createGoal`/`deleteGoal` service functions are all
live from `data-schema-foundation`. No domain API routes exist yet. Dashboard is a
minimal placeholder; no goals UI exists anywhere.

## Desired End State

A signed-in user opens `/goals` via a Topbar link, sees their goals listed (name, dollar
amount, target date, months remaining), and creates a new goal via an inline form with
client-side fetch. The form is disabled when 3 goals exist. A `POST /api/goals` endpoint
handles creation, using zod validation, cents conversion, and a 409 for the cap error.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Page location | Dedicated `/goals` page | Clean URL; dashboard stays a simple welcome placeholder for now. |
| Topbar nav | Add Goals link | Makes the feature discoverable without requiring the user to know the URL. |
| Form submission | Client-side fetch with inline feedback | No page reload; errors appear in the form — better UX than redirect-based auth flow. |
| Cap enforcement UI | Disable submit button when goals.length ≥ 3 | Prevents the error entirely; keeps the form visible so users can see their goals. |
| Amount input | Dollar text input → cents in API | Users think in dollars; API is the right place to convert (single source of truth). |
| Date input | Native `<input type="date">` | No extra dependency; consistent with codebase's lean approach. |
| Date constraint | Future only — min UI + zod refine | Both API and UI enforce it; prevents meaningless goals set in the past. |
| Goal card info | Name + amount + date + months remaining | Months remaining makes the goal feel concrete without needing transaction data. |
| API validation | Introduce zod (first domain route) | Establishes the pattern per AGENTS.md; downstream routes (transactions, recommendations API) will follow the same schema. |

## Scope

**In scope:**
- `POST /api/goals` JSON endpoint with zod validation and auth guard
- `/goals` Astro SSR page with `GoalsManager` React island
- Goals Topbar navigation link
- Fix stale `/goals/new` link in recommendations page → `/goals`

**Out of scope:**
- Deleting goals (S-05)
- Editing goals (v2 backlog)
- Monthly savings calculation / progress (requires transaction data from S-01)
- Any DB schema changes (data layer complete)

## Architecture / Approach

API route (`src/pages/api/goals.ts`) accepts JSON POST, validates with zod (install), converts
dollars to cents, calls the existing `createGoal` service, and maps the DB trigger error to a
409. Astro SSR page server-fetches goals, wraps in try/catch (lesson), and mounts a React
island for the interactive form. The island manages local goal list state, fetch submission,
and cap enforcement as derived UI state (`goals.length >= 3`).

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. POST /api/goals endpoint | First domain API route; zod validation; auth guard; cap → 409 | Zod install (new dep); trigger error message fragile string match |
| 2. /goals page + GoalsManager | Full UI — goal list, form, inline feedback, cap disabled state | First React island with fetch; no existing fetch-form pattern to copy |
| 3. Topbar navigation link | Goals link in authenticated nav | Trivial; risk of accidentally breaking Topbar layout |

**Prerequisites:** `data-schema-foundation` implemented (confirmed).
**Estimated effort:** ~2-3 sessions across 3 phases.

## Open Risks & Assumptions

- The trigger error message string `'A user may not hold more than 3 active savings goals'` is matched by substring in the API. If the message changes (e.g. Supabase locale wrapping), the 409 mapping would fall through to 500.
- `context.locals.user` in API routes is set by middleware — no documented guarantee this propagates to all API handler contexts; verify during Phase 1 manual testing.

## Success Criteria (Summary)

- Signed-in user can create up to 3 goals via `/goals`; the 4th is blocked at both UI (button disabled) and API (409).
- Created goals persist across page refreshes (SSR re-fetch).
- Goals link visible in Topbar for authenticated users; `/goals` redirects unauthenticated visitors to sign-in.
