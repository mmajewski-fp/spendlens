import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/pages/api/transactions/export";
import { getUserTransactions } from "@/lib/services/transactions";
import type { TransactionWithCategory } from "@/types";

// Hermetic: exercise the handler's HTTP concerns (auth gate, content-type,
// download disposition) without a DB. Mocking @/lib/supabase also keeps the
// `astro:env/server` virtual import from being evaluated in plain Vitest.
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => ({})) }));
vi.mock("@/lib/services/transactions", () => ({ getUserTransactions: vi.fn() }));

const mockedGetUserTransactions = vi.mocked(getUserTransactions);

function makeContext(opts: { user?: { id: string } | null } = {}): APIContext {
  const { user = { id: "user-1" } } = opts;
  const request = new Request("http://localhost/api/transactions/export", { method: "GET" });
  return { locals: { user }, request, cookies: {} } as unknown as APIContext;
}

const sampleTx: TransactionWithCategory = {
  id: "tx-1",
  user_id: "user-1",
  category_id: "cat-dining",
  amount: 1_250,
  type: "expense",
  description: "Lunch",
  date: "2026-07-01",
  external_id: null,
  created_at: "2026-07-01T00:00:00Z",
  category: { name: "Dining", slug: "dining" },
};

describe("GET /api/transactions/export — handler HTTP concerns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated (never reaches the service)", async () => {
    const res = await GET(makeContext({ user: null }));
    expect(res.status).toBe(401);
    expect(mockedGetUserTransactions).not.toHaveBeenCalled();
  });

  it("returns 200 with a text/csv content type and a download disposition", async () => {
    mockedGetUserTransactions.mockResolvedValue([sampleTx]);
    const res = await GET(makeContext());

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const disposition = res.headers.get("Content-Disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename="spendlens-transactions-\d{4}-\d{2}-\d{2}\.csv"$/);

    const body = await res.text();
    expect(body).toContain("date,description,category,type,amount");
    expect(body).toContain("2026-07-01,Lunch,Dining,expense,12.50");
  });

  it("maps a service error to 500 with a generic body (no raw error details)", async () => {
    mockedGetUserTransactions.mockRejectedValue(new Error("connection reset"));
    const res = await GET(makeContext());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to export transactions" });
  });
});
