# Edit Savings Goal Implementation Plan

## Overview

Let a signed-in user edit an existing savings goal — its name, target amount, and
target date — from `/goals`, persisting the change and re-flowing it through the
live recommendations engine. This completes CRUD for `savings_goals` (Update was
the only missing operation) and brings forward the v2-backlog item that PRD FR-008
and the roadmap "Deferred" section explicitly parked.

Add `getGoalById` + `updateGoal` to the savings-goals service, a `PUT /api/goals/[id]`
route (owner-scoped, reading the current goal to conditionally enforce the
future-date rule), an inline edit-in-place UI in `GoalsManager`, hermetic handler
tests, a real-Supabase integration test proving update isolation, and a docs
refresh so the PRD/roadmap stop claiming edit is deferred.

## Current State Analysis

- **The DB tier already permits owner-scoped updates**: the `savings_goals_authenticated_update`
  policy exists (`supabase/migrations/20260527000000_data_schema_foundation.sql:112`)
  with `USING (user_id = auth.uid())` + `WITH CHECK (user_id = auth.uid())`. No schema
  or policy change needed.
- **The 3-goal cap does not interfere with edit**: `check_savings_goal_limit` is a
  `BEFORE INSERT` trigger (`migration:137`) — an UPDATE never fires it.
- **The "recalculation complexity" that deferred edit is moot**: `computeRecommendations`
  (`src/lib/services/recommendations.ts:24`) reads goals fresh on each request; the
  dashboard/recommendations pages compute live server-side. An edited goal simply
  flows into the next computation — same as delete. Nothing to recompute or invalidate.
- **The service has Create/Read/Delete but no Update**: `getUserGoals`, `createGoal`,
  `deleteGoal` (`src/lib/services/savings-goals.ts`). No `updateGoal`, no single-row read.
- **The item route exists with only DELETE**: `src/pages/api/goals/[id].ts` has the
  auth gate, `createClient` null-check, `jsonResponse` helper, and try/catch → 500
  shape. `PUT` slots into the same file.
- **The create validator is the validation template**: `createGoalSchema` in
  `src/pages/api/goals.ts:12` — `name` (trim, 1–100 chars), `target_amount_dollars`
  (positive number, converted to cents via `Math.round(x * 100)`), `target_date`
  (YYYY-MM-DD regex + **must be in the future**). Edit reuses the name/amount rules
  verbatim but relaxes the future-date rule (see Critical Implementation Details).
- **`GoalsManager.tsx` owns the list + form + state**: renders per-goal cards
  (`src/components/goals/GoalsManager.tsx:131-153`), holds `goals` in `useState`,
  and the create flow (lines 67-121) plus the delete flow (lines 45-65) are the
  patterns to mirror — `fetch` → check `response.ok` → update state → inline `error`,
  with a per-row in-flight id (`deletingId`). `FormField` and `formatCents` already imported.
- **Hermetic handler test pattern is established**: `src/pages/api/goals/[id].test.ts`
  mocks `@/lib/supabase` + the service and asserts status mapping via a mocked
  `APIContext` with `params.id`.
- **Integration harness exists**: `tests/integration/isolation.integration.test.ts`
  proves Risk #5 (ownership) for select + delete using two truly-authenticated
  clients; it does NOT yet cover UPDATE. Helpers in `tests/integration/helpers/users.ts`
  (`createTestUser`, `deleteTestUser`, per-user `client`). Test-plan §6.2 documents the pattern.

### Key Discoveries:

- The only missing pieces are a service `updateGoal` (+ a single-row read for the
  date-diff check), the `PUT` handler, and the inline UI. The DB tier is done.
- **404 semantics differ from delete**: delete is an idempotent no-op (RLS silently
  drops non-matching rows). For PUT we read-then-update; a missing / non-owned id
  must map to **404**, not a silent success — the client is asking to modify a
  specific resource that isn't theirs/doesn't exist.
- The future-date rule must be enforced **server-side** (Risk #6 validation parity),
  so the handler compares the incoming date against the stored one rather than
  trusting a client flag.

## Desired End State

On `/goals`, each goal card has an **Edit** button. Clicking it turns that card into
an inline form prefilled with the goal's current name, amount (dollars), and date,
with **Save** and **Cancel**. Saving calls `PUT /api/goals/<id>`; on success the
card returns to display mode showing the updated values, and any recommendations /
dashboard views reflect the change on their next load. Editing the name or amount of
an already-expired goal is allowed (the future-date rule only bites when the date
itself changes). A request to edit a missing or another user's goal returns 404;
unauthenticated returns 401; invalid input returns 400.

Verified by: `npm run lint`, `npm run build`, `npx vitest run` all pass; new PUT
handler tests cover auth/validation/404/500 mapping; the integration suite
(`npm run test:integration`, ad-hoc) proves User A cannot update User B's goal; PRD
FR-008 commentary and the roadmap no longer describe edit as deferred; manual check
on `/goals` confirms inline edit, prefill, save, cancel, and expired-goal name edit.

## What We're NOT Doing

- No transaction editing — this change is savings goals only.
- No partial-field PATCH — PUT full replace of the mutable fields (name, amount, date).
- No optimistic UI — pessimistic update (state changes only after the server confirms).
- No undo / edit history / audit trail.
- No change to the 3-goal cap, the RLS policies, or the DB schema.
- No editing of `user_id`, `id`, or `created_at` (immutable server-side).
- No styled confirmation modal for edit — inline in-place form, no dialog dependency.
- No automated UI/component test (no jsdom in the repo) — the inline form is manually verified.
- No new recommendations logic — edited goals flow through the existing live computation unchanged.

## Implementation Approach

Three phases, each independently verifiable. Phase 1 lands the data + API tier
(service methods, PUT route, hermetic tests) — fully testable without touching the
UI. Phase 2 adds the inline edit-in-place UI in `GoalsManager`, mirroring the
existing create/delete flows. Phase 3 proves update isolation against a real
Supabase (extending the existing two-user harness) and refreshes the PRD/roadmap
docs so the foundation reflects shipped behavior.

PUT is full-replace of the mutable fields: the client always sends name + amount +
date. The handler reads the current goal first (owner-scoped by RLS) both to return
404 for a missing/non-owned id and to decide whether the future-date rule applies.

## Critical Implementation Details

- **Conditional future-date validation (server-side).** The create rule "target_date
  must be in the future" cannot apply verbatim to edit — an expired goal must still be
  renameable. The `PUT` handler fetches the stored goal, and enforces the future-date
  check **only when the incoming `target_date` differs from the stored one**. Name
  (1–100 chars) and amount (> 0) are always validated. This keeps validation server-side
  (Risk #6 parity) — it does not trust a client "date changed" flag.
- **Read-then-update ordering for 404.** Because RLS scopes the update to the owner,
  updating a non-owned/missing id would otherwise affect 0 rows and look like success.
  The handler reads the goal by id first: `null` → 404 (before any validation that
  would leak field-level info is unnecessary, but validate after the existence check
  so a 404 isn't masked by a 400). Then validate, then `updateGoal`.
- **Amount unit conversion.** The API contract takes `target_amount_dollars` (a
  number) and stores integer cents via `Math.round(dollars * 100)` — identical to
  `POST`. The UI edit form must prefill dollars from stored cents (`cents / 100`).

## Phase 1: Service methods + PUT endpoint + hermetic tests

### Overview

Add the single-row read and update to the service, the `PUT` handler with
validation / 404 / error mapping, and hermetic handler tests.

### Changes Required:

#### 1. Service: single-row read + update

**File**: `src/lib/services/savings-goals.ts`

**Intent**: Add `getGoalById` (owner-scoped single-row read, returns `null` when not
found/not owned) and `updateGoal` (owner-scoped update of the mutable fields,
returns the updated row), mirroring the existing `createGoal`/`deleteGoal` throw-on-error style.

**Contract**:
- `getGoalById(client, id): Promise<SavingsGoal | null>` — `.from("savings_goals").select("*").eq("id", id).maybeSingle()`; throw `new Error(error.message)` on a real error, return `data` (or `null`). RLS scopes visibility to the owner, so a non-owned id returns `null`.
- `updateGoal(client, id, fields): Promise<SavingsGoal>` where `fields` is `Pick<SavingsGoal, "name" | "target_amount" | "target_date">` — `.from("savings_goals").update(fields).eq("id", id).select().single()`; throw on error, throw if no row returned. Do NOT allow `id`/`user_id`/`created_at` in `fields`.

#### 2. PUT API route

**File**: `src/pages/api/goals/[id].ts`

**Intent**: Add a `PUT` handler alongside the existing `DELETE` to update the caller's
goal, auth-gated, validated, with 404 for missing/non-owned ids.

**Contract**: `export const PUT: APIRoute`. Sequence: 401 if `!context.locals.user`;
500 if `createClient` returns null; parse JSON body (400 on parse failure); read the
goal via `getGoalById` (404 if `null`); build the update schema (reuse name/amount
rules from `createGoalSchema`; make the future-date check conditional on the date
differing from the stored value — see Critical Implementation Details); 400 on zod
failure; convert dollars→cents via `Math.round(dollars * 100)`; call `updateGoal`;
return `200` with `{ goal }`; try/catch maps a thrown service error to 500. Factor
the shared name/amount validation so `POST` and `PUT` don't drift (e.g. a shared
base schema in the route module or a small helper) rather than copy-pasting.

**Contract (validation nuance)**: the future-date refinement compares the incoming
`target_date` to `storedGoal.target_date`; when equal, skip the "must be in the
future" refinement; when different, apply it. Keep the YYYY-MM-DD regex + real-date
check unconditionally.

#### 3. Hermetic handler tests

**File**: `src/pages/api/goals/[id].test.ts`

**Intent**: Cover the PUT handler's HTTP concerns hermetically, alongside the existing DELETE tests.

**Contract**: Extend the existing file. Mock `@/lib/supabase` and
`@/lib/services/savings-goals` (add `getGoalById` + `updateGoal` to the mock). Cases:
401 unauthenticated (service not called); 404 when `getGoalById` resolves `null`;
400 on invalid body (e.g. empty name, non-positive amount, a *changed* date in the
past); 200 success calls `updateGoal` with the path id and cents-converted amount;
allows an unchanged past date (name-only edit of an expired goal → 200); service
error → 500. Build `APIContext` with `params: { id }` and a `PUT` `Request` with a
JSON body, mirroring the DELETE context factory.

### Success Criteria:

#### Automated Verification:

- Type checking / build passes: `npm run build`
- Linting passes: `npm run lint`
- PUT handler tests pass: `npx vitest run "src/pages/api/goals/[id].test.ts"`
- Full unit suite passes: `npx vitest run`

#### Manual Verification:

- `PUT /api/goals/<own-goal-id>` with a valid body returns 200 and the updated goal.
- `PUT /api/goals/<nonexistent-id>` returns 404.
- Unauthenticated `PUT` returns 401.
- A name-only edit of a goal whose `target_date` is in the past succeeds (no future-date error).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Inline edit-in-place UI

### Overview

Add a per-row Edit button that toggles the card into a prefilled inline form with
Save/Cancel, calls `PUT`, and updates list state on success.

### Changes Required:

#### 1. Inline edit mode in GoalsManager

**File**: `src/components/goals/GoalsManager.tsx`

**Intent**: Let the user edit a goal in place: an Edit button per row swaps the card's
display content for a form prefilled with the goal's current name, amount (dollars),
and date; Save persists via `PUT` and returns to display mode; Cancel discards.

**Contract**: Add `editingId` state (the goal id currently being edited, or `null`)
and draft field state for the edit form (name / amount-dollars / date), plus a
`savingId` in-flight guard mirroring `deletingId`. In the goal-list `.map()`
(`GoalsManager.tsx:131-153`), when `editingId === goal.id` render an inline form
(reuse `FormField` + the date `<input>` markup from the create form, prefilled;
amount prefilled as `goal.target_amount / 100`) with **Save** and **Cancel** buttons;
otherwise render the current display row plus **Edit** and **Delete** buttons. On
Save: client-side guard (non-empty name, amount > 0, date present) mirroring
`handleSubmit`, then `fetch(\`/api/goals/${goal.id}\`, { method: "PUT", headers, body })`
with `{ name, target_amount_dollars, target_date }`; on 2xx, replace the goal in state
via `setGoals((cur) => cur.map((g) => (g.id === goal.id ? payload.goal : g)))`, clear
`editingId`; on failure set the inline `error` and stay in edit mode. Reuse the
existing `error` state/rendering. Disable Edit/Delete on other rows while one row is
saving (mirror the `deletingId !== null` disable pattern) to avoid concurrent edits.

### Success Criteria:

#### Automated Verification:

- Type checking / build passes: `npm run build`
- Linting passes: `npm run lint`
- Full unit suite passes: `npx vitest run`

#### Manual Verification:

- Each goal card shows an Edit button; clicking it reveals a prefilled inline form (name, amount in dollars, date).
- Saving a change updates the card in place and the values persist across a page reload.
- Cancel discards edits and restores the display row unchanged.
- A failed save (e.g. cleared name) keeps the form open and shows an inline error.
- Editing an expired goal's name (leaving the past date unchanged) saves successfully.
- Dashboard / recommendations reflect an edited amount/date after navigation.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Integration ownership test + docs refresh

### Overview

Prove update isolation against a real Supabase (extends Risk #5 to the UPDATE path)
and update the PRD/roadmap so the foundation reflects that edit shipped.

### Changes Required:

#### 1. Integration ownership test for UPDATE

**File**: `tests/integration/isolation.integration.test.ts`

**Intent**: Prove a user authenticated as A cannot update B's goal, paired with a
positive control that A can update its own — extending the existing Risk #5 coverage
to the new mutation path.

**Contract**: Add a case using the existing two-user harness (`createTestUser`, per-user
`client`, `updateGoal`, `getGoalById`/`getUserGoals`). Assert: A calling `updateGoal`
with B's goal id changes 0 rows (throws no-row / returns unchanged — assert B's goal is
unmodified when read back via B's client), AND A updating its OWN goal succeeds and is
observable via A's client. Pair every "A can't touch B" assertion with a positive
control so it can't pass vacuously (per test-plan §6.2). Seed goals via each user's
OWN client so INSERT `WITH CHECK` passes.

#### 2. Roadmap update

**File**: `context/foundation/roadmap.md`

**Intent**: Reflect edit shipping — add a slice row and remove the "Deferred" entry.

**Contract**: Add a roadmap row (e.g. `S-06 | edit-savings-goal | edit an existing
savings goal (name/amount/timeframe) | S-04 | FR-008 | done`) in the slice table, and
remove/relocate the "Editing a savings goal (changing amount or timeframe)" bullet
from the Deferred section (`roadmap.md:195`). Keep the existing table format and column set.

#### 3. PRD FR-008 commentary update

**File**: `context/foundation/prd.md`

**Intent**: Update the FR-008 Socrates commentary so it no longer states edit is v2-only.

**Contract**: Amend the FR-008 note (`prd.md:82-83`) to record that edit (name /
amount / timeframe) is now in scope and shipped, with a one-line rationale (live
recommendations recompute per request, so the recalculation-complexity concern that
deferred it does not apply). Do not renumber other FRs.

### Success Criteria:

#### Automated Verification:

- Integration suite passes (ad-hoc, requires Docker/local Supabase): `npm run test:integration`
- Full unit suite still passes: `npx vitest run`
- Linting passes: `npm run lint`

#### Manual Verification:

- The new integration case fails if the UPDATE RLS policy is removed (sanity-check the guard actually guards).
- `roadmap.md` shows edit as a done slice and no longer lists it under Deferred.
- `prd.md` FR-008 commentary reflects edit shipped.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before the phase-end commit.

---

## Testing Strategy

### Unit Tests:

- PUT handler (hermetic): 401 unauthenticated; 404 missing/non-owned; 400 invalid body
  (empty name, non-positive amount, changed-to-past date); 200 success (calls
  `updateGoal` with path id + cents amount); 200 name-only edit of an expired goal
  (unchanged past date allowed); 500 service error.

### Integration Tests:

- Ownership isolation for UPDATE (real Supabase, two users): A cannot update B's goal;
  A can update its own — positive control paired.

### Manual Testing Steps:

1. On `/goals`, click Edit on a goal, change the amount, Save — the card updates and survives a reload.
2. Click Edit, change nothing but the name of an expired goal, Save — succeeds.
3. Click Edit, clear the name, Save — inline error, form stays open.
4. Click Edit, then Cancel — original values restored, no request sent on cancel.
5. Edit a goal's amount, then visit `/recommendations` — the recomputed suggestions reflect the new target.

## Performance Considerations

Two single-row queries per edit (read-then-update) keyed by primary key, with ≤ 3
goals per user — negligible. No new dependencies.

## Migration Notes

None — the `savings_goals_authenticated_update` RLS policy and schema already support
update. No data migration.

## References

- Service to extend: `src/lib/services/savings-goals.ts` (`createGoal`, `deleteGoal` patterns)
- Route + validation pattern: `src/pages/api/goals.ts` (`createGoalSchema`), `src/pages/api/goals/[id].ts` (DELETE)
- Handler test pattern: `src/pages/api/goals/[id].test.ts`
- UI list/form/state pattern: `src/components/goals/GoalsManager.tsx:45-121`, `131-153`
- RLS update policy: `supabase/migrations/20260527000000_data_schema_foundation.sql:112`
- Integration harness: `tests/integration/isolation.integration.test.ts`; test-plan §6.2
- Prior sibling change: `context/archive/2026-07-03-delete-savings-goal/plan.md`
- PRD FR-008 / roadmap Deferred: `context/foundation/prd.md:82`, `context/foundation/roadmap.md:195`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Service methods + PUT endpoint + hermetic tests

#### Automated

- [x] 1.1 Type checking / build passes: `npm run build` — ca0a6b4
- [x] 1.2 Linting passes: `npm run lint` — ca0a6b4
- [x] 1.3 PUT handler tests pass: `npx vitest run "src/pages/api/goals/[id].test.ts"` — ca0a6b4
- [x] 1.4 Full unit suite passes: `npx vitest run` — ca0a6b4

#### Manual

- [x] 1.5 PUT with a valid body on an own goal returns 200 and the updated goal — ca0a6b4
- [x] 1.6 PUT on a nonexistent id returns 404 — ca0a6b4
- [x] 1.7 Unauthenticated PUT returns 401 — ca0a6b4
- [x] 1.8 Name-only edit of a goal with a past target_date succeeds (no future-date error) — ca0a6b4

### Phase 2: Inline edit-in-place UI

#### Automated

- [x] 2.1 Type checking / build passes: `npm run build` — 70038aa
- [x] 2.2 Linting passes: `npm run lint` — 70038aa
- [x] 2.3 Full unit suite passes: `npx vitest run` — 70038aa

#### Manual

- [x] 2.4 Each goal card shows an Edit button revealing a prefilled inline form — 70038aa
- [x] 2.5 Saving a change updates the card in place and persists across reload — 70038aa
- [x] 2.6 Cancel discards edits and restores the display row unchanged — 70038aa
- [x] 2.7 A failed save keeps the form open and shows an inline error — 70038aa
- [x] 2.8 Editing an expired goal's name (past date unchanged) saves successfully — 70038aa
- [x] 2.9 Dashboard / recommendations reflect an edited amount/date after navigation — 70038aa

### Phase 3: Integration ownership test + docs refresh

#### Automated

- [x] 3.1 Integration suite passes (ad-hoc): `npm run test:integration` — bec90fe
- [x] 3.2 Full unit suite still passes: `npx vitest run` — bec90fe
- [x] 3.3 Linting passes: `npm run lint` — bec90fe

#### Manual

- [x] 3.4 The new integration case fails if the UPDATE RLS policy is removed — bec90fe
- [x] 3.5 `roadmap.md` shows edit as a done slice and no longer lists it under Deferred — bec90fe
- [x] 3.6 `prd.md` FR-008 commentary reflects edit shipped — bec90fe
