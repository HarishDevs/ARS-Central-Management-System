import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { compareCells, sortValueOf, textOf } from "@/features/ui/ClientSortTable";

// v1.58.0 (D-351, owner): tables sorted in the browser read each cell's own value.
describe("client-sorted tables", () => {
  it("read numbers, money, percentages, rates and times by value", () => {
    expect(sortValueOf("₹1,25,000")).toBe(125000);
    expect(sortValueOf("42%")).toBe(42);
    expect(sortValueOf("4.5 / 5")).toBe(4.5);
    expect(sortValueOf("2.5 days")).toBe(60);
    expect(sortValueOf("12 h")).toBe(12);
    expect(sortValueOf("30 min")).toBe(0.5);
  });
  it("read text inside links and pills; empty and dashes last", () => {
    expect(textOf(createElement("a", { href: "/x" }, "MTG-2026-000003 ", createElement("span", null, "Plant review")))).toBe("MTG-2026-000003 Plant review");
    expect(sortValueOf("—")).toBeNull();
    expect(sortValueOf("")).toBeNull();
    expect(sortValueOf("Purchase")).toBe("purchase");
  });
  it("compare numbers as numbers and text naturally", () => {
    expect(compareCells(9, 10)).toBeLessThan(0);
    expect(compareCells("item 9", "item 10")).toBeLessThan(0);
    expect(compareCells(null, 5)).toBeGreaterThan(0);
  });
});
