# Edit Savings Goal — Plan Brief

> Full plan: `context/changes/edit-savings-goal/plan.md`

## What & Why

Let a signed-in user edit an existing savings goal (name, target amount, target date)
from `/goals`. This completes CRUD for `savings_goals` — Update was the only missing
operation — and brings forward the v2-backlog item that PRD FR-008 and the roadmap
"Deferred" section had parked over "recalculation complexity." That concern turns out
moot: recommendations are computed live server-side per request, so an edited goal
flows into the next computation exactly like a deleted one.

## Starting Point

Goals already support Create (`POST /api/goals`), Read (`getUserGoals`), and Delete
(`DELETE /api/goals/[id]`). The DB tier already permits owner-scoped updates via the
`savings_goals_authenticated_update` RLS policy, and the item route file
(`goals/[id].ts`) already holds a DELETE handler. No service `updateGoal`, no PUT
route, and no edit affordance in `GoalsManager` exist yet.

## Desired End State

Each goal card on `/goals` has an Edit button that turns the card into a prefilled
inline form (name, amount in dollars, date) with Save/Cancel. Saving persists via
`PUT /api/goals/<id>` and updates the card in place; dashboard/recommendations reflect
the change on next load. Editing an expired goal's name is allowed; only a *changed*
date must be in the future. Missing/non-owned id → 404, unauthenticated → 401, invalid
input → 400.

## Key Decisions Made

| Decision                    | Choice                                        | Why (1 sentence)                                                                                     | Source |
| --------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------ |
| Editable fields             | Name + amount + date (all three)              | Users expect to fix a typo'd name too; one coherent form reusing all create fields.                  | Plan   |
| Future-date rule on edit    | Enforce only when the date changes            | An expired goal must stay renameable; new dates still validated — checked server-side, not trusted.  | Plan   |
| Edit UX                     | Inline edit-in-place                          | Reuses existing FormField + row layout; roadmap explicitly says "edit-in-place"; no modal dependency. | Plan   |
| HTTP method                 | PUT full replace                              | Client always sends all mutable fields; coexists with DELETE in the same `[id].ts` route file.        | Plan   |
| Test coverage               | Hermetic handler + real-Supabase isolation    | UPDATE is a new mutation path Risk #5 doesn't yet cover; a mock can't prove the RLS policy holds.     | Plan   |
| Docs                        | Update roadmap + PRD FR-008                    | Keep the 10x foundation honest — docs currently say edit is deferred, contradicting shipped behavior. | Plan   |

## Scope

**In scope:** service `getGoalById` + `updateGoal`; `PUT /api/goals/[id]` with
conditional future-date validation and 404 semantics; inline edit UI in `GoalsManager`;
hermetic handler tests; one real-Supabase update-isolation test; PRD/roadmap refresh.

**Out of scope:** transaction editing; partial-field PATCH; optimistic UI; undo/history;
any change to the 3-goal cap, RLS policies, or schema; automated UI/component tests
(no jsdom); new recommendations logic.

## Architecture / Approach

PUT is full-replace of the mutable fields. The handler reads the goal by id first
(owner-scoped by RLS) — `null` → 404 — then validates (reusing the create schema's
name/amount rules, relaxing the future-date rule to fire only when the date differs
from the stored value), converts dollars→cents, and calls `updateGoal`. The UI mirrors
the shipped create/delete flows: per-row in-flight guard, pessimistic state update,
inline error.

## Phases at a Glance

| Phase                                       | What it delivers                                              | Key risk                                                        |
| ------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| 1. Service + PUT endpoint + hermetic tests  | `getGoalById`/`updateGoal`, PUT route, handler tests          | Getting the conditional future-date + 404 ordering right       |
| 2. Inline edit-in-place UI                  | Edit button → prefilled inline form → PUT → state update      | Draft/edit-mode state branch in an already-stateful component  |
| 3. Integration test + docs refresh          | Real-Supabase update-isolation test; PRD/roadmap update       | Integration test needs Docker/local Supabase (ad-hoc, not CI)  |

**Prerequisites:** none for phases 1–2; Docker + local Supabase for phase 3's integration test.
**Estimated effort:** ~1–2 sessions across 3 phases (mostly pattern-mirroring of the shipped create/delete changes).

## Open Risks & Assumptions

- Assumes recommendations stay a live per-request computation (no caching) — true today; if goals ever get cached/denormalized, edit would need invalidation.
- The read-then-update adds a second query; acceptable given ≤3 goals per user.
- Sharing the name/amount validation between POST and PUT (rather than duplicating) is preferred to avoid drift — the implementer factors this.

## Success Criteria (Summary)

- A user can edit a goal's name/amount/date in place and the change persists and re-flows into recommendations.
- A user cannot edit another user's goal (404 / RLS-enforced, proven by integration test).
- PRD and roadmap no longer describe editing as deferred.
