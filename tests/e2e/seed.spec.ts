import { expect, test } from "@playwright/test";

/**
 * seed.spec.ts — the E2E quality lever for SpendLens.
 *
 * Every generated spec is modeled on this one. What you show is what you get:
 * the four patterns below are the contract for every test in tests/e2e/.
 *
 *   1. Role-based locators   — getByRole / getByLabel / getByText, never CSS/XPath.
 *   2. Test independence      — each test does its own setup, action, assertion, cleanup.
 *   3. Wait for state, not time — toBeVisible() / waitForURL() / waitForResponse(),
 *                                  never page.waitForTimeout().
 *   4. Risk-tied assertion    — the test name binds it to a test-plan.md risk, and the
 *                                assertion fails when that risk materializes.
 *
 * Auth: authenticate WITHOUT the UI via storageState from the `setup` project
 * (see tests/e2e/support/auth.setup.ts) — individual tests never log in through the form.
 */

// risk: test-plan.md — a signed-in user reaches a protected page (the auth + routing boundary is real)
// seed: this file
test("signed-in user lands on the dashboard, not the sign-in redirect", async ({ page }) => {
  // A protected route: middleware must let an authenticated session through.
  await page.goto("/dashboard");

  // Wait for STATE (the dashboard heading), not a fixed timeout, and assert the
  // business outcome: we are on the dashboard, not bounced to /auth/signin.
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();

  // No cleanup needed: this test creates no data. Tests that DO create data must
  // use a unique id (e.g. `Goal ${Date.now()}`) and tear it down here or in afterEach.
});
