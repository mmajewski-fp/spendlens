import { test as setup, expect } from "@playwright/test";
import fs from "node:fs";
import { createFaultUser } from "./local-supabase";
import { AUTH_DIR, STORAGE_STATE, USER_ID_FILE } from "./paths";

// One-time UI login in the setup project is the sanctioned exception to
// "never log in through the UI" — individual tests reuse the storageState below.
setup("create fault user and store authenticated session", async ({ page }) => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const user = await createFaultUser();
  fs.writeFileSync(USER_ID_FILE, user.id);

  await page.goto("/auth/signin");
  // exact: true so "Password" doesn't also match the "Show password" toggle button.
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  // Confirm the controlled React inputs actually hold the values before submitting.
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(user.email);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Signin redirects to the app root — wait for that state, not a timeout.
  await page.waitForURL("/");
  await page.context().storageState({ path: STORAGE_STATE });
});
