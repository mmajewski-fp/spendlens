# Create Savings Goal Implementation Plan

## Overview

Implement S-04 from the roadmap: a signed-in user can create up to 3 active savings goals
(name, target amount, target date) from a dedicated `/goals` page. The data layer (schema,
RLS, 3-goal trigger, TypeScript types, service functions) is fully in place from
`data-schema-foundation`. This plan builds the API route, the interactive UI, and the
navigation link on top of that foundation.

## Current State Analysis

The `savings_goals` table, RLS policies, 3-goal `BEFORE INSERT` trigger, `SavingsGoal`
TypeScript type, and three service functions (`getUserGoals`, `createGoal`, `deleteGoal`)
are all implemented. No domain API routes exist yet. The dashboard is a minimal placeholder;
no goals management UI exists. The Topbar links to Dashboard and Recommendations. The
recommendations page already contains a hard-coded `href="/goals/new"` link that must be
corrected to `/goals` as part of this change.

### Key Discoveries

- `SavingsGoal` type — `src/types.ts` lines 29–39; `target_amount` in integer cents, `target_date` ISO date string.
- CRUD service — `src/lib/services/savings-goals.ts` (full file); `createGoal` re-throws DB errors verbatim, including the trigger message `'A user may not hold more than 3 active savings goals'`.
- 3-goal trigger — `supabase/migrations/20260527000000_data_schema_foundation.sql` lines 127–139; enforced `BEFORE INSERT`, counts all rows for `user_id` (no active/archived flag).
- API route pattern — `src/pages/api/auth/signin.ts`; Supabase client via `createClient(context.request.headers, context.cookies)`; `context.locals.user` is set by middleware before the handler runs.
- Recommendations page — `src/pages/recommendations.astro` line 69: `href="/goals/new"` needs updating to `href="/goals"`.
- Zod — not installed; not used anywhere in `src/`; AGENTS.md specifies it for all API routes. Must be installed in Phase 1.
- Lesson: wrap all SSR service calls in try/catch to avoid blank 500 pages (`context/foundation/lessons.md`).

## Desired End State

A signed-in user navigates to `/goals` via a Topbar link, sees their current goals listed
(name, formatted dollar amount, target date, months remaining), and can create a new goal
via an inline form. The form validates client-side and submits via `fetch`; errors appear
inline without a page reload. When 3 goals exist, the submit button is disabled with a
cap message. Creating a 4th goal returns a 409 from the API (and cannot be reached via
the disabled UI). Visiting `/goals` while unauthenticated redirects to sign-in.

## What We're NOT Doing

- Deleting goals (S-05 — separate change)
- Editing goals (parked to v2 backlog)
- Calculating required monthly savings or progress bars (needs transaction data from S-01)
- Real-time updates (not needed at this scale)
- Pagination (≤3 goals per user, no list pagination needed)
- shadcn DatePicker (native `<input type="date">` is sufficient)
- Migrating the DB schema (already done in data-schema-foundation)

## Implementation Approach

Phase 1 establishes the first domain API endpoint using zod (new pattern, no precedent in
the codebase). The API accepts JSON, returns JSON, guards with `context.locals.user`, and
maps the DB trigger error to a user-friendly 409. Phase 2 builds the UI as a single Astro
SSR page that server-renders the goal list and mounts a React island (`GoalsManager`) for
interactive form behaviour. Phase 3 wires the Topbar navigation link.

## Critical Implementation Details

**Trigger error detection.** The DB trigger raises `'A user may not hold more than 3 active
savings goals'`. The Supabase PostgREST error message will surface this text. The API route
must inspect the error message string and return a 409 with a friendly message; a generic
500 would confuse the client.

**Cents conversion.** The user enters a dollar value (e.g. `"1500.50"`). The API must
convert to integer cents with `Math.round(dollars * 100)` before passing to `createGoal`.
`parseFloat` on the raw JSON number is reliable here since JSON numbers are not subject to
locale-specific decimal separators.

**Future-date validation.** The `<input type="date">` `min` attribute uses the `YYYY-MM-DD`
string for tomorrow's date, computed client-side at render time. The zod schema must also
validate server-side: `new Date(target_date) > new Date()`. Note that both comparisons use
local time; for an MVP this is acceptable.

**Props contract (lesson).** `GoalsManager`'s `Props` interface is the authoritative
specification of what the Astro page must pass. The Astro page should not independently
enumerate props — it defers to whatever the component declares.

---

## Phase 1: POST /api/goals Endpoint

### Overview

Install zod and create the first domain API route. The endpoint accepts a JSON body,
validates it with zod, converts dollar amount to cents, calls the existing `createGoal`
service, and returns JSON for both success and error cases.

### Changes Required:

#### 1. Install zod

**File**: `package.json` (via npm install)

**Intent**: Add zod as a production dependency so it can be imported in API routes and
shared schema definitions.

**Contract**: Run `npm install zod`. No source file changes — the dependency resolves at
build time.

#### 2. Create goals API route

**File**: `src/pages/api/goals.ts`

**Intent**: Expose a `POST /api/goals` endpoint that creates a savings goal for the
authenticated user. Auth guard returns 401 JSON when `context.locals.user` is absent.
Input is validated with zod; validation errors return 400 JSON with field messages.
The DB trigger cap error is mapped to 409 with a friendly message. Success returns 201
with the created `SavingsGoal` object.

**Contract**:

```
export const prerender = false

export const POST: APIRoute = async (context) => {
  // 1. Auth guard: if (!context.locals.user) → 401 JSON { error: "Unauthorized" }
  // 2. Supabase client: createClient(context.request.headers, context.cookies)
  // 3. Parse body: context.request.json()
  // 4. Zod schema parse (safeParse):
  //    - name: string, min 1, max 100
  //    - target_amount_dollars: number (positive)
  //    - target_date: string, matches /^\d{4}-\d{2}-\d{2}$/, refine > today
  //    If parse fails → 400 JSON { error: string (first issue message) }
  // 5. Convert: target_amount = Math.round(target_amount_dollars * 100)
  // 6. Call createGoal(supabase, { name, target_amount, target_date })
  //    Catch: if message includes "3 active" → 409 JSON { error: "...3-goal limit..." }
  //    Other errors → 500 JSON { error: message }
  // 7. Success → 201 JSON { goal: SavingsGoal }
}
```

Import `createClient` from `@/lib/supabase`, `createGoal` from `@/lib/services/savings-goals`,
`SavingsGoal` from `@/types`, and `z` from `zod`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- `POST /api/goals` with a valid JSON body returns 201 with goal object
- `POST /api/goals` without auth (no session cookie) returns 401 JSON
- `POST /api/goals` with missing/invalid fields returns 400 JSON
- `POST /api/goals` when 3 goals already exist returns 409 JSON with cap message
- `POST /api/goals` with a past `target_date` returns 400 JSON

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: /goals Astro Page + GoalsManager React Component

### Overview

Build the goals management UI. The Astro page server-renders the goal list (SSR) and
mounts a `GoalsManager` React island for interactive form behaviour. Also update the
stale `/goals/new` link in the recommendations page.

### Changes Required:

#### 1. Add /goals to protected routes

**File**: `src/middleware.ts`

**Intent**: Gate `/goals` behind auth so unauthenticated visitors are redirected to sign-in.

**Contract**: Add `"/goals"` to the `PROTECTED_ROUTES` array at line 4.

#### 2. Create GoalsManager React component

**File**: `src/components/goals/GoalsManager.tsx`

**Intent**: Render the goal list and the Add Goal form in a single React island. Manages
local state for the goal list (seeded from server props), form field values, submission
state, and inline error/success feedback.

**Contract**:

```ts
interface Props {
  initialGoals: SavingsGoal[];
}
```

Internal behaviour:
- Goal list: for each goal, display name, formatted dollar amount (`$X,XXX.XX` via
  `Intl.NumberFormat`), target date, and months remaining. Months remaining is computed
  as `Math.max(0, (targetYear − nowYear) * 12 + (targetMonth − nowMonth))`, labeled
  `"N month(s) remaining"` (or `"Past due"` if 0).
- Cap state: derived from `goals.length >= 3`. When true, disable the submit button and
  display `"You've reached the 3-goal limit (max 3 active goals)."`.
- Form fields: `name` (text, required, maxLength 100), `targetAmountDollars` (number,
  step `0.01`, min `0.01`), `targetDate` (date, `min` = tomorrow as `YYYY-MM-DD`).
- Submit: `fetch("POST /api/goals", { body: JSON.stringify({ name, target_amount_dollars, target_date }) })`.
  On 201: append new goal to goals state, reset form fields, clear error.
  On error: set error message from response JSON `{ error }`.
- Styling: match the glassmorphism pattern from `dashboard.astro` and `recommendations.astro`
  (white/10 bg, border white/10, backdrop-blur-xl, text-white). Use `cn()` from `@/lib/utils`
  for conditional classes.

Import `SavingsGoal` from `@/types`.

#### 3. Create /goals Astro page

**File**: `src/pages/goals.astro`

**Intent**: Server-render the goals page shell and bootstrap the React island with the
authenticated user's current goals. Apply the try/catch lesson — transient Supabase errors
must render a graceful error card, not a blank 500.

**Contract**:

Frontmatter: create Supabase client (`createClient(Astro.request.headers, Astro.cookies)`),
call `getUserGoals(supabase)` inside try/catch, set `fetchError` on catch and `goals` on
success. If `!supabase`, set `configError = true`.

Template structure follows `recommendations.astro`:
- `<Layout title="Goals — SpendLens">`
- Topbar island (if used in other pages — check; currently Topbar is imported directly in pages that use it)
- `configError` card (same red-border style as recommendations.astro lines 43–47)
- `fetchError` card (same style as recommendations.astro lines 50–59)
- When no error: `<GoalsManager client:load initialGoals={goals} />`

#### 4. Fix stale link in recommendations page

**File**: `src/pages/recommendations.astro`

**Intent**: Update the "Create a savings goal" link to point to `/goals` instead of the
non-existent `/goals/new`.

**Contract**: Change `href="/goals/new"` (line 69) to `href="/goals"`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Visiting `/goals` while signed out redirects to `/auth/signin`
- Visiting `/goals` while signed in renders the goals page
- Form submits successfully; new goal appears in the list without a page reload
- When 3 goals exist, submit button is disabled and cap message is shown
- Refreshing `/goals` after creating a goal shows the goal (SSR re-fetch)
- Recommendations page "Create a savings goal" link navigates to `/goals`

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Topbar Navigation Link

### Overview

Add a Goals navigation link to the authenticated nav in Topbar.astro, between Dashboard
and Recommendations.

### Changes Required:

#### 1. Add Goals link to Topbar

**File**: `src/components/Topbar.astro`

**Intent**: Surface `/goals` to authenticated users directly from the top navigation bar.

**Contract**: Inside the authenticated branch (`user ?` — lines 9–23), add an `<a href="/goals">` element between the Dashboard link (line 13) and the Recommendations link (line 16). Match the existing link class: `text-purple-300 transition-colors hover:text-purple-100 hover:underline`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- "Goals" link appears in the Topbar for signed-in users
- "Goals" link is absent for signed-out users (the unauthenticated branch is unchanged)
- Clicking the Goals link navigates to `/goals`

**Implementation Note**: After all automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Manual Testing Steps:

1. Sign in and navigate to `/goals` via Topbar link → page renders with empty goal list.
2. Fill in the Add Goal form (name, amount, future date) and submit → goal appears inline, no page reload.
3. Repeat until 3 goals exist → submit button is disabled with cap message.
4. Reload the page → all 3 goals persist (SSR re-fetch).
5. Sign out → clicking Goals in Topbar redirects to sign-in.
6. Navigate to `/recommendations` → "Create a savings goal" link navigates to `/goals` (not 404).
7. (API) Test POST with past date → 400; without auth → 401; with 4th goal via curl → 409.

## Performance Considerations

The goals page SSR is a single `SELECT *` query filtered by `auth.uid()` (RLS-enforced),
returning at most 3 rows. No pagination, no joins. Performance is not a concern at this scale.

## Migration Notes

No schema migration needed — `savings_goals` table and all RLS/trigger objects are live
from `data-schema-foundation`.

## References

- Roadmap slice S-04: `context/foundation/roadmap.md` lines 34, 93–103
- data-schema-foundation change: `context/changes/data-schema-foundation/change.md`
- Migration (table + trigger): `supabase/migrations/20260527000000_data_schema_foundation.sql` lines 91–139
- Types: `src/types.ts` lines 29–39
- CRUD service: `src/lib/services/savings-goals.ts`
- API pattern reference: `src/pages/api/auth/signin.ts`
- Page pattern reference: `src/pages/recommendations.astro`
- Lessons: `context/foundation/lessons.md`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: POST /api/goals Endpoint

#### Automated

- [x] 1.1 Lint passes
- [x] 1.2 Build passes

#### Manual

- [x] 1.3 Valid POST returns 201 with goal object
- [x] 1.4 POST without auth returns 401 JSON
- [x] 1.5 POST with invalid fields returns 400 JSON
- [x] 1.6 POST when 3 goals exist returns 409 JSON with cap message
- [x] 1.7 POST with past target_date returns 400 JSON

### Phase 2: /goals Astro Page + GoalsManager React Component

#### Automated

- [ ] 2.1 Lint passes
- [ ] 2.2 Build passes

#### Manual

- [ ] 2.3 /goals while signed out redirects to sign-in
- [ ] 2.4 /goals while signed in renders goals page
- [ ] 2.5 Form submits and new goal appears inline without page reload
- [ ] 2.6 At 3 goals, submit button disabled and cap message shown
- [ ] 2.7 Refresh after creating a goal shows the goal (SSR re-fetch)
- [ ] 2.8 Recommendations "Create a savings goal" link navigates to /goals

### Phase 3: Topbar Navigation Link

#### Automated

- [ ] 3.1 Lint passes
- [ ] 3.2 Build passes

#### Manual

- [ ] 3.3 Goals link appears in Topbar for signed-in users
- [ ] 3.4 Goals link absent for signed-out users
- [ ] 3.5 Clicking Goals link navigates to /goals
