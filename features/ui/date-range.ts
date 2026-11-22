// v1.75.0 (D-399, owner: "use this kind so that from date to date can be
// captured"): the pure rules of the shared date range picker
// (features/ui/DateRangePicker.tsx): reading a typed date, the Monday-first
// month grid, the range a day belongs to, picking a day into the start or
// due field, and which days are weekly offs or holidays. Days are plain
// "YYYY-MM-DD" strings (India time is the app's day; no time zone maths here).

export type Day = string; // YYYY-MM-DD
export type DateField = "start" | "due";
export interface RangeDraft {
  start: Day | "";
  due: Day | "";
}
export interface PickerCalendar {
  holidays: Record<Day, string>; // day → holiday name
  workingWeekdays: number[]; // 0 = Sunday … 6 = Saturday; empty = every day works
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const WEEK_HEAD = [
  { short: "M", long: "Monday" },
  { short: "T", long: "Tuesday" },
  { short: "W", long: "Wednesday" },
  { short: "T", long: "Thursday" },
  { short: "F", long: "Friday" },
  { short: "S", long: "Saturday" },
  { short: "S", long: "Sunday" },
];

const pad = (value: number) => String(value).padStart(2, "0");
const utc = (day: Day) => new Date(`${day}T00:00:00Z`);
const toDay = (date: Date): Day => date.toISOString().slice(0, 10);

/** A real calendar day ("2027-02-30" is not). */
export function isRealDay(value: string): value is Day {
  const match = DAY_RE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * What a person typed, as a day, or null. Accepted: dd-mm-yyyy, dd/mm/yyyy,
 * dd.mm.yyyy, the same with a two-digit year (20yy), and yyyy-mm-dd.
 */
export function parseDayInput(text: string): Day | null {
  const value = text.trim();
  if (!value) return null;
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value);
  if (iso) {
    const day = `${iso[1]}-${pad(Number(iso[2]))}-${pad(Number(iso[3]))}`;
    return isRealDay(day) ? day : null;
  }
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(value);
  if (!dmy) return null;
  const year = dmy[3]!.length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
  const day = `${year}-${pad(Number(dmy[2]))}-${pad(Number(dmy[1]))}`;
  return isRealDay(day) ? day : null;
}

/** dd/mm/yy, as the picker's fields show a day. */
export function fieldText(day: Day | ""): string {
  if (!day || !isRealDay(day)) return "";
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(2, 4)}`;
}

/** "1 Dec" (this year) or "1 Dec 2027". */
export function shortDay(day: Day, today: Day): string {
  if (!isRealDay(day)) return "";
  const month = MONTHS[Number(day.slice(5, 7)) - 1]!.slice(0, 3);
  const text = `${Number(day.slice(8, 10))} ${month}`;
  return day.slice(0, 4) === today.slice(0, 4) ? text : `${text} ${day.slice(0, 4)}`;
}

/** "Monday 1 December 2026": a day read out in full. */
export function longDay(day: Day): string {
  const date = utc(day);
  return `${WEEKDAY_NAMES[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function monthTitle(year: number, month: number): string {
  return `${MONTHS[month]} ${year}`;
}

export function addDays(day: Day, days: number): Day {
  const date = utc(day);
  date.setUTCDate(date.getUTCDate() + days);
  return toDay(date);
}

/** The same day n months on, kept inside the month (31 Jan + 1 = 28/29 Feb). */
export function addMonths(day: Day, months: number): Day {
  const date = utc(day);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), last));
  return toDay(target);
}

/** Monday (Home) and Sunday (End) of the day's week. */
export function weekStart(day: Day): Day {
  const weekday = utc(day).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}
export function weekEnd(day: Day): Day {
  return addDays(weekStart(day), 6);
}

export interface GridCell {
  day: Day;
  inMonth: boolean;
}
/**
 * The month as weeks, Monday first, with the days of the months before and
 * after that fill the first and last week. Always six weeks, so the picker
 * keeps its height from month to month.
 */
export function monthGrid(year: number, month: number): GridCell[][] {
  const first = toDay(new Date(Date.UTC(year, month, 1)));
  let day = weekStart(first);
  const weeks: GridCell[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const row: GridCell[] = [];
    for (let index = 0; index < 7; index += 1) {
      const date = utc(day);
      row.push({ day, inMonth: date.getUTCFullYear() === year && date.getUTCMonth() === month });
      day = addDays(day, 1);
    }
    weeks.push(row);
  }
  return weeks;
}

/** A weekly off or a holiday (with its name) on the organisation's calendar. */
export function dayOff(day: Day, calendar: PickerCalendar | null): { off: boolean; reason: string | null } {
  if (!calendar) return { off: false, reason: null };
  const holiday = calendar.holidays[day];
  if (holiday) return { off: true, reason: `Holiday: ${holiday}` };
  if (calendar.workingWeekdays.length > 0 && !calendar.workingWeekdays.includes(utc(day).getUTCDay())) return { off: true, reason: "Weekly off" };
  return { off: false, reason: null };
}

/** Outside the allowed span (min/max, either may be empty). */
export function outOfBounds(day: Day, min?: Day | "", max?: Day | ""): boolean {
  return Boolean((min && day < min) || (max && day > max));
}

/** Where a day sits in the (possibly previewed) range. */
export function rangeRole(day: Day, start: Day | "", due: Day | ""): "start" | "due" | "both" | "inside" | null {
  if (start && due && start === due && day === start) return "both";
  if (start && day === start) return "start";
  if (due && day === due) return "due";
  if (start && due && day > start && day < due) return "inside";
  return null;
}

/** The range shown while the pointer is over a day: what a click would make. */
export function previewRange(draft: RangeDraft, active: DateField, hover: Day | null): RangeDraft {
  if (!hover) return draft;
  if (active === "due" && draft.start) return hover >= draft.start ? { start: draft.start, due: hover } : { start: hover, due: draft.start };
  if (active === "start" && draft.due) return hover <= draft.due ? { start: hover, due: draft.due } : { start: draft.due, due: hover };
  return draft;
}

/**
 * A day picked into the active field. A start after the due date (or a due
 * date before the start) swaps the two, and says so. With the start field in
 * use, the other field becomes the active one.
 */
export function pickDay(draft: RangeDraft, active: DateField, day: Day, startInUse: boolean): { draft: RangeDraft; active: DateField; swapped: boolean } {
  if (active === "start") {
    if (draft.due && day > draft.due) return { draft: { start: draft.due, due: day }, active: "start", swapped: true };
    return { draft: { ...draft, start: day }, active: "due", swapped: false };
  }
  if (draft.start && day < draft.start) return { draft: { start: day, due: draft.start }, active: startInUse ? "start" : "due", swapped: true };
  return { draft: { ...draft, due: day }, active: startInUse ? "start" : "due", swapped: false };
}

/** A typed day into one field: same swap rule as a click; the field stays active. */
export function typeDay(draft: RangeDraft, field: DateField, day: Day): { draft: RangeDraft; swapped: boolean } {
  if (field === "start" && draft.due && day > draft.due) return { draft: { start: draft.due, due: day }, swapped: true };
  if (field === "due" && draft.start && day < draft.start) return { draft: { start: day, due: draft.start }, swapped: true };
  return { draft: { ...draft, [field]: day }, swapped: false };
}

/** What the picker announces (and shows on its button) for a range. */
export function rangeText(draft: RangeDraft, today: Day, labels: { start?: string; due?: string } = {}): string {
  const startLabel = labels.start ?? "Start";
  const dueLabel = labels.due ?? "Due";
  if (draft.start && draft.due) return `${startLabel} ${shortDay(draft.start, today)}, ${dueLabel.toLowerCase()} ${shortDay(draft.due, today)}`;
  if (draft.due) return `${dueLabel} ${shortDay(draft.due, today)}`;
  if (draft.start) return `${startLabel} ${shortDay(draft.start, today)}, no ${dueLabel.toLowerCase()} date yet`;
  return "No dates chosen";
}

/**
 * A day or a range as the app shows it (spec DATE_RANGES §3, in the app's
 * day-first order): one day = "Today" / "Tomorrow" / "Yesterday", a weekday
 * name within the coming week, else "1 Dec" (this year) or "1 Dec 2027";
 * a range = "30 Nov – 4 Dec", "7 – 11 Dec" (same month), "28 Dec 2026 –
 * 5 Jan 2027" (years differ or not this year). Start = due is one day.
 */
export function formatDayRange(start: Day | "" | null | undefined, due: Day | "" | null | undefined, today: Day, relative = true): string {
  const one = (day: Day) => {
    if (relative) {
      const diff = Math.round((utc(day).getTime() - utc(today).getTime()) / 86_400_000);
      if (diff === 0) return "Today";
      if (diff === 1) return "Tomorrow";
      if (diff === -1) return "Yesterday";
      if (diff > 1 && diff < 7) return WEEKDAY_NAMES[utc(day).getUTCDay()]!;
    }
    return shortDay(day, today);
  };
  const s = start && isRealDay(start) ? start : "";
  const d = due && isRealDay(due) ? due : "";
  if (!s && !d) return "";
  if (!s || !d || s === d) return one((d || s) as Day);
  const month = (day: Day) => MONTHS[Number(day.slice(5, 7)) - 1]!.slice(0, 3);
  const num = (day: Day) => Number(day.slice(8, 10));
  const thisYear = today.slice(0, 4);
  if (s.slice(0, 4) !== d.slice(0, 4) || s.slice(0, 4) !== thisYear) {
    if (s.slice(0, 7) === d.slice(0, 7)) return `${num(s)} – ${num(d)} ${month(d)} ${d.slice(0, 4)}`;
    return `${num(s)} ${month(s)} ${s.slice(0, 4)} – ${num(d)} ${month(d)} ${d.slice(0, 4)}`;
  }
  if (s.slice(0, 7) === d.slice(0, 7)) return `${num(s)} – ${num(d)} ${month(d)}`;
  return `${num(s)} ${month(s)} – ${num(d)} ${month(d)}`;
}

/** Today in India (the app's day). */
export function todayInIndia(now: Date = new Date()): Day {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
