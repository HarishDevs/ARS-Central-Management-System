import { formatDate } from "@/lib/format/date";
// v1.65.0 (D-373, PM phase B part 2, spec PV §16): dependency types, the
// working-day calendar used for shifting, and the auto-shift plan. Pure and
// unit-tested; server/work/schedule-service.ts loads the data and applies the
// plan in one transaction. Also used by the Timeline/Gantt to colour
// connectors (a link whose dates break its rule is a conflict).

// ---- dependency types -------------------------------------------------------------------
export const DEP_TYPES = ["FS", "SS", "FF", "SF"] as const;
export type DepType = (typeof DEP_TYPES)[number];
export const isDepType = (value: unknown): value is DepType => typeof value === "string" && (DEP_TYPES as readonly string[]).includes(value);
export const DEP_TYPE_LABEL: Record<DepType, string> = { FS: "Finish to start", SS: "Start to start", FF: "Finish to finish", SF: "Start to finish" };
// What the rule means for the task that waits (the successor).
export const DEP_TYPE_HELP: Record<DepType, string> = {
  FS: "It starts once the other task is finished.",
  SS: "It starts once the other task has started.",
  FF: "It finishes once the other task is finished.",
  SF: "The other task finishes once this one has started.",
};
export const MAX_LAG_DAYS = 0; // lag is stored but reserved: always 0 for now

const OPEN = ["OPEN", "IN_PROGRESS", "BLOCKED"];
// Does a link stop its successor now? FS and FF: while the predecessor is open.
// SS: until the predecessor has started (In progress) or is done. SF never
// holds the successor back (it constrains the predecessor's finish).
export function linkBlocks(type: DepType, predecessorStatus: string): boolean {
  if (type === "FS" || type === "FF") return OPEN.includes(predecessorStatus);
  if (type === "SS") return predecessorStatus === "OPEN" || predecessorStatus === "BLOCKED";
  return false;
}

// ---- days and the working calendar ------------------------------------------------------
export const addDays = (day: string, days: number): string => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
export const dayDiff = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
export const weekdayOf = (day: string): number => new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 Sunday … 6 Saturday

export interface WorkCalendar {
  offDays: ReadonlySet<string>; // holidays (YYYY-MM-DD)
  workingWeekdays: ReadonlySet<number>; // 0..6; empty = every day works
}
export const EVERY_DAY: WorkCalendar = { offDays: new Set(), workingWeekdays: new Set() };

export function isWorkDay(day: string, calendar: WorkCalendar, skip: boolean): boolean {
  if (!skip) return true;
  if (calendar.offDays.has(day)) return false;
  return calendar.workingWeekdays.size === 0 || calendar.workingWeekdays.has(weekdayOf(day));
}

// The day `n` working days after (n < 0: before) `day`. n = 0 gives the day itself.
export function addWorkDays(day: string, n: number, calendar: WorkCalendar, skip: boolean): string {
  if (!skip || n === 0) return addDays(day, n);
  const step = n > 0 ? 1 : -1;
  let left = Math.abs(n);
  let current = day;
  for (let guard = 0; left > 0 && guard < 4000; guard += 1) {
    current = addDays(current, step);
    if (isWorkDay(current, calendar, true)) left -= 1;
  }
  return current;
}

// Working days from `from` to `to` (signed): the working days in (from, to]
// (or −those in (to, from]). Without skipping: plain days.
export function workDayDelta(from: string, to: string, calendar: WorkCalendar, skip: boolean): number {
  if (!skip) return dayDiff(from, to);
  if (from === to) return 0;
  const forward = to > from;
  let count = 0;
  let current = from;
  for (let guard = 0; current !== to && guard < 4000; guard += 1) {
    current = addDays(current, forward ? 1 : -1);
    if (forward ? isWorkDay(current, calendar, true) : isWorkDay(addDays(current, 1), calendar, true)) count += 1;
  }
  return forward ? count : -count;
}

// ---- task dates and link rules ----------------------------------------------------------
export interface TaskDates {
  start: string | null; // null: a one-day task (or a milestone) on its due day
  due: string; // mandatory (D-316)
}
export const startOf = (dates: TaskDates) => dates.start ?? dates.due;

// The predecessor date a link hangs on: SS uses its start, the others its due date.
export const predecessorAnchor = (type: DepType, dates: TaskDates) => (type === "SS" ? startOf(dates) : dates.due);

// Is the link's rule broken by these dates? FS: the successor starts on or
// after the predecessor's due day. SS: starts on or after its start. FF:
// finishes on or after its due day. SF: starts on or before its due day.
// Same-day counts as kept (day granularity; spec AC-PROJV-12).
export function linkConflict(type: DepType, predecessor: TaskDates, successor: TaskDates, lag = 0): boolean {
  if (type === "FS") return startOf(successor) < addDays(predecessor.due, lag);
  if (type === "SS") return startOf(successor) < addDays(startOf(predecessor), lag);
  if (type === "FF") return successor.due < addDays(predecessor.due, lag);
  return startOf(successor) > addDays(predecessor.due, lag);
}

// Move a task by n working days, both dates (its length in working days is
// kept, and start ≤ due stays true because the move is monotonic).
export function shiftDates(dates: TaskDates, n: number, calendar: WorkCalendar, skip: boolean): TaskDates {
  if (n === 0) return dates;
  const due = addWorkDays(dates.due, n, calendar, skip);
  let start = dates.start === null ? null : addWorkDays(dates.start, n, calendar, skip);
  if (start !== null && start > due) start = due;
  return { start, due };
}

// ---- auto-shift ---------------------------------------------------------------------------
export const SHIFT_MODES = ["OFF", "KEEP_GAP", "CONSUME"] as const;
export type ShiftMode = (typeof SHIFT_MODES)[number];
export const isShiftMode = (value: unknown): value is ShiftMode => typeof value === "string" && (SHIFT_MODES as readonly string[]).includes(value);
export const SHIFT_MODE_LABEL: Record<ShiftMode, string> = {
  OFF: "Off: never move dependent tasks",
  KEEP_GAP: "Keep the gap: move dependent tasks by the same number of days",
  CONSUME: "Use up the slack: move dependent tasks only when they would clash",
};

export interface ShiftLink {
  predecessor: number;
  successor: number;
  type: DepType;
  lag: number;
  mode: ShiftMode; // the setting of a project both tasks share (OFF: none)
  skip: boolean; // that project skips weekly offs and holidays
}
export interface ShiftTask {
  id: number;
  dates: TaskDates;
  movable: boolean; // open and not deleted: done tasks never move
}
export interface ShiftMove {
  id: number;
  from: TaskDates;
  to: TaskDates;
  because: number; // the predecessor whose move caused it
  mode: ShiftMode;
}

// When `source` moved from `before` to its current dates, which dependent
// tasks move, and where. KEEP_GAP: each successor moves by the same number of
// working days as the date its link hangs on. CONSUME: a successor moves only
// as far as needed to keep the link's rule (later; an SF successor earlier).
// Breadth-first over successors; each task moves at most once in KEEP_GAP and
// settles within a bounded number of passes in CONSUME. Done tasks and links
// whose projects have shifting off are left alone (their conflicts show).
export function planShift(source: number, before: TaskDates, tasks: ReadonlyMap<number, ShiftTask>, links: readonly ShiftLink[], calendar: WorkCalendar): ShiftMove[] {
  const now = new Map<number, TaskDates>();
  for (const [id, task] of tasks) now.set(id, task.dates);
  const was = new Map<number, TaskDates>([[source, before]]);
  const bySource = new Map<number, ShiftLink[]>();
  for (const link of links) if (link.mode !== "OFF") bySource.set(link.predecessor, [...(bySource.get(link.predecessor) ?? []), link]);
  const moves = new Map<number, ShiftMove>();
  const visits = new Map<number, number>();
  const queue: number[] = [source];
  for (let guard = 0; queue.length && guard < 20_000; guard += 1) {
    const predecessor = queue.shift()!;
    const prevDates = was.get(predecessor);
    const predDates = now.get(predecessor);
    if (!prevDates || !predDates) continue;
    for (const link of bySource.get(predecessor) ?? []) {
      const successor = tasks.get(link.successor);
      if (!successor || !successor.movable || link.successor === source) continue;
      const current = now.get(link.successor)!;
      let next: TaskDates = current;
      if (link.mode === "KEEP_GAP") {
        if (moves.has(link.successor)) continue;
        const delta = workDayDelta(predecessorAnchor(link.type, prevDates), predecessorAnchor(link.type, predDates), calendar, link.skip);
        next = shiftDates(current, delta, calendar, link.skip);
      } else if (linkConflict(link.type, predDates, current, link.lag)) {
        const required = addDays(predecessorAnchor(link.type, predDates), link.lag);
        const anchor = link.type === "FF" ? current.due : startOf(current);
        next = shiftDates(current, workDayDelta(anchor, required, calendar, link.skip), calendar, link.skip);
        // On non-working days the working-day move can stop a day short: step on until the rule holds.
        for (let step = 0; linkConflict(link.type, predDates, next, link.lag) && step < 400; step += 1) next = shiftDates(next, link.type === "SF" ? -1 : 1, calendar, link.skip);
      }
      if (next.due === current.due && next.start === current.start) continue;
      const count = (visits.get(link.successor) ?? 0) + 1;
      if (count > 25) continue;
      visits.set(link.successor, count);
      const first = moves.get(link.successor)?.from ?? current;
      moves.set(link.successor, { id: link.successor, from: first, to: next, because: predecessor, mode: link.mode });
      was.set(link.successor, current);
      now.set(link.successor, next);
      queue.push(link.successor);
    }
  }
  return [...moves.values()].filter((move) => move.from.due !== move.to.due || move.from.start !== move.to.start);
}

// ---- status updates -----------------------------------------------------------------------
export const HIGHLIGHT_WINDOWS = [7, 14, 30] as const;
export const DEFAULT_HIGHLIGHT_DAYS = 14;
export const highlightDays = (value: unknown): number => {
  const n = Number(value);
  return (HIGHLIGHT_WINDOWS as readonly number[]).includes(n) ? n : DEFAULT_HIGHLIGHT_DAYS;
};
export const MAX_HIGHLIGHTS = 30;
export const MAX_EXTRA_RECIPIENTS = 30;
// The weekly reminder goes on Friday (India), from 9 am, once per Friday.
export const REMINDER_WEEKDAY = 5;
export function reminderDue(indiaNow: { day: string; hour: number }, remindedOn: string | null): boolean {
  return weekdayOf(indiaNow.day) === REMINDER_WEEKDAY && indiaNow.hour >= 9 && remindedOn !== indiaNow.day;
}
// Default title of a status update: "<project> – 22 Nov".
export function statusTitleFor(projectName: string, day: string): string {
  return `${projectName} – ${formatDate(day, { year: "never" })}`;
}
// Undo of a shift is possible for this long.
export const SHIFT_UNDO_MINUTES = 15;
