import { describe, it, expect } from "vitest";

import { categorize } from "@/lib/services/transaction-categorizer";

describe("categorize", () => {
  // Oracle: hand-worked expected slugs per representative description — NOT
  // lifted from the implementation's keyword table.
  it.each([
    ["Monthly Salary Payroll", "salary"],
    ["Apartment Rent", "housing"],
    ["Whole Foods Market", "groceries"],
    ["Grocery Store", "groceries"],
    ["Restaurant Dinner", "dining"],
    ["Corner Cafe", "dining"],
    ["Coffee Shop", "dining"],
    ["Uber Ride", "transport"],
    ["Shell Fuel", "transport"],
    ["Electric Bill", "utilities"],
    ["Water Utility", "utilities"],
    ["Internet Service", "utilities"],
    ["Netflix Subscription", "entertainment"],
    ["Pharmacy Purchase", "healthcare"],
    ["Amazon Order", "shopping"],
    ["Clothing Boutique", "shopping"],
    ["Airline Tickets", "travel"],
    ["Hotel Booking", "travel"],
  ])("maps %j → %s", (description, expected) => {
    expect(categorize(description)).toBe(expected);
  });

  it("falls back to 'other' when no keyword matches", () => {
    expect(categorize("ATM Withdrawal")).toBe("other");
    expect(categorize("Unknown Vendor 4821")).toBe("other");
  });

  it("is case-insensitive and locale-independent", () => {
    expect(categorize("WHOLE FOODS MARKET")).toBe("groceries");
    expect(categorize("uBeR rIdE")).toBe("transport");
  });

  it("is deterministic — same input yields same slug", () => {
    expect(categorize("Electric Bill")).toBe(categorize("Electric Bill"));
  });
});
