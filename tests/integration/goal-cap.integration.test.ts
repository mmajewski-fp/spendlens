import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGoal } from "@/lib/services/savings-goals";

import { adminClient, createTestUser, deleteTestUser, type TestUser } from "./helpers/users";

// Risk #6 (DB tier): the 3-goal cap is a BEFORE INSERT trigger counting rows per
// user_id — real DB state a mock would lie about. Seed the 3 goals via the
// user's OWN client so each INSERT satisfies WITH CHECK (user_id = auth.uid());
// the 4th is what trips the trigger (not the policy).
describe("Risk #6: 3-goal cap (DB trigger)", () => {
  let admin: SupabaseClient;
  let user: TestUser;

  beforeAll(async () => {
    admin = adminClient();
    user = await createTestUser(admin);
  });

  afterAll(async () => {
    await deleteTestUser(admin, user.id);
  });

  it("rejects a 4th active goal via the BEFORE INSERT trigger", async () => {
    for (const i of [1, 2, 3]) {
      await createGoal(user.client, user.id, {
        name: `Goal ${i}`,
        target_amount: 100_000 * i,
        target_date: "2099-01-01",
      });
    }

    await expect(
      createGoal(user.client, user.id, {
        name: "Goal 4",
        target_amount: 400_000,
        target_date: "2099-01-01",
      }),
    ).rejects.toThrow(/3 active savings goals/);
  });
});
