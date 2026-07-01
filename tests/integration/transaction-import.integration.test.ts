import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { importTransactions } from "@/lib/services/import-transactions";
import { getUserTransactions } from "@/lib/services/transactions";

import { adminClient, createTestUser, deleteTestUser, type TestUser } from "./helpers/users";

// S-01 import pipeline against a real Supabase. Two DB-level guarantees a mock
// cannot prove: idempotency (UNIQUE(user_id, external_id) + upsert) and per-user
// isolation (RLS). Everything runs through each user's OWN authenticated client
// so RLS WITH CHECK (user_id = auth.uid()) applies. Fixed `today` → deterministic
// generator output. Ad-hoc gate (Docker), not CI.
const TODAY = "2026-06-15";

describe("S-01 transaction import (real Supabase)", () => {
  let admin: SupabaseClient;
  let userA: TestUser;
  let userB: TestUser;
  let firstImportedA: number;

  beforeAll(async () => {
    admin = adminClient();
    [userA, userB] = await Promise.all([createTestUser(admin), createTestUser(admin)]);

    const [a] = await Promise.all([
      importTransactions(userA.client, userA.id, TODAY),
      importTransactions(userB.client, userB.id, TODAY),
    ]);
    firstImportedA = a.imported;
  });

  afterAll(async () => {
    await Promise.all([deleteTestUser(admin, userA.id), deleteTestUser(admin, userB.id)]);
  });

  it("lands a non-empty, fully-categorized set with income present", async () => {
    expect(firstImportedA).toBeGreaterThan(0);

    const txns = await getUserTransactions(userA.client);
    expect(txns).toHaveLength(firstImportedA); // count matches what import reported
    expect(txns.some((t) => t.type === "income")).toBe(true); // salary present (S-06 needs it)
    expect(txns.every((t) => t.category_id !== null)).toBe(true); // every row resolved to a category (Other fallback)
  });

  it("is idempotent — re-importing the same user creates no duplicates", async () => {
    const before = (await getUserTransactions(userA.client)).length;

    const { imported } = await importTransactions(userA.client, userA.id, TODAY);
    expect(imported).toBe(0); // upsert ignoreDuplicates → nothing new

    const after = (await getUserTransactions(userA.client)).length;
    expect(after).toBe(before); // count unchanged
  });

  it("isolates per user — A sees only A's rows, B sees only B's (Risk #5)", async () => {
    const aTxns = await getUserTransactions(userA.client);
    const bTxns = await getUserTransactions(userB.client);

    // Positive controls: each user sees their own imported data.
    expect(aTxns.length).toBeGreaterThan(0);
    expect(bTxns.length).toBeGreaterThan(0);

    // A's rows are all A's; none of B's leak in (and symmetrically for B).
    expect(aTxns.every((t) => t.external_id?.startsWith(`sim-${userA.id}-`))).toBe(true);
    expect(aTxns.some((t) => t.external_id?.startsWith(`sim-${userB.id}-`))).toBe(false);
    expect(bTxns.every((t) => t.external_id?.startsWith(`sim-${userB.id}-`))).toBe(true);
  });
});
