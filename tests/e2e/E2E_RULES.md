# E2E Testing Rules (Playwright — SpendLens)

The agent reads this before generating any spec in `tests/e2e/`. It constrains
output so generated tests are stable by default. Model every test on
`tests/e2e/seed.spec.ts` — seed quality is test quality.

## The rules block

- Use `getByRole`, `getByLabel`, `getByText` as primary locators.
  Fall back to `getByTestId` only when accessibility attributes are ambiguous.
- Never use CSS selectors, XPath, or DOM structure for locating elements.
- Each test must be independently runnable — no shared state between tests.
- Never use `page.waitForTimeout()`. Wait for specific conditions:
  `toBeVisible()`, `waitForURL()`, `waitForResponse()`.
- Assert the business outcome, not implementation details.
- Use unique identifiers (e.g. timestamp suffix) for test data to avoid
  collisions in parallel runs. Clean up in `afterEach`/`finally`.
- Use `storageState` for authentication — never log in through the UI in
  individual tests. The `setup` project (`tests/e2e/support/auth.setup.ts`)
  creates a confirmed user via the Supabase service-role key and produces the
  stored session; specs reuse it.

## What stays real vs. what may be faulted (SpendLens specifics)

- **Auth, routing, middleware, SSR render stay REAL.** That is where the
  integration risk this suite protects actually lives.
- **The only sanctioned mock is deterministic fault injection of an external
  data call**, and only at the network boundary the server actually calls out
  to. SpendLens fetches Supabase **server-side** in `.astro` frontmatter, so
  `page.route()` (browser-side) cannot intercept it. To simulate a backend
  failure, point the app's `SUPABASE_URL` at `tests/e2e/support/fault-proxy.mjs`,
  which forwards everything to the real local Supabase **except** the one
  data path under test, which it fails. Auth still flows to the real backend.

## Governing rules

- **Name the test after the risk**, e.g.
  `test('SSR fetch error renders a graceful error card, not a blank 500', ...)`.
- **The assertion must fail if the risk materializes.** Control question for
  every assertion: would this fail if the `test-plan.md` risk came true? If
  not, it is decorative. Confirm with a deliberate break, never assume.
- **Don't generate E2E tests from scratch or per-page.** One reviewed test per
  browser-level risk from `context/foundation/test-plan.md`.
