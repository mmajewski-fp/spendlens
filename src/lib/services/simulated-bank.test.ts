import { describe, it, expect } from "vitest";

import { generateTransactions } from "@/lib/services/simulated-bank";
import { categorize } from "@/lib/services/transaction-categorizer";

// Tests run under TZ=UTC (see the `test` script), so all Date math is exact.
const TODAY = "2026-06-15";
const USER = "user-abc";

function utcDays(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / (1000 * 60 * 60 * 24);
}

describe("generateTransactions", () => {
  it("is deterministic — same (userId, today) yields identical output", () => {
    expect(generateTransactions(USER, TODAY)).toEqual(generateTransactions(USER, TODAY));
  });

  it("varies by user — different userId yields different output", () => {
    const a = generateTransactions(USER, TODAY);
    const b = generateTransactions("user-xyz", TODAY);
    expect(a).not.toEqual(b);
  });

  it("produces a realistic-sized dataset (~30–50 rows)", () => {
    const txns = generateTransactions(USER, TODAY);
    expect(txns.length).toBeGreaterThanOrEqual(30);
    expect(txns.length).toBeLessThanOrEqual(50);
  });

  it("dates every transaction within the 30-day window [today-29, today]", () => {
    const txns = generateTransactions(USER, TODAY);
    const todayN = utcDays(TODAY);
    const windowStart = todayN - 29;
    for (const t of txns) {
      const n = utcDays(t.date);
      expect(n).toBeGreaterThanOrEqual(windowStart);
      expect(n).toBeLessThanOrEqual(todayN);
    }
  });

  it("includes at least one income (salary) row inside the window", () => {
    const income = generateTransactions(USER, TODAY).filter((t) => t.type === "income");
    expect(income.length).toBeGreaterThanOrEqual(1);
    expect(income.every((t) => t.amount > 0)).toBe(true);
  });

  it("emits only positive integer-cent amounts", () => {
    for (const t of generateTransactions(USER, TODAY)) {
      expect(Number.isInteger(t.amount)).toBe(true);
      expect(t.amount).toBeGreaterThan(0);
    }
  });

  it("has at least one expense category exceeding 12% of monthly income (so S-06 alerts fire)", () => {
    const txns = generateTransactions(USER, TODAY);
    const incomeCents = txns.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);

    const perSlug = new Map<string, number>();
    for (const t of txns.filter((t) => t.type === "expense")) {
      const slug = categorize(t.description);
      perSlug.set(slug, (perSlug.get(slug) ?? 0) + t.amount);
    }

    const maxCategory = Math.max(...perSlug.values());
    expect(maxCategory).toBeGreaterThan(Math.floor(incomeCents * 0.12));
  });

  it("includes at least one transaction that maps to the 'other' fallback", () => {
    const txns = generateTransactions(USER, TODAY);
    const others = txns.filter((t) => t.type === "expense" && categorize(t.description) === "other");
    expect(others.length).toBeGreaterThanOrEqual(1);
  });

  it("assigns stable, unique external_ids", () => {
    const txns = generateTransactions(USER, TODAY);
    const ids = txns.map((t) => t.external_id);
    expect(new Set(ids).size).toBe(ids.length);
    // Stable across runs (same index → same id).
    expect(generateTransactions(USER, TODAY).map((t) => t.external_id)).toEqual(ids);
    expect(ids[0]).toBe(`sim-${USER}-0`);
  });
});
