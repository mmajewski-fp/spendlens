---
change_id: ci-cd-code-review
title: AI code review agent in the PR pipeline
status: archived
created: 2026-08-31
updated: 2026-09-01
archived_at: 2026-09-01T11:33:09Z
---

## Notes

Moves the M5L2 code review agent (`scripts/code-review-agent/`) off localhost and
into GitHub Actions: a composite action wraps the agent, a PR workflow feeds it
the diff, and the verdict becomes a visible signal (comment + label) plus a merge
gate.

Requirements brainstorm lives in `requirements.md`. The review criteria there are
this repo's own conventions — `CLAUDE.md` and `context/foundation/lessons.md` —
not a generic checklist.

## Outcome

Shipped and exercised end to end on PR #1, which was itself reviewed by the gate:
it scored test coverage 5/10 and raised one MEDIUM finding (three 500-path tests
asserted the status code but never the body, so the leak the PR fixed was not
actually locked in). Closing that finding took the same PR to 9/10 with no
findings.

Everything in requirements.md was built except the parked items. Two things the
first real pull request taught us, neither visible before:

- `git fetch --depth=0` is not valid git, so the diff step died before reaching
  the agent. The step never ran until a PR existed to run it on.
- Reviewing a diff and gating on it are separate concerns. The gate lives in
  `evaluateGate()`, not in the prompt, so the verdict is reproducible and moving
  the bar is a code change.

Model choice was settled by evals rather than by feel — see
`scripts/code-review-agent/promptfooconfig.yaml`. haiku-4.5 matched sonnet-5 on
both fixtures at a sixth of the cost.
