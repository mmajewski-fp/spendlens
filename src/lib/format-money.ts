import type { TransactionType } from "@/types";

/** Format positive integer cents as en-US currency (e.g. 1250 → "$12.50"). */
export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * Format a transaction amount with a leading sign reflecting its type:
 * income → "+$X.XX", expense → "−$X.XX" (true minus sign). `cents` is the
 * stored positive amount; the sign comes from `type`, not the number.
 */
export function formatSignedAmount(cents: number, type: TransactionType): string {
  const sign = type === "income" ? "+" : "−";
  return `${sign}${formatCents(cents)}`;
}
