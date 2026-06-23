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

    it("sums multiple transactions in the same category into one bucket", () => {
      // Two dining transactions must accumulate into a single 90000 bucket
      // (exercises the bucket-merge branch, not two separate buckets).
      const transactions = [
        income(1_000_000),
        expense("dining", "Dining", 50_000),
        expense("dining", "Dining", 40_000),
      ];
      // surplus 910000; target 1000000 over 1 month → gap 90000 → one dining cut.
      const goals = [makeGoal(1_000_000, "2026-07-01", "Accumulate")];

      const result = computeRecommendations(transactions, goals);

      expect(result.goals[0].suggestions).toEqual([
        { categorySlug: "dining", categoryName: "Dining", estimatedSavingCents: 90_000 },
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

    const degenerateCases: {
      name: string;
      transactions: TransactionWithCategory[];
      goals: SavingsGoal[];
      check: (result: RecommendationsResult) => void;
    }[] = [
      {
        name: "timeframe zero (target date is today) — not expired (strict <)",
        transactions: [income(400_000), expense("dining", "Dining", 80_000)],
        goals: [makeGoal(1_500_000, "2026-06-01", "Due today")],
        check: (r) => {
          expect(r.goals[0].isExpired).toBe(false);
        },
      },
      {
        name: "past date — expired, suggestions still computed (ratified shipped design)",
        transactions: [income(400_000), expense("dining", "Dining", 80_000)],
        goals: [makeGoal(1_500_000, "2026-05-15", "Already overdue")],
        check: (r) => {
          expect(r.goals[0].isExpired).toBe(true);
          // Decision D: an expired goal keeps its aggressive cuts (months floored
          // to 1), NOT an empty/sentinel result.
          expect(r.goals[0].suggestions.length).toBeGreaterThan(0);
        },
      },
      {
        name: "negative surplus with income present — finite, not missing-income",
        transactions: [income(100_000), expense("dining", "Dining", 150_000)],
        goals: [makeGoal(1_500_000, "2026-10-29", "Underwater")],
        check: (r) => {
          expect(r.hasMissingIncome).toBe(false);
          expect(r.goals[0].currentSurplusCents).toBe(-50_000); // negative but finite
        },
      },
      {
        name: "missing income — empty sentinel (no suggestions, no alerts)",
        transactions: [expense("dining", "Dining", 80_000)],
        goals: [makeGoal(1_500_000, "2026-10-29", "No income")],
        check: (r) => {
          expect(r.hasMissingIncome).toBe(true);
          expect(r.alerts).toEqual([]);
          expect(r.goals[0].suggestions).toEqual([]);
        },
      },
    ];

    it.each(degenerateCases)("stays finite and guarded: $name", ({ transactions, goals, check }) => {
      const result = computeRecommendations(transactions, goals);

      // Risk #2 invariant: no NaN/±Infinity reaches the UI, for every input.
      expect(result.goals.length).toBe(1);
      expectAllFieldsFinite(result);
      check(result);
    });

    // Out-of-contract: a malformed/unparseable target_date is NOT tested.
    // target_date validity is guaranteed upstream — DB `date NOT NULL` plus the
    // API zod schema (YYYY-MM-DD regex + future-date refine) — so a bad string is
    // unreachable in production and the engine trusts its callers. Decided
    // won't-fix in Phase-2 research (decision G): no guard, no assertion.
  });

  describe("Risk #3: ranking order & cap", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("orders suggestions by spend descending (highest-impact first), not alphabetically", () => {
      // Spend order transport(30000) > dining(20000) > shopping(10000) is the
      // REVERSE of alphabetical — proving the rank is by spend (the PRD
      // "highest-impact → lowest" rule), not by category name.
      const transactions = [
        income(1_000_000),
        expense("transport", "Transport", 30_000),
        expense("dining", "Dining", 20_000),
        expense("shopping", "Shopping", 10_000),
      ];
      // surplus 940000; target 1000000 over 1 month → gap 60000 = sum of all three.
      const goals = [makeGoal(1_000_000, "2026-07-01", "All three")];

      const result = computeRecommendations(transactions, goals);

      expect(result.goals[0].suggestions.map((s) => s.categorySlug)).toEqual(["transport", "dining", "shopping"]);
    });

    it("cuts the minimum set to close the gap and leaves smaller categories untouched", () => {
      const transactions = [
        income(1_000_000),
        expense("shopping", "Shopping", 50_000),
        expense("dining", "Dining", 40_000),
        expense("groceries", "Groceries", 30_000),
        expense("transport", "Transport", 20_000),
      ];
      // surplus 860000; target 930000 over 1 month → gap 70000, closed by
      // shopping (50000) + part of dining (20000). groceries/transport untouched.
      const goals = [makeGoal(930_000, "2026-07-01", "Minimum set")];

      const { suggestions } = computeRecommendations(transactions, goals).goals[0];

      expect(suggestions).toEqual([
        { categorySlug: "shopping", categoryName: "Shopping", estimatedSavingCents: 50_000 },
        { categorySlug: "dining", categoryName: "Dining", estimatedSavingCents: 20_000 },
      ]);
      // Sum equals the gap exactly; the walk stopped before the smaller categories.
      const total = suggestions.reduce((sum, s) => sum + s.estimatedSavingCents, 0);
      expect(total).toBe(70_000);
    });

    it("caps suggestions at 5, keeping the highest-spend categories (gap may stay open)", () => {
      const transactions = [
        income(1_000_000),
        expense("shopping", "Shopping", 60_000),
        expense("dining", "Dining", 50_000),
        expense("groceries", "Groceries", 40_000),
        expense("transport", "Transport", 30_000),
        expense("entertainment", "Entertainment", 20_000),
        expense("utilities", "Utilities", 10_000),
      ];
      // Gap (1210000) dwarfs total spend, so all six would help — but the cap
      // stops at the 5 highest-spend categories; utilities (smallest) is dropped
      // and the gap stays open (documented truncation, not a bug).
      const goals = [makeGoal(2_000_000, "2026-07-01", "Over cap")];

      const goal = computeRecommendations(transactions, goals).goals[0];

      expect(goal.suggestions).toHaveLength(5);
      expect(goal.suggestions.map((s) => s.categorySlug)).toEqual([
        "shopping",
        "dining",
        "groceries",
        "transport",
        "entertainment",
      ]);
      // 5 cuts fall short of the gap (required − surplus); it remains open.
      const total = goal.suggestions.reduce((sum, s) => sum + s.estimatedSavingCents, 0);
      expect(total).toBeLessThan(goal.requiredMonthlySavingCents - goal.currentSurplusCents);
    });

    it("breaks ties alphabetically by category name, not by transaction order", () => {
      // Two equal-total categories inserted in REVERSE-alphabetical transaction
      // order (Dining before Apparel): insertion order would yield [dining,
      // apparel]; the defined tie-break must instead yield [apparel, dining].
      const transactions = [
        income(1_000_000),
        expense("dining", "Dining", 50_000),
        expense("apparel", "Apparel", 50_000),
      ];
      // surplus 900000; target 1000000 over 1 month → gap 100000 = both cuts.
      const goals = [makeGoal(1_000_000, "2026-07-01", "Tie")];

      const result = computeRecommendations(transactions, goals);

      expect(result.goals[0].suggestions.map((s) => s.categorySlug)).toEqual(["apparel", "dining"]);
    });
  });
});
