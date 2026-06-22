import { describe, it, expect } from "vitest";

import { computeRecommendations } from "@/lib/services/recommendations";

describe("computeRecommendations", () => {
  it("returns a finite empty baseline for no transactions and no goals", () => {
    const result = computeRecommendations([], []);

    expect(result.hasMissingIncome).toBe(true);
    expect(result.monthlyIncomeCents).toBe(0);
    expect(result.alerts).toEqual([]);
    expect(result.goals).toEqual([]);
  });
});
