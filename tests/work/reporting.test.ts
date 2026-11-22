import { describe, expect, it } from "vitest";
import {
  assembleChart,
  bucketOf,
  burnChart,
  burnSeries,
  capacityFor,
  cellCapacity,
  cellLoad,
  cellState,
  chartConfigSchema,
  checkChartConfig,
  defaultWidgets,
  dueStatusOf,
  filterCount,
  filterCountText,
  groupRows,
  newChartConfig,
  niceTicks,
  parseMetricKey,
  rangeDays,
  shareOf,
  spreadLoad,
  taskDays,
  timeBuckets,
  workloadColumns,
  type FieldInfo,
  type GroupRow,
} from "@/server/work/reporting";
import { addableViews, allowedView } from "@/server/work/view-tabs";

// v1.67.0 (D-375): the dashboard's chart setup, the chart maths and the Workload maths.
const FIELDS: FieldInfo[] = [
  { id: 1, name: "Priority", type: "SELECT", options: [{ id: 11, name: "High" }] },
  { id: 2, name: "Cost", type: "NUMBER" },
  { id: 3, name: "Time spent", type: "TIMER" },
  { id: 4, name: "Notes", type: "TEXT" },
  { id: 5, name: "Margin", type: "FORMULA" },
  { id: 6, name: "Review date", type: "DATE" },
];
const cfg = (partial: Record<string, unknown>) => chartConfigSchema.parse(partial);
const row = (k: string | null, s: string | null, tasks: number, sums: number[] = [], counts: number[] = []): GroupRow => ({ k, s, tasks, sums, counts });

describe("chart setup checks", () => {
  it("accepts each chart family and tidies what the style doesn't use", () => {
    for (const style of ["bar", "line", "lollipop", "donut"]) expect(checkChartConfig({ style, x: { by: "section" } }, FIELDS).ok).toBe(true);
    const number = checkChartConfig({ style: "number", x: { by: "section" }, benchmark: 5, metrics: [{ measure: "count" }, { measure: "count" }] }, FIELDS);
    expect(number.ok && number.config).toMatchObject({ x: null, benchmark: null, metrics: [{ measure: "count", fieldId: null }] });
    const burn = checkChartConfig({ style: "burndown", metrics: [{ measure: "sum", fieldId: 2 }] }, FIELDS);
    expect(burn.ok && burn.config.metrics).toEqual([{ measure: "count", fieldId: null }]);
    const donut = checkChartConfig({ style: "donut", x: { by: "completion" }, benchmark: 3, percent: true }, FIELDS);
    expect(donut.ok && donut.config).toMatchObject({ benchmark: null, percent: true });
    const bar = checkChartConfig({ style: "bar", x: { by: "section" }, percent: true, benchmark: 4 }, FIELDS);
    expect(bar.ok && bar.config).toMatchObject({ percent: false, benchmark: 4 });
  });
  it("needs an X-axis, and a second grouping or metric for stacked and grouped bars", () => {
    expect(checkChartConfig({ style: "bar" }, FIELDS)).toMatchObject({ ok: false, message: "Choose the X-axis." });
    expect(checkChartConfig({ style: "donut" }, FIELDS)).toMatchObject({ ok: false });
    expect(checkChartConfig({ style: "stacked", x: { by: "section" } }, FIELDS)).toMatchObject({ ok: false });
    expect(checkChartConfig({ style: "stacked", x: { by: "section" }, series: { by: "completion" } }, FIELDS).ok).toBe(true);
    expect(checkChartConfig({ style: "grouped", x: { by: "section" }, metrics: [{ measure: "count" }, { measure: "sum", fieldId: 2 }] }, FIELDS).ok).toBe(true);
    expect(checkChartConfig({ style: "stacked", x: { by: "section" }, series: { by: "section" } }, FIELDS)).toMatchObject({ ok: false });
    // With a second grouping only one metric is kept.
    const one = checkChartConfig({ style: "grouped", x: { by: "section" }, series: { by: "assignee" }, metrics: [{ measure: "count" }, { measure: "sum", fieldId: 2 }] }, FIELDS);
    expect(one.ok && one.config.metrics).toHaveLength(1);
  });
  it("checks fields: axis fields must be select, people or date; metrics number, formula or timer", () => {
    expect(checkChartConfig({ style: "bar", x: { by: "field", fieldId: 1 } }, FIELDS).ok).toBe(true);
    expect(checkChartConfig({ style: "bar", x: { by: "field", fieldId: 6, unit: "month" } }, FIELDS).ok).toBe(true);
    expect(checkChartConfig({ style: "bar", x: { by: "field", fieldId: 4 } }, FIELDS).ok).toBe(false);
    expect(checkChartConfig({ style: "bar", x: { by: "field", fieldId: 99 } }, FIELDS).ok).toBe(false);
    for (const id of [2, 3, 5]) expect(checkChartConfig({ style: "bar", x: { by: "section" }, metrics: [{ measure: "avg", fieldId: id }] }, FIELDS).ok).toBe(true);
    expect(checkChartConfig({ style: "bar", x: { by: "section" }, metrics: [{ measure: "sum", fieldId: 4 }] }, FIELDS).ok).toBe(false);
    expect(checkChartConfig({ style: "bar", x: { by: "section" }, metrics: [{ measure: "sum" }] }, FIELDS).ok).toBe(false);
    // Filters: a known field and an operator it supports.
    expect(checkChartConfig({ style: "number", filters: { fields: [{ fieldId: 2, op: "gt", value: "5" }] } }, FIELDS).ok).toBe(true);
    expect(checkChartConfig({ style: "number", filters: { fields: [{ fieldId: 1, op: "gt", value: "5" }] } }, FIELDS).ok).toBe(false);
    expect(checkChartConfig({ style: "number", filters: { fields: [{ fieldId: 77, op: "empty", value: "" }] } }, FIELDS).ok).toBe(false);
  });
  it("time entries: timer fields only, no burn charts, the logger as a grouping", () => {
    expect(checkChartConfig({ style: "bar", source: "time", x: { by: "person" }, metrics: [{ measure: "sum" }] }, FIELDS).ok).toBe(true);
    expect(checkChartConfig({ style: "bar", source: "time", timerFieldId: 3, x: { by: "person" } }, FIELDS).ok).toBe(true);
    expect(checkChartConfig({ style: "bar", source: "time", timerFieldId: 2, x: { by: "person" } }, FIELDS).ok).toBe(false);
    expect(checkChartConfig({ style: "burnup", source: "time" }, FIELDS).ok).toBe(false);
    expect(checkChartConfig({ style: "bar", x: { by: "person" } }, FIELDS).ok).toBe(false);
  });
  it("refuses junk and more than four metrics", () => {
    expect(checkChartConfig({ style: "pie" }, FIELDS).ok).toBe(false);
    expect(checkChartConfig(null, FIELDS).ok).toBe(false);
    expect(checkChartConfig({ style: "bar", x: { by: "section" }, metrics: Array(5).fill({ measure: "count" }) }, FIELDS).ok).toBe(false);
    expect(checkChartConfig({ style: "bar", x: { by: "section" }, filters: { fields: Array(11).fill({ fieldId: 2, op: "empty" }) } }, FIELDS).ok).toBe(false);
  });
  it("counts filters for the footer", () => {
    expect(filterCount(cfg({ style: "number" }).filters)).toBe(0);
    expect(filterCount(cfg({ style: "number", filters: { completion: "open", types: ["TASK"], fields: [{ fieldId: 2, op: "empty" }] } }).filters)).toBe(3);
    expect([0, 1, 2].map(filterCountText)).toEqual(["No filters", "1 filter", "2 filters"]);
  });
});

describe("default widgets (spec SBX41)", () => {
  it("are 4 number cards and 4 charts with the spec's filters", () => {
    const seeds = defaultWidgets();
    expect(seeds).toHaveLength(8);
    expect(seeds.slice(0, 4).every((seed) => seed.config?.style === "number")).toBe(true);
    expect(seeds.map((seed) => seed.title)).toEqual([
      "Total completed tasks",
      "Total incomplete tasks",
      "Total overdue tasks",
      "Total tasks",
      "Incomplete tasks by section",
      "Tasks by completion status",
      "Upcoming tasks by assignee",
      "Task completion over time",
    ]);
    expect(seeds.map((seed) => filterCount(seed.config!.filters))).toEqual([1, 1, 1, 0, 2, 1, 2, 0]);
    for (const seed of seeds) expect(checkChartConfig(seed.config, []).ok).toBe(true);
  });
  it("a new chart is a bar by the first single-select field, else by section (AC-PROJV-22)", () => {
    expect(newChartConfig(FIELDS)).toMatchObject({ title: "Total tasks by Priority", config: { style: "bar", x: { by: "field", fieldId: 1 }, dataLabels: true } });
    expect(newChartConfig([])).toMatchObject({ title: "Total tasks by section", config: { x: { by: "section" } } });
  });
});

describe("chart maths", () => {
  it("adds up counts, sums and averages; orders keys naturally; 'no value' last", () => {
    const config = cfg({ style: "bar", x: { by: "section" }, metrics: [{ measure: "count" }, { measure: "sum", fieldId: 2 }, { measure: "avg", fieldId: 2 }] });
    const data = assembleChart({
      config,
      rows: [row("20", null, 2, [10, 10, 10], [2, 2, 2]), row("10", null, 3, [9, 9, 9], [3, 3, 3]), row(null, null, 1, [0, 0, 0], [0, 0, 0])],
      x: { natural: [{ key: "10", label: "To do" }, { key: "20", label: "Doing" }], none: "No section", fill: false, label: "Section" },
      series: null,
      metricLabels: ["Tasks", "Total Cost", "Average Cost"],
      formats: [{ kind: "count" }, { kind: "count" }, { kind: "count" }],
    });
    expect(data.categories.map((item) => item.label)).toEqual(["To do", "Doing", "No section"]);
    expect(data.values).toEqual([
      [3, 2, 1],
      [9, 10, 0],
      [3, 5, null],
    ]);
    expect(data.series.map((item) => item.slot)).toEqual([1, 2, 3]);
    expect(data.empty).toBe(false);
  });
  it("number widgets add every row; averages are weighted by values, not rows", () => {
    const data = assembleChart({ config: cfg({ style: "number", metrics: [{ measure: "avg", fieldId: 2 }] }), rows: [row("a", null, 1, [10], [1]), row("b", null, 3, [2], [3])], x: null, series: null, metricLabels: ["Average"], formats: [{ kind: "count" }] });
    expect(data.total).toBe(3);
  });
  it("folds a ninth series into Other (slot 8) with correct averages, colours in natural order", () => {
    const natural = Array.from({ length: 10 }, (_, index) => ({ key: `s${index}`, label: `S${index}` }));
    const rows = natural.map((item, index) => row("x", item.key, 1, [index], [1]));
    const data = assembleChart({ config: cfg({ style: "stacked", x: { by: "section" }, series: { by: "assignee" }, metrics: [{ measure: "avg", fieldId: 2 }] }), rows, x: { natural: [{ key: "x", label: "X" }], none: "-", fill: false, label: "Section" }, series: { natural, none: "Nobody" }, metricLabels: ["Average"], formats: [{ kind: "count" }] });
    expect(data.series).toHaveLength(8);
    expect(data.series.at(-1)).toMatchObject({ label: "Other (3)", slot: 8 });
    expect(data.values.at(-1)).toEqual([8]); // (7 + 8 + 9) / 3
    expect(data.series.slice(0, 7).map((item) => item.slot)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it("donut: slices past eight fold into Other; total in the centre; shares", () => {
    const natural = Array.from({ length: 9 }, (_, index) => ({ key: `k${index}`, label: `K${index}` }));
    const data = assembleChart({ config: cfg({ style: "donut", x: { by: "assignee" } }), rows: natural.map((item) => row(item.key, null, 2)), x: { natural, none: "-", fill: false, label: "Assignee" }, series: null, metricLabels: ["Tasks"], formats: [{ kind: "count" }] });
    expect(data.categories).toHaveLength(8);
    expect(data.values[0]!.at(-1)).toBe(4);
    expect(data.total).toBe(18);
    expect(shareOf([1, 3], 1)).toBe(75);
    expect(shareOf([0, 0], 0)).toBe(0);
  });
  it("date buckets fill every bucket of the range and leave rows outside it out", () => {
    const { buckets } = timeBuckets("2026-11-02", "2026-11-15", "week");
    const data = assembleChart({ config: cfg({ style: "line", x: { by: "date", unit: "week" } }), rows: [row("2026-11-09", null, 4), row("2026-10-01", null, 9)], x: { natural: buckets.map((bucket) => ({ key: bucket.key, label: bucket.label })), none: "No date", fill: true, label: "Due date" }, series: null, metricLabels: ["Tasks"], formats: [{ kind: "count" }] });
    expect(data.values).toEqual([[0, 4]]);
    expect(data.categories.map((item) => item.label)).toEqual(["Week of 2 Nov", "Week of 9 Nov"]);
  });
  it("caps categories at 50 with a note, and says when nothing is there", () => {
    const natural = Array.from({ length: 60 }, (_, index) => ({ key: String(index), label: `P${index}` }));
    const data = assembleChart({ config: cfg({ style: "bar", x: { by: "assignee" } }), rows: natural.map((item) => row(item.key, null, 1)), x: { natural, none: "-", fill: false, label: "Assignee" }, series: null, metricLabels: ["Tasks"], formats: [{ kind: "count" }] });
    expect(data.categories).toHaveLength(50);
    expect(data.note).toContain("first 50 of 60");
    expect(assembleChart({ config: cfg({ style: "bar", x: { by: "assignee" } }), rows: [], x: { natural: [], none: "-", fill: false, label: "A" }, series: null, metricLabels: ["Tasks"], formats: [{ kind: "count" }] }).empty).toBe(true);
  });
  it("groups rows worked out in code like SQL would (each counted thing once a group)", () => {
    const grouped = groupRows(
      [
        { unit: 1, k: "a", s: null, values: [5] },
        { unit: 1, k: "a", s: null, values: [5] },
        { unit: 2, k: "a", s: null, values: [null] },
        { unit: 3, k: "b", s: null, values: [2] },
      ],
      1,
    );
    expect(grouped).toEqual([
      { k: "a", s: null, tasks: 2, sums: [5], counts: [1] },
      { k: "b", s: null, tasks: 1, sums: [2], counts: [1] },
    ]);
  });
  it("burnup and burndown series", () => {
    const { buckets } = timeBuckets("2026-11-01", "2026-11-04", "day");
    const points = [
      { created: "2026-10-20", completed: "2026-11-02", n: 1 },
      { created: "2026-11-01", completed: null, n: 1 },
      { created: "2026-11-03", completed: "2026-11-04", n: 2 },
    ];
    const burn = burnSeries(points, buckets);
    expect(burn.total).toEqual([2, 2, 4, 4]);
    expect(burn.completed).toEqual([0, 1, 1, 3]);
    expect(burn.remaining).toEqual([2, 1, 3, 1]);
    expect(burn.ideal).toEqual([2, 1.3, 0.7, 0]);
    const up = burnChart(cfg({ style: "burnup" }), points, buckets);
    expect(up.series.map((item) => item.label)).toEqual(["Total", "Completed"]);
    const down = burnChart(cfg({ style: "burndown" }), points, buckets);
    expect(down.series.map((item) => [item.label, Boolean(item.dashed)])).toEqual([
      ["Remaining", false],
      ["Ideal", true],
    ]);
    expect(burnChart(cfg({ style: "burnup" }), [], buckets).empty).toBe(true);
  });
  it("buckets, ranges and due statuses", () => {
    expect(bucketOf("2026-11-22", "week")).toBe("2026-11-16"); // a Sunday → its Monday
    expect(bucketOf("2026-11-22", "month")).toBe("2026-11-01");
    expect(timeBuckets("2026-01-01", "2026-12-31", "day").unit).toBe("week"); // 365 days is too many
    expect(timeBuckets("2020-01-01", "2026-12-31", "day").unit).toBe("month");
    expect(rangeDays("30d", "2026-11-22", { startOn: null, dueOn: null, createdOn: "2026-01-01" })).toEqual({ from: "2026-10-24", to: "2026-11-22" });
    expect(rangeDays("next30", "2026-11-22", { startOn: null, dueOn: null, createdOn: "2026-01-01" })).toEqual({ from: "2026-11-22", to: "2026-12-21" });
    expect(rangeDays("project", "2026-11-22", { startOn: "2026-11-01", dueOn: "2027-01-31", createdOn: "2026-10-01" })).toEqual({ from: "2026-11-01", to: "2027-01-31" });
    expect(rangeDays("project", "2026-11-22", { startOn: null, dueOn: null, createdOn: "2026-10-01" })).toEqual({ from: "2026-10-01", to: "2026-11-22" });
    expect(["2026-11-20", "2026-11-22", "2026-11-25", "2026-12-20"].map((day) => dueStatusOf(day, "2026-11-22", false))).toEqual(["overdue", "today", "week", "later"]);
    expect(dueStatusOf("2026-11-20", "2026-11-22", true)).toBe("done");
    expect(dueStatusOf(null, "2026-11-22", false)).toBe("none");
  });
  it("clean axis ticks", () => {
    expect(niceTicks(0, 7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(0, 1)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(niceTicks(-3, 9)[0]).toBeLessThanOrEqual(-3);
    expect(niceTicks(0, 12000).at(-1)).toBeGreaterThanOrEqual(12000);
    expect(niceTicks(0, 2, 4, true)).toEqual([0, 1, 2]); // counts: whole numbers only
  });
});

describe("Workload maths", () => {
  // Weekly offs Sat (6) and Sun (0); a holiday on Wed 25 Nov 2026.
  const calendar = { offDays: new Set(["2026-11-25"]), workingWeekdays: new Set([1, 2, 3, 4, 5]) };
  it("columns from the Monday, with working days, offs and holidays", () => {
    const days = workloadColumns("2026-11-26", "day", calendar, { "2026-11-25": "Diwali" });
    expect(days).toHaveLength(14);
    expect(days[0]!.key).toBe("2026-11-23");
    expect(days.filter((column) => column.off).map((column) => column.key)).toEqual(["2026-11-25", "2026-11-28", "2026-11-29", "2026-12-05", "2026-12-06"]);
    expect(days[2]!.holiday).toBe("Diwali");
    const weeks = workloadColumns("2026-11-26", "week", calendar);
    expect(weeks).toHaveLength(8);
    expect(weeks[0]!.workDays).toBe(4);
    expect(weeks[1]!.workDays).toBe(5);
  });
  it("a task takes up its working days from start to due; only off days → its due day", () => {
    expect(taskDays({ start: "2026-11-23", due: "2026-11-27" }, calendar)).toEqual(["2026-11-23", "2026-11-24", "2026-11-26", "2026-11-27"]);
    expect(taskDays({ start: null, due: "2026-11-24" }, calendar)).toEqual(["2026-11-24"]);
    expect(taskDays({ start: "2026-11-28", due: "2026-11-29" }, calendar)).toEqual(["2026-11-29"]);
    expect(taskDays({ start: "2026-12-01", due: "2026-11-24" }, calendar)).toEqual(["2026-11-24"]); // start after due: the due day
  });
  it("count counts 1 a day; effort is shared evenly", () => {
    expect([...spreadLoad({ start: "2026-11-23", due: "2026-11-24", effort: 0 }, calendar, "count").values()]).toEqual([1, 1]);
    expect([...spreadLoad({ start: "2026-11-23", due: "2026-11-27", effort: 8 }, calendar, "effort").values()]).toEqual([2, 2, 2, 2]);
  });
  it("cells: count tasks once per cell, effort adds shares; capacity per working day; over capacity", () => {
    const tasks = [
      { id: 1, load: spreadLoad({ start: "2026-11-23", due: "2026-11-27", effort: 8 }, calendar, "effort") },
      { id: 2, load: spreadLoad({ start: null, due: "2026-11-24", effort: 3 }, calendar, "effort") },
    ];
    expect(cellLoad(tasks, ["2026-11-24"], "effort")).toEqual({ load: 5, taskIds: [1, 2] });
    const week = ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"];
    expect(cellLoad(tasks, week, "effort")).toEqual({ load: 11, taskIds: [1, 2] });
    expect(cellLoad(tasks, week, "count")).toEqual({ load: 2, taskIds: [1, 2] });
    expect(cellCapacity(8, { workDays: 4 })).toBe(32);
    expect(cellState(0, 5)).toBe("empty");
    expect(cellState(5, 5)).toBe("ok");
    expect(cellState(5.5, 5)).toBe("over");
    expect(cellState(1, 0)).toBe("over"); // work on a day with no capacity
  });
  it("capacity: the person's own, else the project's, else the default", () => {
    const rows = [
      { userId: null, metric: "count", perDay: 3 },
      { userId: 7, metric: "count", perDay: 6 },
      { userId: 7, metric: "f2", perDay: 4 },
    ];
    expect(capacityFor(rows, 7, "count")).toEqual({ perDay: 6, own: true });
    expect(capacityFor(rows, 8, "count")).toEqual({ perDay: 3, own: false });
    expect(capacityFor(rows, 8, "f2")).toEqual({ perDay: 8, own: false });
    expect(capacityFor([], 8, "count")).toEqual({ perDay: 5, own: false });
    expect([parseMetricKey("count"), parseMetricKey("f12"), parseMetricKey("x1"), parseMetricKey(undefined)]).toEqual([null, 12, undefined, null]);
  });
});

describe("tab catalogue", () => {
  it("offers Dashboard and Workload only with the pm_reporting switch on", () => {
    expect(addableViews("PROJECT", true, false).map((entry) => entry.type)).not.toContain("DASHBOARD");
    expect(addableViews("PROJECT", false, true).map((entry) => entry.type)).toEqual(expect.arrayContaining(["DASHBOARD", "WORKLOAD"]));
    expect(addableViews("MY_TASKS", true, true).map((entry) => entry.type)).not.toContain("WORKLOAD");
    expect(allowedView("PROJECT", "DASHBOARD", false, false)).toBe(false);
    expect(allowedView("PROJECT", "WORKLOAD", false, true)).toBe(true);
    // v1.78.0 (D-405): a Task Summary may have a Dashboard tab, never a Workload one.
    expect(allowedView("MY_TASKS", "DASHBOARD", true, true)).toBe(true);
    expect(allowedView("MY_TASKS", "DASHBOARD", true, false)).toBe(false);
    expect(allowedView("MY_TASKS", "WORKLOAD", true, true)).toBe(false);
  });
});
