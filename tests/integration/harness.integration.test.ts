import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGoal, getUserGoals } from "@/lib/services/savings-goals";

import { adminClient, createTestUser, deleteTestUser, type TestUser } from "./helpers/users";

// Proof-of-life: proves the whole pipeline — Supabase boot, user auth, the
// INSERT WITH CHECK (user_id = auth.uid()), and the SELECT RLS policy — works
// before the risk suites pile on.
describe("integration harness", () => {
  let admin: SupabaseClient;
  let userA: TestUser;

  beforeAll(async () => {
    admin = adminClient();
    userA = await createTestUser(admin);
  });

  afterAll(async () => {
    await deleteTestUser(admin, userA.id);
  });

  it("creates and reads back a goal through real RLS", async () => {
    const created = await createGoal(userA.client, userA.id, {
      name: "Vacation",
      target_amount: 500_000,
      target_date: "2027-01-01",
    });
    expect(created.user_id).toBe(userA.id);

    const goals = await getUserGoals(userA.client);
    expect(goals).toHaveLength(1);
    expect(goals[0].name).toBe("Vacation");
  });
});
