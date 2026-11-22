import { describe, expect, it } from "vitest";
import { connectorPath, headerBands, isoWeek, scaleRange, shortDay, visibleRows, zoomIn, zoomOut } from "@/features/work/gantt-scale";

// v1.65.0 (D-373): the Timeline/Gantt time scale, windowing and connectors.
describe("time scale", () => {
  it("zooms between days, weeks, months and quarters", () => {
    expect(zoomIn("weeks")).toBe("days");
    expect(zoomIn("days")).toBe("days");
    expect(zoomOut("months")).toBe("quarters");
    expect(zoomOut("quarters")).toBe("quarters");
  });
  it("covers the tasks and today from a Monday or a month's first day", () => {
    const weeks = scaleRange(["2026-12-10"], "2026-11-22", "weeks");
    expect(new Date(`${weeks.from}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(weeks.from <= "2026-11-22").toBe(true);
    expect(weeks.span).toBeGreaterThan(18);
    const months = scaleRange([], "2026-11-22", "months");
    expect(months.from.endsWith("-01")).toBe(true);
    expect(scaleRange(["2020-01-01", "2035-01-01"], "2026-11-22", "quarters").span).toBeLessThanOrEqual(1500);
  });
  it("draws ISO weeks under months, and quarters over months", () => {
    expect(isoWeek("2026-11-22")).toBe(47);
    expect(isoWeek("2027-01-01")).toBe(53);
    const weeks = headerBands("2026-11-16", 21, "weeks");
    expect(weeks.bottom.map((band) => band.label)).toEqual(["W47 16 Nov", "W48 23 Nov", "W49 30 Nov"]);
    expect(weeks.top.map((band) => band.label)).toEqual(["Nov 2026", "Dec 2026"]);
    const months = headerBands("2026-10-01", 92, "months");
    expect(months.top.map((band) => band.label)).toEqual(["Q4 2026"]);
    expect(months.bottom.map((band) => band.label)).toEqual(["Oct", "Nov", "Dec"]);
    expect(months.bottom.reduce((sum, band) => sum + band.days, 0)).toBe(92);
  });
  it("draws only the rows on screen", () => {
    expect(visibleRows(0, 340, 34, 300, 0)).toEqual({ first: 0, last: 10 });
    expect(visibleRows(3400, 340, 34, 300, 5)).toEqual({ first: 95, last: 115 });
    expect(visibleRows(99999, 340, 34, 300).last).toBe(299);
  });
  it("routes connectors as elbows", () => {
    expect(connectorPath(100, 17, 200, 51, 34)).toBe("M 100 17 H 108 V 51 H 200");
    expect(connectorPath(200, 17, 100, 51, 34)).toBe("M 200 17 H 208 V 34 H 92 V 51 H 100");
  });
  it("shows the year only for another year", () => {
    expect(shortDay("2026-12-03", "2026-11-22")).toBe("3 Dec");
    expect(shortDay("2027-01-04", "2026-11-22")).toBe("4 Jan 2027");
  });
});
