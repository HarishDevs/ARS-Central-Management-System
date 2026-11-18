// Working calendar for response times (F-31, D-067). Pure and unit-tested.
// Hours count only on working days in India (IST, UTC+5:30); a non-working
// day (weekly off or holiday) is skipped whole.
export const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const DEFAULT_WORKING_DAYS: Weekday[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

export interface WorkingCalendar {
  workingDays: ReadonlySet<Weekday>;
  holidays: ReadonlySet<string>; // YYYY-MM-DD, India dates
}

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

// The India calendar date of a moment, as YYYY-MM-DD.
export function indiaDate(moment: Date): string {
  return new Date(moment.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function isWorkingDay(date: string, calendar: WorkingCalendar): boolean {
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
  return calendar.workingDays.has(weekday) && !calendar.holidays.has(date);
}

// Adds `hours` of working time to `start`. Time on non-working days doesn't
// count; a start on a non-working day begins at the next working midnight.
export function addWorkingHours(start: Date, hours: number, calendar: WorkingCalendar): Date {
  if (calendar.workingDays.size === 0) return new Date(start.getTime() + hours * HOUR_MS); // nothing set: plain hours
  let remaining = hours * HOUR_MS;
  let cursor = start.getTime();
  for (let guard = 0; guard < 3660; guard += 1) {
    const local = cursor + IST_OFFSET_MS;
    const dayStartLocal = Math.floor(local / DAY_MS) * DAY_MS;
    const nextMidnight = dayStartLocal + DAY_MS - IST_OFFSET_MS; // next India midnight, as UTC ms
    const date = new Date(dayStartLocal).toISOString().slice(0, 10);
    if (isWorkingDay(date, calendar)) {
      const available = nextMidnight - cursor;
      if (remaining <= available) return new Date(cursor + remaining);
      remaining -= available;
    }
    cursor = nextMidnight;
  }
  return new Date(cursor); // a year without working days: give up safely
}

// v1.55.0 (D-326): the India date that is the `days`-th working day after
// `fromDate` (YYYY-MM-DD; fromDate itself never counts). Weekly offs and
// holidays are skipped. With no working days set, plain calendar days.
export function addWorkingDays(fromDate: string, days: number, calendar: WorkingCalendar): string {
  let cursor = Date.parse(`${fromDate}T00:00:00Z`);
  let left = Math.max(0, Math.floor(days));
  for (let guard = 0; left > 0 && guard < 3660; guard += 1) {
    cursor += DAY_MS;
    const date = new Date(cursor).toISOString().slice(0, 10);
    if (calendar.workingDays.size === 0 || isWorkingDay(date, calendar)) left -= 1;
  }
  return new Date(cursor).toISOString().slice(0, 10);
}

// Working days strictly after `fromDate` up to and including `toDate`.
export function workingDaysBetween(fromDate: string, toDate: string, calendar: WorkingCalendar): number {
  let count = 0;
  let cursor = Date.parse(`${fromDate}T00:00:00Z`);
  const end = Date.parse(`${toDate}T00:00:00Z`);
  for (let guard = 0; cursor < end && guard < 3660; guard += 1) {
    cursor += DAY_MS;
    if (calendar.workingDays.size === 0 || isWorkingDay(new Date(cursor).toISOString().slice(0, 10), calendar)) count += 1;
  }
  return count;
}

export function parseWorkingDays(raw: string | null | undefined): Weekday[] {
  if (!raw) return DEFAULT_WORKING_DAYS;
  const days = raw
    .split(",")
    .map((day) => day.trim().toUpperCase())
    .filter((day): day is Weekday => (WEEKDAYS as readonly string[]).includes(day));
  return days.length ? WEEKDAYS.filter((day) => days.includes(day)) : DEFAULT_WORKING_DAYS;
}
