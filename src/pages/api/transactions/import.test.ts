import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/pages/api/transactions/import";
import { importTransactions } from "@/lib/services/import-transactions";

// Hermetic: exercise the handler's HTTP concerns (auth gate, success shape,
// error→500 contract) without a DB or a browser. Mocking @/lib/supabase also
// keeps the `astro:env/server` virtual import from being evaluated in Vitest.
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => ({})) }));
vi.mock("@/lib/services/import-transactions", () => ({ importTransactions: vi.fn() }));

const mockedImport = vi.mocked(importTransactions);

function makeContext(opts: { user?: { id: string } | null }): APIContext {
  const { user = { id: "user-1" } } = opts;
  const request = new Request("http://localhost/api/transactions/import", { method: "POST" });
  return { locals: { user }, request, cookies: {} } as unknown as APIContext;
}

describe("POST /api/transactions/import — handler HTTP concerns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated (never reaches the service)", async () => {
    const res = await POST(makeContext({ user: null }));
    expect(res.status).toBe(401);
    expect(mockedImport).not.toHaveBeenCalled();
  });

  it("returns 200 with the imported count on success", async () => {
    mockedImport.mockResolvedValue({ imported: 33 });
    const res = await POST(makeContext({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ imported: 33 });
    expect(mockedImport).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it("maps a service error to 500 with a generic body (no raw error details)", async () => {
    mockedImport.mockRejectedValue(new Error("connection reset"));
    const res = await POST(makeContext({}));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to import transactions" });
  });
});
