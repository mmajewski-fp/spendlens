---
change_id: testing-runner-bootstrap-wedge
title: Bootstrap test runner and first wedge tests for cut-suggestion math
status: implementing
created: 2026-06-22
updated: 2026-06-22
archived_at: null
---

## Notes

Rollout Phase 1 of context/foundation/test-plan.md: "Runner bootstrap + first wedge test".

Risks covered: #1 (cut-suggestion amount mathematically wrong vs goal target/timeframe), #2 (degenerate goal inputs — timeframe 0, past goal date, ≤0 surplus — produce NaN/Infinity that renders to the UI).

Test types planned: unit. NOTE: the test base is currently `none` — this phase also bootstraps the test runner (Vitest is the hypothesis; confirm in research) and wires it into CI before/alongside the first assertion.

Risk response intent:
- #1: prove a hand-worked example (income, spend, goal target, timeframe → expected per-category cut amounts) matches the output. The oracle MUST come from the hand-worked example / PRD §Business Logic + US-01 AC, never from the implementation (oracle-mirror is the trap).
- #2: prove timeframe=0, past goal date, and ≤0 surplus each return a safe guarded result (empty/sentinel), never NaN/Infinity reaching the UI.
