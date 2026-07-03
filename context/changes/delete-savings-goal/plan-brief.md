# Delete Savings Goal — Plan Brief

> Full plan: `context/changes/delete-savings-goal/plan.md`

## What & Why

Roadmap slice S-05 / FR-008: a signed-in user should be able to delete an existing savings goal. The PRD scopes the MVP to delete-only (editing is v2 backlog). Today goals can be created and listed but never removed.

## Starting Point

The data layer is already done: `deleteGoal(client, id)` exists in savings-goals.ts, and an RLS delete policy scopes deletions to the owner (deleting a missing/other-user goal is a silent no-op). `GoalsManager.tsx` already lists goals and holds them in state; `/api/goals.ts` has POST but no DELETE. The only gaps are the HTTP endpoint and a UI button.

## Desired End State

Each goal card on `/goals` has a Delete button. Clicking it prompts a native confirm(); on confirm, the client calls `DELETE /api/goals/<id>` and the goal disappears from the list once the server confirms. Cancelling leaves it; a failed delete keeps it with an inline error. Deleting below the 3-goal cap re-enables the create form automatically.

## Key Decisions Made

| Decision        | Choice                                            | Why (1 sentence)                                                       |
| --------------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| Endpoint shape  | Dynamic route `DELETE /api/goals/[id]`            | RESTful item route; keeps the collection (POST) and item routes clean. |
| Confirm UX      | Native `confirm()` before delete                  | Zero deps, guards a non-recoverable action, ships immediately.        |
| List update     | Pessimistic (remove after 2xx)                    | List never lies; mirrors the create flow (append after success).      |
| Response        | Idempotent 2xx (no 404)                           | RLS makes non-matching deletes a no-op; no rows-affected check needed. |
| Testing         | Hermetic DELETE-handler tests (mirror goals.test) | Covers auth/wiring/errors without jsdom; UI verified manually.        |

## Scope

**In scope:** `DELETE /api/goals/[id]` route; confirm-guarded Delete button + pessimistic removal + inline error in GoalsManager; hermetic handler tests.

**Out of scope:** goal editing; undo/soft-delete; 404 semantics; optimistic UI; bulk delete; changes to deleteGoal/RLS/schema; custom modal; automated UI test.

## Architecture / Approach

New `src/pages/api/goals/[id].ts` exports `DELETE`: 401 gate on `context.locals.user`, 500 if `createClient` is null, reads id from `context.params.id`, calls `deleteGoal`, returns 2xx (idempotent), maps thrown errors to 500 — mirroring the POST handler. `GoalsManager.tsx` gains a per-row Delete button with a `confirm()` guard, a `deletingId` in-flight state, `setGoals(filter)` on success, and inline error on failure.

## Phases at a Glance

| Phase                                          | What it delivers                                          | Key risk                                     |
| ---------------------------------------------- | -------------------------------------------------------- | -------------------------------------------- |
| 1. Delete endpoint + button + handler tests    | `/api/goals/[id]` DELETE + Delete button + tests         | Correct id extraction from param; auth gate  |

**Prerequisites:** S-04 (create-savings-goal) — done; `deleteGoal` + RLS in place.
**Estimated effort:** ~1 session, single phase.

## Open Risks & Assumptions

- Native `confirm()` is unstyled and not unit-testable — accepted; UI verified manually.
- Idempotent 2xx means deleting a non-existent id returns success (no distinct 404) — accepted.

## Success Criteria (Summary)

- A user can delete a goal (with confirm) and it disappears from the list; cap re-enables.
- The DELETE endpoint rejects unauthenticated requests and is idempotent.
- Handler tests + lint + build green.
