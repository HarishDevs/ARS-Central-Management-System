import { describe, expect, it } from "vitest";
import { displayValue, parseItemRows, storedItems } from "@/server/forms/fields";
import { checkTypeDraft, DEFAULT_TASK_SETTINGS, DEFAULT_TICKET_SETTINGS } from "@/server/modules/settings";

// v1.57.0 (D-335): the Item list field (item + quantity, no rate or GST).
describe("item list rows", () => {
  it("keeps items with whole quantities and ignores blank rows", () => {
    expect(parseItemRows(JSON.stringify([{ description: " Pens ", quantity: "10" }, { description: "", quantity: "1" }]))).toEqual({ items: [{ description: "Pens", quantity: 10 }] });
  });
  it("refuses a missing item, a bad quantity and too many rows", () => {
    expect(parseItemRows(JSON.stringify([{ description: "", quantity: "5" }]))).toEqual({ error: "Item 1: write what is needed." });
    expect(parseItemRows(JSON.stringify([{ description: "Pens", quantity: "2.5" }]))).toMatchObject({ error: expect.stringMatching(/whole number/) });
    expect(parseItemRows(JSON.stringify([{ description: "Pens", quantity: "0" }]))).toMatchObject({ error: expect.stringMatching(/whole number/) });
    expect(parseItemRows(JSON.stringify(Array.from({ length: 101 }, () => ({ description: "x", quantity: "1" }))))).toEqual({ error: "Add at most 100 items." });
    expect(parseItemRows("not json")).toMatchObject({ error: expect.any(String) });
  });
  it("reads stored items back and shows them as text", () => {
    const stored = JSON.stringify([
      { description: "A4 paper", quantity: 5 },
      { description: "Pens", quantity: 20 },
    ]);
    expect(storedItems(stored)).toHaveLength(2);
    expect(storedItems("garbage")).toEqual([]);
    expect(displayValue({ key: "items", label: "Items", type: "ITEM_LIST", required: false }, stored, new Map())).toBe("A4 paper × 5\nPens × 20");
  });
  it("is allowed on ticket forms, not on task forms", () => {
    const form = [{ key: "items", label: "Items", type: "ITEM_LIST" as const, required: true }];
    expect(checkTypeDraft("TICKET", form, DEFAULT_TICKET_SETTINGS)).toEqual([]);
    expect(checkTypeDraft("TASK", form, DEFAULT_TASK_SETTINGS).join(" ")).toMatch(/only for approval and ticket forms/);
  });
});
