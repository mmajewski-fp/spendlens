import { test as teardown } from "@playwright/test";
import fs from "node:fs";
import { deleteUser } from "./local-supabase";
import { STORAGE_STATE, USER_ID_FILE } from "./paths";

// Runs after the test project (wired via the setup project's `teardown`): remove the
// user created in setup so re-runs don't accumulate rows in the local dev database.
teardown("delete fault user", async () => {
  if (fs.existsSync(USER_ID_FILE)) {
    const id = fs.readFileSync(USER_ID_FILE, "utf8").trim();
    if (id) await deleteUser(id);
    fs.rmSync(USER_ID_FILE, { force: true });
  }
  fs.rmSync(STORAGE_STATE, { force: true });
});
