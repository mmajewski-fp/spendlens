import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import SpendingSummary from "@/components/SpendingSummary";
import type { SpendingSummary as SpendingSummaryData } from "@/types";

// Server-render the island to a string — the unit config runs in a node
// environment and has no jsdom/testing-library, so we assert on rendered HTML.

const summary: SpendingSummaryData = {
  totalExpensesCents: 10_000,
  categories: [
    { categoryName: "Groceries", categorySlug: "groceries", totalCents: 6_667, percent: 66.7 },
    { categoryName: "Dining", categorySlug: "dining", totalCents: 3_333, percent: 33.3 },
  ],
};

function render(data: SpendingSummaryData): string {
  return renderToStaticMarkup(createElement(SpendingSummary, { summary: data }));
}

describe("SpendingSummary", () => {
  it("renders the total and each category with formatted amount and percent", () => {
    const html = render(summary);
    expect(html).toContain("Spending this month");
    expect(html).toContain("$100.00"); // total expenses
    expect(html).toContain("Groceries");
    expect(html).toContain("$66.67");
    expect(html).toContain("66.7%");
    expect(html).toContain("Dining");
    expect(html).toContain("$33.33");
    expect(html).toContain("33.3%");
  });

  it("renders categories in the given (spend-descending) order", () => {
    const html = render(summary);
    expect(html.indexOf("Groceries")).toBeLessThan(html.indexOf("Dining"));
  });

  it("sizes each category bar to its percentage", () => {
    const html = render(summary);
    expect(html).toContain("width:66.7%");
    expect(html).toContain("width:33.3%");
  });

  it("renders an empty list with a zero total", () => {
    const html = render({ totalExpensesCents: 0, categories: [] });
    expect(html).toContain("$0.00");
    expect(html).not.toContain("width:");
  });
});
