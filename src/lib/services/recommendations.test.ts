import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { computeRecommendations } from "@/lib/services/recommendations";
import type { RecommendationsResult, SavingsGoal, TransactionWithCategory } from "@/types";

// --- fixture factories -------------------------------------------------------
// Dates default inside the engine's 30-day window relative to the frozen clock
// (2026-06-01 → window starts 2026-05-02). Tests run under TZ=UTC (see the
// `test` script) so all Date math is exact and DST-free.

function expense(slug: string, name: string, amountCents: number): TransactionWithCategory {
  return {
    id: `tx-${slug}`,
    user_id: "user-1",
    category_id: `cat-${slug}`,
    amount: amountCents,
    type: "expense",
    description: null,
    date: "2026-05-20",
    external_id: null,
    created_at: "2026-05-20T00:00:00Z",
    category: { name, slug },
  };
}

function income(amountCents: number): TransactionWithCategory {
  return {
    id: "tx-income",
    user_id: "user-1",
    category_id: null,
    amount: amountCents,
    type: "income",
    description: null,
    date: "2026-05-20",
    external_id: null,
    created_at: "2026-05-20T00:00:00Z",
    category: null,
  };
}

function makeGoal(targetAmountCents: number, targetDate: string, name = "Goal"): SavingsGoal {
  return {
    id: "goal-1",
    user_id: "user-1",
    name,
    target_amount: targetAmountCents,
    target_date: targetDate,
    created_at: "2026-01-01T00:00:00Z",
  };
}

// Risk #2 oracle: no numeric field may be NaN or ±Infinity (those render to the
// UI as "$NaN"/"$∞" via formatCents). Number.isFinite is false for both.
function expectAllFieldsFinite(result: RecommendationsResult): void {
  expect(Number.isFinite(result.monthlyIncomeCents)).toBe(true);
  for (const goal of result.goals) {
    expect(Number.isFinite(goal.targetAmountCents)).toBe(true);
    expect(Number.isFinite(goal.requiredMonthlySavingCents)).toBe(true);
    expect(Number.isFinite(goal.currentSurplusCents)).toBe(true);
    for (const s of goal.suggestions) {
      expect(Number.isFinite(s.estimatedSavingCents)).toBe(true);
    }
  }
  for (const a of result.alerts) {
    expect(Number.isFinite(a.spendCents)).toBe(true);
    expect(Number.isFinite(a.thresholdCents)).toBe(true);
  }
}

describe("computeRecommendations", () => {
  it("returns a finite empty baseline for no transactions and no goals", () => {
    const result = computeRecommendations([], []);

    expect(result.hasMissingIncome).toBe(true);
    expect(result.monthlyIncomeCents).toBe(0);
    expect(result.alerts).toEqual([]);
    expect(result.goals).toEqual([]);
  });

  describe("Risk #1: cut-math correctness", () => {
    // Freeze "today" so the 30-day window and months-remaining are deterministic.
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    // Oracle derived by hand from PRD §Business Logic + US-01 AC (see research.md),
    // NOT from the implementation:
    //   income 400000, expenses 190000  → surplus 210000
    //   target 1500000 over 5 months     → required 300000
    //   gap 90000 closed highest→lowest  → Dining 80000 (full) + Shopping 10000
    it("matches the hand-worked cut amounts and minimum cut set", () => {
      const transactions = [
        income(400_000),
        expense("dining", "Dining", 80_000),
        expense("shopping", "Shopping", 50_000),
        expense("groceries", "Groceries", 40_000),
        expense("transport", "Transport", 20_000),
      ];
      // 2026-10-29 is 150 days after the frozen today → 5 months remaining.
      const goals = [makeGoal(1_500_000, "2026-10-29", "Vacation")];

      const result = computeRecommendations(transactions, goals);

      expect(result.monthlyIncomeCents).toBe(400_000);

      const goal = result.goals[0];
      expect(goal.currentSurplusCents).toBe(210_000);
      expect(goal.requiredMonthlySavingCents).toBe(300_000);
      expect(goal.isExpired).toBe(false);
      expect(goal.isOnTrack).toBe(false);

      expect(goal.suggestions).toEqual([
        { categorySlug: "dining", categoryName: "Dining", estimatedSavingCents: 80_000 },
        { categorySlug: "shopping", categoryName: "Shopping", estimatedSavingCents: 10_000 },
      ]);

      // The cuts sum to exactly the gap, and only the minimum set is used
      // (Groceries and Transport are left untouched).
      const totalCut = goal.suggestions.reduce((sum, s) => sum + s.estimatedSavingCents, 0);
      expect(totalCut).toBe(90_000);
    });

    it("emits no cuts when the surplus already covers the goal", () => {
      const transactions = [
        income(400_000),
        expense("dining", "Dining", 80_000),
        expense("shopping", "Shopping", 50_000),
        expense("groceries", "Groceries", 40_000),
        expense("transport", "Transport", 20_000),
      ];
      // required 100000 (= 500000 / 5) < surplus 210000 → on track, no cuts.
      const goals = [makeGoal(500_000, "2026-10-29", "Easy goal")];

      const result = computeRecommendations(transactions, goals);

      const goal = result.goals[0];
      expect(goal.requiredMonthlySavingCents).toBe(100_000);
      expect(goal.isOnTrack).toBe(true);
      expect(goal.suggestions).toEqual([]);
    });
  });

  describe("Risk #2: degenerate-input guards", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("stays finite when the goal timeframe is zero (target date is today)", () => {
      const transactions = [income(400_000), expense("dining", "Dining", 80_000)];
      const goals = [makeGoal(1_500_000, "2026-06-01", "Due today")];

      const result = computeRecommendations(transactions, goals);

      // months floored to 1 → required is finite, not NaN/Infinity.
      expectAllFieldsFinite(result);
      expect(result.goals[0].isExpired).toBe(false); // strictly-past test, today is not expired
    });

    it("stays finite when the goal date is in the past", () => {
      const transactions = [income(400_000), expense("dining", "Dining", 80_000)];
      const goals = [makeGoal(1_500_000, "2026-05-15", "Already overdue")];

      const result = computeRecommendations(transactions, goals);

      expectAllFieldsFinite(result);
      expect(result.goals[0].isExpired).toBe(true);
    });

    it("stays finite when the surplus is negative (expenses exceed income)", () => {
      const transactions = [income(100_000), expense("dining", "Dining", 150_000)];
      const goals = [makeGoal(1_500_000, "2026-10-29", "Underwater")];

      const result = computeRecommendations(transactions, goals);

      expectAllFieldsFinite(result);
      expect(result.hasMissingIncome).toBe(false);
      expect(result.goals[0].currentSurplusCents).toBe(-50_000); // negative but finite
    });

    it("returns the empty sentinel when income is missing", () => {
      const transactions = [expense("dining", "Dining", 80_000)];
      const goals = [makeGoal(1_500_000, "2026-10-29", "No income")];

      const result = computeRecommendations(transactions, goals);

      expectAllFieldsFinite(result);
      expect(result.hasMissingIncome).toBe(true);
      expect(result.alerts).toEqual([]);
      expect(result.goals[0].suggestions).toEqual([]);
    });

    // Out-of-contract NaN vector: a malformed target_date string is parsed by
    // toDateOnly without a validity check, cascading to NaN through to the UI.
    // Not reachable from the DB/API today; fixing + asserting it belongs to
    // rollout Phase 2 (Wedge-math contract). See research.md Open Q2.
    it.todo("malformed target_date string must not yield NaN — add guard + assertion in rollout Phase 2");
  });
});
