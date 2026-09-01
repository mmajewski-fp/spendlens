# Code review agent

A Claude Agent SDK script that scores a diff against this team's five review
criteria and returns a verdict the pipeline can gate on.

The split that matters: **the model scores, the code decides.** The agent returns
per-criterion scores and findings against a fixed JSON schema; `evaluateGate()` in
`src/criteria.js` turns those into pass/fail. Moving the bar is a code change, not
a prompt change, and the same scores always produce the same outcome.

## The criteria

Five, all drawn from rules this repo already documents — `CLAUDE.md` conventions
and `context/foundation/lessons.md`. Each is scored 1-10 against anchors that
describe what a 1 and a 10 look like _in this codebase_:

| Criterion                    | Anchored on                                                             |
| ---------------------------- | ----------------------------------------------------------------------- |
| `implementation-correctness` | unguarded SSR/API service calls → blank 500s                            |
| `stack-idiomaticity`         | zod validation, `prerender = false`, `cn()`, `@/` alias, `src/types.ts` |
| `determinism`                | no ambient timezone or locale in logic or tests                         |
| `test-and-risk-coverage`     | risk-weighted tests; E2E locator and wait rules                         |
| `data-safety`                | RLS, user-scoped queries, generic error bodies, server-only secrets     |

Full text with both anchors: `src/criteria.js`, and the reasoning behind them in
`context/changes/ci-cd-code-review/requirements.md`.

The gate fails on any criterion at or below **4**, or any `high`/`critical` finding.

## Local use

```bash
npm install
export ANTHROPIC_API_KEY=...

npm run review                 # uncommitted changes (git diff HEAD)
npm run review -- --staged     # staged changes only
npm run review -- main..HEAD   # an arbitrary range
```

Exit codes are three-valued on purpose: `0` the gate passed, `2` the gate failed,
`1` the review could not run. A failing review and a failed review are different
events, and only one of them means something is broken.

## In CI

`.github/workflows/review.yml` runs on every PR to `main`. It computes the diff
against the base (`fetch-depth: 0`, otherwise the diff is empty), hands it to the
`.github/actions/ai-reviewer` composite action, then publishes the result:

- one PR comment, updated in place on each push rather than stacked
- `ai-cr:passed` / `ai-cr:failed` labels
- a separate `Gate` step that fails the check, so the comment always lands first

Re-run on demand by adding the `ai-cr:review` label.

**Required secret:** one of two, and the action rejects having both.

- `ANTHROPIC_API_KEY` — a key from the Claude Console. Billed as API usage.
- `CLAUDE_CODE_OAUTH_TOKEN` — a one-year token from `claude setup-token`, run in a
  terminal and pasted into `gh secret set`. Bills the review to a Claude
  subscription (Pro, Max, Team or Enterprise) instead of API credits. Note it is
  tied to the account of whoever generated it, so a shared repo is better served
  by an API key.

With neither, the action fails loudly rather than passing silently.

## Evals

`promptfooconfig.yaml` runs the exact prompt the agent uses — imported from
`src/prompt.js`, not a copy — across several models on the same fixtures, so
"cheaper or stronger?" is settled by a matrix instead of a hunch. It doubles as a
regression gate on prompt edits.

```bash
export OPENROUTER_API_KEY=...
npm run eval
npm run eval:view
```

Two fixtures, deliberately pulling in opposite directions:

- `evals/fixtures/react19-migration.diff` — a React 16 → 19 component migration with
  three planted defects (dropped `defaultProps`, `setInterval` with no cleanup,
  empty dependency array losing the refetch). Must be blocked, _and_ an
  `llm-rubric` checks the review names all three — a right verdict for the wrong
  reason is still wrong.
- `evals/fixtures/clean-change.diff` — a correct, tested change. Must pass. A
  reviewer that blocks everything is as useless as one that blocks nothing, and
  this is the case that keeps the suite from rewarding indiscriminate severity.

Assertions import the production gate from `src/criteria.js`, so a threshold change
can't leave the evals testing a rule nobody runs.

## Layout

```
src/criteria.js   the five criteria + the gate      (single source of truth)
src/schema.js     response schema, derived from the criteria
src/prompt.js     system + user prompts, shared with the eval suite
src/index.ts      CLI: git diff → review → report, markdown, exit code
evals/            promptfoo fixtures, assertions, output transform
```
