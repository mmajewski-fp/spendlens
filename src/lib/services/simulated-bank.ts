/**
 * In-repo simulated banking source (S-01).
 *
 * Deterministic, DB-free generator: the same `(userId, today)` always yields the
 * same transactions, so re-connecting is stable and unit tests are exact. No
 * `Math.random()` / `Date.now()` / argless `new Date()` / ambient locale — all
 * randomness is a seeded PRNG derived from `userId`, and `today` is injected by
 * the caller (see context/foundation/lessons.md: determinism rule).
 */

import type { TransactionType } from "@/types";

export interface SimulatedTransaction {
  /** Positive integer cents. Sign is carried by `type`, never the amount. */
  amount: number;
  type: TransactionType;
  description: string;
  /** ISO YYYY-MM-DD, always within [today-29, today]. */
  date: string;
  /** Stable idempotency key: `sim-${userId}-${index}`, date-independent. */
  external_id: string;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const WINDOW_DAYS = 30;

// --- deterministic PRNG ------------------------------------------------------

/** FNV-1a hash over UTF-16 code units (codepoint-stable, locale-free). */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 — small, fast, fully deterministic PRNG returning [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inclusive integer in [min, max]. */
function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[randInt(rng, 0, items.length - 1)];
}

// --- date helpers (UTC-only, TZ-safe) ----------------------------------------

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** `isoDate` minus `days`, computed in UTC and formatted YYYY-MM-DD. */
function subtractDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  const result = new Date(base - days * MS_PER_DAY);
  return `${result.getUTCFullYear()}-${pad2(result.getUTCMonth() + 1)}-${pad2(result.getUTCDate())}`;
}

// --- fixture templates -------------------------------------------------------
// Descriptions are authored so the categorizer's keyword table maps each to a
// non-`other` slug — EXCEPT the deliberate `Other` case (see below), which
// exercises the fallback path downstream code must handle.

interface ExpenseTheme {
  descriptions: readonly string[];
  minCents: number;
  maxCents: number;
}

const EXPENSE_THEMES: readonly ExpenseTheme[] = [
  { descriptions: ["Whole Foods Supermarket", "Grocery Store", "Supermarket Trip"], minCents: 1_500, maxCents: 12_000 },
  {
    descriptions: ["Restaurant Dinner", "Corner Cafe", "Coffee Shop", "Pizzeria Order"],
    minCents: 800,
    maxCents: 7_000,
  },
  { descriptions: ["Uber Ride", "Shell Fuel", "Transit Card Top-up"], minCents: 500, maxCents: 6_000 },
  { descriptions: ["Electric Bill", "Water Utility", "Internet Service"], minCents: 3_000, maxCents: 15_000 },
  { descriptions: ["Netflix Subscription", "Cinema Tickets", "Concert Night"], minCents: 1_000, maxCents: 9_000 },
  { descriptions: ["Pharmacy Purchase", "Clinic Visit"], minCents: 1_200, maxCents: 20_000 },
  { descriptions: ["Amazon Order", "Clothing Boutique"], minCents: 2_000, maxCents: 25_000 },
  { descriptions: ["Airline Tickets", "Hotel Booking"], minCents: 5_000, maxCents: 60_000 },
];

/**
 * Generate a deterministic set of simulated transactions for a user.
 *
 * Guarantees (relied on by downstream slices and tests):
 * - exactly one `income` (salary) row inside the window — else S-06 shows nothing;
 * - one large Housing (rent) expense that alone exceeds 12% of income — so the
 *   S-06 alert threshold fires and the wedge has signal;
 * - one description ("ATM Withdrawal") that maps to `Other`, exercising the fallback;
 * - every date within [today-29, today]; every amount a positive integer cent value.
 */
export function generateTransactions(userId: string, today: string): SimulatedTransaction[] {
  const rng = mulberry32(fnv1a(userId));
  const out: SimulatedTransaction[] = [];

  const push = (t: Omit<SimulatedTransaction, "external_id">) => {
    out.push({ ...t, external_id: `sim-${userId}-${out.length}` });
  };

  // 1. Salary income (~$3,800–$4,200), dated in the first days of the window.
  const salaryCents = randInt(rng, 380_000, 420_000);
  push({
    amount: salaryCents,
    type: "income",
    description: "Monthly Salary Payroll",
    date: subtractDays(today, randInt(rng, 0, 5)),
  });

  // 2. Guaranteed rent (~$1,400–$1,600) — always > 12% of salary, so Housing alerts.
  push({
    amount: randInt(rng, 140_000, 160_000),
    type: "expense",
    description: "Apartment Rent",
    date: subtractDays(today, randInt(rng, 0, WINDOW_DAYS - 1)),
  });

  // 3. Deliberate `Other` case — no keyword matches, exercises the fallback path.
  push({
    amount: randInt(rng, 2_000, 8_000),
    type: "expense",
    description: "ATM Withdrawal",
    date: subtractDays(today, randInt(rng, 0, WINDOW_DAYS - 1)),
  });

  // 4. Spread of everyday expenses across themes (total lands at ~31–47 rows).
  const regularCount = randInt(rng, 28, 44);
  for (let i = 0; i < regularCount; i++) {
    const theme = pick(rng, EXPENSE_THEMES);
    push({
      amount: randInt(rng, theme.minCents, theme.maxCents),
      type: "expense",
      description: pick(rng, theme.descriptions),
      date: subtractDays(today, randInt(rng, 0, WINDOW_DAYS - 1)),
    });
  }

  return out;
}
