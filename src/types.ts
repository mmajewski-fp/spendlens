export type TransactionType = "income" | "expense";

export interface Category {
  id: string;
  name: string;
  slug: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  category_id: string | null;
  /** Stored as integer cents (e.g. $12.50 → 1250). Always positive. */
  amount: number;
  type: TransactionType;
  description: string | null;
  /** ISO date string: YYYY-MM-DD */
  date: string;
  /** Idempotency key from the simulated banking API import. */
  external_id: string | null;
  /** ISO 8601 timestamp string */
  created_at: string;
}

export interface SavingsGoal {
  id: string;
  user_id: string;
  name: string;
  /** Stored as integer cents (e.g. $1000.00 → 100000). */
  target_amount: number;
  /** ISO date string: YYYY-MM-DD */
  target_date: string;
  /** ISO 8601 timestamp string */
  created_at: string;
}

export interface Suggestion {
  categorySlug: string;
  categoryName: string;
  /** Cut amount in integer cents, always > 0. */
  estimatedSavingCents: number;
}

export interface SpendingAlert {
  categorySlug: string;
  categoryName: string;
  /** Actual category spend in the 30-day window, in integer cents. */
  spendCents: number;
  /** 12% of monthly income, in integer cents. */
  thresholdCents: number;
}

export interface GoalRecommendation {
  goalId: string;
  goalName: string;
  targetAmountCents: number;
  /** ISO YYYY-MM-DD */
  targetDate: string;
  isExpired: boolean;
  isOnTrack: boolean;
  requiredMonthlySavingCents: number;
  currentSurplusCents: number;
  /** Max 5 suggestions; empty when isOnTrack. */
  suggestions: Suggestion[];
}

export interface RecommendationsResult {
  hasMissingIncome: boolean;
  monthlyIncomeCents: number;
  alerts: SpendingAlert[];
  /** Same order as getUserGoals() (created_at ASC). */
  goals: GoalRecommendation[];
}
