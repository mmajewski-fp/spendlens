import { describe, it, expect } from "vitest";

import { summarizeByCategory, computeSpendingSummary } from "@/lib/services/spending-summary";
import type { TransactionWithCategory } from "@/types";

// Tests run under TZ=UTC (see the `test` script and vitest.config) so all
// date-only math is exact and DST-free (lessons.md).

function expense(slug: string, name: string, amountCents: number, date = "2026-07-10"): TransactionWithCategory {
  return {
    id: `tx-${slug}-${date}-${amountCents}`,
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

function uncategorizedExpense(amountCents: number, date = "2026-07-10"): TransactionWithCategory {
  return {
    id: `tx-uncat-${date}-${amountCents}`,
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

function income(amountCents: number, date = "2026-07-10"): TransactionWithCategory {
  return {
    id: `tx-income-${date}-${amountCents}`,
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

// Fixed "today" for the calendar-month window: 2026-07-15 (local, TZ=UTC).
const TODAY = new Date(2026, 6, 15);

describe("summarizeByCategory", () => {
  it("returns an empty array for no expenses", () => {
    expect(summarizeByCategory([])).toEqual([]);
  });

  it("buckets a null-category expense as Other / other", () => {
    expect(summarizeByCategory([uncategorizedExpense(5_000)])).toEqual([
      { categoryName: "Other", categorySlug: "other", totalCents: 5_000 },
    ]);
  });

  it("sums multiple transactions in the same category into one bucket", () => {
    expect(summarizeByCategory([expense("dining", "Dining", 4_000), expense("dining", "Dining", 6_000)])).toEqual([
      { categoryName: "Dining", categorySlug: "dining", totalCents: 10_000 },
    ]);
  });

  it("orders buckets by spend descending", () => {
    const result = summarizeByCategory([
      expense("dining", "Dining", 2_000),
      expense("shopping", "Shopping", 5_000),
      expense("transport", "Transport", 3_000),
    ]);
    expect(result.map((c) => c.categorySlug)).toEqual(["shopping", "transport", "dining"]);
  });

  it("breaks equal-spend ties by codepoint category name, not insertion order", () => {
    // Dining inserted before Apparel; both equal spend. Deterministic tie-break
    // must yield [Apparel, Dining] (codepoint), not the insertion order.
    const result = summarizeByCategory([expense("dining", "Dining", 5_000), expense("apparel", "Apparel", 5_000)]);
    expect(result.map((c) => c.categorySlug)).toEqual(["apparel", "dining"]);
  });
});

describe("computeSpendingSummary", () => {
  it("returns a zero, empty summary for no transactions (no divide-by-zero)", () => {
    const summary = computeSpendingSummary([], TODAY);
    expect(summary.totalExpensesCents).toBe(0);
    expect(summary.categories).toEqual([]);
  });

  it("ignores income and produces a zero summary when the month has only income", () => {
    const summary = computeSpendingSummary([income(500_000)], TODAY);
    expect(summary.totalExpensesCents).toBe(0);
    expect(summary.categories).toEqual([]);
  });

  it("computes total and per-category percentage as a share of total expenses", () => {
    const summary = computeSpendingSummary(
      [income(500_000), expense("dining", "Dining", 3_333), expense("groceries", "Groceries", 6_667)],
      TODAY,
    );
    expect(summary.totalExpensesCents).toBe(10_000);
    // Ranked by spend desc; percent rounded to one decimal.
    expect(summary.categories).toEqual([
      { categoryName: "Groceries", categorySlug: "groceries", totalCents: 6_667, percent: 66.7 },
      { categoryName: "Dining", categorySlug: "dining", totalCents: 3_333, percent: 33.3 },
    ]);
    for (const c of summary.categories) {
      expect(Number.isFinite(c.percent)).toBe(true);
    }
  });

  it("includes the first-of-month and today boundaries, excludes prior month and future dates", () => {
    const summary = computeSpendingSummary(
      [
        expense("dining", "Dining", 1_000, "2026-06-30"), // prior month → excluded
        expense("groceries", "Groceries", 2_000, "2026-07-01"), // first of month → included
        expense("transport", "Transport", 3_000, "2026-07-15"), // today → included
        expense("shopping", "Shopping", 4_000, "2026-07-20"), // after today → excluded
      ],
      TODAY,
    );
    expect(summary.totalExpensesCents).toBe(5_000);
    expect(summary.categories.map((c) => c.categorySlug)).toEqual(["transport", "groceries"]);
  });

  it("buckets an uncategorized expense as Other in the summary", () => {
    const summary = computeSpendingSummary([uncategorizedExpense(8_000)], TODAY);
    expect(summary.categories).toEqual([
      { categoryName: "Other", categorySlug: "other", totalCents: 8_000, percent: 100 },
    ]);
  });
});
