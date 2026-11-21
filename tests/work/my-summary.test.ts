import { describe, expect, it } from "vitest";
import { SUMMARY_IDS, summarySection, summarySections } from "@/server/work/my-summary";
import { addableViews, allowedView, baseOrder, buildStrip, maxTabs, MAX_MY_TABS, tabMenu, type TabRow } from "@/server/work/view-tabs";

// v1.63.0 (D-369, PM-A13): Task Summary's sections and My Tasks tabs.
const now = new Date("2026-11-22T06:00:00Z"); // 11:30 IST
const today = "2026-11-22";
const task = (over: Partial<Parameters<typeof summarySection>[0]>) => ({ status: "OPEN", dueDay: today, assignedAt: null, selfAssigned: true, ...over });

describe("Task Summary sections", () => {
  it("adds Recently assigned after Overdue only with the switch on", () => {
    expect(summarySections(false).map((section) => section.name)).toEqual(["Overdue", "Due today", "Due in the next 7 days", "Completed today"]);
    expect(summarySections(true).map((section) => section.name)).toEqual(["Overdue", "Recently assigned", "Due today", "Due in the next 7 days", "Completed today"]);
  });
  it("puts a task given by someone else in the last 3 days in Recently assigned, unless it is overdue or done", () => {
    const fresh = new Date(now.getTime() - 86_400_000);
    expect(summarySection(task({ assignedAt: fresh, selfAssigned: false }), today, now, true)).toBe(SUMMARY_IDS.recent);
    expect(summarySection(task({ assignedAt: fresh, selfAssigned: false, dueDay: "2026-12-30" }), today, now, true)).toBe(SUMMARY_IDS.recent);
    expect(summarySection(task({ assignedAt: fresh, selfAssigned: false, dueDay: "2026-11-20" }), today, now, true)).toBe(SUMMARY_IDS.overdue);
    expect(summarySection(task({ assignedAt: fresh, selfAssigned: false, status: "COMPLETED" }), today, now, true)).toBe(SUMMARY_IDS.done);
    // Your own task, or one given 4 days ago, goes by its date.
    expect(summarySection(task({ assignedAt: fresh, selfAssigned: true }), today, now, true)).toBe(SUMMARY_IDS.today);
    expect(summarySection(task({ assignedAt: new Date(now.getTime() - 4 * 86_400_000), selfAssigned: false, dueDay: "2026-11-25" }), today, now, true)).toBe(SUMMARY_IDS.week);
    // Switch off: as before.
    expect(summarySection(task({ assignedAt: fresh, selfAssigned: false }), today, now, false)).toBe(SUMMARY_IDS.today);
  });
});

describe("My Tasks tabs", () => {
  const row = (over: Partial<TabRow>): TabRow => ({ id: 1, type: "LIST", name: "Tab", config: {}, isDefault: false, position: 1024, ...over });
  it("offers List, Board and Calendar only", () => {
    expect(addableViews("MY_TASKS").map((entry) => entry.type)).toEqual(["LIST", "BOARD", "CALENDAR"]);
    expect(allowedView("MY_TASKS", "TIMELINE")).toBe(false);
    expect(allowedView("MY_TASKS", "BOARD")).toBe(true);
    expect(allowedView("PROJECT", "OVERVIEW")).toBe(true);
    expect(maxTabs("MY_TASKS")).toBe(MAX_MY_TABS);
  });
  it("before it is stored: List, the saved List tabs, Board, Calendar; List is the default", () => {
    const strip = buildStrip([row({ id: 4, name: "Urgent" })], false, "LIST", baseOrder("MY_TASKS"));
    expect(strip.map((tab) => tab.key)).toEqual(["vLIST", "t4", "vBOARD", "vCALENDAR"]);
    expect(strip.find((tab) => tab.isDefault)?.key).toBe("vLIST");
  });
  it("can't duplicate past 30 tabs", () => {
    const full = Array.from({ length: MAX_MY_TABS }, (_, index) => ({ key: `t${index + 1}`, id: index + 1, type: "LIST" as const, name: `T${index}`, isDefault: index === 0 }));
    expect(tabMenu(full[1]!, full, true, MAX_MY_TABS)).not.toContain("duplicate");
    expect(tabMenu(full[1]!, full.slice(0, 5), true, MAX_MY_TABS)).toContain("duplicate");
  });
});
