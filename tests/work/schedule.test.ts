import { describe, expect, it } from "vitest";
import {
  addWorkDays,
  DEP_TYPES,
  EVERY_DAY,
  isDepType,
  linkBlocks,
  linkConflict,
  planShift,
  reminderDue,
  shiftDates,
  statusTitleFor,
  highlightDays,
  workDayDelta,
  type ShiftLink,
  type ShiftTask,
  type TaskDates,
  type WorkCalendar,
} from "@/server/work/schedule";
import { dependencyLoop } from "@/server/work/rules";

// v1.65.0 (D-373): dependency types, working-day maths, auto-shift (keep the
// gap / use up the slack) with weekly offs and holidays, cycles, reminders.
// 2026-11-23 is a Monday.
const MON_SAT: WorkCalendar = { offDays: new Set(), workingWeekdays: new Set([1, 2, 3, 4, 5, 6]) }; // Sunday off (the ARS default)
const MON_FRI: WorkCalendar = { offDays: new Set(), workingWeekdays: new Set([1, 2, 3, 4, 5]) };
const HOLIDAY: WorkCalendar = { offDays: new Set(["2026-11-25"]), workingWeekdays: new Set([1, 2, 3, 4, 5]) };
const d = (start: string | null, due: string): TaskDates => ({ start, due });
const tasks = (entries: [number, TaskDates, boolean?][]) => new Map<number, ShiftTask>(entries.map(([id, dates, movable]) => [id, { id, dates, movable: movable ?? true }]));
const link = (predecessor: number, successor: number, type: ShiftLink["type"], mode: ShiftLink["mode"], skip = true): ShiftLink => ({ predecessor, successor, type, lag: 0, mode, skip });

describe("dependency types", () => {
  it("knows the four types, FS by default", () => {
    expect(DEP_TYPES).toEqual(["FS", "SS", "FF", "SF"]);
    expect(isDepType("FS")).toBe(true);
    expect(isDepType("XX")).toBe(false);
  });
  it("holds the successor back by type", () => {
    expect(linkBlocks("FS", "OPEN")).toBe(true);
    expect(linkBlocks("FS", "IN_PROGRESS")).toBe(true);
    expect(linkBlocks("FS", "COMPLETED")).toBe(false);
    expect(linkBlocks("FF", "BLOCKED")).toBe(true);
    expect(linkBlocks("SS", "OPEN")).toBe(true);
    expect(linkBlocks("SS", "IN_PROGRESS")).toBe(false);
    expect(linkBlocks("SF", "OPEN")).toBe(false);
    expect(linkBlocks("FS", "CANCELLED")).toBe(false);
  });
  it("finds conflicts per type (same day is allowed)", () => {
    const a = d("2026-11-23", "2026-11-25");
    expect(linkConflict("FS", a, d("2026-11-25", "2026-11-27"))).toBe(false);
    expect(linkConflict("FS", a, d("2026-11-24", "2026-11-27"))).toBe(true);
    expect(linkConflict("FS", a, d(null, "2026-11-24"))).toBe(true); // no start: its due day counts
    expect(linkConflict("SS", a, d("2026-11-23", "2026-11-24"))).toBe(false);
    expect(linkConflict("SS", a, d("2026-11-22", "2026-11-24"))).toBe(true);
    expect(linkConflict("FF", a, d("2026-11-20", "2026-11-25"))).toBe(false);
    expect(linkConflict("FF", a, d("2026-11-20", "2026-11-24"))).toBe(true);
    expect(linkConflict("SF", a, d("2026-11-25", "2026-11-30"))).toBe(false);
    expect(linkConflict("SF", a, d("2026-11-26", "2026-11-30"))).toBe(true);
  });
  it("refuses loops of any type", () => {
    expect(dependencyLoop(1, 1, [])).toBe(true);
    expect(dependencyLoop(3, 1, [[1, 2], [2, 3]])).toBe(true);
    expect(dependencyLoop(1, 3, [[1, 2], [2, 3]])).toBe(false);
  });
});

describe("working days", () => {
  it("adds working days, skipping weekly offs and holidays", () => {
    expect(addWorkDays("2026-11-27", 1, MON_FRI, true)).toBe("2026-11-30"); // Fri + 1 → Mon
    expect(addWorkDays("2026-11-27", 1, MON_SAT, true)).toBe("2026-11-28"); // Sat works
    expect(addWorkDays("2026-11-24", 1, HOLIDAY, true)).toBe("2026-11-26"); // the 25th is a holiday
    expect(addWorkDays("2026-11-30", -1, MON_FRI, true)).toBe("2026-11-27");
    expect(addWorkDays("2026-11-27", 1, MON_FRI, false)).toBe("2026-11-28"); // not skipping
    expect(addWorkDays("2026-11-27", 3, EVERY_DAY, true)).toBe("2026-11-30");
  });
  it("counts working days between two days, signed", () => {
    expect(workDayDelta("2026-11-27", "2026-11-30", MON_FRI, true)).toBe(1);
    expect(workDayDelta("2026-11-30", "2026-11-27", MON_FRI, true)).toBe(-1);
    expect(workDayDelta("2026-11-23", "2026-11-27", HOLIDAY, true)).toBe(3);
    expect(workDayDelta("2026-11-23", "2026-11-27", HOLIDAY, false)).toBe(4);
    for (const day of ["2026-11-23", "2026-11-27", "2026-12-01"]) for (const n of [-4, -1, 1, 5]) expect(workDayDelta(day, addWorkDays(day, n, MON_FRI, true), MON_FRI, true)).toBe(n);
  });
  it("moves both dates and never puts the start after the due date", () => {
    expect(shiftDates(d("2026-11-26", "2026-11-27"), 1, MON_FRI, true)).toEqual(d("2026-11-27", "2026-11-30"));
    expect(shiftDates(d(null, "2026-11-27"), 2, MON_FRI, true)).toEqual(d(null, "2026-12-01"));
    const moved = shiftDates(d("2026-11-28", "2026-11-28"), 1, MON_FRI, true); // on a weekend
    expect(moved.start! <= moved.due).toBe(true);
  });
});

describe("auto-shift", () => {
  it("keep the gap: the successor moves by the same working days (AC-PROJV-11)", () => {
    // A due Mon 23; B starts Wed 25 (a 2-day gap). A moves +3 working days to Thu 26.
    const all = tasks([
      [1, d(null, "2026-11-26")],
      [2, d("2026-11-25", "2026-11-27")],
    ]);
    const moves = planShift(1, d(null, "2026-11-23"), all, [link(1, 2, "FS", "KEEP_GAP")], MON_FRI);
    expect(moves).toEqual([{ id: 2, from: d("2026-11-25", "2026-11-27"), to: d("2026-11-30", "2026-12-02"), because: 1, mode: "KEEP_GAP" }]);
  });
  it("keep the gap moves earlier too, and down the chain once each", () => {
    const all = tasks([
      [1, d(null, "2026-11-23")],
      [2, d("2026-11-26", "2026-11-26")],
      [3, d(null, "2026-11-30")],
    ]);
    const moves = planShift(1, d(null, "2026-11-24"), all, [link(1, 2, "FS", "KEEP_GAP"), link(2, 3, "FS", "KEEP_GAP"), link(1, 3, "FS", "KEEP_GAP")], MON_FRI);
    expect(moves.map((move) => [move.id, move.to.due])).toEqual([
      [2, "2026-11-25"],
      [3, "2026-11-27"],
    ]);
  });
  it("use up the slack: nothing moves while the gap absorbs it (AC-PROJV-12)", () => {
    // A due Mon 23, B starts Wed 25. Every day works here (plain days, as the spec's example).
    const before = d(null, "2026-11-23");
    const plus1 = planShift(1, before, tasks([[1, d(null, "2026-11-24")], [2, d("2026-11-25", "2026-11-26")]]), [link(1, 2, "FS", "CONSUME", false)], EVERY_DAY);
    expect(plus1).toEqual([]);
    const plus3 = planShift(1, before, tasks([[1, d(null, "2026-11-26")], [2, d("2026-11-25", "2026-11-26")]]), [link(1, 2, "FS", "CONSUME", false)], EVERY_DAY);
    expect(plus3.map((move) => move.to)).toEqual([d("2026-11-26", "2026-11-27")]); // +1 day
  });
  it("use up the slack skips weekends and holidays", () => {
    // A moves to Tue 24; B (Mon 23 – Tue 24) must start on or after Tue 24, keeping its 2 working days, over the holiday on the 25th.
    const moves = planShift(1, d(null, "2026-11-20"), tasks([[1, d(null, "2026-11-24")], [2, d("2026-11-23", "2026-11-24")]]), [link(1, 2, "FS", "CONSUME")], HOLIDAY);
    expect(moves.map((move) => move.to)).toEqual([d("2026-11-24", "2026-11-26")]);
  });
  it("uses each type's dates: SS by start, FF by due, SF pulls earlier", () => {
    const ss = planShift(1, d("2026-11-23", "2026-11-27"), tasks([[1, d("2026-11-25", "2026-11-27")], [2, d("2026-11-24", "2026-11-24")]]), [link(1, 2, "SS", "CONSUME")], MON_FRI);
    expect(ss.map((move) => move.to)).toEqual([d("2026-11-25", "2026-11-25")]);
    const ff = planShift(1, d(null, "2026-11-24"), tasks([[1, d(null, "2026-11-27")], [2, d("2026-11-23", "2026-11-25")]]), [link(1, 2, "FF", "CONSUME")], MON_FRI);
    expect(ff.map((move) => move.to)).toEqual([d("2026-11-25", "2026-11-27")]);
    const sf = planShift(1, d(null, "2026-11-27"), tasks([[1, d(null, "2026-11-24")], [2, d("2026-11-26", "2026-11-30")]]), [link(1, 2, "SF", "CONSUME")], MON_FRI);
    expect(sf.map((move) => move.to)).toEqual([d("2026-11-24", "2026-11-26")]);
  });
  it("leaves done tasks and links with shifting off alone", () => {
    const all = tasks([
      [1, d(null, "2026-11-27")],
      [2, d("2026-11-24", "2026-11-25"), false],
      [3, d("2026-11-24", "2026-11-25")],
    ]);
    expect(planShift(1, d(null, "2026-11-23"), all, [link(1, 2, "FS", "KEEP_GAP"), link(1, 3, "FS", "OFF")], MON_FRI)).toEqual([]);
  });
  it("keeps start ≤ due on every move and stops on a loop", () => {
    const all = tasks([
      [1, d("2026-11-24", "2026-11-26")],
      [2, d("2026-11-25", "2026-11-25")],
      [3, d(null, "2026-11-25")],
    ]);
    const moves = planShift(1, d("2026-11-23", "2026-11-23"), all, [link(1, 2, "FS", "KEEP_GAP"), link(2, 3, "FS", "KEEP_GAP"), link(3, 1, "FS", "KEEP_GAP")], MON_FRI);
    expect(moves.every((move) => (move.to.start ?? move.to.due) <= move.to.due)).toBe(true);
    expect(moves.find((move) => move.id === 1)).toBeUndefined();
  });
});

describe("status updates", () => {
  it("reminds on Friday from 9 am, once a day", () => {
    expect(reminderDue({ day: "2026-11-27", hour: 9 }, null)).toBe(true);
    expect(reminderDue({ day: "2026-11-27", hour: 8 }, null)).toBe(false);
    expect(reminderDue({ day: "2026-11-27", hour: 15 }, "2026-11-27")).toBe(false);
    expect(reminderDue({ day: "2026-11-26", hour: 15 }, "2026-11-20")).toBe(false);
  });
  it("titles and windows", () => {
    expect(statusTitleFor("Plant 2", "2026-11-22")).toBe("Plant 2 – 22 Nov");
    expect(highlightDays(30)).toBe(30);
    expect(highlightDays(99)).toBe(14);
  });
});
