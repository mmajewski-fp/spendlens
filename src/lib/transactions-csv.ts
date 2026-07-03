import type { TransactionWithCategory } from "@/types";

const HEADER = ["date", "description", "category", "type", "amount"];

/**
 * Make a single field safe for CSV output:
 *  1. Formula-injection guard — prefix a value that begins with = + - @ (or a
 *     leading tab/CR) with a single quote so spreadsheets don't execute it.
 *  2. RFC-4180 quoting — if the value contains a comma, double-quote, or newline,
 *     wrap it in double quotes and double any internal quotes.
 */
function escapeField(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) {
    v = `'${v}`;
  }
  if (/[",\r\n]/.test(v)) {
    v = `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

/** Amount in plain decimal dollars (e.g. 1250 → "12.50") — no `$`, no separators. */
function amountToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Serialize categorized transactions to a CSV string (RFC-4180, CRLF line ends).
 * Columns: date, description, category, type, amount. Null category → "Other",
 * null description → "". Amount is a positive decimal; income/expense is carried
 * by the `type` column. Empty input yields a header-only document.
 */
export function toCsv(transactions: TransactionWithCategory[]): string {
  const rows = [HEADER.join(",")];
  for (const t of transactions) {
    rows.push(
      [t.date, t.description ?? "", t.category?.name ?? "Other", t.type, amountToDollars(t.amount)]
        .map(escapeField)
        .join(","),
    );
  }
  return rows.join("\r\n");
}
