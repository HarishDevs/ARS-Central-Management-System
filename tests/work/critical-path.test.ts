import { describe, expect, it } from "vitest";
import { criticalPath, criticalSummary, MAX_CPM_TASKS, slackText, type CpmLink, type CpmTask } from "@/server/work/critical-path";
import { EVERY_DAY, type DepType, type WorkCalendar } from "@/server/work/schedule";

// v1.74.0 (D-398): the critical path method on textbook examples.
// Monday 7 Dec 2026 is working day 0; Monday to Friday work.
const WEEK: WorkCalendar = { offDays: new Set(), workingWeekdays: new Set([1, 2, 3, 4, 5]) };
const task = (id: number, start: string | null, due: string, extra: Partial<CpmTask> = {}): CpmTask => ({ id, start, due, milestone: false, done: false, ...extra });
const link = (predecessor: number, successor: number, type: DepType = "FS", lag = 0): CpmLink => ({ predecessor, successor, type, lag });

describe("criticalPath: finish to start (textbook)", () => {
  // A(3) → B(2) → D(2); A(3) → C(4) → D(2). All planned to start on 7 Dec.
  const tasks = [task(1, "2026-12-07", "2026-12-09"), task(2, "2026-12-07", "2026-12-08"), task(3, "2026-12-07", "2026-12-10"), task(4, "2026-12-07", "2026-12-08")];
  const links = [link(1, 2), link(1, 3), link(2, 4), link(3, 4)];
  const result = criticalPath(tasks, links, WEEK);
  it("finds the longest path A, C, D and its length", () => {
    expect(result.criticalIds).toEqual([1, 3, 4]);
    expect(result.days).toBe(9);
    expect(result.start).toBe("2026-12-07");
    expect(result.end).toBe("2026-12-17");
  });
  it("gives early/late dates and slack in working days", () => {
    expect(result.tasks[2]).toMatchObject({ duration: 2, earlyStart: "2026-12-10", earlyFinish: "2026-12-11", lateStart: "2026-12-14", lateFinish: "2026-12-15", slack: 2, critical: false });
    expect(result.tasks[3]).toMatchObject({ duration: 4, earlyStart: "2026-12-10", earlyFinish: "2026-12-15", slack: 0, critical: true });
    expect(result.tasks[4]).toMatchObject({ earlyStart: "2026-12-16", earlyFinish: "2026-12-17", slack: 0 });
  });
  it("marks the links that drive the path", () => {
    expect(result.criticalLinks.sort()).toEqual(["1-3", "3-4"]);
  });
  it("summarises it", () => {
    expect(criticalSummary(result, (day) => day)).toBe("Critical path: 3 tasks, 9 working days, ends 2026-12-17");
  });
});

describe("criticalPath: link types and lag", () => {
  it("SS: the waiting task may start with the other", () => {
    const result = criticalPath([task(1, "2026-12-07", "2026-12-11"), task(2, "2026-12-07", "2026-12-08")], [link(1, 2, "SS", 1)], WEEK);
    expect(result.tasks[2]!.earlyStart).toBe("2026-12-08"); // one working day of lag
    expect(result.tasks[2]!.slack).toBe(2); // 2 days long, may finish by Fri 11
    expect(result.criticalIds).toEqual([1]);
  });
  it("FF: the waiting task finishes once the other has finished", () => {
    const result = criticalPath([task(1, "2026-12-07", "2026-12-10"), task(2, "2026-12-07", "2026-12-08")], [link(1, 2, "FF")], WEEK);
    expect(result.tasks[2]!.earlyFinish).toBe("2026-12-10");
    expect(result.tasks[2]!.earlyStart).toBe("2026-12-09");
    expect(result.criticalIds).toEqual([1, 2]);
  });
  it("SF (the app's rule): the other task can't finish before the waiting task starts", () => {
    // Task 2 waits for 1 with SF: 2 starts on or before 1's due date. 2 is fixed later (done), so 1 must finish after it starts.
    const result = criticalPath([task(1, "2026-12-07", "2026-12-07"), task(2, "2026-12-09", "2026-12-09", { done: true })], [link(1, 2, "SF")], WEEK);
    expect(result.tasks[1]!.earlyFinish).toBe("2026-12-09");
  });
  it("FS with lag counts working days (over a weekend)", () => {
    const result = criticalPath([task(1, "2026-12-09", "2026-12-11"), task(2, "2026-12-07", "2026-12-07")], [link(1, 2, "FS", 2)], WEEK);
    expect(result.tasks[2]!.earlyStart).toBe("2026-12-16"); // Fri 11 + next day Mon 14 + 2 lag days
  });
  it("skips holidays", () => {
    const holiday: WorkCalendar = { offDays: new Set(["2026-12-08"]), workingWeekdays: new Set([1, 2, 3, 4, 5]) };
    const result = criticalPath([task(1, "2026-12-07", "2026-12-09"), task(2, "2026-12-07", "2026-12-07")], [link(1, 2)], holiday);
    expect(result.tasks[1]!.duration).toBe(2);
    expect(result.tasks[2]!.earlyStart).toBe("2026-12-10");
  });
});

describe("criticalPath: shapes", () => {
  it("marks every one of several equally long paths", () => {
    const result = criticalPath([task(1, "2026-12-07", "2026-12-08"), task(2, "2026-12-07", "2026-12-08"), task(3, "2026-12-07", "2026-12-07")], [link(1, 3), link(2, 3)], WEEK);
    expect(result.criticalIds.sort()).toEqual([1, 2, 3]);
  });
  it("treats milestones as zero days", () => {
    const result = criticalPath([task(1, "2026-12-07", "2026-12-09"), task(2, null, "2026-12-07", { milestone: true }), task(3, "2026-12-07", "2026-12-07")], [link(1, 2), link(2, 3)], WEEK);
    expect(result.tasks[2]).toMatchObject({ duration: 0, earlyStart: "2026-12-09", earlyFinish: "2026-12-09", critical: true });
    expect(result.tasks[3]!.earlyStart).toBe("2026-12-10");
    expect(result.days).toBe(4);
  });
  it("gives a task with only a due date one day", () => {
    expect(criticalPath([task(1, null, "2026-12-09")], [], WEEK).tasks[1]).toMatchObject({ duration: 1, earlyStart: "2026-12-09", critical: true });
  });
  it("measures disconnected tasks against the latest finish", () => {
    const result = criticalPath([task(1, "2026-12-07", "2026-12-11"), task(2, "2026-12-07", "2026-12-08")], [], WEEK);
    expect(result.tasks[2]!.slack).toBe(3);
    expect(result.criticalIds).toEqual([1]);
  });
  it("respects a task planned later than its links need", () => {
    const result = criticalPath([task(1, "2026-12-07", "2026-12-07"), task(2, "2026-12-10", "2026-12-11")], [link(1, 2)], WEEK);
    expect(result.tasks[2]!.earlyStart).toBe("2026-12-10");
    expect(result.tasks[1]!.slack).toBe(2);
  });
  it("keeps completed tasks on their dates", () => {
    const result = criticalPath([task(1, "2026-12-07", "2026-12-11"), task(2, "2026-12-07", "2026-12-07", { done: true })], [link(1, 2)], WEEK);
    expect(result.tasks[2]!.earlyStart).toBe("2026-12-07");
  });
  it("shows a buffer to the project's To date, or negative slack when it is too early", () => {
    const tasks = [task(1, "2026-12-07", "2026-12-09")];
    expect(criticalPath(tasks, [], WEEK, "2026-12-11")).toMatchObject({ buffer: 2, criticalIds: [1] });
    const late = criticalPath(tasks, [], WEEK, "2026-12-08");
    expect(late.buffer).toBe(-1);
    expect(late.tasks[1]!.slack).toBe(-1);
    expect(late.end).toBe("2026-12-08");
  });
  it("leaves out links to tasks outside the set", () => {
    const result = criticalPath([task(1, "2026-12-07", "2026-12-07")], [link(99, 1), link(1, 98)], WEEK);
    expect(result.outsideLinks).toBe(2);
  });
  it("survives a loop in the data", () => {
    const result = criticalPath([task(1, "2026-12-07", "2026-12-07"), task(2, "2026-12-07", "2026-12-07")], [link(1, 2), link(2, 1)], WEEK);
    expect(result.loopLinks).toBeGreaterThan(0);
    expect(Object.keys(result.tasks)).toHaveLength(2);
  });
  it("is empty without tasks and refuses too many", () => {
    expect(criticalPath([], [], WEEK).criticalIds).toEqual([]);
    const many = Array.from({ length: MAX_CPM_TASKS + 1 }, (_, i) => task(i + 1, null, "2026-12-07"));
    expect(criticalPath(many, [], WEEK).tooMany).toBe(true);
  });
  it("counts every day with an empty calendar", () => {
    const result = criticalPath([task(1, "2026-12-05", "2026-12-06")], [], EVERY_DAY);
    expect(result.tasks[1]!.duration).toBe(2);
  });
  it("handles a long chain quickly", () => {
    const tasks = Array.from({ length: 500 }, (_, i) => task(i + 1, "2026-12-07", "2026-12-07"));
    const links = tasks.slice(1).map((item) => link(item.id - 1, item.id));
    const result = criticalPath(tasks, links, WEEK);
    expect(result.days).toBe(500);
    expect(result.criticalIds).toHaveLength(500);
  });
});

describe("slackText", () => {
  it("words the slack", () => {
    expect(slackText(0)).toBe("No slack");
    expect(slackText(1)).toBe("1 working day of slack");
    expect(slackText(-2)).toBe("2 working days late");
  });
});
