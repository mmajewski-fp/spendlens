# Mom Test Validation Plan

## Input Idea

`ssr-guard-check` from `context/team/opportunity-map.md`: a static check flagging service-helper calls not wrapped in try/catch across SSR frontmatter and API routes, intended to prevent blank/generic 500s. This validation pass corrected the underlying signal before assessing it — see Critique.

## Correction To The Opportunity Map's Framing

The original candidate targeted "missing try/catch → blank 500s." Evidence shows that specific pattern is a single, durably-fixed incident, not a recurring one:

- `f5a8d7b` ("fix blank page", 2026-05-27) on `recommendations.astro` — missing try/catch, fixed same day, written into `lessons.md` the next day (`3819612`, 2026-05-28).
- All 4 current `.astro` pages (`recommendations`, `goals`, `dashboard`, `transactions`) have had try/catch ever since — **zero recurrences in ~2 months**.
- `b72b9af` (2026-07-06), previously cited as a "recurrence," is a **different bug**: the try/catch in `goals/[id].ts` PUT already existed — the leak was the catch block returning raw `error.message` (Postgres/PostgREST internals: constraint/column names, "relation does not exist") straight to the client, instead of a generic message + server-side log.

Checked whether that actual pattern is still live: **confirmed present today** in `goals.ts` (POST catch), `goals/[id].ts` (DELETE catch), `transactions/export.ts`, `transactions/import.ts` — 4 of 7 non-auth API route handlers. Only PUT was fixed. The impl-review report that caught it (`context/archive/2026-07-06-edit-savings-goal/reviews/impl-review.md`, finding F1) explicitly called it a "pre-existing whole-module pattern, not new drift," and queued a follow-up (`follow-ups/review-fixes.md`, Fix B) to apply the same treatment to DELETE + POST — that follow-up was never executed.

**Corrected friction**: raw error messages leaking to API clients in error responses — not missing try/catch.

## Hypotheses

- **User/role**: the solo builder operating the implement → impl-review AI-agent workflow. No external customer population — this is a one-person internal-tooling question.
- **Friction**: API route catch blocks forward raw `error.message` to clients instead of a generic message + server-side log.
- **Current workaround**: impl-review (already-running skill) catches instances during diff review, flags them, and queues follow-ups — but follow-up execution isn't guaranteed once filed.
- **Risky assumptions**:
  - That this needs new tooling rather than finishing an already-written, already-scoped follow-up.
  - That impl-review "missing" `export.ts`/`import.ts` is a process gap — it reviewed the diff of a change that didn't touch those files, so it had no way to see them in that pass.
  - That a standing CI/script gate beats simply widening the impl-review checklist by one line.
- **Evidence already present**:
  - 4 of 7 API route files currently leak raw `error.message`; 1 of 7 (PUT) is fixed.
  - A follow-up was filed on 2026-07-06 for DELETE + POST and remains unexecuted as of this writing.
  - Zero recurrences of the *original* missing-try/catch pattern since 2026-05-28.

## Critique

The proposed solution (detect missing try/catch) targets a bug that's already extinct in this codebase; a tool built to that spec would find nothing today while missing the actual live issue. The real question isn't "will this recur speculatively" — it's "a fix is already known and already queued; why wasn't it applied?" That's a follow-through gap, not a detection gap. The cheapest test: manually apply the same fix to the 3 remaining files (~15 minutes, using the PUT diff as the template) and see whether the pattern reappears in the next 2–3 features despite doing that. If it does, a checklist line or script earns its place. If it doesn't, the existing impl-review process was always sufficient — it just needed its follow-up queue cleared.

## Interview Guide — Adapted (Self-Review, No External User Population)

Since the "user" is the solo builder and their own AI-agent workflow, there's no one else to interview. This is reframed as a retrospective against the project's own archive — same rule (past behavior, not intent), applied to the builder's own recent decisions:

1. **Warm-up**: When you start a new API route today, what's your actual mental checklist for error responses — before any tooling?
2. **Recent story**: Walk through `b72b9af` — how did you first notice the raw-message leak on PUT, and what specifically caught it?
3. **Workaround**: The follow-up for DELETE/POST was queued in `review-fixes.md` on 2026-07-06 and hasn't been applied. What happened between filing it and now?
4. **Cost of pain**: Has a raw DB error message actually reached a real client, or has every instance so far been caught pre-merge? What would it concretely cost if one shipped?
5. **Existing alternative**: Would adding one line to impl-review's existing F-series checks ("scan touched files' catch blocks for raw message forwarding") have caught DELETE/POST in the same pass that caught PUT?
6. **Decision signal**: If you fix `goals.ts`, `goals/[id].ts` DELETE, `export.ts`, and `import.ts` by hand right now, does the problem still exist afterward?
7. **Recurrence check**: Over the next 2–3 features, does a new instance of raw-message leaking appear despite the manual fixes and the existing impl-review step?
8. **Closing**: Would you rather this live as a standing script/CI gate, or as one added checklist line inside `/10x-impl-review`?

## Survey

Not applicable. The target population is a single builder (n=1) — there's no broader group to survey for signal. If this workflow is ever shared with teammates or templated for other solo builders, a real survey becomes meaningful then; forcing one now would just be asking yourself the same question twice.

## Decision Criteria

- **Proceed** (build a script/CI gate) if: after manually fixing the 4 known instances, a new raw-message-leak or missing-try/catch bug appears in at least 2 of the next 3 shipped features, despite the existing impl-review step — proving manual review alone doesn't hold.
- **Narrow scope** if: it recurs exactly once more — add a single explicit line to impl-review's checklist instead of separate tooling.
- **Do not build yet** if: manually fixing the 3–4 outstanding files closes every currently known instance and nothing recurs in the next few features.
- **Try existing tool/process first**: execute the already-queued follow-up (`context/archive/2026-07-06-edit-savings-goal/follow-ups/review-fixes.md`, Fix B) across `goals.ts`, `goals/[id].ts` DELETE, `export.ts`, `import.ts` — this is a backlog/follow-through gap, not a missing-tool gap, until proven otherwise.

**Overall read**: leans strongly toward "try existing tool/process first" — clear the follow-up, then watch for recurrence before building anything.
