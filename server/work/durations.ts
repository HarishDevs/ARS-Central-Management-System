import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";
import { getWorkingDays } from "@/lib/db/repositories/calendar.repository";
import { WEEKDAYS } from "@/server/workflows/calendar";
import { loadSetting } from "@/server/work/holiday-store";
import type { WorkCalendar } from "@/server/work/schedule";
import { effectiveEstimate, parsePlanningSettings, PLANNING_SETTINGS_KEY, projectDuration, taskDurationDays, type Duration, type EffectiveEstimate } from "@/server/work/working-days";

// v1.74.0 (D-398): what the From/To durations, the date-based estimates and
// the critical path count with: the Working calendar's working weekdays, the
// organisation's holidays (all of them: the list is short) and the hours per
// working day (Admin → Task settings). Durations always count working days,
// whatever a project's "skip weekly offs and holidays when moving" choice
// (that choice is only about how auto-shift counts a move).
export interface PlanningBasis {
  calendar: WorkCalendar;
  hoursPerDay: number;
}
export async function planningBasis(db: Queryable = getDbPool()): Promise<PlanningBasis> {
  const [[rows], working, raw] = await Promise.all([
    db.query<RowDataPacket[]>("SELECT DATE_FORMAT(holiday_on, '%Y-%m-%d') AS day FROM holidays LIMIT 20000"),
    getWorkingDays(db),
    loadSetting(PLANNING_SETTINGS_KEY, db),
  ]);
  return {
    calendar: { offDays: new Set(rows.map((row) => String(row.day))), workingWeekdays: new Set(working.map((day) => WEEKDAYS.indexOf(day)).filter((day) => day >= 0)) },
    hoursPerDay: parsePlanningSettings(raw).hoursPerDay,
  };
}
// The calendar in a shape that crosses to the browser.
export const calendarJson = (calendar: WorkCalendar) => ({ offDays: [...calendar.offDays].sort(), workingWeekdays: [...calendar.workingWeekdays].sort() });

export function durationOf(from: string | null, to: string | null, basis: PlanningBasis): Duration | null {
  return projectDuration(from, to, basis.calendar, basis.hoursPerDay);
}
// A task's effective estimate: its manual estimate, else from its dates.
// A milestone is a point in time: 0 days, so no date-based estimate.
export function taskEstimate(task: { manualMinutes: number | null; start: string | null; due: string | null; milestone?: boolean }, basis: PlanningBasis | null): EffectiveEstimate & { days: number | null } {
  const days = task.milestone ? 0 : task.due ? taskDurationDays(task.start, task.due, basis?.calendar ?? { offDays: new Set(), workingWeekdays: new Set() }) : null;
  if (!basis) return { ...effectiveEstimate(task.manualMinutes, null, 8), days };
  return { ...effectiveEstimate(task.manualMinutes, days, basis.hoursPerDay), days };
}
