# Opportunity Map

## Context

- **Project / context**: SpendLens (this repo, kurs10x) — solo-built greenfield MVP, Astro 6 SSR + React 19 + Supabase, using the 10xDevs AI-agent plan→implement→review workflow.
- **Data constraint**: Mock / local / read-only / non-sensitive — first version can stay lightweight, no access-control work needed up front.
- **Date**: 2026-07-20

## Map

| Signal | Existing / default response | Thin complement | First useful version | Data risk | Direction if valuable |
|---|---|---|---|---|---|
| Unguarded SSR/API calls → blank 500s on transient Supabase errors | lessons.md rule (try/catch) + impl-review catches it after the fact | static grep/ast-grep check for unguarded service-helper calls | local script scanning `src/pages/**/*.astro` frontmatter + `src/pages/api/**/*.ts`, checklist output | mock/local | Review / CI gate |
| Ambient TZ/locale bugs in deterministic logic | lessons.md rule (pin TZ=UTC, avoid bare localeCompare) — manual recall | grep for `new Date(` without UTC handling and bare `.localeCompare(` | local script flagging risky patterns in diff/source, file:line list | mock/local | Review / CI gate |
| Duplicated utility/business logic across features, consolidated only after the fact | human/AI eyeballing during a later refactor commit | run an existing duplicate-code detector (e.g. jscpd) against `src/` | one-off jscpd run + report, read at impl-review time instead of a later refactor | mock/local | Review / CI gate |
| Domain invariant re-implemented across DB trigger + API string-match + UI guard, drifting from spec | one-off DDD analysis (context/domain/01-03) already scoped a real fix — aggregate + ACL refactor planned | stopgap audit script has only transitional value | n/a as a lasting tool — refactor plan already in motion is the real fix | mock/local | Wait / no build (essential complexity, plan already in flight) |

## Recommended First Candidate

```text
Candidate:
ssr-guard-check

Reads:
src/pages/**/*.astro frontmatter, src/pages/api/**/*.ts — static source only

Returns:
a checklist report: file:line for each service-helper call (e.g. imports from src/lib or src/lib/services) not wrapped in try/catch in SSR frontmatter or API handlers

Does not do:
auto-fix, block commits, run in CI yet, understand cross-file call chains (flags direct calls only)

Data risk:
mock/local — pure static analysis on source, no user or production data touched

Direction if it proves valuable:
Review / CI gate — once the checklist proves useful across a few features, promote it into the pre-commit lint-staged step or CI as a non-blocking warning, then a blocking gate
```

## Why This Candidate

Ranks highest of the four: it recurs *despite* a written lesson (proof the rule alone doesn't hold — it hit again in `edit-savings-goal` after being documented during transactions-list-era work), it's cheaply checkable read-only against source (confirmed narrow: only 4 `.astro` pages currently use `try {`, API surface is small — `src/pages/api/{auth,goals,transactions}`), it complements rather than replaces the existing impl-review/lint step, and its later direction (a Review/CI gate) is immediately actionable given this repo already runs ESLint + a pre-commit hook.

The TZ/locale signal is real (hit twice in one rollout per lessons.md) but has zero current occurrences in code (no `localeCompare` in `src`) — worth watching, nothing to build against today. The duplication signal is fuzzier to automate precisely (generic dupe detectors produce more false positives) — a good second candidate once the first earns its keep. The invariant-drift signal is essential complexity with a refactor already scoped in `context/domain/02-03`; a parallel stopgap tool would compete with, not complement, that in-flight work.

## Next Direction If Valuable

**Validate, then shape** — run `/10x-mom-test` on the ssr-guard-check candidate to pressure-test whether "unguarded SSR/API calls" is a problem worth a dedicated check versus just re-reinforcing the lessons.md rule, grounded in past behavior (does impl-review actually miss this often enough to justify tooling, or was `edit-savings-goal` a one-off slip?). If it survives, feed it into `/10x-shape` → `/10x-prd` → `/10x-roadmap`.
