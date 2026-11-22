import { describe, expect, it } from "vitest";
import {
  addMonths,
  dayOff,
  fieldText,
  formatDayRange,
  isRealDay,
  monthGrid,
  outOfBounds,
  parseDayInput,
  pickDay,
  previewRange,
  rangeRole,
  rangeText,
  typeDay,
  weekEnd,
  weekStart,
} from "@/features/ui/date-range";
import { dateWindowValue, parseDateWindow, passesWindow } from "@/server/work/grid";

// v1.75.0 (D-399): the shared date range picker's rules (spec DATE_RANGES).
describe("typed dates", () => {
  it("accepts dd-mm-yyyy, dd/mm/yyyy, dd.mm.yy and yyyy-mm-dd", () => {
    expect(parseDayInput("01-12-2026")).toBe("2026-12-01");
    expect(parseDayInput("1/12/2026")).toBe("2026-12-01");
    expect(parseDayInput("01.12.26")).toBe("2026-12-01");
    expect(parseDayInput("2026-12-01")).toBe("2026-12-01");
    expect(parseDayInput(" 2026-1-5 ")).toBe("2026-01-05");
  });
  it("refuses days that don't exist and other text", () => {
    expect(parseDayInput("30-02-2027")).toBeNull();
    expect(parseDayInput("2027-02-29")).toBeNull();
    expect(parseDayInput("2028-02-29")).toBe("2028-02-29");
    expect(parseDayInput("31/04/2026")).toBeNull();
    expect(parseDayInput("tomorrow")).toBeNull();
    expect(parseDayInput("")).toBeNull();
    expect(isRealDay("2026-13-01")).toBe(false);
  });
  it("shows a day in a field as dd/mm/yy", () => {
    expect(fieldText("2026-12-01")).toBe("01/12/26");
    expect(fieldText("")).toBe("");
  });
});

describe("month grid", () => {
  it("is Monday-first with the neighbouring months' days, six weeks", () => {
    const weeks = monthGrid(2026, 10); // November 2026 starts on a Sunday
    expect(weeks).toHaveLength(6);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[0]![0]).toEqual({ day: "2026-10-26", inMonth: false }); // Monday before
    expect(weeks[0]![6]).toEqual({ day: "2026-11-01", inMonth: true }); // Sunday the 1st, last column
    expect(weeks[5]![6]!.day).toBe("2026-12-06");
    expect(weeks[5]![6]!.inMonth).toBe(false);
  });
  it("handles a month starting on Monday and February of a leap year", () => {
    expect(monthGrid(2027, 1)[0]![0]).toEqual({ day: "2027-02-01", inMonth: true });
    const feb = monthGrid(2028, 1).flat().filter((cell) => cell.inMonth);
    expect(feb).toHaveLength(29);
  });
  it("moves by week and month at the edges", () => {
    expect(weekStart("2026-11-01")).toBe("2026-10-26");
    expect(weekEnd("2026-11-26")).toBe("2026-11-29");
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2027-01-15", -12)).toBe("2026-01-15");
  });
});

describe("holidays and weekly offs", () => {
  const calendar = { holidays: { "2026-11-09": "Diwali" }, workingWeekdays: [1, 2, 3, 4, 5, 6] };
  it("marks holidays by name and the weekly off", () => {
    expect(dayOff("2026-11-09", calendar)).toEqual({ off: true, reason: "Holiday: Diwali" });
    expect(dayOff("2026-11-08", calendar)).toEqual({ off: true, reason: "Weekly off" });
    expect(dayOff("2026-11-10", calendar)).toEqual({ off: false, reason: null });
    expect(dayOff("2026-11-08", null).off).toBe(false);
    expect(dayOff("2026-11-08", { holidays: {}, workingWeekdays: [] }).off).toBe(false);
  });
});

describe("range rules", () => {
  it("fills the active field then moves to the other", () => {
    let state = pickDay({ start: "", due: "" }, "start", "2026-12-01", true);
    expect(state).toMatchObject({ draft: { start: "2026-12-01", due: "" }, active: "due", swapped: false });
    state = pickDay(state.draft, state.active, "2026-12-05", true);
    expect(state).toMatchObject({ draft: { start: "2026-12-01", due: "2026-12-05" }, active: "start", swapped: false });
  });
  it("swaps a due date before the start, and a start after the due date (BR-DATE-001)", () => {
    expect(pickDay({ start: "2026-12-10", due: "" }, "due", "2026-12-04", true)).toMatchObject({ draft: { start: "2026-12-04", due: "2026-12-10" }, swapped: true });
    expect(pickDay({ start: "", due: "2026-12-04" }, "start", "2026-12-10", true)).toMatchObject({ draft: { start: "2026-12-04", due: "2026-12-10" }, swapped: true });
    expect(typeDay({ start: "", due: "2026-12-04" }, "start", "2026-12-10")).toEqual({ draft: { start: "2026-12-04", due: "2026-12-10" }, swapped: true });
  });
  it("keeps the due date active without a start field", () => {
    expect(pickDay({ start: "", due: "" }, "due", "2026-12-04", false).active).toBe("due");
  });
  it("shades the range and previews it on hover", () => {
    expect(rangeRole("2026-12-02", "2026-12-01", "2026-12-05")).toBe("inside");
    expect(rangeRole("2026-12-01", "2026-12-01", "2026-12-05")).toBe("start");
    expect(rangeRole("2026-12-05", "2026-12-01", "2026-12-05")).toBe("due");
    expect(rangeRole("2026-12-01", "2026-12-01", "2026-12-01")).toBe("both");
    expect(rangeRole("2026-12-06", "2026-12-01", "2026-12-05")).toBeNull();
    expect(previewRange({ start: "2026-12-01", due: "" }, "due", "2026-12-03")).toEqual({ start: "2026-12-01", due: "2026-12-03" });
    expect(previewRange({ start: "2026-12-05", due: "" }, "due", "2026-12-03")).toEqual({ start: "2026-12-03", due: "2026-12-05" });
  });
  it("respects min and max", () => {
    expect(outOfBounds("2026-12-01", "2026-12-02", "")).toBe(true);
    expect(outOfBounds("2026-12-03", "2026-12-02", "2026-12-31")).toBe(false);
    expect(outOfBounds("2027-01-01", "", "2026-12-31")).toBe(true);
  });
  it("announces the range", () => {
    expect(rangeText({ start: "2026-12-01", due: "2026-12-05" }, "2026-11-22")).toBe("Start 1 Dec, due 5 Dec");
    expect(rangeText({ start: "", due: "" }, "2026-11-22")).toBe("No dates chosen");
  });
});

describe("display formats (spec DATE_RANGES §3, day first)", () => {
  const today = "2026-11-22"; // a Sunday
  it("writes near days relatively", () => {
    expect(formatDayRange("", "2026-11-22", today)).toBe("Today");
    expect(formatDayRange("", "2026-11-23", today)).toBe("Tomorrow");
    expect(formatDayRange("", "2026-11-21", today)).toBe("Yesterday");
    expect(formatDayRange("", "2026-11-26", today)).toBe("Thursday");
    expect(formatDayRange("", "2026-12-01", today)).toBe("1 Dec");
    expect(formatDayRange("", "2027-01-05", today)).toBe("5 Jan 2027");
  });
  it("writes ranges without repeating the month or year (AC-DATE-01/02)", () => {
    expect(formatDayRange("2026-11-30", "2026-12-04", today)).toBe("30 Nov – 4 Dec");
    expect(formatDayRange("2026-12-07", "2026-12-11", today)).toBe("7 – 11 Dec");
    expect(formatDayRange("2026-12-28", "2027-01-05", today)).toBe("28 Dec 2026 – 5 Jan 2027");
    expect(formatDayRange("2026-12-01", "2026-12-01", today)).toBe("1 Dec"); // start = due is one day
    expect(formatDayRange("2027-03-01", "2027-03-04", today)).toBe("1 – 4 Mar 2027");
  });
});

describe("date window filters (spec DATE_RANGES §6, BR-DATE-008)", () => {
  it("is between / is not between, both ends included", () => {
    const value = dateWindowValue(false, "2026-12-01", "2026-12-31");
    expect(parseDateWindow(value)).toEqual({ not: false, from: "2026-12-01", to: "2026-12-31" });
    expect(passesWindow("2026-12-01", value)).toBe(true);
    expect(passesWindow("2026-12-31", value)).toBe(true);
    expect(passesWindow("2027-01-01", value)).toBe(false);
    expect(passesWindow(null, value)).toBe(false);
    const not = dateWindowValue(true, "2026-12-01", "2026-12-31");
    expect(passesWindow("2026-12-15", not)).toBe(false);
    expect(passesWindow("2027-01-01", not)).toBe(true);
    expect(passesWindow("2026-12-15", "between::")).toBe(true); // not finished yet: filters nothing
    expect(passesWindow("2026-12-15", "today")).toBeNull();
  });
});
