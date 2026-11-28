// v1.89.0 (D-425, UIQA-CON-08 / ERR-01): the ONE way the app writes a date or a time.
//
// India time (Asia/Kolkata, UTC+5:30, no daylight saving), written out by hand rather
// than with Intl / toLocale*: Node's ICU and each browser's ICU disagree in small ways
// ("pm" vs "PM", a narrow no-break space before it, "Sept"), and a server-rendered text
// that the browser then writes differently is a hydration error (React #418). The same
// input gives the same text on the server, in every browser and in emails.
//
// The app's formats (GLOBAL_DESIGN_SYSTEM §Content):
//   date            24 Nov 2026          formatDate(at)
//   short date      24 Nov               formatDate(at, { year: "auto", now })   (another year: 24 Nov 2027)
//   with weekday    Tue, 24 Nov 2026     formatDate(at, { weekday: "short" })
//   time            3:05 pm              formatTime(at)
//   date and time   24 Nov 2026, 3:05 pm formatDateTime(at)
//   time range      Tue, 24 Nov 2026, 11:00 am to 12:30 pm      formatTimeRange(start, end)
//   day range       30 Nov – 4 Dec, 7 – 11 Dec                   formatDayRange(start, due, today)
//   PM screens (v1.95.0, D-471): `{ weekdays: false }` on formatRelativeDay / formatDayRange:
//                   a day near today is the date itself ("27 Nov"), only Today / Tomorrow /
//                   Yesterday stay as words (other modules keep weekday names, TD-041).
//   month           Nov 2026 / November 2026                     formatMonth(at)
//   relative        just now, 5 min ago, 2 h ago, Yesterday, 3 days ago, in 2 h, Tomorrow
//                   formatRelative(at, now) — "now" differs between server and browser, so
//                   on a page use <RelativeTime> (features/ui/RelativeTime.tsx): the absolute
//                   text first, the relative text after mount (no #418).
//   relative day    Today, Tomorrow, Yesterday, Friday (within the coming week), else 24 Nov
//                   formatRelativeDay(day, today)
//
// Inputs: a Date, epoch milliseconds, an ISO date-time string, or a calendar day
// "YYYY-MM-DD" (a day is a day: it is never moved by a time zone). "YYYY-MM" is a month.
// Nothing valid gives `empty` ("" unless asked).
//
// Exports and stored data keep their own machine formats (ISO, yyyy-mm-dd); this file is
// for text people read. ESLint (ars-ui/date-format) keeps toLocale* / Intl.DateTimeFormat
// out of app/, features/, components/ and server/ display code.

export type DateInput = Date | string | number | null | undefined;

export const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
export const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

interface Parts {
  year: number;
  month: number; // 0-11
  day: number;
  weekday: number; // 0 = Sunday
  hour: number; // 0-23, India time
  minute: number;
  dayOnly: boolean; // a calendar day or a month: no time of day
}

/** Milliseconds of a moment, or null. A "YYYY-MM-DD" day is its India midnight. */
export function toMillis(value: DateInput): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = value.trim();
  if (DAY_RE.test(text)) return Date.parse(`${text}T00:00:00Z`) - IST_OFFSET_MS;
  // "2026-11-24 15:05:00" (a database text) is read as an ISO moment in UTC.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? `${text.replace(" ", "T")}Z` : text;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function parts(value: DateInput): Parts | null {
  if (typeof value === "string") {
    const text = value.trim();
    const day = DAY_RE.exec(text);
    if (day) {
      const [y, m, d] = [Number(day[1]), Number(day[2]), Number(day[3])];
      const at = new Date(Date.UTC(y, m - 1, d));
      if (at.getUTCMonth() !== m - 1) return null;
      return { year: y, month: m - 1, day: d, weekday: at.getUTCDay(), hour: 0, minute: 0, dayOnly: true };
    }
    const month = MONTH_RE.exec(text);
    if (month) {
      const [y, m] = [Number(month[1]), Number(month[2])];
      if (m < 1 || m > 12) return null;
      return { year: y, month: m - 1, day: 1, weekday: new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), hour: 0, minute: 0, dayOnly: true };
    }
  }
  const ms = toMillis(value);
  if (ms === null) return null;
  const ist = new Date(ms + IST_OFFSET_MS);
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth(),
    day: ist.getUTCDate(),
    weekday: ist.getUTCDay(),
    hour: ist.getUTCHours(),
    minute: ist.getUTCMinutes(),
    dayOnly: false,
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** The India calendar day of a moment, "YYYY-MM-DD" ("" when not a date). A day stays itself. */
export function indiaDay(value: DateInput = new Date()): string {
  const p = parts(value);
  return p ? `${p.year}-${pad(p.month + 1)}-${pad(p.day)}` : "";
}
/** Today in India, "YYYY-MM-DD". */
export const indiaToday = (now: DateInput = new Date()) => indiaDay(now);
/** The hour in India, 0-23 (NaN when not a date). */
export const indiaHour = (value: DateInput = new Date()) => parts(value)?.hour ?? Number.NaN;
/** The year in India (NaN when not a date). */
export const indiaYear = (value: DateInput = new Date()) => parts(value)?.year ?? Number.NaN;
/** "HH:MM" (24 h) in India: for time inputs and stored times, not for people to read. */
export function indiaClock(value: DateInput): string {
  const p = parts(value);
  return p ? `${pad(p.hour)}:${pad(p.minute)}` : "";
}

/** A stored India clock "HH:MM" (24 h) as people read it: "3:05 pm" ("" when not a clock). */
export function formatClock(clock: string | null | undefined): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(clock ?? "");
  if (!match) return "";
  const hour = Number(match[1]);
  if (hour > 23 || Number(match[2]) > 59) return "";
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? "am" : "pm"}`;
}

export interface DateOptions {
  /** "always" (default): 24 Nov 2026. "auto": no year when it is `now`'s year. "never": 24 Nov. */
  year?: "always" | "auto" | "never";
  /** For year "auto": the moment that decides "this year" (default: the current time). */
  now?: DateInput;
  /** "short": Tue, 24 Nov 2026. "long": Tuesday, 24 Nov 2026. */
  weekday?: "short" | "long";
  /** "short" (default): Nov. "long": November. */
  month?: "short" | "long";
  /** What an empty or invalid input gives (default ""). */
  empty?: string;
}

function dateText(p: Parts, options: DateOptions): string {
  const monthName = (options.month === "long" ? MONTHS_LONG : MONTHS_SHORT)[p.month];
  const mode = options.year ?? "always";
  const showYear = mode === "always" || (mode === "auto" && p.year !== indiaYear(options.now ?? new Date()));
  const text = `${p.day} ${monthName}${showYear ? ` ${p.year}` : ""}`;
  if (!options.weekday) return text;
  return `${(options.weekday === "long" ? WEEKDAYS_LONG : WEEKDAYS_SHORT)[p.weekday]}, ${text}`;
}

function timeText(p: Parts): string {
  return `${p.hour % 12 || 12}:${pad(p.minute)} ${p.hour < 12 ? "am" : "pm"}`;
}

/** 24 Nov 2026 (see DateOptions for the short, weekday and long-month forms). */
export function formatDate(value: DateInput, options: DateOptions = {}): string {
  const p = parts(value);
  return p ? dateText(p, options) : (options.empty ?? "");
}

/** 3:05 pm */
export function formatTime(value: DateInput, options: { empty?: string } = {}): string {
  const p = parts(value);
  return p && !p.dayOnly ? timeText(p) : (options.empty ?? "");
}

/** 24 Nov 2026, 3:05 pm (a calendar day alone gives the date only). */
export function formatDateTime(value: DateInput, options: DateOptions = {}): string {
  const p = parts(value);
  if (!p) return options.empty ?? "";
  return p.dayOnly ? dateText(p, options) : `${dateText(p, options)}, ${timeText(p)}`;
}

/**
 * A meeting's time: "Tue, 24 Nov 2026, 11:00 am to 12:30 pm"; ending on another day:
 * "Tue, 24 Nov 2026, 11:30 pm to 25 Nov, 12:30 am". Without an end, the start only.
 */
export function formatTimeRange(start: DateInput, end: DateInput, options: DateOptions = {}): string {
  const a = parts(start);
  if (!a) return options.empty ?? "";
  const first = `${dateText(a, options)}, ${timeText(a)}`;
  const b = parts(end);
  if (!b) return first;
  const sameDay = a.year === b.year && a.month === b.month && a.day === b.day;
  if (sameDay) return `${first} to ${timeText(b)}`;
  return `${first} to ${dateText(b, { ...options, weekday: undefined, year: a.year === b.year ? "never" : "always" })}, ${timeText(b)}`;
}

/** Nov 2026; { month: "long" } November 2026; { year: "2-digit" } Nov 26 (chart axes only). */
export function formatMonth(value: DateInput, options: { month?: "short" | "long"; year?: "numeric" | "2-digit"; empty?: string } = {}): string {
  const p = parts(value);
  if (!p) return options.empty ?? "";
  const name = (options.month === "long" ? MONTHS_LONG : MONTHS_SHORT)[p.month];
  return `${name} ${options.year === "2-digit" ? String(p.year).slice(-2) : p.year}`;
}

const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);

/**
 * A day as the work lists show it: "Today", "Tomorrow", "Yesterday", a weekday name
 * within the coming week ("Friday"; `weekdays: false` leaves it out), else "24 Nov"
 * (this year) or "24 Nov 2027". `day` and `today` are India days (or moments).
 */
export function formatRelativeDay(day: DateInput, today: DateInput = new Date(), options: { weekdays?: boolean; empty?: string } = {}): string {
  const d = indiaDay(day);
  const t = indiaDay(today);
  if (!d || !t) return options.empty ?? "";
  const diff = dayNumber(d) - dayNumber(t);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if ((options.weekdays ?? true) && diff > 1 && diff < 7) return WEEKDAYS_LONG[new Date(`${d}T00:00:00Z`).getUTCDay()]!;
  return formatDate(d, { year: "auto", now: t });
}

/**
 * How long ago (or until) a moment, against `now`:
 *   under a minute        just now
 *   under an hour         5 min ago / in 5 min
 *   under 24 hours        2 h ago / in 2 h
 *   1 India day apart     Yesterday / Tomorrow
 *   2-6 India days apart  3 days ago / in 3 days
 *   further               24 Nov (this year) or 24 Nov 2025
 * Server text and browser text differ as time passes: on a page, use <RelativeTime>.
 */
export function formatRelative(at: DateInput, now: DateInput = new Date(), options: { empty?: string } = {}): string {
  const a = toMillis(at);
  const n = toMillis(now);
  if (a === null || n === null) return options.empty ?? "";
  const seconds = Math.round((n - a) / 1000);
  const past = seconds >= 0;
  const abs = Math.abs(seconds);
  if (abs < 60) return "just now";
  const minutes = Math.floor(abs / 60);
  if (minutes < 60) return past ? `${minutes} min ago` : `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return past ? `${hours} h ago` : `in ${hours} h`;
  const days = Math.abs(dayNumber(indiaDay(a)) - dayNumber(indiaDay(n)));
  if (days <= 1) return past ? "Yesterday" : "Tomorrow";
  if (days < 7) return past ? `${days} days ago` : `in ${days} days`;
  return formatDate(a, { year: "auto", now: n });
}

/** "Today at 2:27 pm", "Yesterday at 3:41 pm", "28 Oct at 9:05 am" (another year: "28 Oct 2025 at …"). */
export function formatDayTime(at: DateInput, now: DateInput = new Date(), options: { empty?: string } = {}): string {
  const p = parts(at);
  if (!p || p.dayOnly) return options.empty ?? "";
  const diff = dayNumber(indiaDay(at)) - dayNumber(indiaDay(now));
  const day = diff === 0 ? "Today" : diff === -1 ? "Yesterday" : diff === 1 ? "Tomorrow" : formatDate(at, { year: "auto", now });
  return `${day} at ${timeText(p)}`;
}

/**
 * A day or a range of days (spec DATE_RANGES §3, day first): one day = "Today" /
 * "Tomorrow" / "Yesterday", a weekday name within the coming week (with `relative`),
 * else "1 Dec" (this year) or "1 Dec 2027"; a range = "30 Nov – 4 Dec", "7 – 11 Dec"
 * (same month), "28 Dec 2026 – 5 Jan 2027" (years differ or not this year).
 */
export function formatDayRange(start: string | null | undefined, due: string | null | undefined, today: DateInput = new Date(), relative = true, options: { weekdays?: boolean } = {}): string {
  const t = indiaDay(today);
  const s = start && DAY_RE.test(start) && parts(start) ? start : "";
  const d = due && DAY_RE.test(due) && parts(due) ? due : "";
  if (!s && !d) return "";
  const one = (day: string) => (relative ? formatRelativeDay(day, t, { weekdays: options.weekdays }) : formatDate(day, { year: "auto", now: t }));
  if (!s || !d || s === d) return one(d || s);
  const month = (day: string) => MONTHS_SHORT[Number(day.slice(5, 7)) - 1];
  const num = (day: string) => Number(day.slice(8, 10));
  const thisYear = t.slice(0, 4);
  if (s.slice(0, 4) !== d.slice(0, 4) || s.slice(0, 4) !== thisYear) {
    if (s.slice(0, 7) === d.slice(0, 7)) return `${num(s)} – ${num(d)} ${month(d)} ${d.slice(0, 4)}`;
    return `${num(s)} ${month(s)} ${s.slice(0, 4)} – ${num(d)} ${month(d)} ${d.slice(0, 4)}`;
  }
  if (s.slice(0, 7) === d.slice(0, 7)) return `${num(s)} – ${num(d)} ${month(d)}`;
  return `${num(s)} ${month(s)} – ${num(d)} ${month(d)}`;
}

/** "1 Dec to 12 Dec 2026", "28 Dec 2026 to 3 Jan 2027": a period written out (reports, emails). */
export function formatPeriod(from: DateInput, to: DateInput, options: { empty?: string } = {}): string {
  const a = parts(from);
  const b = parts(to);
  if (!a && !b) return options.empty ?? "";
  if (!a) return `to ${formatDate(to)}`;
  if (!b) return `from ${formatDate(from)}`;
  if (indiaDay(from) === indiaDay(to)) return formatDate(from);
  return a.year === b.year ? `${dateText(a, { year: "never" })} to ${dateText(b, {})}` : `${dateText(a, {})} to ${dateText(b, {})}`;
}
