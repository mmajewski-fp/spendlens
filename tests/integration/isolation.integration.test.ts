import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGoal, deleteGoal, getUserGoals } from "@/lib/services/savings-goals";
import { createTransactions, getUserTransactions } from "@/lib/services/transactions";

import { adminClient, createTestUser, deleteTestUser, type TestUser } from "./helpers/users";

// Risk #5: a request authenticated as User A can NEVER return or mutate User B's
// rows. Enforcement is pure RLS (USING/WITH CHECK user_id = auth.uid()), so this
// must run with two truly-authenticated clients — a mock would lie. Every
// isolation assertion is paired with a positive control (own row present) so a
// broken query / empty DB can't pass it vacuously.
describe("Risk #5: ownership isolation", () => {
  let admin: SupabaseClient;
  let userA: TestUser;
  let userB: TestUser;
  let aGoalId: string;
  let bGoalId: string;

  beforeAll(async () => {
    admin = adminClient();
    [userA, userB] = await Promise.all([createTestUser(admin), createTestUser(admin)]);

    const [aGoal, bGoal] = await Promise.all([
      createGoal(userA.client, userA.id, {
        name: "A goal",
        target_amount: 100_000,
        target_date: "2027-01-01",
      }),
      createGoal(userB.client, userB.id, {
        name: "B goal",
        target_amount: 200_000,
        target_date: "2027-02-01",
      }),
    ]);
    aGoalId = aGoal.id;
    bGoalId = bGoal.id;

    await Promise.all([
      createTransactions(userA.client, [
        {
          user_id: userA.id,
          category_id: null,
          amount: 100_000,
          type: "income",
          description: null,
          date: "2026-06-01",
          external_id: "a-1",
        },
      ]),
      createTransactions(userB.client, [
        {
          user_id: userB.id,
          category_id: null,
          amount: 200_000,
          type: "income",
          description: null,
          date: "2026-06-01",
          external_id: "b-1",
        },
      ]),
    ]);
  });

  afterAll(async () => {
    await Promise.all([deleteTestUser(admin, userA.id), deleteTestUser(admin, userB.id)]);
  });

  it("A reads only A's goals (own present, B's absent)", async () => {
    const goals = await getUserGoals(userA.client);
    expect(goals).toHaveLength(1); // control: A's own goal IS visible
    expect(goals[0].id).toBe(aGoalId);
    expect(goals.some((g) => g.id === bGoalId)).toBe(false); // B's goal is NOT visible
  });

  it("A reads only A's transactions (own present, B's absent)", async () => {
    const txns = await getUserTransactions(userA.client);
    expect(txns).toHaveLength(1); // control: A's own transaction IS visible
    expect(txns[0].external_id).toBe("a-1");
    expect(txns.some((t) => t.external_id === "b-1")).toBe(false); // B's txn is NOT visible
  });

  it("B reads only B's goals (symmetric)", async () => {
    const goals = await getUserGoals(userB.client);
    expect(goals).toHaveLength(1);
    expect(goals[0].id).toBe(bGoalId);
  });

  it("A cannot delete B's goal — cross-user delete is a no-op", async () => {
    await deleteGoal(userA.client, bGoalId); // RLS filters the DELETE to zero rows (no error)

    const bGoals = await getUserGoals(userB.client);
    expect(bGoals.some((g) => g.id === bGoalId)).toBe(true); // B's goal SURVIVES

    const aGoals = await getUserGoals(userA.client);
    expect(aGoals.map((g) => g.id)).toEqual([aGoalId]); // A's own goals unaffected (zero rows deleted)
  });
});
