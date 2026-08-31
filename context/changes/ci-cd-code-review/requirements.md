# CI/CD Code Review — Requirements

Brainstorm note, not a plan. Scope is deliberately MVP-sized: diff in, verdict out.

## Overall concept

- GHA workflow run for every new pull request to `main`
- composite action for the review itself so that the main workflow is easy to reason about
- the agent scores; the **pipeline** decides — the pass/fail gate is computed in code
  from the scores, never asked of the model

## Input parameters

- pull request title
- pull request description
- `git diff` against the base branch (`fetch-depth: 0`, otherwise the diff is empty)

Deliberately out of scope for v1: the full repo tree. The agent may still `Read`/`Grep`
files it needs for context, which is cheaper than shipping them all in the prompt.

## Code Review Criteria

Each criterion is scored on a 1–10 scale, where 1 is the worst outcome and 10 is the best.
These are this repo's existing rules, written down before the agent existed: the conventions
section of `CLAUDE.md` and the three entries in `context/foundation/lessons.md`.

1. **implementation correctness** — does the change do what it claims, across the happy path, edge cases and failure modes?
   - _1_: logic is broken, an error path throws uncaught, or existing behaviour silently regresses. In this app that shows up as an unguarded service-helper call in Astro SSR frontmatter or an API route — a transient Supabase error becomes a blank 500.
   - _10_: correct on the happy path, edge cases and failure modes; every service-helper call in SSR frontmatter and API handlers is wrapped so failures render a graceful surface, not a blank page.

2. **stack idiomaticity** — does the code follow the conventions this repo already documents?
   - _1_: fights the documented conventions — API route without zod validation or without `prerender = false`, manually concatenated Tailwind class strings, deep relative imports instead of `@/`, entity/DTO types declared inline instead of in `src/types.ts`, business logic left in a route instead of `src/lib/services/`, a React island where an `.astro` component would do, or Next.js-style directives.
   - _10_: indistinguishable from the surrounding code — zod-validated input, uppercase `GET`/`POST` exports, `cn()` for class merging, `@/` alias, shared types in `src/types.ts`, extracted service helpers, React only where interactivity is genuinely needed.

3. **determinism** — is the logic independent of the machine it runs on?
   - _1_: depends on ambient timezone, default-locale collation, wall-clock time or network state — e.g. a date window built from local time, or a bare `localeCompare` tie-break. This repo has been bitten twice: a DST-crossing goal date computed 6 months instead of 5, and category ordering that could flip per host.
   - _10_: dates and ordering are explicit — UTC-anchored date math, codepoint or explicitly-localed comparison, injected clock; the same input yields the same output on any machine, in CI, and under parallel test workers.

4. **test and risk coverage** — are the risky paths exercised in proportion to their risk?
   - _1_: risky logic ships untested, or the tests assert nothing useful. For E2E specifically: CSS/XPath selectors, `page.waitForTimeout()`, or tests that depend on each other's leftover state.
   - _10_: risk-weighted — the parts most likely to break are tested deliberately; E2E uses `getByRole`/`getByLabel`/`getByText`, waits on state rather than time, and each test sets up, asserts and cleans up standalone with collision-free ids.

5. **data safety** — does the change keep user data and secrets where they belong?
   - _1_: a new table without RLS or with a blanket policy, a query that trusts a client-supplied user id, a raw DB error string returned to the client, a secret or PII in a log line or in `astro:env/client`.
   - _10_: RLS on with granular per-operation, per-role policies; every query scoped to `context.locals.user`; untrusted input zod-validated at the boundary; errors logged server-side and returned generically; secrets only via `astro:env/server`.

## Parked for later

- business alignment (requires broader context than the diff)
- architectural fit (requires broader context than the diff)
- reviewing the change against its own `context/changes/<id>/plan.md` — the natural
  next tool once the agent gets read access to `./context`

## Expected side-effects

- PR comment with the summary, the per-criterion score table and the findings
- labels: `ai-cr:failed` (red) OR `ai-cr:passed` (green)
- non-zero exit when the gate fails, so the check can become required

## Expected behavior

- gate fails when any criterion scores at or below 4, or when any finding is `high`/`critical`
- on-demand retry when the label `ai-cr:review` is added
- a review that cannot run (missing key, model error) fails loudly rather than passing silently
