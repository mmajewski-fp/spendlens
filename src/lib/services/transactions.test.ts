import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { getUserTransactions } from "@/lib/services/transactions";

// Hermetic (Risk #7): same service-error contract as getUserGoals — a Supabase
// error becomes a clean message-only Error, never the raw {code,details,hint}
// object. The chainable stub also exposes `.gte` for the optional `since` filter.
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

describe("getUserTransactions — service error contract (Risk #7)", () => {
  it("throws a clean Error with only the Supabase message, never the raw object", async () => {
    const client = stubClient({
      data: null,
      error: { message: "db unavailable", code: "PGRST500", details: "internal detail", hint: "internal hint" },
    });

    const thrown = await getUserTransactions(client).then(
      () => null,
      (e: unknown) => e,
    );

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("db unavailable");
    const asRecord = thrown as Record<string, unknown>;
    expect(asRecord.code).toBeUndefined();
    expect(asRecord.details).toBeUndefined();
    expect(asRecord.hint).toBeUndefined();
  });

  it("returns the rows on success", async () => {
    const client = stubClient({ data: [], error: null });
    await expect(getUserTransactions(client)).resolves.toEqual([]);
  });
});
