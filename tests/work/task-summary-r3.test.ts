import { describe, expect, it } from "vitest";
import {
  cleanNotes,
  cleanRequestNote,
  mayReadNotes,
  NOTES_MAX,
  parseDashboardRange,
  profileCardTasks,
  requestProblem,
  summaryDashboard,
  type DashboardTask,
} from "@/server/work/summary-extras-rules";
import { addableViews, allowedView, catalogueGroups, TAB_VIEW_LABEL } from "@/server/work/view-tabs";
import { applyGrid, DEFAULT_GRID, personHeading, type GridTask } from "@/server/work/grid";
import { clearDraft, DRAFT_KEY, DRAFT_MAX_AGE_MS, readDraft, writeDraft } from "@/features/work/task-draft-store";

// v1.78.0 (D-405): Task Summary release 3: Dashboard, Notes and Files tabs,
// Request access, the profile Tasks card, the Create task draft kept in the
// browser tab, employee codes in person groups and no Assignee sort.
describe("Task Summary tab catalogue", () => {
  it("Notes is always offered on a Task Summary; Dashboard and Files only with their switches", () => {
    expect(addableViews("MY_TASKS", false, false, false).map((entry) => entry.type)).toEqual(["LIST", "BOARD", "CALENDAR", "NOTES"]);
    expect(addableViews("MY_TASKS", true, true, true).map((entry) => entry.type)).toEqual(["LIST", "BOARD", "CALENDAR", "DASHBOARD", "FILES", "NOTES"]);
    expect(allowedView("MY_TASKS", "NOTES")).toBe(true);
    expect(allowedView("MY_TASKS", "DASHBOARD", false, true)).toBe(true);
    expect(allowedView("MY_TASKS", "DASHBOARD", false, false)).toBe(false);
    expect(allowedView("MY_TASKS", "FILES", false, false, true)).toBe(true);
    expect(allowedView("MY_TASKS", "FILES", false, false, false)).toBe(false);
    expect(allowedView("MY_TASKS", "MESSAGES", true, true, true)).toBe(false);
    expect(allowedView("MY_TASKS", "WORKLOAD", true, true, true)).toBe(false);
  });
  it("a project never gets a Notes tab", () => {
    expect(addableViews("PROJECT", true, true, true).some((entry) => entry.type === "NOTES")).toBe(false);
    expect(allowedView("PROJECT", "NOTES", true, true, true)).toBe(false);
  });
  it("describes the Task Summary's Dashboard and Files in the person's terms, and lists Notes under Other", () => {
    const entries = addableViews("MY_TASKS", true, true, true);
    expect(entries.find((entry) => entry.type === "DASHBOARD")!.description).toMatch(/your own tasks/);
    expect(entries.find((entry) => entry.type === "FILES")!.description).toMatch(/given to you/);
    expect(catalogueGroups(entries).find((group) => group.name === "Other")!.entries.map((entry) => entry.type)).toEqual(["DASHBOARD", "FILES", "NOTES"]);
    expect(TAB_VIEW_LABEL.NOTES).toBe("Notes");
  });
});

describe("Dashboard tab", () => {
  const today = "2026-11-22";
  const task = (over: Partial<DashboardTask>): DashboardTask => ({ id: 1, open: true, done: false, dueDay: today, completedDay: null, priority: "NORMAL", projects: [], ...over });
  const tasks = [
    task({ id: 1, dueDay: "2026-11-20" }), // overdue
    task({ id: 2 }), // today
    task({ id: 3, dueDay: "2026-11-25", priority: "URGENT", projects: ["Plant"] }),
    task({ id: 4, open: false, done: true, completedDay: "2026-11-21" }),
    task({ id: 5, open: false, done: true, completedDay: "2026-09-01" }), // outside the range
  ];
  it("counts open, overdue, due today and completed in the range", () => {
    const view = summaryDashboard(tasks, today, "30d");
    expect(Object.fromEntries(view.numbers.map((number) => [number.key, number.value]))).toEqual({ open: 3, overdue: 1, today: 1, done: 1 });
  });
  it("draws five charts with the right figures", () => {
    const view = summaryDashboard(tasks, today, "14d");
    expect(view.charts.map((chart) => chart.key)).toEqual(["due", "completed", "completion", "project", "priority"]);
    const due = view.charts.find((chart) => chart.key === "due")!.data;
    expect(due.categories.map((category) => category.key)).toEqual(["overdue", "today", "week"]);
    expect(due.values[0]).toEqual([1, 1, 1]);
    const completed = view.charts.find((chart) => chart.key === "completed")!.data;
    expect(completed.categories).toHaveLength(14); // every day of the range
    expect(completed.values[0]!.reduce<number>((sum, value) => sum + (value ?? 0), 0)).toBe(1);
    const project = view.charts.find((chart) => chart.key === "project")!.data;
    expect(project.categories.map((category) => category.label)).toEqual(["Plant", "No project"]);
    const donut = view.charts.find((chart) => chart.key === "completion")!.data;
    expect(donut.total).toBe(4);
  });
  it("90 days are shown by week; an unknown range reads as 30 days", () => {
    expect(summaryDashboard(tasks, today, "90d").charts[1]!.title).toBe("Tasks completed each week");
    expect(parseDashboardRange("1y")).toBe("30d");
    expect(parseDashboardRange("14d")).toBe("14d");
  });
  it("nothing to show is an empty chart, not an error", () => {
    const view = summaryDashboard([], today, "30d");
    expect(view.numbers.every((number) => number.value === 0)).toBe(true);
    expect(view.charts.find((chart) => chart.key === "due")!.data.empty).toBe(true);
  });
});

describe("Notes tab", () => {
  it("only the owner reads their notes (managers and shared viewers don't)", () => {
    expect(mayReadNotes("OWN")).toBe(true);
    expect(mayReadNotes("MANAGER")).toBe(false);
    expect(mayReadNotes("SHARED")).toBe(false);
    expect(mayReadNotes(null)).toBe(false);
  });
  it("keeps tabs and new lines, drops control characters, refuses over the limit", () => {
    expect(cleanNotes("a\r\nb\tc\u0007")).toBe("a\nb\tc");
    expect(cleanNotes("x".repeat(NOTES_MAX))).toHaveLength(NOTES_MAX);
    expect(cleanNotes("x".repeat(NOTES_MAX + 1))).toBeNull();
  });
});

describe("Request access", () => {
  const base = { requesterId: 2, ownerId: 1, ownerActive: true as boolean | null, access: null as "OWN" | "MANAGER" | "SHARED" | null };
  it("someone refused may ask", () => expect(requestProblem(base)).toBeNull());
  it("not for your own, an unknown or inactive person, or one you can already open", () => {
    expect(requestProblem({ ...base, requesterId: 1 })).toMatch(/your own/);
    expect(requestProblem({ ...base, ownerActive: null })).toBe("Not found.");
    expect(requestProblem({ ...base, ownerActive: false })).toMatch(/inactive/);
    expect(requestProblem({ ...base, access: "SHARED" })).toMatch(/already open/);
    expect(requestProblem({ ...base, access: "MANAGER" })).toMatch(/already open/);
  });
  it("a note is one tidy line of at most 300 characters", () => {
    expect(cleanRequestNote("  please\nshare \u0000 it  ")).toBe("please share it");
    expect(cleanRequestNote("y".repeat(400))).toHaveLength(300);
  });
});

describe("profile Tasks card", () => {
  it("soonest due first (no date last), at most five", () => {
    const tasks = [
      { id: 1, taskNo: "T-1", title: "a", dueAt: null },
      { id: 2, taskNo: "T-2", title: "b", dueAt: "2026-11-25T18:29:00.000Z" },
      { id: 3, taskNo: "T-3", title: "c", dueAt: "2026-11-20T18:29:00.000Z" },
      ...[4, 5, 6, 7].map((id) => ({ id, taskNo: `T-${id}`, title: "d", dueAt: "2026-12-01T18:29:00.000Z" })),
    ];
    expect(profileCardTasks(tasks).map((task) => task.id)).toEqual([3, 2, 4, 5, 6]);
  });
});

describe("person group headings show the employee code", () => {
  const task = (over: Partial<GridTask>): GridTask => ({
    id: 1, taskNo: "T-1", title: "Task", status: "OPEN", priority: "NORMAL", assigneeId: 1, assigneeName: "Ravi", createdBy: 2, createdByName: "Akash E", dueAt: null, startsOn: null, createdAt: "2026-10-01T00:00:00.000Z", completedAt: null,
    likes: 0, comments: 0, subtasks: 0, isPeriodic: false, isMilestone: false, projects: [], tags: [], followers: [], sectionId: null, position: 0, canEdit: true, canComplete: true, ...over,
  });
  it("Name · code, and the avatar keeps the name", () => {
    expect(personHeading("Akash E", "6299")).toBe("Akash E · 6299");
    expect(personHeading("Akash E", null)).toBe("Akash E");
    const groups = applyGrid([task({ createdByCode: "6299" }), task({ id: 2, createdBy: 3, createdByName: "Asha" })], { ...DEFAULT_GRID, group: "createdBy" }, { today: "2026-11-22", meId: 1 });
    expect(groups.map((group) => [group.name, group.person])).toEqual([
      ["Akash E · 6299", "Akash E"],
      ["Asha", "Asha"],
    ]);
    const byAssignee = applyGrid([task({ assigneeCode: "EMP123" })], { ...DEFAULT_GRID, group: "assignee" }, { today: "2026-11-22", meId: 1 });
    expect(byAssignee[0]!.name).toBe("Ravi · EMP123");
  });
});

describe("Create task draft kept in the browser tab", () => {
  const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), removeItem: (key: string) => void data.delete(key), data };
  };
  const draft = { title: "Send the quote", description: "", projectId: 4, due: "2026-11-25", start: "", dueTime: "17:00", forWhom: "self" as const, others: [], priority: "HIGH" as const };
  it("is written as typed and read back after a reload", () => {
    const store = memory();
    writeDraft(store, draft, 1000);
    expect(readDraft(store, 2000)).toEqual({ ...draft, savedAt: 1000 });
  });
  it("an empty draft isn't kept; Create and Close clear it", () => {
    const store = memory();
    writeDraft(store, draft, 1000);
    writeDraft(store, { ...draft, title: "  " }, 1000);
    expect(store.data.has(DRAFT_KEY)).toBe(false);
    writeDraft(store, draft, 1000);
    clearDraft(store);
    expect(readDraft(store)).toBeNull();
  });
  it("a day-old or broken draft is ignored, bad values are dropped", () => {
    const store = memory();
    writeDraft(store, draft, 0);
    expect(readDraft(store, DRAFT_MAX_AGE_MS + 1)).toBeNull();
    store.setItem(DRAFT_KEY, "{not json");
    expect(readDraft(store)).toBeNull();
    store.setItem(DRAFT_KEY, JSON.stringify({ title: "x", due: "soon", dueTime: "late", others: [1, "2", -3], priority: "MEGA", projectId: "7", savedAt: 5 }));
    expect(readDraft(store, 10)).toMatchObject({ title: "x", due: "", dueTime: "23:59", others: [1], priority: "NORMAL", projectId: null });
  });
  it("works without storage (private windows)", () => {
    expect(readDraft(null)).toBeNull();
    expect(() => writeDraft(null, draft)).not.toThrow();
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(readDraft(broken)).toBeNull();
    expect(() => writeDraft(broken, draft)).not.toThrow();
    expect(() => clearDraft(broken)).not.toThrow();
  });
});
