---
change_id: ci-cd-code-review
title: AI code review agent in the PR pipeline
status: in-progress
created: 2026-08-31
updated: 2026-08-31
---

## Notes

Moves the M5L2 code review agent (`scripts/code-review-agent/`) off localhost and
into GitHub Actions: a composite action wraps the agent, a PR workflow feeds it
the diff, and the verdict becomes a visible signal (comment + label) plus a merge
gate.

Requirements brainstorm lives in `requirements.md`. The review criteria there are
this repo's own conventions — `CLAUDE.md` and `context/foundation/lessons.md` —
not a generic checklist.
