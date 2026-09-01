import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/pages/api/goals";
import { createGoal } from "@/lib/services/savings-goals";

// Hermetic: exercise the handler's HTTP concerns (auth gate, zod validation,
// cap→409 mapping) without a DB or a browser. Mocking @/lib/supabase also keeps
// the `astro:env/server` virtual import from being evaluated in plain Vitest.
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => ({})) }));
vi.mock("@/lib/services/savings-goals", () => ({ createGoal: vi.fn() }));

const mockedCreateGoal = vi.mocked(createGoal);

const validBody = { name: "Vacation", target_amount_dollars: 1500, target_date: "2099-01-01" };

function makeContext(opts: { user?: { id: string } | null; body?: unknown }): APIContext {
  const { user = { id: "user-1" }, body } = opts;
  const request = new Request("http://localhost/api/goals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  });
  return { locals: { user }, request, cookies: {} } as unknown as APIContext;
}

describe("POST /api/goals — handler HTTP concerns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated (never reaches the service)", async () => {
    const res = await POST(makeContext({ user: null, body: validBody }));
    expect(res.status).toBe(401);
    expect(mockedCreateGoal).not.toHaveBeenCalled();
  });

  it("returns 400 when the target amount is not positive", async () => {
    const res = await POST(makeContext({ body: { ...validBody, target_amount_dollars: 0 } }));
    expect(res.status).toBe(400);
    expect(mockedCreateGoal).not.toHaveBeenCalled();
  });

  it("returns 400 when the target date is in the past", async () => {
    const res = await POST(makeContext({ body: { ...validBody, target_date: "2020-01-01" } }));
    expect(res.status).toBe(400);
  });

  it("maps the 3-goal cap trigger error to 409", async () => {
    mockedCreateGoal.mockRejectedValue(new Error("A user may not hold more than 3 active savings goals"));
    const res = await POST(makeContext({ body: validBody }));
    expect(res.status).toBe(409);
  });

  it("maps any other service error to 500 with a generic body (no raw error details)", async () => {
    mockedCreateGoal.mockRejectedValue(new Error("connection reset"));
    const res = await POST(makeContext({ body: validBody }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to create savings goal" });
  });

  it("returns 201 and converts dollars → cents on success", async () => {
    mockedCreateGoal.mockResolvedValue({
      id: "g1",
      user_id: "user-1",
      name: "Vacation",
      target_amount: 150_000,
      target_date: "2099-01-01",
      created_at: "2026-01-01T00:00:00Z",
    });
    const res = await POST(makeContext({ body: validBody }));
    expect(res.status).toBe(201);
    expect(mockedCreateGoal).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({ target_amount: 150_000 }),
    );
  });
});
