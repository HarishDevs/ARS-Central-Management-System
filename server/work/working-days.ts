// v1.74.0 (D-398): a project's and a task's dates read as From and To, and the
// working days and estimated hours between them. Pure and unit-tested; the
// calendar is the Working calendar (weekly offs) plus the organisation's
// holidays (server/work/durations.ts loads it). Also used in the browser (the
// Gantt recomputes while a bar is dragged), so no server imports here.
import { z } from "zod";
import { addDays, dayDiff, weekdayOf, type WorkCalendar } from "@/server/work/schedule";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
// A real calendar day (2026-02-31 is not one).
export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const isWorkingWeekday = (day: string, calendar: WorkCalendar) => calendar.workingWeekdays.size === 0 || calendar.workingWeekdays.has(weekdayOf(day));
export const isWorkingDay = (day: string, calendar: WorkCalendar) => isWorkingWeekday(day, calendar) && !calendar.offDays.has(day);

// The working days from `from` to `to`, both counted (inclusive). null when
// either is not a day or From is after To. Whole weeks are counted at once,
// so a range of many years costs no more than a few weeks.
export function workingDaysBetween(from: string, to: string, calendar: WorkCalendar): number | null {
  if (!isDay(from) || !isDay(to) || from > to) return null;
  const span = dayDiff(from, to) + 1;
  const perWeek = calendar.workingWeekdays.size === 0 ? 7 : calendar.workingWeekdays.size;
  const weeks = Math.floor(span / 7);
  let count = weeks * perWeek;
  for (let i = weeks * 7; i < span; i += 1) if (isWorkingWeekday(addDays(from, i), calendar)) count += 1;
  for (const holiday of calendar.offDays) if (holiday >= from && holiday <= to && isWorkingWeekday(holiday, calendar)) count -= 1;
  return count;
}

// A task's length in working days. Only a due date (or a start after the due
// date, which the app doesn't allow): 1 day. A range with no working day in it
// (say a Sunday-only task) still counts as 1, so a task is never "0 days".
export function taskDurationDays(start: string | null, due: string, calendar: WorkCalendar): number {
  if (!start || start >= due) return 1;
  return Math.max(1, workingDaysBetween(start, due, calendar) ?? 1);
}

// ---- hours per working day (Admin → Task settings) ------------------------------------------
export const PLANNING_SETTINGS_KEY = "tasks.planning";
export const DEFAULT_HOURS_PER_DAY = 8;
export const planningSettingsSchema = z.object({
  hoursPerDay: z.number().min(1).max(24).multipleOf(0.5).default(DEFAULT_HOURS_PER_DAY),
});
export type PlanningSettings = z.infer<typeof planningSettingsSchema>;
export function parsePlanningSettings(raw: string | null | undefined): PlanningSettings {
  let value: unknown = {};
  try {
    value = raw ? JSON.parse(raw) : {};
  } catch {
    value = {};
  }
  const parsed = planningSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : planningSettingsSchema.parse({});
}

// ---- durations and estimates ----------------------------------------------------------------
export interface Duration {
  days: number; // working days, From and To both counted
  hours: number; // days × hours per working day
}
export function projectDuration(from: string | null, to: string | null, calendar: WorkCalendar, hoursPerDay: number): Duration | null {
  if (!from || !to) return null;
  const days = workingDaysBetween(from, to, calendar);
  return days === null ? null : { days, hours: days * hoursPerDay };
}

export type EstimateSource = "MANUAL" | "DATES";
export interface EffectiveEstimate {
  minutes: number | null;
  source: EstimateSource | null;
}
// A manual estimate always wins; without one, the task's working days × hours
// per day ("Estimated from dates"). No dates (or the planning features off):
// no estimate.
export function effectiveEstimate(manualMinutes: number | null, durationDays: number | null, hoursPerDay: number): EffectiveEstimate {
  if (manualMinutes !== null && manualMinutes !== undefined) return { minutes: manualMinutes, source: "MANUAL" };
  if (durationDays === null || durationDays === undefined || durationDays <= 0) return { minutes: null, source: null };
  return { minutes: Math.round(durationDays * hoursPerDay * 60), source: "DATES" };
}

// ---- words ------------------------------------------------------------------------------------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "12 Dec", or "12 Dec 2027" when the year isn't `thisYear`.
export function dayText(day: string, thisYear?: string): string {
  if (!isDay(day)) return day;
  const text = `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
  return thisYear && day.slice(0, 4) === thisYear ? text : `${text} ${day.slice(0, 4)}`;
}
const hoursText = (hours: number) => `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
export const daysText = (days: number) => `${days} working day${days === 1 ? "" : "s"}`;
// "From 1 Dec To 12 Dec", "From 1 Dec", "To 12 Dec", or "" without dates.
export function datesText(from: string | null, to: string | null, thisYear?: string): string {
  if (from && to) return `From ${dayText(from, thisYear)} To ${dayText(to, thisYear)}`;
  if (from) return `From ${dayText(from, thisYear)}`;
  if (to) return `To ${dayText(to, thisYear)}`;
  return "";
}
// "10 working days · 80 h"
export const durationText = (duration: Duration) => `${daysText(duration.days)} · ${hoursText(duration.hours)}`;
