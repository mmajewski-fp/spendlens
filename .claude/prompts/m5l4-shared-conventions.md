# Shared Team Engineering Conventions

Source input for the `code-review` skill (see `m5l4-shared-spec-skill.md`).

Scope: the SpendLens stack — Astro 6 SSR, React 19 islands, Supabase (SSR cookie
auth + RLS), zod 4, Tailwind 4, Vitest, Playwright.

**These rules are deliberately the ones tooling cannot check.** `eslint.config.js`
already runs `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`, so
`any`, unused vars, floating promises, unsafe member access and misused promises
are caught by `npm run lint` before review. A reviewer that repeats the linter
adds noise and buries the findings that matter. Every rule below is one a human
or an agent has to reason about.

Each rule states what to flag, so a finding can cite `file:line` and name the
convention it violates.

## Naming

- Variables and functions: descriptive camelCase. Abbreviations allowed: `url`, `id`, `api`, `db`, `csv`.
- Booleans: prefix `is`, `has`, `should`, `can` (`isFutureDate`, not `futureDate`).
- Functions: verb-first (`getUserGoals`, `createGoal`, `formatMoney`).
- **Money variables must carry their unit in the name.** `targetAmountInCents`, `target_amount_dollars`. A bare `amount` is only acceptable on a type whose JSDoc pins the unit.
- Files: kebab-case, matching the primary export's subject (`savings-goals.ts`, `goal-validation.ts`). Colocated tests are `<name>.test.ts`.
- DB-shaped fields keep `snake_case` (they mirror Postgres columns); everything else is camelCase. Do not "fix" `snake_case` on a row type.
- Constants: UPPER_SNAKE_CASE.

## Money and dates

The two things this codebase has gotten wrong before. Flag every violation as
Critical — both classes are silent and produce wrong numbers, not crashes.

- **Money is integer cents everywhere except the HTTP boundary and the rendered string.** `Transaction.amount`, `SavingsGoal.target_amount`, `estimatedSavingCents` are cents. Flag any float arithmetic on money, any `toFixed()` used to compute rather than display, and any cents value passed where dollars are expected.
- Dollars→cents conversion happens once, at the zod boundary, via `Math.round(dollars * 100)`. Flag conversions scattered into services or components.
- Rendering money goes through `formatMoney` from `@/lib/format-money`. Flag ad-hoc `$${...}` template strings.
- **Never depend on the ambient timezone or default locale in deterministic logic or tests.** Dates are `YYYY-MM-DD` strings. Flag `new Date()` arithmetic that can cross a DST boundary, and bare `localeCompare` — use codepoint comparison or pass an explicit locale.
- Tests that touch dates or ordering must be invariant to host timezone. `TZ=UTC` is pinned on the npm scripts; a test that only passes because of it is still a finding.

## Error handling

- Service helpers (`src/lib/services/*`) throw a **clean** `Error` carrying the message only. Flag any code that rethrows or attaches a raw Supabase error object — `code`, `details`, `hint` must not survive onto the thrown error or reach the client.
- API routes never leak internal phrasing. The pattern in `src/pages/api/goals.ts` is the reference: `console.error` the real error server-side, return a generic message with the right status. Flag any response body built from `error.message` unless that message is a deliberate, user-facing domain string.
- **Astro SSR frontmatter that calls a service helper must be wrapped in try/catch** and render an error card. An unhandled throw is a blank 500 on Vercel.
- Status codes are meaningful: 400 invalid input, 401 no `context.locals.user`, 404 not found or not owned, 409 domain-invariant violation (e.g. the 3-active-goals cap), 500 unexpected. Flag a 500 used for a condition the caller could have avoided.
- No empty catch blocks. A bare `catch {}` is acceptable only where the fallback is the whole point (`await request.json()` → 400) and a comment says so.
- `no-console` is a lint warning, so `console.error` in a server-side catch is intentional — do not flag it. Flag `console.log` left in client components.

## TypeScript

- External and untrusted data enters as `unknown` and is narrowed by zod. Flag a request body typed as its expected shape without parsing.
- Use `safeParse` at boundaries and return the first issue's message; `parse` is for code that should crash on programmer error.
- Prefer `interface` for object shapes; `type` for unions, intersections and aliases.
- Model states as discriminated unions, not a bag of optional fields.
- `as` casts on Supabase results are tolerated where the client's generics are lossy (see `SingleRowResult` in `savings-goals.ts`) — but flag a cast that skips a null check. `.single()` and `.maybeSingle()` need both `error` and `data` handled.
- Shared entity and DTO types live in `src/types.ts` and carry a JSDoc line for any non-obvious unit or format. Flag a duplicated row shape defined locally.

## Function design

- Single responsibility: if describing it needs "and", split it.
- Max 3 positional parameters; beyond that use an options object. Service helpers take `(client, ...)` first.
- Early returns over nested conditionals — API routes should read as a flat sequence of guards.
- Query functions (`get*`, `find*`, `is*`, `format*`) are pure: no writes, no mutation of arguments.
- Business logic belongs in `src/lib/services/`, not in route handlers or component bodies. A route handler that computes domain rules inline is a finding.
- Tailwind classes are merged with `cn()` from `@/lib/utils`. Flag manual string concatenation of class names.

## Security

- Every API route exports `prerender = false`. A missing export is Critical — the route silently prerenders and stops seeing per-request auth.
- Every route checks `context.locals.user` before touching data, and scopes writes by `user.id`. Flag a query that trusts a client-supplied `user_id`.
- **RLS is the real boundary, not the route check.** New tables need RLS enabled with granular per-operation, per-role policies. Flag a migration that creates a table without them, or a policy using `USING (true)`.
- Secrets come from `astro:env/server` (`SUPABASE_URL`, `SUPABASE_KEY`). Flag any literal key, and any server-only secret imported into a React island or `PUBLIC_`-prefixed.
- Ownership on mutation: an id from the URL must be verified against the current user before update or delete. Returning 404 rather than 403 for another user's row is correct — it does not confirm the row exists.
- Responses never include stack traces, file paths, SQL, or constraint names.
- User-supplied strings are not rendered as HTML (`astro/no-set-html-directive` is on; the same rule applies to `dangerouslySetInnerHTML`).

## Testing

- Test names describe behavior, not implementation: `"returns empty array when no results found"`, not `"tests getUserGoals"`.
- Each test owns its setup and teardown. No shared mutable state between tests, no ordering dependency.
- Specific assertions: `toEqual(expected)` over `toBeTruthy()`. Assert the actual value, including the unit — a cents assertion should read like a cents assertion.
- Cover the error path, not just the happy path. Where real infrastructure can't easily produce a failure, stub the Supabase client to force the branch (see `savings-goals.test.ts`).
- Every bug fix arrives with a test that fails without it. Flag a fix to a reported defect with no accompanying test.
- Unit and integration tests are separate suites (`vitest.config.ts` vs `vitest.config.integration.ts`). Flag a unit test that reaches for the network or a live database.
- E2E: `getByRole`/`getByLabel`/`getByText` first, `getByTestId` only when accessibility attributes are ambiguous, never CSS selectors or XPath. **Never `page.waitForTimeout()`** — wait on state (`toBeVisible()`, `waitForURL()`, `waitForResponse()`). Unique ids per run so parallel runs don't collide.
