import { describe, expect, it } from "vitest";
import { powerChips, powerHref, type PowerField } from "@/features/ui/PowerSearch";

// v1.85.0 (D-412): the power search's chips come from the address, and each
// operator sets exactly one parameter the register already reads.
const FIELDS: PowerField[] = [
  { key: "q", label: "Title", input: "text", operators: [{ label: "contains", param: "q" }] },
  { key: "status", label: "Status", input: "choice", operators: [{ label: "is", param: "status" }], options: [["APPROVED", "Approved"]] },
  { key: "date", label: "Submitted", input: "date", operators: [{ label: "on or after", param: "from" }, { label: "on or before", param: "to" }] },
  { key: "overdue", label: "Overdue", input: "flag", operators: [{ label: "is", param: "overdue" }] },
];

describe("power search", () => {
  it("makes a chip per parameter in use, with the option's label", () => {
    const chips = powerChips(FIELDS, { status: "APPROVED", from: "2026-11-01", overdue: "1", q: "", sort: "no" });
    expect(chips.map((chip) => chip.text)).toEqual(["Status is Approved", "Submitted on or after 2026-11-01", "Overdue is yes"]);
  });

  it("sets or removes one parameter, drops the page and the open pane, keeps the rest", () => {
    expect(powerHref("/admin/records/requests", { status: "APPROVED", page: "3", open: "9", sort: "title" }, { from: "2026-11-01" })).toBe("/admin/records/requests?status=APPROVED&sort=title&from=2026-11-01");
    expect(powerHref("/admin/records/requests", { status: "APPROVED" }, { status: null })).toBe("/admin/records/requests");
  });
});
