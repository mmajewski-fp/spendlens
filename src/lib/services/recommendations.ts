import type {
  SavingsGoal,
  GoalRecommendation,
  RecommendationsResult,
  SpendingAlert,
  Suggestion,
  TransactionWithCategory,
} from "@/types";

const WINDOW_DAYS = 30;
const ALERT_INCOME_FRACTION = 0.12;
const MAX_SUGGESTIONS = 5;
const MS_PER_DAY = 1000 * 60 * 60 * 24;
const DAYS_PER_MONTH = 30;

function toDateOnly(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Months remaining from today to targetDate, floored at 1 (avoids division by zero). */
function monthsRemaining(today: Date, targetDate: Date): number {
  const diffMs = targetDate.getTime() - today.getTime();
  const diffDays = diffMs / MS_PER_DAY;
  return Math.max(1, Math.ceil(diffDays / DAYS_PER_MONTH));
}

/** Deterministic codepoint string comparison (locale-independent — see impl-review F1). */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface CategoryBucket {
  name: string;
  slug: string;
  totalCents: number;
}

export function computeRecommendations(
  transactions: TransactionWithCategory[],
  goals: SavingsGoal[],
): RecommendationsResult {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowStart = new Date(today.getTime() - WINDOW_DAYS * MS_PER_DAY);

  const recent = transactions.filter((t) => {
    const d = toDateOnly(t.date);
    return d >= windowStart;
  });

  const income = recent.filter((t) => t.type === "income");
  const expenses = recent.filter((t) => t.type === "expense");

  const monthlyIncomeCents = income.reduce((sum, t) => sum + t.amount, 0);
  const hasMissingIncome = monthlyIncomeCents === 0;

  const monthlyExpenseCents = expenses.reduce((sum, t) => sum + t.amount, 0);
  const monthlySurplusCents = monthlyIncomeCents - monthlyExpenseCents;

  // Build category buckets from expense transactions
  const buckets = new Map<string, CategoryBucket>();
  for (const t of expenses) {
    const key = t.category_id ?? "uncategorized";
    const name = t.category?.name ?? "Other";
    const slug = t.category?.slug ?? "other";
    const existing = buckets.get(key);
    if (existing) {
      existing.totalCents += t.amount;
    } else {
      buckets.set(key, { name, slug, totalCents: t.amount });
    }
  }

  // Excessive-spending alerts: categories > 12% of monthly income
  const alerts: SpendingAlert[] = [];
  if (!hasMissingIncome) {
    const thresholdCents = Math.floor(monthlyIncomeCents * ALERT_INCOME_FRACTION);
    for (const bucket of buckets.values()) {
      if (bucket.totalCents > thresholdCents) {
        alerts.push({
          categorySlug: bucket.slug,
          categoryName: bucket.name,
          spendCents: bucket.totalCents,
          thresholdCents,
        });
      }
    }
    alerts.sort((a, b) => b.spendCents - a.spendCents);
  }

  // Per-goal recommendations
  const sortedBuckets = [...buckets.values()].sort(
    (a, b) => b.totalCents - a.totalCents || compareStrings(a.name, b.name) || compareStrings(a.slug, b.slug),
  );

  const goalRecommendations: GoalRecommendation[] = goals.map((goal) => {
    const targetDate = toDateOnly(goal.target_date);
    const isExpired = targetDate < today;
    const months = monthsRemaining(today, targetDate);
    const requiredMonthlySavingCents = Math.ceil(goal.target_amount / months);
    const gapCents = Math.max(0, requiredMonthlySavingCents - monthlySurplusCents);
    const isOnTrack = !hasMissingIncome && gapCents === 0;

    const suggestions: Suggestion[] = [];
    if (!isOnTrack && !hasMissingIncome) {
      let remaining = gapCents;
      for (const bucket of sortedBuckets) {
        if (remaining <= 0 || suggestions.length >= MAX_SUGGESTIONS) break;
        const cut = Math.min(bucket.totalCents, remaining);
        suggestions.push({
          categorySlug: bucket.slug,
          categoryName: bucket.name,
          estimatedSavingCents: cut,
        });
        remaining -= cut;
      }
    }

    return {
      goalId: goal.id,
      goalName: goal.name,
      targetAmountCents: goal.target_amount,
      targetDate: goal.target_date,
      isExpired,
      isOnTrack,
      requiredMonthlySavingCents,
      currentSurplusCents: monthlySurplusCents,
      suggestions,
    };
  });

  return {
    hasMissingIncome,
    monthlyIncomeCents,
    alerts,
    goals: goalRecommendations,
  };
}
