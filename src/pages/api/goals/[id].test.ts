import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE } from "@/pages/api/goals/[id]";
import { deleteGoal } from "@/lib/services/savings-goals";

// Hermetic: exercise the handler's HTTP concerns (auth gate, id extraction,
// error mapping) without a DB. Mocking @/lib/supabase also keeps the
// `astro:env/server` virtual import from being evaluated in plain Vitest.
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => ({})) }));
vi.mock("@/lib/services/savings-goals", () => ({ deleteGoal: vi.fn() }));

const mockedDeleteGoal = vi.mocked(deleteGoal);

function makeContext(opts: { user?: { id: string } | null; id?: string }): APIContext {
  const { user = { id: "user-1" }, id = "goal-1" } = opts;
  const request = new Request(`http://localhost/api/goals/${id}`, { method: "DELETE" });
  return { locals: { user }, request, cookies: {}, params: { id } } as unknown as APIContext;
}

describe("DELETE /api/goals/[id] — handler HTTP concerns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated (never reaches the service)", async () => {
    const res = await DELETE(makeContext({ user: null }));
    expect(res.status).toBe(401);
    expect(mockedDeleteGoal).not.toHaveBeenCalled();
  });

  it("returns 204 and calls deleteGoal with the path id on success", async () => {
    mockedDeleteGoal.mockResolvedValue(undefined);
    const res = await DELETE(makeContext({ id: "goal-42" }));
    expect(res.status).toBe(204);
    expect(mockedDeleteGoal).toHaveBeenCalledWith(expect.anything(), "goal-42");
  });

  it("maps a service error to 500", async () => {
    mockedDeleteGoal.mockRejectedValue(new Error("connection reset"));
    const res = await DELETE(makeContext({}));
    expect(res.status).toBe(500);
  });
});
