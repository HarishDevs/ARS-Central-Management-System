import { describe, expect, it } from "vitest";
import { addableWidgets, availableKinds, defaultLayout, hoursText, isOverviewScope, OVERVIEW_SCOPES, readLayout, sharePercent, validLayout, WIDGETS } from "@/server/home/widgets";
import { changePercent, parsePeriod } from "@/server/work/period";
import { OVERVIEW_PERIODS, periodKeep } from "@/features/home/OverviewParts";

// v1.79.0 (D-406): the three Home overviews identically featured: one layout
// per overview, defaults that reproduce today's screens, the standard widgets
// on all three, and access limits on every widget.
const everything = { tasks: true, projects: true, forms: true, approvals: true, meetings: true, meetingFigures: true };
const noFigures = { ...everything, meetingFigures: false };
const kinds = (layout: { kind: string }[]) => layout.map((item) => item.kind);

describe("overview scopes", () => {
  it("knows the three overviews and refuses anything else", () => {
    expect(OVERVIEW_SCOPES).toEqual(["approvals", "tasks", "meetings"]);
    expect(isOverviewScope("meetings")).toBe(true);
    expect(isOverviewScope("projects")).toBe(false);
    expect(isOverviewScope(undefined)).toBe(false);
  });
  it("every widget belongs to at least one overview; only the notepad to all three", () => {
    expect(WIDGETS.every((entry) => entry.scopes.length >= 1)).toBe(true);
    expect(WIDGETS.filter((entry) => entry.scopes.length === 3).map((entry) => entry.kind)).toEqual(["notepad"]);
  });
});

describe("defaults reproduce today's screens, in today's order", () => {
  it("Approvals: Waiting for me, Due soon or overdue, Returned, My recent requests, then Drafts and Quick insights", () => {
    expect(defaultLayout(everything, "approvals")).toEqual([
      { kind: "ap_waiting", size: "full" },
      { kind: "ap_due", size: "full" },
      { kind: "ap_returned", size: "full" },
      { kind: "ap_recent", size: "full" },
      { kind: "ap_drafts", size: "half" },
      { kind: "ap_insights", size: "half" },
    ]);
  });
  it("Meetings: the sections, then the figures and register (only with the dashboard access)", () => {
    expect(kinds(defaultLayout(everything, "meetings"))).toEqual(["mt_attention", "mt_upcoming", "mt_actions", "mt_approve", "mt_confirm", "mt_insights", "mt_figures", "mt_register"]);
    expect(kinds(defaultLayout(noFigures, "meetings"))).toEqual(["mt_attention", "mt_upcoming", "mt_actions", "mt_approve", "mt_confirm"]);
  });
  it("My Work: unchanged (the new standard widgets are offered, not added)", () => {
    expect(kinds(defaultLayout(everything, "tasks"))).toEqual(["my_tasks", "projects", "status_updates", "notepad", "workload", "assigned", "people", "forms"]);
    expect(defaultLayout(everything)).toEqual(defaultLayout(everything, "tasks"));
  });
});

describe("the standard widgets are on every overview", () => {
  it("notepad, a day-by-day chart, Needs attention and Quick insights", () => {
    const standard = { approvals: ["notepad", "ap_chart", "ap_attention", "ap_insights"], tasks: ["notepad", "workload", "task_attention", "task_insights"], meetings: ["notepad", "mt_chart", "mt_attention", "mt_insights"] } as const;
    for (const scope of OVERVIEW_SCOPES) for (const kind of standard[scope]) expect(availableKinds(everything, scope)).toContain(kind);
  });
  it("Add widgets lists only that overview's widgets not shown yet", () => {
    const addable = addableWidgets(defaultLayout(everything, "approvals"), everything, "approvals").map((entry) => entry.kind);
    expect(addable).toEqual(["notepad", "ap_attention", "ap_chart"]);
    expect(addableWidgets(defaultLayout(everything, "meetings"), everything, "meetings").map((entry) => entry.kind)).toEqual(["notepad", "mt_chart"]);
  });
});

describe("access limits on every widget", () => {
  it("a widget of another overview can't be saved on this one", () => {
    expect(validLayout([{ kind: "my_tasks", size: "full" }], everything, "approvals")).toBeNull();
    expect(validLayout([{ kind: "ap_waiting", size: "full" }], everything, "meetings")).toBeNull();
    expect(validLayout([{ kind: "mt_upcoming", size: "half" }], everything, "tasks")).toBeNull();
    expect(validLayout([{ kind: "ap_waiting", size: "half" }, { kind: "notepad", size: "full" }], everything, "approvals")).toEqual([
      { kind: "ap_waiting", size: "half" },
      { kind: "notepad", size: "full" },
    ]);
  });
  it("meeting figures need the dashboard page access: refused on save, dropped on read", () => {
    for (const kind of ["mt_insights", "mt_figures", "mt_register"] as const) {
      expect(availableKinds(noFigures, "meetings")).not.toContain(kind);
      expect(validLayout([{ kind, size: "full" }], noFigures, "meetings")).toBeNull();
    }
    const stored = [{ kind: "mt_figures", size: "full" }, { kind: "mt_upcoming", size: "half" }, { kind: "mt_register", size: "full" }];
    expect(readLayout(stored, noFigures, "meetings")).toEqual([{ kind: "mt_upcoming", size: "half" }]);
    expect(kinds(readLayout(stored, everything, "meetings"))).toEqual(["mt_figures", "mt_upcoming", "mt_register"]);
  });
  it("without the module, only the notepad is left on that overview", () => {
    expect(availableKinds({ ...everything, approvals: false }, "approvals")).toEqual(["notepad"]);
    expect(availableKinds({ ...everything, meetings: false }, "meetings")).toEqual(["notepad"]);
    expect(defaultLayout({ ...everything, meetings: false }, "meetings")).toEqual([{ kind: "notepad", size: "half" }]);
    expect(availableKinds({ ...everything, tasks: false }, "tasks")).toEqual(["notepad"]);
  });
  it("a stored layout of one overview never leaks into another (read per scope)", () => {
    const approvalsLayout = [{ kind: "ap_recent", size: "full" }, { kind: "notepad", size: "half" }];
    expect(readLayout(approvalsLayout, everything, "tasks")).toEqual([{ kind: "notepad", size: "half" }]);
  });
});

describe("figures", () => {
  it("shares and durations read plainly", () => {
    expect(sharePercent(3, 4)).toBe(75);
    expect(sharePercent(1, 0)).toBeNull();
    expect(hoursText(null)).toBe("N/A");
    expect(hoursText(0.004)).toBe("< 1 min");
    expect(hoursText(0.5)).toBe("30 min");
    expect(hoursText(5)).toBe("5.0 h");
    expect(hoursText(36)).toBe("1.5 d");
  });
  it("cards compare with the previous period of the same length (null when nothing before)", () => {
    expect(changePercent(6, 4)).toBe(50);
    expect(changePercent(2, 4)).toBe(-50);
    expect(changePercent(3, 0)).toBeNull();
    const month = parsePeriod({ period: "month" }, "2026-11-22", "month");
    expect([month.fromDay, month.prevFrom.toISOString()]).toEqual(["2026-11-01", new Date("2026-10-01T00:00:00+05:30").toISOString()]);
  });
  it("the same period choices on all three; the default is left out of the address", () => {
    expect(OVERVIEW_PERIODS.map(([key]) => key)).toEqual(["today", "week", "month", "30d", "90d", "custom"]);
    const week = parsePeriod({ period: "week" }, "2026-11-22", "month");
    expect(periodKeep(week, "month")).toEqual({ period: "week" });
    expect(periodKeep(week, "week")).toEqual({});
    const custom = parsePeriod({ period: "custom", from: "2026-11-01", to: "2026-11-10" }, "2026-11-22", "month");
    expect(periodKeep(custom, "month")).toEqual({ period: "custom", from: "2026-11-01", to: "2026-11-10" });
  });
});
