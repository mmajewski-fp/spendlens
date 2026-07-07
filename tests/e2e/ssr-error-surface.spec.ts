import { expect, test } from "@playwright/test";

// risk: test-plan.md #7 — an SSR page whose data fetch throws must render a graceful
//        error card (HTTP 200), NOT a blank 500, and must NOT leak the raw Supabase
//        error / PII into the rendered page.
// seed: tests/e2e/seed.spec.ts
// how:  the fault-proxy (tests/e2e/support/fault-proxy.mjs) fails the dashboard's
//       server-side transactions read for the fault user, so getUserTransactions()
//       throws inside dashboard.astro's frontmatter — the exact failure lessons.md
//       ("Wrap SSR data-fetching in try/catch to avoid blank 500 pages") warns about.

// The secret token the faulted backend response carries. dashboard.astro captures the
// error but must render a generic card, so this must never appear in the page.
const LEAK_TOKEN = "SUPABASE_INTERNAL_LEAK_TOKEN_do_not_render";

test.describe("SSR error surface (test-plan.md #7)", () => {
  test("dashboard SSR fetch error renders a graceful error card, not a blank 500", async ({ page }) => {
    // A signed-in user loads the dashboard while the transactions read is failing.
    const response = await page.goto("/dashboard");

    // The page is SERVED, not a blank 500 — the try/catch turned the thrown service
    // error into a normal render. A 500 here is exactly the regression #7 protects against.
    expect(response?.status()).toBe(200);

    // The graceful error card is shown to the user (real SSR-rendered markup).
    await expect(page.getByText("Could not load your spending summary")).toBeVisible();

    // The page still rendered its shell (heading), i.e. it degraded gracefully rather
    // than blanking out — and we were NOT bounced to the sign-in redirect.
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();

    // No raw Supabase error / PII leaked into the error surface.
    await expect(page.locator("body")).not.toContainText(LEAK_TOKEN);
    await expect(page.locator("body")).not.toContainText("permission denied for table");
  });
});
