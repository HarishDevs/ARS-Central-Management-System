import { describe, expect, it } from "vitest";
import { formatDayRange, formatRelativeDay } from "@/lib/format/date";
import { dayText, dueLabel } from "@/features/work/format";
import { formatDayRange as pickerDayRange } from "@/features/ui/date-range";
import { DEFAULT_GRID, type GridConfig } from "@/server/work/grid";
import { gridLayoutSchema, isLayoutKey, layoutKey, layoutOf, parseLayout, sameLayout, withLayout } from "@/server/work/grid-layout";

// v1.95.0 (owner 28 Nov 2026): PM screens write dates, not weekday names (D-471,
// PM only), and a task table's column layout is kept per person (D-475, D-476).
const today = "2026-11-24"; // a Tuesday

describe("PM dates: no weekday names (D-471)", () => {
  it("the work helpers give the date itself; only Yesterday / Today / Tomorrow stay words", () => {
    expect(dayText("2026-11-23", today)).toBe("Yesterday");
    expect(dayText("2026-11-24", today)).toBe("Today");
    expect(dayText("2026-11-25", today)).toBe("Tomorrow");
    for (const day of ["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29", "2026-11-30"]) expect(dayText(day, today)).toMatch(/^\d{1,2} (Nov|Dec)$/);
    expect(dayText("2026-11-27", today)).toBe("27 Nov");
    expect(dueLabel("2026-11-27T18:29:00Z", new Date("2026-11-24T06:00:00Z"), true)).toEqual({ text: "27 Nov", tone: "neutral" });
  });
  it("PM pickers and ranges: dates only", () => {
    expect(pickerDayRange("", "2026-11-27", today, true, false)).toBe("27 Nov");
    expect(formatDayRange("", "2026-11-26", today, true, { weekdays: false })).toBe("26 Nov");
    expect(formatDayRange("2026-11-24", "2026-11-26", today, true, { weekdays: false })).toBe("24 – 26 Nov");
  });
  it("other modules keep the shared default for now (TD-041)", () => {
    expect(formatRelativeDay("2026-11-27", today)).toBe("Friday");
    expect(dayText("2026-11-27", today, { weekdays: true })).toBe("Friday");
    expect(dueLabel("2026-11-27T05:00:00Z", new Date("2026-11-24T06:00:00Z"), true, { weekdays: true })?.text).toBe("Friday");
    expect(pickerDayRange("", "2026-11-27", today)).toBe("Friday");
  });
});

describe("column layout kept per person (D-475, D-476)", () => {
  it("keys name one screen", () => {
    expect(layoutKey("PROJECT", 12, "t34")).toBe("PROJECT.12.t34");
    expect(layoutKey("MY_TASKS", 5, "vLIST")).toBe("MY_TASKS.5.vLIST");
    expect(layoutKey("MY_TASKS", 5, null)).toBe("MY_TASKS.5.none");
    expect(layoutKey("PROJECT", 1, "x; DROP")).toBe("PROJECT.1.none");
    for (const key of ["search", "PROJECT.12.t34", "MY_TASKS.5.vLIST", "MY_TASKS.5.none"]) expect(isLayoutKey(key)).toBe(true);
    for (const key of ["", "searchx", "PROJECT.a.t1", "work.layout.search", "PROJECT.1.t1.extra", 12]) expect(isLayoutKey(key)).toBe(false);
  });
  it("only hidden columns and their order; everything else in the view stays", () => {
    const view = { ...DEFAULT_GRID, sort: "due" as const, search: "x", hidden: ["createdBy" as const] };
    const layout = { hidden: ["tags" as const], hiddenFields: [3], columnOrder: ["due", "assignee"] };
    expect(withLayout(view, layout)).toEqual({ ...view, hidden: ["tags"], hiddenFields: [3], columnOrder: ["due", "assignee"] });
    expect(withLayout(view, null)).toBe(view);
    expect(layoutOf(withLayout(view, layout))).toEqual(layout);
    const sorted: GridConfig = { ...view, sort: "alpha" };
    expect(sameLayout(layoutOf(view), layoutOf(sorted))).toBe(true);
  });
  it("reads only valid stored layouts", () => {
    expect(parseLayout(JSON.stringify({ hidden: ["due"], columnOrder: ["f7", "due"] }))).toEqual({ hidden: ["due"], hiddenFields: [], columnOrder: ["f7", "due"] });
    expect(parseLayout(null)).toBeNull();
    expect(parseLayout("not json")).toBeNull();
    expect(parseLayout(JSON.stringify({ hidden: ["nope"] }))).toBeNull();
    expect(gridLayoutSchema.strict().safeParse({ hidden: [], sort: "due" }).success).toBe(false);
    expect(gridLayoutSchema.safeParse({ columnOrder: ["<b>"] }).success).toBe(false);
  });
});
