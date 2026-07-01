<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Connect Simulated Bank (S-01)

- **Plan**: context/changes/connect-simulated-bank/plan.md
- **Scope**: Full plan (Phases 1–4 of 4)
- **Date**: 2026-07-01
- **Verdict**: APPROVED (with 1 minor warning)
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated success criteria (re-run at review): `npx astro check` 0 errors · `npm run lint` exit 0 · `npm run build` exit 0 · `npm run test` unit+hermetic green · `npm run test:integration` 9 passed. All manual items (1.4, 2.4, 3.5–3.9, 4.2) confirmed by the user during implementation.

## Findings

### F1 — Broad "market" keyword can shadow future descriptions

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (data quality)
- **Location**: src/lib/services/transaction-categorizer.ts:41
- **Detail**: The ordered keyword table has `["market", "groceries"]`. It correctly catches the fixture "Whole Foods Market", but the bare "market" substring would also claim any future description containing it (e.g. "Stock Market Fee", "Marketing Subscription") as groceries. Harmless for the current closed, in-repo fixture set (all 11 fixtures verified correct), but a latent mis-categorization if descriptions ever broaden. NOTE: the naive "just drop the market entry" fix is wrong — "Whole Foods Market" contains neither "grocer" nor "supermarket", so dropping it reintroduces the Phase-1 bug (→ other).
- **Fix**: Rename the fixture "Whole Foods Market" → "Whole Foods Supermarket" in simulated-bank.ts, then drop the bare "market" keyword — removes the shadowing without reintroducing the miscategorization.
- **Decision**: FIXED — renamed fixture to "Whole Foods Supermarket", dropped the "market" keyword, updated categorizer test; 62 tests green.

### F2 — No batch ceiling on the bulk insert

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/lib/services/import-transactions.ts:40
- **Detail**: All generated rows go to `createTransactions` in one upsert. The generator caps at ~31–47 rows, so this is well within Postgres/PostgREST limits — not a live problem. Only relevant if the fixture size ever grows large.
- **Fix**: None needed now; add batching only if the dataset grows.
- **Decision**: SKIPPED — not a live problem at ~31–47 rows; revisit only if the fixture grows.
