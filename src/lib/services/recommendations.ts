import type {
  SavingsGoal,
  GoalRecommendation,
  RecommendationsResult,
  SpendingAlert,
  Suggestion,
  TransactionWithCategory,
} from "@/types";
import { summarizeByCategory, toDateOnly } from "@/lib/services/spending-summary";

const WINDOW_DAYS = 30;
const ALERT_INCOME_FRACTION = 0.12;
const MAX_SUGGESTIONS = 5;
const MS_PER_DAY = 1000 * 60 * 60 * 24;
const DAYS_PER_MONTH = 30;

/** Months remaining from today to targetDate, floored at 1 (avoids division by zero). */
function monthsRemaining(today: Date, targetDate: Date): number {
  const diffMs = targetDate.getTime() - today.getTime();
  const diffDays = diffMs / MS_PER_DAY;
  return Math.max(1, Math.ceil(diffDays / DAYS_PER_MONTH));
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

  // Category buckets from expense transactions (sorted spend-desc, deterministic
  // tie-break). Single source of truth shared with the dashboard summary.
  const sortedBuckets = summarizeByCategory(expenses);

  // Excessive-spending alerts: categories > 12% of monthly income.
  // sortedBuckets is already spend-descending, so alerts inherit that order.
  const alerts: SpendingAlert[] = [];
  if (!hasMissingIncome) {
    const thresholdCents = Math.floor(monthlyIncomeCents * ALERT_INCOME_FRACTION);
    for (const bucket of sortedBuckets) {
      if (bucket.totalCents > thresholdCents) {
        alerts.push({
          categorySlug: bucket.categorySlug,
          categoryName: bucket.categoryName,
          spendCents: bucket.totalCents,
          thresholdCents,
        });
      }
    }
  }

  // Per-goal recommendations
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
          categorySlug: bucket.categorySlug,
          categoryName: bucket.categoryName,
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
