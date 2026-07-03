# Transactions List — Plan Brief

> Full plan: `context/changes/transactions-list/plan.md`

## What & Why

Roadmap slice S-03 / FR-005: a signed-in user with imported transactions should be able to browse a full chronological list of every expense and income, each row showing its assigned category. The category layer is the whole point — it's what distinguishes this from a raw bank statement (the PRD's explicit defense of the slice).

## Starting Point

No `/transactions` list page exists (only the `/transactions/import` flow). The data helper `getUserTransactions(client)` already returns all transactions — date-desc, category joined — with no changes needed. The `dashboard.astro` page shipped hours ago is the exact SSR pattern to mirror.

## Desired End State

Opening `/transactions` (via a new Topbar link) shows a "Showing N transactions" count and a vertically stacked list of cards, newest first — each with date, description, a category badge ("Other" when uncategorized), and a signed, color-coded amount (−$ rose for expenses, +$ emerald for incomes). Empty and error states mirror the dashboard; unauthenticated access redirects to sign-in.

## Key Decisions Made

| Decision        | Choice                                         | Why (1 sentence)                                                        |
| --------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| Presentation    | Row list of cards                              | Matches existing card aesthetic; mobile-friendly; no table overflow.   |
| Component       | Pure Astro, no React island                    | CLAUDE.md: React only when interactivity is needed; ships zero JS.     |
| Amount UX       | Signed + color-coded (with +/− sign)           | Instantly legible; sign keeps it accessible without relying on color.  |
| Scale           | Render all + a visible count                   | Simplest; simulated-bank volume is bounded; count is a cheap signal.   |
| Testing         | Extract + unit-test `formatSignedAmount`; build/manual for page | Puts the only real logic under test without Astro-markup test infra. |
| States          | Mirror `dashboard.astro`                       | Proven; satisfies SSR try/catch lesson and no-blank-screen NFR.        |

## Scope

**In scope:** `formatSignedAmount` helper + tests; `/transactions` SSR page (card list, count, category badge, signed amounts, config/fetch/empty states); Topbar link; protected-route registration.

**Out of scope:** filtering/sorting/search; pagination; React/client JS; date-grouping or split income/expense sections; new service/type/API/schema; edit/delete; E2E tests.

## Architecture / Approach

One new pure helper `src/lib/format-money.ts` (`formatSignedAmount(cents, type)`), unit-tested. A new `src/pages/transactions.astro` fetches `getUserTransactions(supabase)` (no `since`) inside a try/catch, mirrors `dashboard.astro`'s config/fetch/empty branches, and `.map()`s transactions to card rows. `Topbar` gains a Transactions link; `middleware.ts` gains `/transactions` in `PROTECTED_ROUTES`.

## Phases at a Glance

| Phase                                          | What it delivers                                              | Key risk                                              |
| ---------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| 1. Transactions list page + signed-amount helper | Tested helper + `/transactions` page + Topbar link + route gate | Correct sign/color per type; every row shows a category |

**Prerequisites:** S-01 (transaction import) — done.
**Estimated effort:** ~1 session, single phase.

## Open Risks & Assumptions

- Assumes MVP transaction volume is small enough to render unpaginated.
- Assumes `/transactions` (list) and `/transactions/import` coexist cleanly as distinct routes.
- Color + sign convention assumed accessible; no formal a11y audit in this slice.

## Success Criteria (Summary)

- A user with imported data sees an accurate, newest-first list with a category on every row and correctly signed/colored amounts.
- Empty and error states render gracefully; unauthenticated access is redirected.
- The signed-amount helper is unit-tested; lint + build + suite green.
