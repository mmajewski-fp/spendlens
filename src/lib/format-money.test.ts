import { describe, it, expect } from "vitest";

import { formatCents, formatSignedAmount } from "@/lib/format-money";

describe("formatCents", () => {
  it("formats positive cents as en-US currency", () => {
    expect(formatCents(1_250)).toBe("$12.50");
  });

  it("formats zero", () => {
    expect(formatCents(0)).toBe("$0.00");
  });

  it("adds a thousands separator for large amounts", () => {
    expect(formatCents(1_234_567)).toBe("$12,345.67");
  });
});

describe("formatSignedAmount", () => {
  it("prefixes income with a plus sign", () => {
    expect(formatSignedAmount(400_000, "income")).toBe("+$4,000.00");
  });

  it("prefixes expense with a minus sign", () => {
    expect(formatSignedAmount(8_050, "expense")).toBe("−$80.50");
  });

  it("signs a zero amount by type", () => {
    expect(formatSignedAmount(0, "income")).toBe("+$0.00");
    expect(formatSignedAmount(0, "expense")).toBe("−$0.00");
  });
});
