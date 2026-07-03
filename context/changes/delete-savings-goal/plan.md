# Delete Savings Goal Implementation Plan

## Overview

Let a signed-in user delete one of their savings goals (roadmap **S-05** / **FR-008**; PRD scopes MVP to delete-only, edit is v2). Add a `DELETE /api/goals/[id]` route and a per-goal Delete button in `GoalsManager`, guarded by a native `confirm()`, removing the row from state only after the server confirms success.

## Current State Analysis

- **The service already exists**: `deleteGoal(client, id)` (`src/lib/services/savings-goals.ts`) runs `.delete().eq("id", id)` and throws on error. No change needed.
- **RLS already scopes deletes**: `savings_goals_authenticated_delete` policy (migration `20260527000000_data_schema_foundation.sql:118`) restricts deletes to the owner — deleting a missing or another user's goal is a silent no-op (0 rows), not an error.
- **`GoalsManager.tsx` owns the list + state**: renders per-goal cards (lines 107-118) and holds `goals` in `useState` (line 34). The create flow (lines 68-98) is the pattern to mirror: `fetch` → check `response.ok` → update state → inline `error`. `formatCents` already imported (line 7).
- **`/api/goals.ts` has only `POST`**: uses a `jsonResponse` helper, a `context.locals.user` 401 gate, and `createClient` (500 if null). The hermetic test `src/pages/api/goals.test.ts` mocks `@/lib/supabase` + the service and asserts status codes — the pattern to mirror for the DELETE handler.
- **No cross-impact**: dashboard/recommendations read goals live server-side, so a deleted goal simply drops out of future computations. Nothing to clean up.

### Key Discoveries:

- The only missing pieces are the HTTP DELETE handler and the UI button — the data layer (service + RLS) is done.
- RLS-as-no-op makes an idempotent 2xx response natural: no rows-affected check, no `deleteGoal` signature change.
- `goals.ts` (collection, `POST`) and a new `goals/[id].ts` (item, `DELETE`) coexist cleanly as separate Astro route files.

## Desired End State

On `/goals`, each goal card has a Delete control. Clicking it prompts a native `confirm("Delete "<goal name>"?")`; on confirm, the client calls `DELETE /api/goals/<id>`, and on success the goal disappears from the list. On failure the goal stays and an inline error shows. Unauthenticated or misconfigured requests are rejected (401/500). The 3-goal cap naturally frees up after a delete (create form re-enables).

Verified by: `npm run lint`, `npm run build`, `npx vitest run` all pass; new `[id].test.ts` covers the handler's auth gate, success path, and error mapping; manual check on `/goals` confirms confirm-guarded deletion, list removal, and cap re-enable.

## What We're NOT Doing

- No goal editing (v2 backlog per PRD FR-008 resolution).
- No undo / soft-delete / trash — hard delete, guarded by `confirm()`.
- No 404 semantics — delete is idempotent (2xx even if nothing matched).
- No optimistic UI (remove-before-confirm) — pessimistic update.
- No bulk delete.
- No change to `deleteGoal`, the RLS policy, or the schema.
- No styled/custom confirmation modal — native `confirm()`.
- No automated UI test (no jsdom in the repo); the button is manually verified.

## Implementation Approach

Single phase. Add the item-level DELETE route mirroring the existing POST handler's structure (auth gate, `createClient`, `jsonResponse`, try/catch → 500), returning a 2xx no-content on success. Wire a Delete button into each `GoalsManager` row with a `confirm()` guard, a per-row in-flight/disabled state, pessimistic state removal on success, and an inline error on failure. Add hermetic handler tests mirroring `goals.test.ts`.

## Critical Implementation Details

- **Idempotent delete**: because RLS silently drops non-matching deletes, the handler does not need a rows-affected check — call `deleteGoal` and return success. A stale id or double-click just succeeds.

## Phase 1: Delete endpoint + delete button + handler tests

### Overview

Add the DELETE route, the confirm-guarded Delete button with pessimistic removal, and hermetic handler tests.

### Changes Required:

#### 1. Delete API route

**File**: `src/pages/api/goals/[id].ts` (new)

**Intent**: Item-level endpoint to delete the caller's savings goal by id, auth-gated and idempotent.

**Contract**: `export const prerender = false;` and `export const DELETE: APIRoute`. Reads the goal id from `context.params.id`; returns 401 when `context.locals.user` is absent, 500 when `createClient` returns null, and a 2xx no-content (204, or 200 with a small JSON) on success. Calls `deleteGoal(supabase, id)`; wraps it in try/catch mapping a thrown service error to 500. Mirror the `jsonResponse` helper / gate shape from `src/pages/api/goals.ts`. Missing/other-user id is a silent no-op (still 2xx) — no rows-affected check.

#### 2. Delete button in GoalsManager

**File**: `src/components/goals/GoalsManager.tsx`

**Intent**: Add a per-goal Delete control that confirms, calls the endpoint, and removes the goal from state on success.

**Contract**: In the goal-list `.map()` (around lines 108-117), add a Delete button per row (styled with the existing `Button` + cosmic classes, in a destructive/rose accent). On click: `if (!confirm(\`Delete "${goal.name}"?\`)) return;` then `fetch(\`/api/goals/${goal.id}\`, { method: "DELETE" })`. Track a per-row in-flight id (e.g. `deletingId` state) to disable the button during the request. On a 2xx response, remove the goal via `setGoals((cur) => cur.filter((g) => g.id !== goal.id))` (pessimistic); on failure, set an inline `error` message and keep the goal. Reuse the existing `error` state/rendering pattern. Deleting below 3 goals re-enables the create form automatically via the existing `atGoalCap` derivation — no extra work.

#### 3. Handler tests

**File**: `src/pages/api/goals/[id].test.ts` (new)

**Intent**: Cover the DELETE handler's HTTP concerns hermetically.

**Contract**: Mirror `src/pages/api/goals.test.ts`: `vi.mock("@/lib/supabase")` and `vi.mock("@/lib/services/savings-goals", () => ({ deleteGoal: vi.fn() }))`. Cases: 401 when unauthenticated (service not called); 2xx success calls `deleteGoal` with the id from `context.params`; service error → 500. Build the `APIContext` with `params: { id }` like `goals.test.ts` builds its context.

### Success Criteria:

#### Automated Verification:

- Type checking / build passes: `npm run build`
- Linting passes: `npm run lint`
- Delete-handler tests pass: `npx vitest run src/pages/api/goals/[id].test.ts`
- Full unit suite passes: `npx vitest run`

#### Manual Verification:

- On `/goals`, each goal shows a Delete button; clicking it and confirming removes the goal from the list.
- Cancelling the `confirm()` dialog leaves the goal in place.
- After deleting below 3 goals, the create form re-enables (cap message clears).
- A failed delete keeps the goal and shows an inline error.
- Unauthenticated `DELETE /api/goals/<id>` returns 401.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before the phase-end commit.

---

## Testing Strategy

### Unit Tests:

- DELETE handler: 401 unauthenticated, 2xx success (calls `deleteGoal` with the path id), service error → 500.

### Integration Tests:

- None added; the RLS scoping is exercised by the existing local integration suite conventions if run, but not required here.

### Manual Testing Steps:

1. On `/goals`, create a goal, click Delete, confirm — it disappears.
2. Click Delete, cancel the dialog — it stays.
3. Create 3 goals (cap hit), delete one — the create form re-enables.

## Performance Considerations

Single-row delete by primary key; negligible. No new dependencies.

## Migration Notes

None — service, RLS, and schema already support delete.

## References

- Service: `src/lib/services/savings-goals.ts` (`deleteGoal`)
- Route + test pattern to mirror: `src/pages/api/goals.ts`, `src/pages/api/goals.test.ts`
- UI list/state pattern: `src/components/goals/GoalsManager.tsx:33-98`
- RLS delete policy: `supabase/migrations/20260527000000_data_schema_foundation.sql:118`
- Roadmap S-05 / FR-008: `context/foundation/roadmap.md`, `context/foundation/prd.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Delete endpoint + delete button + handler tests

#### Automated

- [x] 1.1 Type checking / build passes: `npm run build` — b115b04
- [x] 1.2 Linting passes: `npm run lint` — b115b04
- [x] 1.3 Delete-handler tests pass: `npx vitest run src/pages/api/goals/[id].test.ts` — b115b04
- [x] 1.4 Full unit suite passes: `npx vitest run` — b115b04

#### Manual

- [x] 1.5 Each goal shows a Delete button; confirming removes it from the list — b115b04
- [x] 1.6 Cancelling the confirm() dialog leaves the goal in place — b115b04
- [x] 1.7 Deleting below 3 goals re-enables the create form (cap message clears) — b115b04
- [x] 1.8 A failed delete keeps the goal and shows an inline error — b115b04
- [x] 1.9 Unauthenticated DELETE /api/goals/<id> returns 401 — b115b04
