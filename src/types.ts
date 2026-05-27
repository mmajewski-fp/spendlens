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
