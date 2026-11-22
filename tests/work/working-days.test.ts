import { describe, expect, it } from "vitest";
import { datesText, dayText, durationText, effectiveEstimate, isDay, parsePlanningSettings, projectDuration, taskDurationDays, workingDaysBetween } from "@/server/work/working-days";
import { EVERY_DAY, type WorkCalendar } from "@/server/work/schedule";

// v1.74.0 (D-398): From/To → working days → estimated hours.
const WEEK: WorkCalendar = { offDays: new Set(), workingWeekdays: new Set([1, 2, 3, 4, 5]) };
const SIX_DAYS: WorkCalendar = { offDays: new Set(["2026-12-25"]), workingWeekdays: new Set([1, 2, 3, 4, 5, 6]) };

describe("workingDaysBetween", () => {
  it("counts both ends", () => {
    expect(workingDaysBetween("2026-12-07", "2026-12-11", WEEK)).toBe(5); // Mon–Fri
    expect(workingDaysBetween("2026-12-07", "2026-12-07", WEEK)).toBe(1); // same day
  });
  it("skips weekly offs", () => {
    expect(workingDaysBetween("2026-12-04", "2026-12-07", WEEK)).toBe(2); // Fri, Mon
    expect(workingDaysBetween("2026-12-05", "2026-12-06", WEEK)).toBe(0); // a weekend
  });
  it("skips holidays that fall on working days only", () => {
    expect(workingDaysBetween("2026-12-21", "2026-12-26", SIX_DAYS)).toBe(5); // Mon–Sat less Fri 25 Dec
    const sundayHoliday: WorkCalendar = { offDays: new Set(["2026-12-27"]), workingWeekdays: new Set([1, 2, 3, 4, 5, 6]) };
    expect(workingDaysBetween("2026-12-21", "2026-12-27", sundayHoliday)).toBe(6);
  });
  it("rejects From after To and non-days", () => {
    expect(workingDaysBetween("2026-12-11", "2026-12-07", WEEK)).toBeNull();
    expect(workingDaysBetween("2026-02-31", "2026-03-02", WEEK)).toBeNull();
    expect(workingDaysBetween("", "2026-03-02", WEEK)).toBeNull();
  });
  it("counts long ranges exactly", () => {
    // 2026 has 261 weekdays; 2027 has 261.
    expect(workingDaysBetween("2026-01-01", "2026-12-31", WEEK)).toBe(261);
    expect(workingDaysBetween("2026-01-01", "2027-12-31", WEEK)).toBe(522);
    expect(workingDaysBetween("2026-01-01", "2035-12-31", EVERY_DAY)).toBe(3652);
  });
});

describe("taskDurationDays", () => {
  it("gives a due-date-only task one day, and never zero", () => {
    expect(taskDurationDays(null, "2026-12-09", WEEK)).toBe(1);
    expect(taskDurationDays("2026-12-05", "2026-12-06", WEEK)).toBe(1);
    expect(taskDurationDays("2026-12-07", "2026-12-14", WEEK)).toBe(6);
  });
});

describe("estimates", () => {
  it("prefers the manual estimate", () => {
    expect(effectiveEstimate(90, 3, 8)).toEqual({ minutes: 90, source: "MANUAL" });
    expect(effectiveEstimate(0, 3, 8)).toEqual({ minutes: 0, source: "MANUAL" });
  });
  it("falls back to the dates", () => {
    expect(effectiveEstimate(null, 3, 8)).toEqual({ minutes: 1440, source: "DATES" });
    expect(effectiveEstimate(null, 2, 7.5)).toEqual({ minutes: 900, source: "DATES" });
    expect(effectiveEstimate(null, null, 8)).toEqual({ minutes: null, source: null });
  });
  it("works out a project's duration", () => {
    expect(projectDuration("2026-12-07", "2026-12-18", WEEK, 8)).toEqual({ days: 10, hours: 80 });
    expect(projectDuration(null, "2026-12-18", WEEK, 8)).toBeNull();
    expect(projectDuration("2026-12-18", "2026-12-07", WEEK, 8)).toBeNull();
  });
});

describe("settings and words", () => {
  it("reads the hours per working day", () => {
    expect(parsePlanningSettings(null).hoursPerDay).toBe(8);
    expect(parsePlanningSettings('{"hoursPerDay":9.5}').hoursPerDay).toBe(9.5);
    expect(parsePlanningSettings('{"hoursPerDay":30}').hoursPerDay).toBe(8);
    expect(parsePlanningSettings("not json").hoursPerDay).toBe(8);
  });
  it("words dates and durations", () => {
    expect(isDay("2026-12-07")).toBe(true);
    expect(dayText("2026-12-07", "2026")).toBe("7 Dec");
    expect(dayText("2027-01-04", "2026")).toBe("4 Jan 2027");
    expect(datesText("2026-12-07", "2026-12-18", "2026")).toBe("From 7 Dec To 18 Dec");
    expect(datesText(null, "2026-12-18", "2026")).toBe("To 18 Dec");
    expect(datesText(null, null)).toBe("");
    expect(durationText({ days: 1, hours: 7.5 })).toBe("1 working day · 7.5 h");
    expect(durationText({ days: 10, hours: 80 })).toBe("10 working days · 80 h");
  });
});
