import { describe, expect, it } from "vitest";
import { chipText, DEFAULT_MY_RULES, mySectionOf, myRulesSchema, promotionTarget, rangeLimit, rangeWhere, rulesText, shouldRunFor, tabSettings, visibilityLabel } from "@/server/work/my-sections";
import { SUMMARY_IDS, summarySection, summarySections } from "@/server/work/my-summary";
import { applyGrid, DEFAULT_GRID, groupsStartFolded, type GridTask } from "@/server/work/grid";
import { summaryCsv, summaryFileName } from "@/server/work/my-export";
import { indiaDay } from "@/server/work/rules";
import { EVERY_DAY, type WorkCalendar } from "@/server/work/schedule";

// v1.76.0 (D-401): Task Summary release 1: range per tab, My sections, rules,
// chips, visibility label and the CSV.
const SECTIONS = [
  { id: 10, system: "OVERDUE" as const },
  { id: 11, system: "RECENT" as const },
  { id: 12, system: "TODAY" as const },
  { id: 13, system: "UPCOMING" as const },
  { id: 14, system: "LATER" as const },
  { id: 20, system: null },
];

describe("range per tab", () => {
  it("reads a tab's settings leniently (default Summary window, By date)", () => {
    expect(tabSettings(undefined)).toEqual({ range: "summary", sections: "date" });
    expect(tabSettings({ range: "all", sections: "mine", group: "createdBy" })).toEqual({ range: "all", sections: "mine" });
    expect(tabSettings({ range: "everything", sections: 3 })).toEqual({ range: "summary", sections: "date" });
  });
  it("Summary window keeps D-312's set; All my open tasks lists every open task and today's completed", () => {
    const summary = rangeWhere("summary", true);
    expect(summary.uses).toEqual(["weekEnd", "todayStart", "recentSince"]);
    expect(summary.sql).toContain("<= ?");
    expect(rangeWhere("summary", false).uses).toEqual(["weekEnd", "todayStart"]);
    const all = rangeWhere("all", true);
    expect(all.uses).toEqual(["todayStart"]);
    expect(all.sql).not.toContain("due_at IS NOT NULL");
    expect(rangeLimit("all")).toBeGreaterThan(rangeLimit("summary"));
  });
  it("All my open tasks adds Due later; a later task lands there", () => {
    expect(summarySections(true, true).map((section) => section.name)).toEqual(["Overdue", "Recently assigned", "Due today", "Due in the next 7 days", "Due later", "Completed today"]);
    expect(summarySections(true).map((section) => section.name)).not.toContain("Due later");
    const now = new Date("2026-11-23T06:00:00Z");
    expect(summarySection({ status: "OPEN", dueDay: "2026-12-20", assignedAt: null, selfAssigned: true }, "2026-11-23", now, true, true)).toBe(SUMMARY_IDS.later);
    expect(summarySection({ status: "OPEN", dueDay: "2026-11-25", assignedAt: null, selfAssigned: true }, "2026-11-23", now, true, true)).toBe(SUMMARY_IDS.week);
  });
});

describe("My sections", () => {
  const today = "2026-11-23";
  it("a task never placed is in Recently assigned (and stays there, whatever its age)", () => {
    expect(mySectionOf({ open: true, dueDay: "2027-01-10" }, null, SECTIONS, today)).toBe(11);
  });
  it("a placed task is where the person put it; an open overdue task shows in Overdue", () => {
    expect(mySectionOf({ open: true, dueDay: "2026-11-30" }, { sectionId: 20 }, SECTIONS, today)).toBe(20);
    expect(mySectionOf({ open: true, dueDay: "2026-11-20" }, { sectionId: 20 }, SECTIONS, today)).toBe(10);
    expect(mySectionOf({ open: false, dueDay: "2026-11-20" }, { sectionId: 20 }, SECTIONS, today)).toBe(20);
  });
  it("a placement in a deleted section or in Overdue falls back to Recently assigned", () => {
    expect(mySectionOf({ open: true, dueDay: "2026-11-30" }, { sectionId: 999 }, SECTIONS, today)).toBe(11);
    expect(mySectionOf({ open: true, dueDay: "2026-11-30" }, { sectionId: 10 }, SECTIONS, today)).toBe(11);
  });
  it("groups by My sections in the person's order, open (not folded)", () => {
    const row = (id: number, mySectionId: number, myPosition: number) => ({ ...task(id), mySectionId, myPosition });
    const groups = applyGrid([row(1, 20, 5), row(2, 20, 1), row(3, 11, 0)], { ...DEFAULT_GRID, group: "mySection" }, { today, meId: 1, mySections: [{ id: 11, name: "Recently assigned" }, { id: 20, name: "Waiting" }] });
    expect(groups.map((group) => [group.name, group.rows.map((item) => item.id)])).toEqual([
      ["Recently assigned", [3]],
      ["Waiting", [2, 1]],
    ]);
    expect(groupsStartFolded("mySection")).toBe(false);
  });
});

describe("rules (auto-promotion)", () => {
  const calendar: WorkCalendar = { offDays: new Set(["2026-11-30"]), workingWeekdays: new Set([1, 2, 3, 4, 5, 6]) }; // Sundays off, 30 Nov a holiday
  const t = (dueDay: string | null, system: "RECENT" | "TODAY" | "UPCOMING" | "LATER" | null = "RECENT", ruleKey: string | null = null) => ({ open: true, dueDay, system, ruleKey });
  it("due today → Today; due within N working days → Upcoming; later or overdue → nothing", () => {
    expect(promotionTarget(t("2026-11-23"), DEFAULT_MY_RULES, "2026-11-23", EVERY_DAY)).toEqual({ to: "TODAY", key: "TODAY:2026-11-23" });
    expect(promotionTarget(t("2026-11-30"), DEFAULT_MY_RULES, "2026-11-23", EVERY_DAY)).toEqual({ to: "UPCOMING", key: "UPCOMING:2026-11-30" });
    expect(promotionTarget(t("2026-12-01"), DEFAULT_MY_RULES, "2026-11-23", EVERY_DAY)).toBeNull();
    expect(promotionTarget(t("2026-11-20"), DEFAULT_MY_RULES, "2026-11-23", EVERY_DAY)).toBeNull();
    expect(promotionTarget({ ...t("2026-11-23"), open: false }, DEFAULT_MY_RULES, "2026-11-23", EVERY_DAY)).toBeNull();
  });
  it("weekly offs and holidays don't count as working days", () => {
    const rules = { ...DEFAULT_MY_RULES, upcomingDays: 6 };
    // Mon 23 Nov: 24..30 Nov has Sunday 29 and the holiday 30 → 5 working days to Mon 30? 30 is off; Tue 1 Dec = 6th working day.
    expect(promotionTarget(t("2026-12-01"), rules, "2026-11-23", calendar)).toEqual({ to: "UPCOMING", key: "UPCOMING:2026-12-01" });
    expect(promotionTarget(t("2026-12-02"), rules, "2026-11-23", calendar)).toBeNull();
    expect(promotionTarget(t("2026-12-01"), rules, "2026-11-23", EVERY_DAY)).toBeNull();
  });
  it("once per due day, never backwards from Today, and nothing when switched off", () => {
    expect(promotionTarget(t("2026-11-23", "LATER", "TODAY:2026-11-23"), DEFAULT_MY_RULES, "2026-11-23", EVERY_DAY)).toBeNull();
    expect(promotionTarget(t("2026-11-23", "TODAY"), DEFAULT_MY_RULES, "2026-11-23", EVERY_DAY)).toBeNull();
    expect(promotionTarget(t("2026-11-25", "TODAY"), DEFAULT_MY_RULES, "2026-11-23", EVERY_DAY)).toBeNull();
    // The due date moved: a new due day, a new move.
    expect(promotionTarget(t("2026-11-24", "LATER", "UPCOMING:2026-11-26"), DEFAULT_MY_RULES, "2026-11-23", EVERY_DAY)?.to).toBe("UPCOMING");
    expect(promotionTarget(t("2026-11-23"), { ...DEFAULT_MY_RULES, todayOn: false }, "2026-11-23", EVERY_DAY)).toBeNull();
    expect(promotionTarget(t("2026-11-25"), { ...DEFAULT_MY_RULES, upcomingOn: false }, "2026-11-23", EVERY_DAY)).toBeNull();
  });
  it("runs once per India day from 00:00 India time (18:30 UTC)", () => {
    expect(indiaDay(new Date("2026-11-22T18:29:00Z"))).toBe("2026-11-22");
    expect(indiaDay(new Date("2026-11-22T18:30:00Z"))).toBe("2026-11-23");
    expect(shouldRunFor(null, "2026-11-23")).toBe(true);
    expect(shouldRunFor("2026-11-22", "2026-11-23")).toBe(true);
    expect(shouldRunFor("2026-11-23", "2026-11-23")).toBe(false);
  });
  it("validates the settings and words them", () => {
    expect(myRulesSchema.safeParse({ todayOn: true, upcomingOn: true, upcomingDays: 0 }).success).toBe(false);
    expect(myRulesSchema.safeParse({ todayOn: true, upcomingOn: true, upcomingDays: 31 }).success).toBe(false);
    expect(rulesText({ todayOn: true, upcomingOn: true, upcomingDays: 1 })).toEqual(["Move to Today when the task is due today", "Move to Upcoming when the task is due within 1 working day"]);
  });
});

describe("toolbar chips and the Task visibility column", () => {
  it("count chips", () => {
    expect(chipText("Filters", 2)).toBe("Filters: 2");
    expect(chipText("Filters", 0)).toBe("Filter");
    expect(chipText("Groups", 1)).toBe("Groups: 1");
    expect(chipText("Groups", 0)).toBe("Group");
    expect(chipText("Sorts", 0)).toBe("Sort");
  });
  it("follows the widest project privacy", () => {
    expect(visibilityLabel([])).toEqual({ kind: "COLLABORATORS", text: "Collaborators" });
    expect(visibilityLabel([{ name: "A", privacy: "PRIVATE" }]).text).toBe("A members");
    expect(visibilityLabel([{ name: "A", privacy: "PRIVATE" }, { name: "B", privacy: "DEPARTMENT", departmentName: "Finance" }]).text).toBe("Finance department");
    expect(visibilityLabel([{ name: "A", privacy: "DEPARTMENT", departmentName: "Finance" }, { name: "B", privacy: "ORGANISATION" }]).text).toBe("Everyone at ARS");
  });
});

describe("CSV", () => {
  it("writes the tab's visible columns, the group, status and completed day; escapes and guards cells", () => {
    const rows = [
      { ...task(1), title: 'Say "hi", then go', projects: [{ id: 1, name: "Ops", color: "red", privacy: "ORGANISATION" as const }] },
      { ...task(2), title: "=SUM(A1)", status: "COMPLETED", completedAt: "2026-11-23T05:00:00Z" },
    ];
    const groups = applyGrid(rows, { ...DEFAULT_GRID, group: "createdBy", completed: "all" }, { today: "2026-11-23", meId: 1 });
    const { csv, rows: count } = summaryCsv(groups, { hidden: ["collaborators", "priority"], group: "createdBy", groupField: null });
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(count).toBe(2);
    expect(lines[0]).toBe("Task no.,Task,Due date,Created by,Projects,Task visibility,Group,Status,Completed on");
    expect(lines[1]).toBe('T-1,"Say ""hi"", then go",2026-11-25,Asha,Ops,Everyone at ARS,Asha,Open,');
    expect(lines[2]).toBe("T-2,'=SUM(A1),2026-11-25,Asha,,Collaborators,Asha,Completed,2026-11-23");
    expect(summaryFileName("Today's DB", "2026-11-23")).toBe("task-summary-Todays-DB-2026-11-23.csv");
  });
});

function task(id: number): GridTask {
  return {
    id,
    taskNo: `T-${id}`,
    title: `Task ${id}`,
    status: "OPEN",
    priority: "NORMAL",
    assigneeId: 1,
    assigneeName: "Me",
    createdBy: 2,
    createdByName: "Asha",
    dueAt: "2026-11-25T12:00:00Z",
    startsOn: null,
    createdAt: "2026-11-20T00:00:00Z",
    completedAt: null,
    likes: 0,
    comments: 0,
    subtasks: 0,
    isPeriodic: false,
    isMilestone: false,
    projects: [],
    tags: [],
    followers: [],
    sectionId: null,
    position: 0,
    canEdit: true,
    canComplete: true,
  };
}
