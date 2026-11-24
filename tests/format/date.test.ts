import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatDayRange,
  formatDayTime,
  formatMonth,
  formatPeriod,
  formatRelative,
  formatRelativeDay,
  formatTime,
  formatTimeRange,
  indiaClock,
  indiaDay,
  indiaHour,
  indiaYear,
  toMillis,
} from "@/lib/format/date";

// v1.89.0 (D-425, UIQA-CON-08 / ERR-01): the one date formatter, India time.
const at = (iso: string) => new Date(iso);

describe("India time boundaries around midnight", () => {
  it("18:29:59 UTC is 11:59 pm the same India day, 18:30 UTC is the next India day", () => {
    expect(formatDateTime(at("2026-11-24T18:29:59Z"))).toBe("24 Nov 2026, 11:59 pm");
    expect(formatDateTime(at("2026-11-24T18:30:00Z"))).toBe("25 Nov 2026, 12:00 am");
    expect(indiaDay(at("2026-11-24T18:29:59Z"))).toBe("2026-11-24");
    expect(indiaDay(at("2026-11-24T18:30:00Z"))).toBe("2026-11-25");
  });
  it("noon and the small hours", () => {
    expect(formatTime(at("2026-11-24T06:30:00Z"))).toBe("12:00 pm");
    expect(formatTime(at("2026-11-23T19:35:00Z"))).toBe("1:05 am");
    expect(formatTime(at("2026-11-24T09:35:00Z"))).toBe("3:05 pm");
    expect(indiaHour(at("2026-11-24T18:30:00Z"))).toBe(0);
    expect(indiaClock(at("2026-11-24T09:35:00Z"))).toBe("15:05");
  });
  it("a calendar day is never moved by the time zone", () => {
    expect(formatDate("2026-11-24")).toBe("24 Nov 2026");
    expect(formatDateTime("2026-11-24")).toBe("24 Nov 2026");
    expect(indiaDay("2026-11-24")).toBe("2026-11-24");
    expect(formatTime("2026-11-24")).toBe("");
    expect(toMillis("2026-11-24")).toBe(Date.parse("2026-11-23T18:30:00Z"));
  });
  it("database text without a zone is UTC", () => {
    expect(formatDateTime("2026-11-24 09:35:00")).toBe("24 Nov 2026, 3:05 pm");
  });
});

describe("year boundary", () => {
  it("31 Dec 18:30 UTC is New Year's Day in India", () => {
    expect(formatDate(at("2026-12-31T18:30:00Z"))).toBe("1 Jan 2027");
    expect(indiaYear(at("2026-12-31T18:29:00Z"))).toBe(2026);
    expect(indiaYear(at("2026-12-31T18:30:00Z"))).toBe(2027);
  });
  it("year 'auto' leaves out this year only", () => {
    const now = at("2026-11-24T10:00:00Z");
    expect(formatDate("2026-12-31", { year: "auto", now })).toBe("31 Dec");
    expect(formatDate("2027-01-01", { year: "auto", now })).toBe("1 Jan 2027");
    // Late on 31 Dec UTC is already 2027 in India: 2027 dates lose the year.
    expect(formatDate("2027-01-05", { year: "auto", now: at("2026-12-31T19:00:00Z") })).toBe("5 Jan");
  });
  it("ranges across the year", () => {
    expect(formatDayRange("2026-12-28", "2027-01-05", "2026-11-24")).toBe("28 Dec 2026 – 5 Jan 2027");
    expect(formatPeriod("2026-12-28", "2027-01-03")).toBe("28 Dec 2026 to 3 Jan 2027");
    expect(formatPeriod("2026-12-01", "2026-12-12")).toBe("1 Dec to 12 Dec 2026");
  });
});

describe("forms", () => {
  it("weekday, long month, empty", () => {
    expect(formatDate("2026-11-24", { weekday: "short" })).toBe("Tue, 24 Nov 2026");
    expect(formatDate("2026-11-24", { weekday: "long", month: "long", year: "never" })).toBe("Tuesday, 24 November");
    expect(formatDate(null)).toBe("");
    expect(formatDate("not a date", { empty: "—" })).toBe("—");
    expect(formatDate("2026-02-30")).toBe("");
  });
  it("months", () => {
    expect(formatMonth("2026-11")).toBe("Nov 2026");
    expect(formatMonth("2026-11", { month: "long" })).toBe("November 2026");
    expect(formatMonth("2026-11", { year: "2-digit" })).toBe("Nov 26");
  });
  it("time ranges", () => {
    expect(formatTimeRange(at("2026-11-24T05:30:00Z"), at("2026-11-24T07:00:00Z"), { weekday: "short" })).toBe("Tue, 24 Nov 2026, 11:00 am to 12:30 pm");
    expect(formatTimeRange(at("2026-11-24T18:00:00Z"), at("2026-11-24T19:00:00Z"), { weekday: "short" })).toBe("Tue, 24 Nov 2026, 11:30 pm to 25 Nov, 12:30 am");
    expect(formatTimeRange(at("2026-11-24T05:30:00Z"), null)).toBe("24 Nov 2026, 11:00 am");
  });
  it("same output whatever the process time zone (no Intl)", () => {
    expect(formatDateTime(1_795_000_000_000)).toBe(formatDateTime(new Date(1_795_000_000_000)));
  });
});

describe("relative thresholds", () => {
  const now = at("2026-11-24T09:30:00Z"); // 3:00 pm India
  it("seconds, minutes, hours", () => {
    expect(formatRelative(at("2026-11-24T09:29:01Z"), now)).toBe("just now");
    expect(formatRelative(at("2026-11-24T09:29:00Z"), now)).toBe("1 min ago");
    expect(formatRelative(at("2026-11-24T08:30:01Z"), now)).toBe("59 min ago");
    expect(formatRelative(at("2026-11-24T08:30:00Z"), now)).toBe("1 h ago");
    expect(formatRelative(at("2026-11-23T09:30:01Z"), now)).toBe("23 h ago");
    expect(formatRelative(at("2026-11-24T11:30:00Z"), now)).toBe("in 2 h");
    expect(formatRelative(at("2026-11-24T09:35:00Z"), now)).toBe("in 5 min");
  });
  it("days by the India calendar", () => {
    expect(formatRelative(at("2026-11-23T09:30:00Z"), now)).toBe("Yesterday");
    expect(formatRelative(at("2026-11-21T09:30:00Z"), now)).toBe("3 days ago");
    expect(formatRelative(at("2026-11-18T09:30:00Z"), now)).toBe("6 days ago");
    expect(formatRelative(at("2026-11-17T09:30:00Z"), now)).toBe("17 Nov");
    expect(formatRelative(at("2025-11-17T09:30:00Z"), now)).toBe("17 Nov 2025");
    expect(formatRelative(at("2026-11-26T09:30:00Z"), now)).toBe("in 2 days");
    expect(formatRelative(at("2026-11-25T09:30:00Z"), now)).toBe("Tomorrow");
  });
  it("relative days", () => {
    const today = "2026-11-24"; // a Tuesday
    expect(formatRelativeDay("2026-11-24", today)).toBe("Today");
    expect(formatRelativeDay("2026-11-25", today)).toBe("Tomorrow");
    expect(formatRelativeDay("2026-11-23", today)).toBe("Yesterday");
    expect(formatRelativeDay("2026-11-27", today)).toBe("Friday");
    expect(formatRelativeDay("2026-11-27", today, { weekdays: false })).toBe("27 Nov");
    expect(formatRelativeDay("2026-12-01", today)).toBe("1 Dec");
    expect(formatRelativeDay("2027-01-01", today)).toBe("1 Jan 2027");
  });
  it("day and time", () => {
    expect(formatDayTime(at("2026-11-24T08:57:00Z"), now)).toBe("Today at 2:27 pm");
    expect(formatDayTime(at("2026-11-23T10:11:00Z"), now)).toBe("Yesterday at 3:41 pm");
    expect(formatDayTime(at("2026-10-28T03:35:00Z"), now)).toBe("28 Oct at 9:05 am");
  });
  it("day ranges keep the picker's forms", () => {
    expect(formatDayRange("2026-11-30", "2026-12-04", "2026-11-24")).toBe("30 Nov – 4 Dec");
    expect(formatDayRange("2026-12-07", "2026-12-11", "2026-11-24")).toBe("7 – 11 Dec");
    expect(formatDayRange("", "2026-11-25", "2026-11-24")).toBe("Tomorrow");
    expect(formatDayRange("", "2026-11-25", "2026-11-24", false)).toBe("25 Nov");
  });
});
