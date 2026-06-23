import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { computeRecommendations } from "@/lib/services/recommendations";
import type { RecommendationsResult, SavingsGoal, TransactionWithCategory } from "@/types";

// --- fixture factories -------------------------------------------------------
// Dates default inside the engine's 30-day window relative to the frozen clock
// (2026-06-01 → window starts 2026-05-02). Tests run under TZ=UTC (see the
// `test` script) so all Date math is exact and DST-free.

function expense(slug: string, name: string, amountCents: number, date = "2026-05-20"): TransactionWithCategory {
  return {
    id: `tx-${slug}-${date}`,
    user_id: "user-1",
    category_id: `cat-${slug}`,
    amount: amountCents,
    type: "expense",
    description: null,
    date,
    external_id: null,
    created_at: `${date}T00:00:00Z`,
    category: { name, slug },
  };
}

// Expense with no category — the engine buckets it as name "Other" / slug "other".
function uncategorizedExpense(amountCents: number, date = "2026-05-20"): TransactionWithCategory {
  return {
    id: `tx-uncategorized-${date}`,
    user_id: "user-1",
    category_id: null,
    amount: amountCents,
    type: "expense",
    description: null,
    date,
    external_id: null,
    created_at: `${date}T00:00:00Z`,
    category: null,
  };
}

function income(amountCents: number, date = "2026-05-20"): TransactionWithCategory {
  return {
    id: `tx-income-${date}`,
    user_id: "user-1",
    category_id: null,
    amount: amountCents,
    type: "income",
    description: null,
    date,
    external_id: null,
    created_at: `${date}T00:00:00Z`,
    category: null,
  };
}

function makeGoal(targetAmountCents: number, targetDate: string, name = "Goal", id = "goal-1"): SavingsGoal {
  return {
    id,
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

    it("rounds the required monthly saving up to reach the goal (ceil)", () => {
      // target 100000 over 3 months (today + 90 days) → 100000/3 = 33333.33.
      // Rounding DOWN (33333 × 3 = 99999) would fall short of the goal, so the
      // oracle is ceil = 33334.
      const result = computeRecommendations([income(400_000)], [makeGoal(100_000, "2026-08-30", "Rounding")]);

      expect(result.goals[0].requiredMonthlySavingCents).toBe(33_334);
    });

    it("counts a transaction on the 30-day boundary and excludes one past it", () => {
      // Window starts 2026-05-02 (today − 30d). 05-02 is included (>=); 05-01 is not.
      const result = computeRecommendations(
        [income(400_000, "2026-05-02"), expense("dining", "Dining", 100_000, "2026-05-01")],
        [makeGoal(5_000_000, "2026-10-29", "Boundary")],
      );

      // The boundary income is counted; the day-too-old expense is dropped, so
      // it never reduces the surplus.
      expect(result.monthlyIncomeCents).toBe(400_000);
      expect(result.goals[0].currentSurplusCents).toBe(400_000);
    });

    it("buckets an uncategorized expense as Other / other", () => {
      // surplus 940000; target 1000000 over 1 month (today + 30d) → required
      // 1000000, gap 60000 → the only (uncategorized) bucket absorbs it fully.
      const result = computeRecommendations(
        [income(1_000_000), uncategorizedExpense(60_000)],
        [makeGoal(1_000_000, "2026-07-01", "Uncategorized")],
      );

      expect(result.goals[0].suggestions).toEqual([
        { categorySlug: "other", categoryName: "Other", estimatedSavingCents: 60_000 },
      ]);
    });

    it("computes per-goal suggestions independently and preserves input order", () => {
      const transactions = [
        income(400_000),
        expense("dining", "Dining", 80_000),
        expense("shopping", "Shopping", 50_000),
      ];
      // surplus 270000. Goal A is covered (required 100000 → on track, no cuts);
      // Goal B needs cuts (required 400000 → gap 130000). Same spend pool, two
      // independent results; output order matches input order.
      const goals = [makeGoal(500_000, "2026-10-29", "A", "goal-a"), makeGoal(2_000_000, "2026-10-29", "B", "goal-b")];

      const result = computeRecommendations(transactions, goals);

      expect(result.goals.map((g) => g.goalId)).toEqual(["goal-a", "goal-b"]);
      expect(result.goals[0].isOnTrack).toBe(true);
      expect(result.goals[0].suggestions).toEqual([]);
      expect(result.goals[1].suggestions).toEqual([
        { categorySlug: "dining", categoryName: "Dining", estimatedSavingCents: 80_000 },
        { categorySlug: "shopping", categoryName: "Shopping", estimatedSavingCents: 50_000 },
      ]);
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
      expect(result.goals.length).toBe(1);
      expectAllFieldsFinite(result);
      expect(result.goals[0].isExpired).toBe(false); // strictly-past test, today is not expired
    });

    it("stays finite when the goal date is in the past", () => {
      const transactions = [income(400_000), expense("dining", "Dining", 80_000)];
      const goals = [makeGoal(1_500_000, "2026-05-15", "Already overdue")];

      const result = computeRecommendations(transactions, goals);

      expect(result.goals.length).toBe(1);
      expectAllFieldsFinite(result);
      expect(result.goals[0].isExpired).toBe(true);
    });

    it("stays finite when the surplus is negative (expenses exceed income)", () => {
      const transactions = [income(100_000), expense("dining", "Dining", 150_000)];
      const goals = [makeGoal(1_500_000, "2026-10-29", "Underwater")];

      const result = computeRecommendations(transactions, goals);

      expect(result.goals.length).toBe(1);
      expectAllFieldsFinite(result);
      expect(result.hasMissingIncome).toBe(false);
      expect(result.goals[0].currentSurplusCents).toBe(-50_000); // negative but finite
    });

    it("returns the empty sentinel when income is missing", () => {
      const transactions = [expense("dining", "Dining", 80_000)];
      const goals = [makeGoal(1_500_000, "2026-10-29", "No income")];

      const result = computeRecommendations(transactions, goals);

      expect(result.goals.length).toBe(1);
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
