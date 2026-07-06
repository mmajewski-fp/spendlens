import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE, PUT } from "@/pages/api/goals/[id]";
import { deleteGoal, getGoalById, updateGoal } from "@/lib/services/savings-goals";
import type { SavingsGoal } from "@/types";

// Hermetic: exercise the handler's HTTP concerns (auth gate, id extraction,
// validation, error mapping) without a DB. Mocking @/lib/supabase also keeps the
// `astro:env/server` virtual import from being evaluated in plain Vitest.
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => ({})) }));
vi.mock("@/lib/services/savings-goals", () => ({
  deleteGoal: vi.fn(),
  getGoalById: vi.fn(),
  updateGoal: vi.fn(),
}));

const mockedDeleteGoal = vi.mocked(deleteGoal);
const mockedGetGoalById = vi.mocked(getGoalById);
const mockedUpdateGoal = vi.mocked(updateGoal);

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

const storedGoal: SavingsGoal = {
  id: "goal-1",
  user_id: "user-1",
  name: "Vacation",
  target_amount: 150_000,
  target_date: "2020-01-01", // in the past — an expired goal
  created_at: "2019-01-01T00:00:00Z",
};

const validPutBody = { name: "Vacation", target_amount_dollars: 1500, target_date: "2020-01-01" };

function makePutContext(opts: { user?: { id: string } | null; id?: string; body?: unknown }): APIContext {
  const { user = { id: "user-1" }, id = "goal-1", body = validPutBody } = opts;
  const request = new Request(`http://localhost/api/goals/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  });
  return { locals: { user }, request, cookies: {}, params: { id } } as unknown as APIContext;
}

describe("PUT /api/goals/[id] — handler HTTP concerns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetGoalById.mockResolvedValue(storedGoal);
    mockedUpdateGoal.mockResolvedValue({ ...storedGoal, name: "Updated" });
  });

  it("returns 401 when unauthenticated (never reaches the service)", async () => {
    const res = await PUT(makePutContext({ user: null }));
    expect(res.status).toBe(401);
    expect(mockedGetGoalById).not.toHaveBeenCalled();
    expect(mockedUpdateGoal).not.toHaveBeenCalled();
  });

  it("returns 404 when the goal is missing or not owned (before validating the body)", async () => {
    mockedGetGoalById.mockResolvedValue(null);
    const res = await PUT(makePutContext({ id: "nope", body: { garbage: true } }));
    expect(res.status).toBe(404);
    expect(mockedUpdateGoal).not.toHaveBeenCalled();
  });

  it("returns 400 when the name is empty", async () => {
    const res = await PUT(makePutContext({ body: { ...validPutBody, name: "  " } }));
    expect(res.status).toBe(400);
    expect(mockedUpdateGoal).not.toHaveBeenCalled();
  });

  it("returns 400 when the target amount is not positive", async () => {
    const res = await PUT(makePutContext({ body: { ...validPutBody, target_amount_dollars: 0 } }));
    expect(res.status).toBe(400);
    expect(mockedUpdateGoal).not.toHaveBeenCalled();
  });

  it("returns 400 when the date is CHANGED to a past date", async () => {
    const res = await PUT(makePutContext({ body: { ...validPutBody, target_date: "2019-06-01" } }));
    expect(res.status).toBe(400);
    expect(mockedUpdateGoal).not.toHaveBeenCalled();
  });

  it("allows a name-only edit of an expired goal (unchanged past date → 200)", async () => {
    const res = await PUT(makePutContext({ body: { ...validPutBody, name: "Renamed" } }));
    expect(res.status).toBe(200);
    expect(mockedUpdateGoal).toHaveBeenCalledWith(
      expect.anything(),
      "goal-1",
      expect.objectContaining({ name: "Renamed", target_date: "2020-01-01" }),
    );
  });

  it("returns 200 and converts dollars → cents on success", async () => {
    const res = await PUT(makePutContext({ body: { ...validPutBody, target_amount_dollars: 1500 } }));
    expect(res.status).toBe(200);
    expect(mockedUpdateGoal).toHaveBeenCalledWith(
      expect.anything(),
      "goal-1",
      expect.objectContaining({ target_amount: 150_000 }),
    );
  });

  it("maps a service error to 500", async () => {
    mockedUpdateGoal.mockRejectedValue(new Error("connection reset"));
    const res = await PUT(makePutContext({}));
    expect(res.status).toBe(500);
  });
});
