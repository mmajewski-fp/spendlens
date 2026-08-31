---
name: code-review
description: Review code changes against team engineering conventions, testing standards and security expectations.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Code Review

Review a change against **this team's** conventions. You are not inventing a
review standard — the checklist below is the standard. Every finding must name
the convention it violates and cite `file:line`.

Trigger phrases: "review code", "check this PR", "review my changes", "code review".

## Scope

Review only what changed, plus whatever you must read to judge it.

1. Get the diff. Default to `git diff HEAD`; use `git diff --staged` if the user
   said staged, or `git diff <base>..HEAD` for a branch or PR.
2. If the diff is empty, say so and stop.
3. Read the surrounding file for any hunk you are unsure about — a rule like
   "money is cents" cannot be judged from the diff alone. Read the type
   definition before flagging a unit mismatch.
4. Do not edit files. This is a review; the user decides what to change.

## Do not repeat the linter

ESLint runs `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked` and
Prettier, on a pre-commit hook. Never report:

- `any`, unsafe member access, unsafe assignment or unsafe return
- unused variables, floating or misused promises
- formatting, import order, quote style, line length

These fail `npm run lint` before review. Reporting them buries the findings that
need judgment. Everything in the checklist below is something tooling cannot see.

Skip any section whose stack is not present in the repo — check before applying
the Astro and Supabase rules.

## Checklist

Report in this order. **Money-and-dates and Security findings default to
Critical**: they produce wrong numbers or leak data silently instead of failing
loudly.

### 1. Naming

- camelCase, descriptive. Allowed abbreviations: `url`, `id`, `api`, `db`, `csv`.
- Booleans prefixed `is`/`has`/`should`/`can`. Functions verb-first.
- **Money variables carry their unit**: `targetAmountInCents`, `target_amount_dollars`. A bare `amount` passes only if its type pins the unit in JSDoc.
- Files kebab-case matching their subject; tests colocated as `<name>.test.ts`.
- `snake_case` is correct on DB row types (they mirror Postgres columns). Do not flag it.
- Constants UPPER_SNAKE_CASE.

### 2. Money and dates

The two classes of bug this codebase has shipped before.

- **Money is integer cents** everywhere except the HTTP boundary and the rendered string. Flag float arithmetic on money, `toFixed()` used to compute rather than display, and any cents value passed where dollars are expected (or the reverse).
- Dollars→cents conversion happens **once**, at the zod boundary, as `Math.round(dollars * 100)`. Flag conversions scattered into services or components.
- Rendering money goes through `formatMoney`. Flag ad-hoc `` `$${...}` `` strings.
- **No dependence on ambient timezone or default locale** in deterministic logic or tests. Dates are `YYYY-MM-DD` strings. Flag `new Date()` arithmetic that can cross a DST boundary, and bare `localeCompare` — require codepoint comparison or an explicit locale.
- A test that only passes because `TZ=UTC` is pinned on the npm script is still a finding.

### 3. Error handling

- Service helpers throw a **clean** `Error` — message only. Flag any rethrow that attaches the raw Supabase error; `code`, `details` and `hint` must not survive onto the thrown error or reach the client.
- API routes never leak internal phrasing. Log the real error server-side, return a generic message with the right status. Flag a response body built from `error.message` unless that string is a deliberate, user-facing domain message.
- **Astro SSR frontmatter calling a service helper must be wrapped in try/catch** and render an error card. An unhandled throw is a blank 500 in production.
- Status codes carry meaning: 400 invalid input, 401 unauthenticated, 404 not found or not owned, 409 domain-invariant violation, 500 unexpected. Flag a 500 used for a condition the caller could have avoided.
- No empty catch blocks — except where the fallback is the whole point (`await request.json()` → 400) and a comment says so.
- `console.error` in a server-side catch is intentional. Do not flag it. Do flag `console.log` left in client components.

### 4. TypeScript

- External data enters as `unknown` and is narrowed by zod. Flag a request body typed as its expected shape without parsing.
- `safeParse` at boundaries, returning the first issue's message; `parse` only where a failure is programmer error.
- `interface` for object shapes, `type` for unions and aliases.
- Discriminated unions over bags of optional fields.
- `as` casts on Supabase results are tolerated where the client's generics are lossy — but flag a cast that skips a null check. `.single()` / `.maybeSingle()` need both `error` and `data` handled.
- Shared entities and DTOs live in `src/types.ts`, with a JSDoc line for any non-obvious unit or format. Flag a row shape re-declared locally.

### 5. Function design

- Single responsibility: if describing it needs "and", it should split.
- Max 3 positional parameters, then an options object. Service helpers take `(client, ...)` first.
- Early returns over nesting — route handlers should read as a flat sequence of guards.
- `get*`/`find*`/`is*`/`format*` are pure: no writes, no argument mutation.
- Business logic lives in `src/lib/services/`. A route handler or component computing domain rules inline is a finding.
- Tailwind classes merge via `cn()`. Flag manual class-string concatenation.

### 6. Security

- Every API route exports `prerender = false`. Missing is **Critical** — the route silently prerenders and stops seeing per-request auth.
- Every route checks the authenticated user before touching data and scopes writes by their id. Flag a query trusting a client-supplied `user_id`.
- **RLS is the real boundary, not the route check.** New tables need RLS enabled with granular per-operation, per-role policies. Flag a migration creating a table without them, or a policy using `USING (true)`.
- Secrets come from `astro:env/server`. Flag literal keys, and any server-only secret reachable from a client island or exposed via a `PUBLIC_` prefix.
- Ownership on mutation: an id from the URL is verified against the current user before update or delete. Returning 404 rather than 403 for another user's row is correct — do not flag it.
- Responses never include stack traces, file paths, SQL, or constraint names.
- User-supplied strings are never rendered as HTML (`set:html`, `dangerouslySetInnerHTML`).

### 7. Testing

- Names describe behavior: "returns empty array when no results found", not "tests getUserGoals".
- Each test owns its setup and teardown. No shared mutable state, no ordering dependency.
- Specific assertions — `toEqual(expected)` over `toBeTruthy()`. Assert the unit too: a cents assertion should read like one.
- Error paths covered, not just the happy path. Where infrastructure cannot easily fail, stub the client to force the branch.
- **Every bug fix arrives with a test that fails without it.** Flag a fix to a reported defect with no accompanying test.
- Unit and integration suites are separate. Flag a unit test reaching for the network or a live database.
- E2E: `getByRole`/`getByLabel`/`getByText` first; `getByTestId` only when accessibility attributes are ambiguous; never CSS selectors or XPath. **Never `page.waitForTimeout()`** — wait on state. Unique ids per run so parallel runs don't collide.

## Output

Open with one or two sentences on the change's overall risk. Then group findings
by severity, highest first, omitting empty groups:

```
## Critical
- `src/pages/api/goals.ts:41` — **Money and dates**: `target_amount` is assigned
  dollars; the type documents integer cents. A $50 goal is stored as 50¢.
  Convert once at the zod boundary with `Math.round(dollars * 100)`.

## Warning
- `src/lib/services/transactions.ts:88` — **Error handling**: rethrows the raw
  Supabase error, so `code` and `hint` reach the client. Throw
  `new Error(error.message)`.

## Suggestion
- `src/components/GoalCard.tsx:22` — **Function design**: class strings are
  concatenated manually; use `cn()` from `@/lib/utils`.
```

Severity:

- **Critical** — wrong behavior, data loss, or an auth/exposure gap. All Money-and-dates and Security violations, unless clearly unreachable.
- **Warning** — a real convention violation that will cause a bug or maintenance cost, but not now.
- **Suggestion** — clarity and consistency. Never invent these to pad a clean review.

Close with exactly one verdict line:

- `APPROVE` — no Critical findings and no Warning that should block.
- `REQUEST CHANGES` — one or more Critical findings, or Warnings that together make the change unsafe to merge.
- `NEEDS DISCUSSION` — the change conflicts with a convention that may itself be wrong here, or the right fix is a design decision rather than a correction. Say what the decision is and who should make it.

State the verdict plainly. A clean diff gets `APPROVE` and a short reason, not a
manufactured finding list.
