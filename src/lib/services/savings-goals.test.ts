import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { getUserGoals } from "@/lib/services/savings-goals";
import type { SavingsGoal } from "@/types";

// Hermetic (Risk #7): stub the Supabase client to force the error branch real
// infra can't easily trigger, and assert the service wraps it into a CLEAN Error
// — message only, never the raw Supabase object (no code/details/hint/PII rides
// along). This is the service-error contract the SSR page's try/catch is meant to
// catch. The page-side card→200 behavior is verified by inspection but is e2e
// (Lesson 4), not asserted here.
function stubClient(result: { data: unknown; error: unknown }): SupabaseClient {
  const builder = {
    select: () => builder,
    order: () => builder,
    gte: () => builder,
    then: (resolve: (value: unknown) => void) => {
      resolve(result);
    },
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

describe("getUserGoals — service error contract (Risk #7)", () => {
  it("throws a clean Error with only the Supabase message, never the raw object", async () => {
    const client = stubClient({
      data: null,
      error: { message: "db unavailable", code: "PGRST500", details: "internal detail", hint: "internal hint" },
    });

    const thrown = await getUserGoals(client).then(
      () => null,
      (e: unknown) => e,
    );

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("db unavailable");
    // The raw Supabase fields must NOT survive on the thrown error.
    const asRecord = thrown as Record<string, unknown>;
    expect(asRecord.code).toBeUndefined();
    expect(asRecord.details).toBeUndefined();
    expect(asRecord.hint).toBeUndefined();
  });

  it("returns the rows on success", async () => {
    const goal: SavingsGoal = {
      id: "g1",
      user_id: "u1",
      name: "Vacation",
      target_amount: 500_000,
      target_date: "2027-01-01",
      created_at: "2026-01-01T00:00:00Z",
    };
    const client = stubClient({ data: [goal], error: null });

    await expect(getUserGoals(client)).resolves.toEqual([goal]);
  });
});
