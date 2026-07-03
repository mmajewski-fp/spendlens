import { describe, it, expect } from "vitest";

import { toCsv } from "@/lib/transactions-csv";
import type { TransactionWithCategory } from "@/types";

function tx(overrides: Partial<TransactionWithCategory> = {}): TransactionWithCategory {
  return {
    id: "tx-1",
    user_id: "user-1",
    category_id: "cat-dining",
    amount: 1_250,
    type: "expense",
    description: "Lunch",
    date: "2026-07-01",
    external_id: null,
    created_at: "2026-07-01T00:00:00Z",
    category: { name: "Dining", slug: "dining" },
    ...overrides,
  };
}

const HEADER = "date,description,category,type,amount";

describe("toCsv", () => {
  it("returns a header-only document for no transactions", () => {
    expect(toCsv([])).toBe(HEADER);
  });

  it("emits the header then one row per transaction", () => {
    const csv = toCsv([tx()]);
    expect(csv).toBe(`${HEADER}\r\n2026-07-01,Lunch,Dining,expense,12.50`);
  });

  it("joins rows with CRLF", () => {
    const csv = toCsv([tx({ id: "a" }), tx({ id: "b", description: "Coffee", amount: 500 })]);
    expect(csv.split("\r\n")).toHaveLength(3); // header + 2 rows
  });

  it("formats amount as a positive decimal regardless of type", () => {
    const income = toCsv([tx({ type: "income", amount: 400_000, description: "Salary", category: null })]);
    expect(income).toContain("income,4000.00");
  });

  it("falls back to Other for a null category and empty for a null description", () => {
    const csv = toCsv([tx({ category: null, description: null })]);
    expect(csv).toBe(`${HEADER}\r\n2026-07-01,,Other,expense,12.50`);
  });

  it("RFC-4180 quotes fields containing commas, quotes, or newlines", () => {
    const csv = toCsv([tx({ description: 'Dinner, "fancy"' })]);
    // internal quotes doubled, whole field wrapped
    expect(csv).toContain('"Dinner, ""fancy"""');
  });

  it("guards spreadsheet formula injection with a leading apostrophe", () => {
    for (const lead of ["=", "+", "-", "@"]) {
      const csv = toCsv([tx({ description: `${lead}CMD()` })]);
      expect(csv).toContain(`'${lead}CMD()`);
    }
  });

  it("both guards and quotes a field that is dangerous and contains a comma", () => {
    const csv = toCsv([tx({ description: "=SUM(A1,A2)" })]);
    // apostrophe guard applied first, then wrapped because of the comma
    expect(csv).toContain('"\'=SUM(A1,A2)"');
  });
});
