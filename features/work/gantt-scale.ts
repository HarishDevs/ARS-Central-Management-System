// v1.65.0 (D-373, spec PV §4-5): the time scale of the Timeline and Gantt
// (zoom units, pixels per day, the two header rows, the visible window of
// rows) and the connector path. Pure and unit-tested.
import { addDays, dayDiff, weekdayOf } from "@/server/work/schedule";

export const ZOOMS = ["days", "weeks", "months", "quarters"] as const;
export type Zoom = (typeof ZOOMS)[number];
export const ZOOM_LABEL: Record<Zoom, string> = { days: "Days", weeks: "Weeks", months: "Months", quarters: "Quarters" };
export const isZoom = (value: unknown): value is Zoom => typeof value === "string" && (ZOOMS as readonly string[]).includes(value);
export const PX_PER_DAY: Record<Zoom, number> = { days: 36, weeks: 16, months: 5, quarters: 2 };
// One keyboard step (and one Previous/Next jump is 4 steps at Days, else 4× too).
export const STEP_DAYS: Record<Zoom, number> = { days: 1, weeks: 7, months: 30, quarters: 91 };
export const STEP_LABEL: Record<Zoom, string> = { days: "a day", weeks: "a week", months: "30 days", quarters: "91 days" };
export const zoomIn = (zoom: Zoom): Zoom => ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)]!;
export const zoomOut = (zoom: Zoom): Zoom => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)]!;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
const nextMonth = (day: string) => {
  const date = new Date(`${monthStart(day)}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
};
const mondayOf = (day: string) => addDays(day, -((weekdayOf(day) + 6) % 7));

// The days the canvas covers: a margin around the tasks and today, from a
// Monday (Days/Weeks) or a month's first day, at most about 4 years.
export function scaleRange(days: readonly string[], today: string, zoom: Zoom): { from: string; to: string; span: number } {
  const pad = zoom === "days" ? 14 : zoom === "weeks" ? 35 : zoom === "months" ? 120 : 270;
  let from = addDays([today, ...days].reduce((a, b) => (b < a ? b : a)), -pad);
  let to = addDays([today, ...days].reduce((a, b) => (b > a ? b : a)), pad);
  // At most about 4 years, kept around today (a stray far date doesn't push today off the canvas).
  if (dayDiff(from, to) > 1460) {
    if (dayDiff(from, today) > 730) from = addDays(today, -730);
    to = addDays(from, 1460);
  }
  from = zoom === "days" || zoom === "weeks" ? mondayOf(from) : monthStart(from);
  return { from, to, span: dayDiff(from, to) + 1 };
}

// ISO week number of a day.
export function isoWeek(day: string): number {
  const date = new Date(`${day}T00:00:00Z`);
  const thursday = new Date(date.getTime() + (3 - ((date.getUTCDay() + 6) % 7)) * 86_400_000);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.floor((thursday.getTime() - yearStart) / 86_400_000 / 7) + 1;
}

export interface Band {
  key: string;
  label: string;
  start: number; // day index from `from`
  days: number;
}
// The two header rows: months over days or ISO weeks (Days, Weeks), quarters
// over months (Months), years over quarters (Quarters).
export function headerBands(from: string, span: number, zoom: Zoom): { top: Band[]; bottom: Band[] } {
  const to = addDays(from, span - 1);
  const months: Band[] = [];
  for (let day = monthStart(from); day <= to; day = nextMonth(day)) {
    const start = Math.max(0, dayDiff(from, day));
    const end = Math.min(span, dayDiff(from, nextMonth(day)));
    if (end > start) months.push({ key: `m${day}`, label: `${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`, start, days: end - start });
  }
  const group = (size: number, label: (day: string) => string, key: string): Band[] => {
    const out: Band[] = [];
    for (const month of months) {
      const day = addDays(from, month.start);
      const m = Number(day.slice(5, 7)) - 1;
      const groupKey = `${key}${day.slice(0, 4)}-${Math.floor(m / size)}`;
      const last = out.at(-1);
      if (last && last.key === groupKey) last.days += month.days;
      else out.push({ key: groupKey, label: label(day), start: month.start, days: month.days });
    }
    return out;
  };
  if (zoom === "days") return { top: months, bottom: Array.from({ length: span }, (_, i) => ({ key: `d${i}`, label: String(Number(addDays(from, i).slice(8, 10))), start: i, days: 1 })) };
  if (zoom === "weeks") {
    const weeks: Band[] = [];
    for (let i = 0; i < span; i += 7) {
      const day = addDays(from, i);
      weeks.push({ key: `w${day}`, label: `W${isoWeek(day)} ${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`, start: i, days: Math.min(7, span - i) });
    }
    return { top: months, bottom: weeks };
  }
  const quarter = (day: string) => `Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1} ${day.slice(0, 4)}`;
  if (zoom === "months") return { top: group(3, quarter, "q"), bottom: months.map((band) => ({ ...band, label: band.label.slice(0, 3) })) };
  return { top: group(12, (day) => day.slice(0, 4), "y"), bottom: group(3, quarter, "q").map((band) => ({ ...band, label: band.label.slice(0, 2) })) };
}

// Windowing: the rows to draw for a scroll position (with some spare rows).
export function visibleRows(scrollTop: number, viewHeight: number, rowHeight: number, total: number, overscan = 8): { first: number; last: number } {
  const first = Math.min(Math.max(0, total - 1), Math.max(0, Math.floor(scrollTop / rowHeight) - overscan));
  const last = Math.min(total - 1, Math.ceil((scrollTop + viewHeight) / rowHeight) + overscan);
  return { first, last: Math.max(first - 1, last) };
}

// The connector: leaves the predecessor's end, steps right, turns down (or
// up) to between the rows, runs to just before the successor's start, and
// enters it from the left (spec "elbow arrow").
export function connectorPath(x1: number, y1: number, x2: number, y2: number, rowHeight: number): string {
  const out = x1 + 8;
  const into = x2 - 8;
  if (into >= out) return `M ${x1} ${y1} H ${out} V ${y2} H ${x2}`;
  const mid = y2 > y1 ? y1 + rowHeight / 2 : y1 - rowHeight / 2;
  return `M ${x1} ${y1} H ${out} V ${mid} H ${into} V ${y2} H ${x2}`;
}

// "3 Dec" / "3 Dec 2027" (another year).
export function shortDay(day: string, today: string): string {
  const label = `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
  return day.slice(0, 4) === today.slice(0, 4) ? label : `${label} ${day.slice(0, 4)}`;
}
