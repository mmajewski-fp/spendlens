import type { CategorySpend, SpendingSummary, TransactionWithCategory } from "@/types";

/** Deterministic codepoint string comparison (locale-independent — see lessons.md). */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Parse an ISO YYYY-MM-DD date string into a local date-only Date (timezone-stable). */
export function toDateOnly(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Bucket an already-filtered list of EXPENSE transactions by category.
 *
 * Single source of truth for category bucketing — shared by the recommendations
 * engine and the dashboard so the two views can never disagree on spending.
 * A null category buckets as { categoryName: "Other", categorySlug: "other" }.
 * Callers own their own time-window filtering; this function is window-agnostic.
 *
 * Returns buckets sorted by spend descending, then codepoint category name, then
 * slug (deterministic tie-break — see lessons.md).
 */
export function summarizeByCategory(expenses: TransactionWithCategory[]): CategorySpend[] {
  const buckets = new Map<string, CategorySpend>();
  for (const t of expenses) {
    const key = t.category_id ?? "uncategorized";
    const categoryName = t.category?.name ?? "Other";
    const categorySlug = t.category?.slug ?? "other";
    const existing = buckets.get(key);
    if (existing) {
      existing.totalCents += t.amount;
    } else {
      buckets.set(key, { categoryName, categorySlug, totalCents: t.amount });
    }
  }

  return [...buckets.values()].sort(
    (a, b) =>
      b.totalCents - a.totalCents ||
      compareStrings(a.categoryName, b.categoryName) ||
      compareStrings(a.categorySlug, b.categorySlug),
  );
}

/** Round to one decimal place. */
function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Current-calendar-month spending summary for the dashboard.
 *
 * Filters `transactions` to the current calendar month [first-of-month, today]
 * (inclusive, date-only comparison), keeps expenses, buckets them via
 * summarizeByCategory, and decorates each bucket with its percentage share of
 * total expenses. `today` is injected so the computation is deterministic and
 * testable rather than reading the clock internally.
 */
export function computeSpendingSummary(transactions: TransactionWithCategory[], today: Date): SpendingSummary {
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const expenses = transactions.filter((t) => {
    if (t.type !== "expense") return false;
    const d = toDateOnly(t.date);
    return d >= monthStart && d <= todayDateOnly;
  });

  const categories = summarizeByCategory(expenses);
  const totalExpensesCents = categories.reduce((sum, c) => sum + c.totalCents, 0);

  return {
    totalExpensesCents,
    categories: categories.map((c) => ({
      ...c,
      // Guard the denominator: 0 total → 0% (never NaN/Infinity to the UI).
      percent: totalExpensesCents === 0 ? 0 : roundToTenth((c.totalCents / totalExpensesCents) * 100),
    })),
  };
}
