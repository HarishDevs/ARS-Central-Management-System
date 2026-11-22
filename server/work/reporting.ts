import { z } from "zod";
import { fieldFilterSchema, filterOps, type FieldConfig, type FieldType } from "@/server/work/custom-fields";
import { addDays, dayDiff, isWorkDay, weekdayOf, type WorkCalendar } from "@/server/work/schedule";

// v1.67.0 (D-375, PM phase D part 1, spec PROJECTS_VIEWS §7-8): the project
// dashboard's chart setup, its checks and defaults, the maths that turns
// grouped figures into chart series (folding, burnup and burndown, time
// buckets, axis ticks), and the Workload maths (spreading a task over its
// working days, capacity per day and week, over-capacity). Pure and
// unit-tested; server/work/reporting-service.ts runs the SQL and the checks
// of who may do what. Shared with the browser (the chart builder).

// ---- chart setup -------------------------------------------------------------------------
export const CHART_STYLES = ["bar", "stacked", "grouped", "line", "burnup", "burndown", "donut", "number", "lollipop"] as const;
export type ChartStyle = (typeof CHART_STYLES)[number];
export const CHART_STYLE_LABEL: Record<ChartStyle, string> = {
  bar: "Bar",
  stacked: "Stacked bar",
  grouped: "Grouped bar",
  line: "Line",
  burnup: "Burnup",
  burndown: "Burndown",
  donut: "Donut",
  number: "Number",
  lollipop: "Lollipop",
};
// Styles drawn over an X-axis (they take a benchmark line).
export const AXIS_STYLES: readonly ChartStyle[] = ["bar", "stacked", "grouped", "line", "lollipop"];
export const TIME_STYLES: readonly ChartStyle[] = ["burnup", "burndown"];

// What a chart groups by. "person" (who ran a timer) is for time entries only.
export const DIMENSIONS = ["assignee", "creator", "section", "type", "completion", "dueStatus", "date", "field", "person"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export const DIMENSION_LABEL: Record<Dimension, string> = {
  assignee: "Assignee",
  creator: "Creator",
  section: "Section",
  type: "Task type",
  completion: "Completion status",
  dueStatus: "Due date status",
  date: "Date",
  field: "Custom field",
  person: "Person who logged the time",
};
export const DATE_FIELDS = ["due", "start", "created", "completed"] as const;
export type DateField = (typeof DATE_FIELDS)[number];
export const DATE_FIELD_LABEL: Record<DateField, string> = { due: "Due date", start: "Start date", created: "Created", completed: "Completed" };
export const DATE_UNITS = ["day", "week", "month"] as const;
export type DateUnit = (typeof DATE_UNITS)[number];
export const DATE_UNIT_LABEL: Record<DateUnit, string> = { day: "By day", week: "By week", month: "By month" };
// A field can be an axis when it has a few known values or a date.
export const AXIS_FIELD_TYPES: readonly FieldType[] = ["SELECT", "MULTI_SELECT", "PEOPLE", "DATE"];
// A metric can add up a number, a formula or a timer field.
export const METRIC_FIELD_TYPES: readonly FieldType[] = ["NUMBER", "FORMULA", "TIMER"];

export const DUE_STATUSES = ["overdue", "today", "week", "later", "none", "done"] as const;
export type DueStatus = (typeof DUE_STATUSES)[number];
export const DUE_STATUS_LABEL: Record<DueStatus, string> = { overdue: "Overdue", today: "Due today", week: "Due in the next 7 days", later: "Due later", none: "No due date", done: "Done" };
export const TASK_TYPES = ["TASK", "MILESTONE"] as const;
export const TASK_TYPE_LABEL: Record<(typeof TASK_TYPES)[number], string> = { TASK: "Task", MILESTONE: "Milestone" };
export const COMPLETION_LABEL: Record<"open" | "done", string> = { done: "Completed", open: "Incomplete" };
export const RANGES = ["14d", "30d", "90d", "next30", "project"] as const;
export type ChartRange = (typeof RANGES)[number];
export const RANGE_LABEL: Record<ChartRange, string> = { "14d": "Last 14 days", "30d": "Last 30 days", "90d": "Last 90 days", next30: "Next 30 days", project: "The project's dates" };

export const dimensionSchema = z.object({
  by: z.enum(DIMENSIONS),
  fieldId: z.number().int().positive().nullable().default(null),
  dateField: z.enum(DATE_FIELDS).default("due"),
  unit: z.enum(DATE_UNITS).default("week"),
});
export type ChartDimension = z.infer<typeof dimensionSchema>;
export const metricSchema = z.object({
  measure: z.enum(["count", "sum", "avg"]).default("count"),
  fieldId: z.number().int().positive().nullable().default(null),
});
export type ChartMetric = z.infer<typeof metricSchema>;
const ids = (max: number) => z.array(z.number().int().positive()).max(max).default([]);
export const chartFiltersSchema = z.object({
  completion: z.enum(["all", "open", "done"]).default("all"),
  types: z.array(z.enum(TASK_TYPES)).max(2).default([]),
  mine: z.boolean().default(false), // assigned to the person looking
  assignees: ids(50),
  creators: ids(50),
  sections: ids(100),
  dueStatus: z.array(z.enum(DUE_STATUSES)).max(6).default([]),
  fields: z.array(fieldFilterSchema).max(10).default([]),
});
export type ChartFilters = z.infer<typeof chartFiltersSchema>;
export const MAX_METRICS = 4; // spec docs: up to 4 metrics on line, bar and lollipop
export const chartConfigSchema = z.object({
  style: z.enum(CHART_STYLES),
  source: z.enum(["tasks", "time"]).default("tasks"),
  timerFieldId: z.number().int().positive().nullable().default(null), // time entries: one timer field, or every one (null)
  x: dimensionSchema.nullable().default(null),
  series: dimensionSchema.nullable().default(null), // stacked / grouped: the second grouping
  metrics: z.array(metricSchema).min(1).max(MAX_METRICS).default([{ measure: "count", fieldId: null }]),
  filters: chartFiltersSchema.default(() => chartFiltersSchema.parse({})),
  range: z.enum(RANGES).default("30d"),
  dataLabels: z.boolean().default(true),
  benchmark: z.number().finite().min(-1e12).max(1e12).nullable().default(null),
  percent: z.boolean().default(false), // donut: show as percentage
});
export type ChartConfig = z.infer<typeof chartConfigSchema>;

export const WIDGET_TITLE_MAX = 80;
export const TEXT_BODY_MAX = 2000;
export const MAX_WIDGETS = 20; // spec: 20 widgets a dashboard (text counts)

export interface FieldInfo {
  id: number;
  name: string;
  type: FieldType;
  config?: FieldConfig;
  options?: { id: number; name: string }[]; // select fields: unarchived options (filter choices)
}

// Checks a chart setup against the style and the project's fields, and
// returns it tidied (things the style doesn't use are dropped). Deny by
// default: anything not understood is refused with a plain message.
export function checkChartConfig(raw: unknown, fields: readonly FieldInfo[]): { ok: true; config: ChartConfig } | { ok: false; message: string } {
  const parsed = chartConfigSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That chart setup isn't valid." };
  const config: ChartConfig = structuredClone(parsed.data);
  const byId = new Map(fields.map((field) => [field.id, field]));
  const time = config.source === "time";
  const style = config.style;
  if (time && TIME_STYLES.includes(style)) return { ok: false, message: "Burnup and burndown charts show tasks, not time entries." };
  if (time && config.timerFieldId !== null && byId.get(config.timerFieldId)?.type !== "TIMER") return { ok: false, message: "Choose one of the project's timer fields." };
  if (!time) config.timerFieldId = null;

  // Axes per style.
  if (style === "number" || TIME_STYLES.includes(style)) {
    config.x = null;
    config.series = null;
  } else if (!config.x) return { ok: false, message: style === "donut" ? "Choose what the donut is grouped by." : "Choose the X-axis." };
  if (style !== "stacked" && style !== "grouped") config.series = null;
  for (const dim of [config.x, config.series]) {
    if (!dim) continue;
    const problem = dimensionProblem(dim, fields, time);
    if (problem) return { ok: false, message: problem };
  }
  if (config.x && config.series && sameDimension(config.x, config.series)) return { ok: false, message: "Group the bars by something other than the X-axis." };

  // Metrics per style.
  if (TIME_STYLES.includes(style)) config.metrics = [{ measure: "count", fieldId: null }];
  if (style === "number" || style === "donut" || config.series) config.metrics = config.metrics.slice(0, 1);
  if ((style === "stacked" || style === "grouped") && !config.series && config.metrics.length < 2) return { ok: false, message: "A stacked or grouped bar needs a second grouping or a second metric." };
  for (const metric of config.metrics) {
    if (metric.measure === "count") {
      metric.fieldId = null;
      continue;
    }
    if (time) {
      metric.fieldId = null; // time entries add up their hours
      continue;
    }
    const field = metric.fieldId ? byId.get(metric.fieldId) : undefined;
    if (!field || !METRIC_FIELD_TYPES.includes(field.type)) return { ok: false, message: "Sum and average need a number, formula or timer field." };
  }
  // Filters.
  for (const filter of config.filters.fields) {
    const field = byId.get(filter.fieldId);
    if (!field) return { ok: false, message: "A filter uses a field this project doesn't have." };
    if (!filterOps(field.type).includes(filter.op)) return { ok: false, message: `${field.name} can't be filtered that way.` };
  }
  if (!AXIS_STYLES.includes(style)) config.benchmark = null;
  if (style !== "donut") config.percent = false;
  return { ok: true, config };
}

function dimensionProblem(dim: ChartDimension, fields: readonly FieldInfo[], time: boolean): string | null {
  if (dim.by === "person" && !time) return "\"Person who logged the time\" is for time entries.";
  if (dim.by === "field") {
    const field = fields.find((item) => item.id === dim.fieldId);
    if (!field || !AXIS_FIELD_TYPES.includes(field.type)) return "Group by a single-select, multi-select, people or date field.";
  } else dim.fieldId = null;
  return null;
}
const sameDimension = (a: ChartDimension, b: ChartDimension) => a.by === b.by && (a.by !== "field" || a.fieldId === b.fieldId) && (a.by !== "date" || a.dateField === b.dateField);

// "1 filter", "2 filters", "No filters" (the widget footer).
export function filterCount(filters: ChartFilters): number {
  return (
    (filters.completion !== "all" ? 1 : 0) +
    (filters.types.length ? 1 : 0) +
    (filters.mine ? 1 : 0) +
    (filters.assignees.length ? 1 : 0) +
    (filters.creators.length ? 1 : 0) +
    (filters.sections.length ? 1 : 0) +
    (filters.dueStatus.length ? 1 : 0) +
    filters.fields.length
  );
}
export const filterCountText = (count: number) => (count === 0 ? "No filters" : count === 1 ? "1 filter" : `${count} filters`);

// ---- the 8 default widgets of a new dashboard (spec §7.1, SBX41) ------------------------------
export interface WidgetSeed {
  kind: "CHART" | "TEXT";
  title: string;
  config: ChartConfig | null;
  body: string | null;
  size: "HALF" | "FULL";
}
const chart = (title: string, partial: Record<string, unknown>, size: "HALF" | "FULL" = "HALF"): WidgetSeed => ({ kind: "CHART", title, config: chartConfigSchema.parse(partial), body: null, size });
export function defaultWidgets(): WidgetSeed[] {
  return [
    chart("Total completed tasks", { style: "number", filters: { completion: "done" } }),
    chart("Total incomplete tasks", { style: "number", filters: { completion: "open" } }),
    chart("Total overdue tasks", { style: "number", filters: { dueStatus: ["overdue"] } }),
    chart("Total tasks", { style: "number" }),
    chart("Incomplete tasks by section", { style: "bar", x: { by: "section" }, filters: { completion: "open", types: ["TASK"] } }),
    chart("Tasks by completion status", { style: "donut", x: { by: "completion" }, filters: { types: ["TASK"] } }),
    chart("Upcoming tasks by assignee", { style: "bar", x: { by: "assignee" }, filters: { completion: "open", dueStatus: ["today", "week", "later"] } }),
    // The spec's "Task completion over time" (Total and Completed per day) is a burnup.
    chart("Task completion over time", { style: "burnup", range: "30d" }),
  ];
}
// A new chart from "Add widget › Chart" (AC-PROJV-22): a bar by the first
// single-select field, else by section; data labels on.
export function newChartConfig(fields: readonly FieldInfo[]): { title: string; config: ChartConfig } {
  const select = fields.find((field) => field.type === "SELECT");
  return select
    ? { title: `Total tasks by ${select.name}`.slice(0, WIDGET_TITLE_MAX), config: chartConfigSchema.parse({ style: "bar", x: { by: "field", fieldId: select.id } }) }
    : { title: "Total tasks by section", config: chartConfigSchema.parse({ style: "bar", x: { by: "section" } }) };
}

// ---- days, buckets and ranges -------------------------------------------------------------
export const mondayOf = (day: string) => addDays(day, -((weekdayOf(day) + 6) % 7));
export function bucketOf(day: string, unit: DateUnit): string {
  if (unit === "day") return day;
  if (unit === "week") return mondayOf(day);
  return `${day.slice(0, 7)}-01`;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function bucketLabel(key: string, unit: DateUnit): string {
  const [y, m, d] = key.split("-").map(Number);
  if (unit === "month") return `${MONTHS[(m ?? 1) - 1]} ${y}`;
  return `${unit === "week" ? "Week of " : ""}${d} ${MONTHS[(m ?? 1) - 1]}`;
}
export const MAX_BUCKETS = 120;
export interface Bucket {
  key: string;
  label: string;
  start: string;
  end: string; // last day in the bucket
}
// Every bucket from `from` to `to` (inclusive). Too many for the unit: the
// next coarser unit is used (day → week → month), so a chart never draws
// hundreds of points. Returns the unit used.
export function timeBuckets(from: string, to: string, unit: DateUnit): { unit: DateUnit; buckets: Bucket[] } {
  if (to < from) return { unit, buckets: [] };
  const units: DateUnit[] = ["day", "week", "month"];
  for (let index = units.indexOf(unit); index < units.length; index += 1) {
    const current = units[index]!;
    const buckets: Bucket[] = [];
    let start = bucketOf(from, current);
    while (start <= to && buckets.length <= MAX_BUCKETS) {
      const next = current === "day" ? addDays(start, 1) : current === "week" ? addDays(start, 7) : nextMonth(start);
      buckets.push({ key: start, label: bucketLabel(start, current), start, end: addDays(next, -1) });
      start = next;
    }
    if (buckets.length <= MAX_BUCKETS || current === "month") return { unit: current, buckets: buckets.slice(0, MAX_BUCKETS) };
  }
  return { unit, buckets: [] };
}
const nextMonth = (first: string) => {
  const [y, m] = first.split("-").map(Number);
  return m === 12 ? `${y! + 1}-01-01` : `${y}-${String(m! + 1).padStart(2, "0")}-01`;
};
// The days a time chart covers.
export function rangeDays(range: ChartRange, today: string, project: { startOn: string | null; dueOn: string | null; createdOn: string }): { from: string; to: string } {
  if (range === "project") {
    const from = project.startOn ?? project.createdOn;
    const to = project.dueOn && project.dueOn > from ? project.dueOn : today > from ? today : from;
    return { from, to };
  }
  if (range === "next30") return { from: today, to: addDays(today, 29) };
  const days = range === "14d" ? 14 : range === "90d" ? 90 : 30;
  return { from: addDays(today, -(days - 1)), to: today };
}
export function dueStatusOf(dueDay: string | null, today: string, done: boolean): DueStatus {
  if (done) return "done";
  if (!dueDay) return "none";
  if (dueDay < today) return "overdue";
  if (dueDay === today) return "today";
  if (dueDay <= addDays(today, 7)) return "week";
  return "later";
}

// ---- grouped figures → chart --------------------------------------------------------------
// One row of grouped figures (from SQL GROUP BY, or worked out in code for
// formula fields): the X key, the series key, how many tasks, and per
// metric the sum of its values and how many values there were (so averages
// fold correctly into "Other").
export interface GroupRow {
  k: string | null;
  s: string | null;
  tasks: number;
  sums: number[];
  counts: number[];
}
export interface KeyLabel {
  key: string;
  label: string;
}
export type ValueFormat = { kind: "count" } | { kind: "hours" } | { kind: "field"; config: Pick<FieldConfig, "format" | "decimals" | "symbol" | "unit" | "unitBefore"> };
export interface ChartSeries {
  key: string;
  label: string;
  slot: number; // 1..8: --color-chart-N
  dashed?: boolean;
}
export interface ChartData {
  style: ChartStyle;
  categories: KeyLabel[];
  series: ChartSeries[];
  values: (number | null)[][]; // [series][category]
  formats: ValueFormat[]; // per series
  total: number | null; // number widgets; the donut's centre
  benchmark: number | null;
  dataLabels: boolean;
  percent: boolean;
  xLabel: string;
  yLabel: string;
  note: string | null;
  empty: boolean;
}
export const MAX_CATEGORIES = 50;
export const MAX_SERIES = 8; // the validated categorical palette; the 8th is "Other" when there are more
export const OTHER = "__other";

const metricValue = (measure: ChartMetric["measure"], row: Pick<GroupRow, "tasks" | "sums" | "counts">, index: number): number | null => {
  if (measure === "count") return row.tasks;
  if (measure === "sum") return round(row.sums[index] ?? 0);
  const n = row.counts[index] ?? 0;
  return n ? round((row.sums[index] ?? 0) / n) : null;
};
export const round = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

function addInto(target: GroupRow, row: GroupRow) {
  target.tasks += row.tasks;
  row.sums.forEach((value, index) => (target.sums[index] = (target.sums[index] ?? 0) + value));
  row.counts.forEach((value, index) => (target.counts[index] = (target.counts[index] ?? 0) + value));
}
// Keys in their natural order (sections in list order, options in field
// order, statuses in a fixed order); keys not in the list come after, by
// label; "no value" (null) last.
function orderKeys(present: readonly (string | null)[], natural: readonly KeyLabel[], noneLabel: string): KeyLabel[] {
  const known = new Map(natural.map((item, index) => [item.key, index]));
  const labels = new Map(natural.map((item) => [item.key, item.label]));
  const unique = [...new Set(present)];
  const real = unique.filter((key): key is string => key !== null);
  real.sort((a, b) => (known.get(a) ?? 1e9) - (known.get(b) ?? 1e9) || (labels.get(a) ?? a).localeCompare(labels.get(b) ?? b));
  const out = real.map((key) => ({ key, label: labels.get(key) ?? key }));
  if (unique.includes(null)) out.push({ key: "__none", label: noneLabel });
  return out;
}

export interface AssembleInput {
  config: ChartConfig;
  rows: readonly GroupRow[];
  x: { natural: readonly KeyLabel[]; none: string; fill: boolean; label: string } | null; // fill: show every natural key (date buckets) even at 0
  series: { natural: readonly KeyLabel[]; none: string } | null;
  metricLabels: string[];
  formats: ValueFormat[];
}
// Turns grouped rows into what the chart draws. Pure: the same rows always
// give the same chart.
export function assembleChart(input: AssembleInput): ChartData {
  const { config } = input;
  const base = { style: config.style, benchmark: config.benchmark, dataLabels: config.dataLabels, percent: config.percent, note: null as string | null };
  const yLabel = input.metricLabels.length === 1 ? input.metricLabels[0]! : "Value";
  // Number: one figure.
  if (config.style === "number" || !input.x) {
    const all: GroupRow = { k: null, s: null, tasks: 0, sums: [], counts: [] };
    for (const row of input.rows) addInto(all, row);
    const value = metricValue(config.metrics[0]!.measure, all, 0);
    return { ...base, categories: [], series: [], values: [], formats: input.formats.slice(0, 1), total: value, xLabel: "", yLabel, empty: false };
  }
  const xKey = (key: string | null) => key ?? "__none";
  // X categories.
  // Date buckets show every bucket of the range (rows outside it are left out).
  let categories = input.x.fill ? [...input.x.natural] : orderKeys(input.rows.map((row) => row.k), input.x.natural, input.x.none);
  let note: string | null = null;
  if (categories.length > MAX_CATEGORIES) {
    note = `Showing the first ${MAX_CATEGORIES} of ${categories.length}. Add a filter to see the rest.`;
    categories = categories.slice(0, MAX_CATEGORIES);
  }
  const catIndex = new Map(categories.map((item, index) => [item.key, index]));

  // Series: by the second grouping, or one per metric.
  let series: ChartSeries[];
  let seriesOf: (row: GroupRow) => number;
  if (input.series) {
    const ordered = orderKeys(input.rows.map((row) => row.s), input.series.natural, input.series.none);
    const folded = ordered.length > MAX_SERIES;
    const kept = folded ? ordered.slice(0, MAX_SERIES - 1) : ordered;
    series = kept.map((item, index) => ({ key: item.key, label: item.label, slot: index + 1 }));
    if (folded) series.push({ key: OTHER, label: `Other (${ordered.length - kept.length})`, slot: MAX_SERIES });
    const index = new Map(series.map((item, at) => [item.key, at]));
    seriesOf = (row) => index.get(row.s ?? "__none") ?? (folded ? series.length - 1 : -1);
  } else {
    series = config.metrics.map((_, index) => ({ key: `m${index}`, label: input.metricLabels[index] ?? `Metric ${index + 1}`, slot: index + 1 }));
    seriesOf = () => 0;
  }
  // Donut: categories are the slices; fold past 8 into "Other".
  if (config.style === "donut" && categories.length > MAX_SERIES) {
    const kept = categories.slice(0, MAX_SERIES - 1);
    const otherKeys = new Set(categories.slice(MAX_SERIES - 1).map((item) => item.key));
    categories = [...kept, { key: OTHER, label: `Other (${otherKeys.size})` }];
    catIndex.clear();
    categories.forEach((item, index) => catIndex.set(item.key, index));
    for (const key of otherKeys) catIndex.set(key, categories.length - 1);
  }
  // Add the rows up per cell.
  const cells: GroupRow[][] = series.map(() => categories.map(() => ({ k: null, s: null, tasks: 0, sums: [], counts: [] })));
  for (const row of input.rows) {
    const c = catIndex.get(xKey(row.k));
    if (c === undefined) continue;
    if (input.series) {
      const s = seriesOf(row);
      if (s >= 0) addInto(cells[s]![c]!, row);
    } else for (let s = 0; s < series.length; s += 1) addInto(cells[s]![c]!, row);
  }
  const values = series.map((_, s) => categories.map((__, c) => metricValue(config.metrics[input.series ? 0 : s]!.measure, cells[s]![c]!, input.series ? 0 : s)));
  const empty = values.every((list) => list.every((value) => !value));
  const formats = input.series ? series.map(() => input.formats[0]!) : input.formats;
  const total = config.style === "donut" ? round(values[0]!.reduce<number>((sum, value) => sum + (value ?? 0), 0)) : null;
  return { ...base, note, categories, series, values, formats, total, xLabel: input.x.label, yLabel, empty };
}

// Burnup (Total and Completed tasks at the end of each bucket) and burndown
// (Remaining, with an even "Ideal" line down to 0). `points` are tasks
// grouped by the India day they were created and completed (null: open).
export interface BurnPoint {
  created: string;
  completed: string | null;
  n: number;
}
// Rows worked out in code (formula fields): one per counted thing (a task,
// or a time entry) and grouping, with each metric's value; grouped like SQL would.
export interface RawRow {
  unit: number; // the task's (or the time entry's) id
  k: string | null;
  s: string | null;
  values: (number | null)[];
}
export function groupRows(rows: readonly RawRow[], metrics: number): GroupRow[] {
  const groups = new Map<string, GroupRow & { units: Set<number> }>();
  for (const row of rows) {
    const key = JSON.stringify([row.k, row.s]);
    let group = groups.get(key);
    if (!group) {
      group = { k: row.k, s: row.s, tasks: 0, sums: Array(metrics).fill(0), counts: Array(metrics).fill(0), units: new Set() };
      groups.set(key, group);
    }
    if (group.units.has(row.unit)) continue;
    group.units.add(row.unit);
    group.tasks += 1;
    row.values.forEach((value, index) => {
      if (value === null || !Number.isFinite(value)) return;
      group!.sums[index] = (group!.sums[index] ?? 0) + value;
      group!.counts[index] = (group!.counts[index] ?? 0) + 1;
    });
  }
  return [...groups.values()].map((group) => ({ k: group.k, s: group.s, tasks: group.tasks, sums: group.sums, counts: group.counts }));
}

export function burnSeries(points: readonly BurnPoint[], buckets: readonly Bucket[]): { total: number[]; completed: number[]; remaining: number[]; ideal: number[] } {
  const total = buckets.map((bucket) => points.reduce((sum, point) => sum + (point.created <= bucket.end ? point.n : 0), 0));
  const completed = buckets.map((bucket) => points.reduce((sum, point) => sum + (point.completed !== null && point.completed <= bucket.end && point.created <= bucket.end ? point.n : 0), 0));
  const remaining = total.map((value, index) => value - completed[index]!);
  const start = remaining[0] ?? 0;
  const steps = Math.max(1, buckets.length - 1);
  const ideal = buckets.map((_, index) => round(start - (start * index) / steps, 1));
  return { total, completed, remaining, ideal };
}
export function burnChart(config: ChartConfig, points: readonly BurnPoint[], buckets: readonly Bucket[]): ChartData {
  const burn = burnSeries(points, buckets);
  const up = config.style === "burnup";
  const series: ChartSeries[] = up
    ? [
        { key: "total", label: "Total", slot: 1 },
        { key: "completed", label: "Completed", slot: 2 },
      ]
    : [
        { key: "remaining", label: "Remaining", slot: 1 },
        { key: "ideal", label: "Ideal", slot: 2, dashed: true },
      ];
  const values = up ? [burn.total, burn.completed] : [burn.remaining, burn.ideal];
  return {
    style: config.style,
    categories: buckets.map((bucket) => ({ key: bucket.key, label: bucket.label })),
    series,
    values,
    formats: [{ kind: "count" }, { kind: "count" }],
    total: null,
    benchmark: null,
    dataLabels: config.dataLabels,
    percent: false,
    xLabel: "Date",
    yLabel: "Tasks",
    note: null,
    empty: burn.total.every((value) => value === 0),
  };
}

// ---- axis -------------------------------------------------------------------------------
// Clean ticks from 0 (or a negative minimum) to at least `max`: 1, 2, 2.5 or 5 × 10^n steps.
// Whole numbers only (counts) when `integer`: no "1.5 tasks".
export function niceTicks(min: number, max: number, count = 4, integer = false): number[] {
  const low = Math.min(0, min);
  const high = Math.max(low + 1, max);
  const raw = (high - low) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * power).find((candidate) => candidate >= raw) ?? raw;
  const step = integer ? Math.max(1, Math.ceil(nice)) : nice;
  const first = Math.floor(low / step) * step;
  const ticks: number[] = [];
  for (let value = first; value < high + step * 0.999 && ticks.length < 12; value += step) ticks.push(round(value, 6));
  return ticks;
}
export function shareOf(values: readonly (number | null)[], index: number): number {
  const total = values.reduce<number>((sum, value) => sum + Math.max(0, value ?? 0), 0);
  return total ? round((Math.max(0, values[index] ?? 0) / total) * 100, 1) : 0;
}

// ---- Workload -----------------------------------------------------------------------------
export const WORKLOAD_UNITS = ["day", "week"] as const;
export type WorkloadUnit = (typeof WORKLOAD_UNITS)[number];
export const WORKLOAD_SPAN: Record<WorkloadUnit, number> = { day: 14, week: 8 }; // columns shown
export const DEFAULT_CAPACITY = { count: 5, effort: 8 }; // tasks a day; hours (timer) or units (number) a day
export const CAPACITY_MAX = 10000;
export const capacitySchema = z.number().finite().min(0).max(CAPACITY_MAX);
export const metricKey = (fieldId: number | null) => (fieldId ? `f${fieldId}` : "count");
export const parseMetricKey = (value: unknown): number | null | undefined => (value === "count" || value === undefined || value === null || value === "" ? null : typeof value === "string" && /^f\d{1,10}$/.test(value) ? Number(value.slice(1)) : undefined);

export interface WorkloadColumn {
  key: string;
  label: string;
  days: string[];
  workDays: number; // working days in it (weekly offs and holidays excluded)
  off: boolean; // a day column that is a weekly off or holiday
  holiday: string | null;
}
export function workloadColumns(from: string, unit: WorkloadUnit, calendar: WorkCalendar, holidayNames: Readonly<Record<string, string>> = {}): WorkloadColumn[] {
  const start = mondayOf(from);
  return Array.from({ length: WORKLOAD_SPAN[unit] }, (_, index) => {
    const first = addDays(start, index * (unit === "day" ? 1 : 7));
    const days = unit === "day" ? [first] : Array.from({ length: 7 }, (__, d) => addDays(first, d));
    const workDays = days.filter((day) => isWorkDay(day, calendar, true)).length;
    return { key: first, label: bucketLabel(first, unit), days, workDays, off: unit === "day" && workDays === 0, holiday: unit === "day" ? (holidayNames[first] ?? (calendar.offDays.has(first) ? "Holiday" : null)) : null };
  });
}
// The days a task takes up: its working days from start (or due, without a
// start) to due. A task that falls only on off days sits on its due day.
export function taskDays(task: { start: string | null; due: string }, calendar: WorkCalendar): string[] {
  const first = task.start && task.start <= task.due ? task.start : task.due;
  const span = dayDiff(first, task.due);
  if (span > 366) return [task.due]; // a very long task: counted on its due day only
  const days: string[] = [];
  for (let index = 0; index <= span; index += 1) {
    const day = addDays(first, index);
    if (isWorkDay(day, calendar, true)) days.push(day);
  }
  return days.length ? days : [task.due];
}
// How much of a task falls on each of its days: task count counts it as 1 on
// every day; an effort is shared out evenly over its working days.
export function spreadLoad(task: { start: string | null; due: string; effort: number }, calendar: WorkCalendar, metric: "count" | "effort"): Map<string, number> {
  const days = taskDays(task, calendar);
  const each = metric === "count" ? 1 : task.effort / days.length;
  return new Map(days.map((day) => [day, each]));
}
// A cell's load: count = the tasks that touch it (each once); effort = the sum of shares.
export function cellLoad(tasks: readonly { id: number; load: ReadonlyMap<string, number> }[], days: readonly string[], metric: "count" | "effort"): { load: number; taskIds: number[] } {
  const ids: number[] = [];
  let load = 0;
  for (const task of tasks) {
    const share = days.reduce((sum, day) => sum + (task.load.get(day) ?? 0), 0);
    if (share <= 0) continue;
    ids.push(task.id);
    load += metric === "count" ? 1 : share;
  }
  return { load: round(load), taskIds: ids };
}
export const cellCapacity = (perDay: number, column: Pick<WorkloadColumn, "workDays">) => round(perDay * column.workDays);
export type CellState = "empty" | "ok" | "over";
// Over capacity: more than the capacity (any work on a day with no capacity is over).
export function cellState(load: number, capacity: number): CellState {
  if (load <= 0) return "empty";
  return load > capacity + 1e-9 ? "over" : "ok";
}
// A person's capacity per working day: their own, else the project's
// default for that metric, else the built-in default.
export function capacityFor(rows: readonly { userId: number | null; metric: string; perDay: number }[], userId: number, metric: string): { perDay: number; own: boolean } {
  const own = rows.find((row) => row.userId === userId && row.metric === metric);
  if (own) return { perDay: own.perDay, own: true };
  const project = rows.find((row) => row.userId === null && row.metric === metric);
  return { perDay: project ? project.perDay : metric === "count" ? DEFAULT_CAPACITY.count : DEFAULT_CAPACITY.effort, own: false };
}
