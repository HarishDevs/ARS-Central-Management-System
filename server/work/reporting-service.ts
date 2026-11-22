import "server-only";
import { getDbPool } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import * as repo from "@/lib/db/repositories/work.repository";
import * as fieldsRepo from "@/lib/db/repositories/fields.repository";
import * as reports from "@/lib/db/repositories/reporting.repository";
import type { FieldRecord } from "@/lib/db/repositories/fields.repository";
import type { TaskActor } from "@/server/modules/tasks";
import { featureOn } from "@/server/settings/features";
import { projectAbilities } from "@/server/work/access";
import { matchFieldFilter, type FieldFilter } from "@/server/work/custom-fields";
import { cellsFor } from "@/server/work/fields-service";
import { indiaDay } from "@/server/work/rules";
import { workCalendar } from "@/server/work/schedule-service";
import { calendarHolidays } from "@/server/work/holiday-store";
import { workViewer } from "@/server/work/task-access";
import {
  assembleChart,
  bucketLabel,
  burnChart,
  capacityFor,
  capacitySchema,
  cellCapacity,
  cellLoad,
  cellState,
  checkChartConfig,
  COMPLETION_LABEL,
  DATE_FIELD_LABEL,
  defaultWidgets,
  DIMENSION_LABEL,
  DUE_STATUS_LABEL,
  DUE_STATUSES,
  filterCount,
  groupRows,
  MAX_WIDGETS,
  metricKey,
  parseMetricKey,
  rangeDays,
  round,
  spreadLoad,
  TASK_TYPE_LABEL,
  TEXT_BODY_MAX,
  timeBuckets,
  WIDGET_TITLE_MAX,
  workloadColumns,
  type CellState,
  type ChartConfig,
  type ChartData,
  type ChartDimension,
  type FieldInfo,
  type GroupRow,
  type KeyLabel,
  type ValueFormat,
  type WidgetSeed,
  type WorkloadColumn,
  type WorkloadUnit,
} from "@/server/work/reporting";

// v1.67.0 (D-375, PM phase D part 1): project dashboards and Workload.
// Every operation checks the "pm_reporting" switch and the person's sight of
// the project on the server (deny by default: a project they can't see is
// "Not found."). Everyone who sees the project sees its dashboard and
// workload; its owners and editors change widgets and capacity. Figures only
// count tasks the person may see (the repository's visibleTaskClause).
type Result<T = undefined> = { ok: true; value: T; message?: string } | { ok: false; message: string };
const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });
const NOT_FOUND = "Not found.";
const OFF = "Dashboards and Workload aren't switched on yet.";
const ONLY_EDITORS = "Only the project's owners and editors change its dashboard.";

export async function reportingOn(actor: { roles: readonly string[] }): Promise<boolean> {
  return featureOn("pm_reporting", actor).catch(() => false);
}
async function access(projectId: number, actor: TaskActor) {
  const viewer = await workViewer(actor);
  const found = await repo.projectFor(projectId, viewer);
  if (!found || found.project.isTemplate || found.project.deletedAt) return null;
  return { ...found, viewer, edit: projectAbilities(found.role).edit };
}
type Access = NonNullable<Awaited<ReturnType<typeof access>>>;
const fieldInfo = (field: FieldRecord): FieldInfo => ({ id: field.id, name: field.name, type: field.type, config: field.config, options: field.options.filter((option) => !option.archived).map((option) => ({ id: option.id, name: option.name })) });
const audit = (actor: TaskActor, projectId: number, metadata: Record<string, unknown>) =>
  recordAudit({ actorUserId: actor.id, action: "WORK_DASHBOARD_CHANGED", entityType: "PROJECT", entityId: projectId, ipAddress: actor.ipAddress ?? null, sessionId: actor.sessionId ?? null, metadata });

// ---- charts ---------------------------------------------------------------------------------
const CODE_FILTER_TYPES = new Set(["FORMULA", "LOOKUP", "REFERENCE"]);
function metricLabel(config: ChartConfig, index: number, fields: ReadonlyMap<number, FieldRecord>): string {
  const metric = config.metrics[index]!;
  if (config.source === "time") return metric.measure === "count" ? "Time entries" : metric.measure === "sum" ? "Hours" : "Average hours an entry";
  if (metric.measure === "count") return "Tasks";
  const name = fields.get(metric.fieldId ?? 0)?.name ?? "field";
  return metric.measure === "sum" ? `Total ${name}` : `Average ${name}`;
}
function metricFormat(config: ChartConfig, index: number, fields: ReadonlyMap<number, FieldRecord>): ValueFormat {
  const metric = config.metrics[index]!;
  if (metric.measure === "count") return { kind: "count" };
  if (config.source === "time") return { kind: "hours" };
  const field = fields.get(metric.fieldId ?? 0);
  if (!field || field.type === "TIMER") return { kind: "hours" };
  return { kind: "field", config: field.config };
}
function dimensionLabel(dim: ChartDimension, fields: ReadonlyMap<number, FieldRecord>, unit: string): string {
  if (dim.by === "field") return fields.get(dim.fieldId ?? 0)?.name ?? "Field";
  if (dim.by === "date") return `${DATE_FIELD_LABEL[dim.dateField]} (${unit})`;
  return DIMENSION_LABEL[dim.by];
}

// The known values of a grouping in their natural order, with labels.
async function naturalKeys(dim: ChartDimension, projectId: number, fields: ReadonlyMap<number, FieldRecord>, keys: readonly (string | null)[], unit: string): Promise<{ natural: KeyLabel[]; none: string }> {
  const present = keys.filter((key): key is string => key !== null);
  switch (dim.by) {
    case "assignee":
    case "creator":
    case "person": {
      const names = await reports.peopleNames([...new Set(present.map(Number))]);
      return { natural: [...names].map(([id, name]) => ({ key: String(id), label: name })).sort((a, b) => a.label.localeCompare(b.label)), none: "Nobody" };
    }
    case "section":
      return { natural: (await repo.listSections(projectId)).map((section) => ({ key: String(section.id), label: section.name })), none: "No section" };
    case "type":
      return { natural: (["TASK", "MILESTONE"] as const).map((key) => ({ key, label: TASK_TYPE_LABEL[key] })), none: "—" };
    case "completion":
      return { natural: (["done", "open"] as const).map((key) => ({ key, label: COMPLETION_LABEL[key] })), none: "—" };
    case "dueStatus":
      return { natural: DUE_STATUSES.map((key) => ({ key, label: DUE_STATUS_LABEL[key] })), none: "—" };
    case "date":
      return { natural: [...new Set(present)].sort().map((key) => ({ key, label: bucketLabel(key, unit as "day") })), none: "No date" };
    case "field": {
      const field = fields.get(dim.fieldId ?? 0);
      const none = `No ${field?.name ?? "value"}`;
      if (!field) return { natural: [], none };
      if (field.type === "SELECT" || field.type === "MULTI_SELECT") return { natural: field.options.map((option) => ({ key: String(option.id), label: option.name })), none };
      if (field.type === "PEOPLE") {
        const names = await reports.peopleNames([...new Set(present.map(Number))]);
        return { natural: [...names].map(([id, name]) => ({ key: String(id), label: name })).sort((a, b) => a.label.localeCompare(b.label)), none };
      }
      return { natural: [...new Set(present)].sort().map((key) => ({ key, label: bucketLabel(key, unit as "day") })), none };
    }
  }
}
const isDateDim = (dim: ChartDimension | null, fields: ReadonlyMap<number, FieldRecord>) => Boolean(dim && (dim.by === "date" || (dim.by === "field" && fields.get(dim.fieldId ?? 0)?.type === "DATE")));

// Works out one chart for the person. Grouped figures come from MySQL
// (GROUP BY); only formula metrics and formula/lookup/reference filters are
// worked out in code, from the same visible task rows.
export async function computeChart(config: ChartConfig, found: Pick<Access, "project" | "viewer">, actorId: number, now = new Date()): Promise<ChartData> {
  const projectId = found.project.id;
  const defs = await fieldsRepo.listFieldDefs(projectId);
  const fields = new Map(defs.map((field) => [field.id, field]));
  const today = indiaDay(now);
  const codeFilters = config.filters.fields.filter((filter) => CODE_FILTER_TYPES.has(fields.get(filter.fieldId)?.type ?? ""));
  const codeMetrics = config.metrics.map((metric) => (metric.measure !== "count" && fields.get(metric.fieldId ?? 0)?.type === "FORMULA" ? metric.fieldId : null));
  const range = rangeDays(config.range, today, { startOn: found.project.startOn, dueOn: found.project.dueOn, createdOn: indiaDay(found.project.createdAt) });
  const xDate = isDateDim(config.x, fields);
  const xBuckets = config.x && xDate ? timeBuckets(range.from, range.to, config.x.unit) : null;
  const spec: reports.FigureSpec = {
    projectId,
    viewer: found.viewer,
    today,
    config,
    fields,
    xUnit: xBuckets?.unit ?? null,
    codeFilterIds: new Set(codeFilters.map((filter) => filter.fieldId)),
  };
  const viewer = { ...found.viewer, id: actorId };
  // Tasks that pass the filters worked out in code, and formula values.
  const codeCells = async (taskIds: number[]) => {
    const needed = new Set([...codeFilters.map((filter) => filter.fieldId), ...codeMetrics.filter((id): id is number => id !== null)]);
    return cellsFor([...new Set(taskIds)], defs.filter((field) => needed.has(field.id)), viewer, now);
  };
  const passes = (cells: Awaited<ReturnType<typeof codeCells>>, taskId: number) => codeFilters.every((filter: FieldFilter) => matchFieldFilter(fields.get(filter.fieldId)!.type, cells[taskId]?.[filter.fieldId], filter, actorId));

  if (config.style === "burnup" || config.style === "burndown") {
    let rows = await reports.burnFigures(spec);
    if (codeFilters.length) {
      const cells = await codeCells(rows.map((row) => row.taskId));
      rows = rows.filter((row) => passes(cells, row.taskId));
    }
    const { buckets } = timeBuckets(range.from, range.to, "day");
    return burnChart(config, rows.map((row) => ({ created: row.created, completed: row.completed, n: 1 })), buckets);
  }

  let groups: GroupRow[];
  if (codeFilters.length || codeMetrics.some((id) => id !== null)) {
    const raw = await reports.rawFigures(spec);
    const cells = await codeCells(raw.map((row) => row.taskId));
    groups = groupRows(
      raw
        .filter((row) => passes(cells, row.taskId))
        .map((row) => ({
          unit: row.unit,
          k: row.k,
          s: row.s,
          values: row.values.map((value, index) => {
            const formula = codeMetrics[index];
            if (!formula) return value;
            const sort = cells[row.taskId]?.[formula]?.sort;
            return typeof sort === "number" ? sort : null;
          }),
        })),
      config.metrics.length,
    );
  } else groups = await reports.groupedFigures(spec);

  const metricLabels = config.metrics.map((_, index) => metricLabel(config, index, fields));
  const formats = config.metrics.map((_, index) => metricFormat(config, index, fields));
  const xUnit = xBuckets?.unit ?? config.x?.unit ?? "week";
  const x = config.x
    ? xBuckets
      ? { natural: xBuckets.buckets.map((bucket) => ({ key: bucket.key, label: bucket.label })), none: "No date", fill: true, label: dimensionLabel(config.x, fields, xUnit) }
      : { ...(await naturalKeys(config.x, projectId, fields, groups.map((row) => row.k), xUnit)), fill: false, label: dimensionLabel(config.x, fields, xUnit) }
    : null;
  const series = config.series ? await naturalKeys(config.series, projectId, fields, groups.map((row) => row.s), config.series.unit) : null;
  const data = assembleChart({ config, rows: groups.map((row) => ({ ...row, sums: row.sums.map((value) => round(value, 4)) })), x, series, metricLabels, formats });
  if (xBuckets && config.x && xBuckets.unit !== config.x.unit) data.note = `Shown ${xBuckets.unit === "week" ? "by week" : "by month"}: too many ${config.x.unit}s for this range.`;
  return data;
}

// ---- the dashboard ----------------------------------------------------------------------------
export interface WidgetView {
  id: number;
  kind: "CHART" | "TEXT";
  title: string;
  size: "HALF" | "FULL";
  body: string | null;
  config: ChartConfig | null;
  filters: number;
  data: ChartData | null;
  error: string | null;
  rowVersion: number;
}
export interface DashboardView {
  widgets: WidgetView[];
  fields: FieldInfo[];
  sections: { id: number; name: string }[];
  people: { id: number; name: string }[];
  canEdit: boolean;
  max: number;
}
// Writes the 8 default widgets the first time a dashboard is opened.
async function ensureDefaults(projectId: number): Promise<void> {
  await withTransaction(async (connection) => {
    if (await reports.lockDashboard(projectId, connection)) return;
    for (const [index, seed] of defaultWidgets().entries()) await reports.insertWidget(projectId, seed, (index + 1) * 1024, null, connection);
    await reports.markDashboardSet(projectId, connection);
  });
}
export async function loadDashboard(projectId: number, actor: TaskActor, now = new Date()): Promise<Result<DashboardView>> {
  if (!(await reportingOn(actor))) return fail(OFF);
  const found = await access(projectId, actor);
  if (!found) return fail(NOT_FOUND);
  await ensureDefaults(projectId);
  const [widgets, defs, sections, people] = await Promise.all([reports.listWidgets(projectId), fieldsRepo.listFieldDefs(projectId), repo.listSections(projectId), reports.projectPeople(projectId)]);
  const views: WidgetView[] = [];
  for (const widget of widgets) {
    let data: ChartData | null = null;
    let error: string | null = null;
    if (widget.kind === "CHART") {
      // A chart whose field was removed since: shown with a message, not an error page.
      const checked = widget.config ? checkChartConfig(widget.config, defs.map(fieldInfo)) : null;
      if (!checked?.ok) error = checked?.message ?? "This chart's setup can't be read.";
      else data = await computeChart(checked.config, found, actor.id, now);
    }
    views.push({ id: widget.id, kind: widget.kind, title: widget.title, size: widget.size, body: widget.body, config: widget.config, filters: widget.config ? filterCount(widget.config.filters) : 0, data, error, rowVersion: widget.rowVersion });
  }
  return { ok: true, value: { widgets: views, fields: defs.map(fieldInfo), sections: sections.map((section) => ({ id: section.id, name: section.name })), people, canEdit: found.edit, max: MAX_WIDGETS } };
}

// The builder's live preview (anyone who sees the project; nothing is stored).
export async function previewChart(projectId: number, raw: unknown, actor: TaskActor): Promise<Result<ChartData>> {
  if (!(await reportingOn(actor))) return fail(OFF);
  const found = await access(projectId, actor);
  if (!found) return fail(NOT_FOUND);
  const checked = checkChartConfig(raw, (await fieldsRepo.listFieldDefs(projectId)).map(fieldInfo));
  if (!checked.ok) return checked;
  return { ok: true, value: await computeChart(checked.config, found, actor.id) };
}

export interface WidgetInput {
  id?: number | null;
  kind: "CHART" | "TEXT";
  title: string;
  config?: unknown;
  body?: string | null;
  size?: "HALF" | "FULL";
  rowVersion?: number | null;
}
const cleanTitle = (raw: unknown) => (typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim() : "");
const cleanBody = (raw: unknown) => (typeof raw === "string" ? raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n/g, "\n").trim() : "");

// Add or save a widget (owners and editors; at most 20 a dashboard).
export async function saveWidget(projectId: number, input: WidgetInput, actor: TaskActor): Promise<Result<{ id: number }>> {
  if (!(await reportingOn(actor))) return fail(OFF);
  const found = await access(projectId, actor);
  if (!found) return fail(NOT_FOUND);
  if (!found.edit) return fail(ONLY_EDITORS);
  if (input.kind !== "CHART" && input.kind !== "TEXT") return fail("That widget isn't valid.");
  const title = cleanTitle(input.title);
  if (!title) return fail("Give the widget a title.");
  if (title.length > WIDGET_TITLE_MAX) return fail(`Use ${WIDGET_TITLE_MAX} characters or fewer for the title.`);
  const size = input.size === "FULL" ? "FULL" : "HALF";
  let config: ChartConfig | null = null;
  let body: string | null = null;
  if (input.kind === "CHART") {
    const checked = checkChartConfig(input.config, (await fieldsRepo.listFieldDefs(projectId)).map(fieldInfo));
    if (!checked.ok) return checked;
    config = checked.config;
  } else {
    body = cleanBody(input.body);
    if (!body) return fail("Write something in the text widget.");
    if (body.length > TEXT_BODY_MAX) return fail(`Use ${TEXT_BODY_MAX} characters or fewer.`);
  }
  await ensureDefaults(projectId);
  const outcome = await withTransaction(async (connection): Promise<Result<{ id: number }>> => {
    await reports.lockDashboard(projectId, connection);
    const widgets = await reports.listWidgets(projectId, connection);
    if (input.id) {
      const current = widgets.find((widget) => widget.id === input.id);
      if (!current) return fail(NOT_FOUND);
      if (current.kind !== input.kind) return fail("That widget isn't valid.");
      const saved = await reports.updateWidget(current.id, { title, config, body, size }, typeof input.rowVersion === "number" ? input.rowVersion : null, actor.id, connection);
      if (!saved) return fail("Someone changed this widget meanwhile. Close it and try again.");
      return { ok: true, value: { id: current.id }, message: input.kind === "CHART" ? "Chart saved." : "Text saved." };
    }
    if (widgets.length >= MAX_WIDGETS) return fail(`A dashboard has at most ${MAX_WIDGETS} widgets. Remove one first.`);
    const seed: WidgetSeed = { kind: input.kind, title, config, body, size };
    const position = (widgets.at(-1)?.position ?? 0) + 1024;
    const id = await reports.insertWidget(projectId, seed, position, actor.id, connection);
    return { ok: true, value: { id }, message: input.kind === "CHART" ? "Chart added." : "Text added." };
  });
  if (outcome.ok) await audit(actor, projectId, { op: input.id ? "SAVE" : "ADD", widgetId: outcome.value.id, kind: input.kind, style: config?.style ?? null });
  return outcome;
}

export async function removeWidget(projectId: number, widgetId: number, actor: TaskActor): Promise<Result> {
  if (!(await reportingOn(actor))) return fail(OFF);
  const found = await access(projectId, actor);
  if (!found) return fail(NOT_FOUND);
  if (!found.edit) return fail(ONLY_EDITORS);
  const widget = await reports.findWidget(widgetId);
  if (!widget || widget.projectId !== projectId) return fail(NOT_FOUND);
  await withTransaction((connection) => reports.deleteWidget(widgetId, connection));
  await audit(actor, projectId, { op: "REMOVE", widgetId, title: widget.title });
  return { ok: true, value: undefined, message: "Widget removed." };
}

// New order of every widget (drag or keyboard move): the same widgets, each once.
export async function moveWidgets(projectId: number, ids: readonly number[], actor: TaskActor): Promise<Result> {
  if (!(await reportingOn(actor))) return fail(OFF);
  const found = await access(projectId, actor);
  if (!found) return fail(NOT_FOUND);
  if (!found.edit) return fail(ONLY_EDITORS);
  return withTransaction(async (connection): Promise<Result> => {
    await reports.lockDashboard(projectId, connection);
    const current = (await reports.listWidgets(projectId, connection)).map((widget) => widget.id);
    const same = current.length === ids.length && new Set(ids).size === ids.length && ids.every((id) => current.includes(id));
    if (!same) return fail("The dashboard changed meanwhile. Refresh and try again.");
    await reports.setWidgetPositions(projectId, ids, connection);
    return { ok: true, value: undefined, message: "Moved." };
  });
}

// ---- Workload -------------------------------------------------------------------------------
export interface WorkloadCell {
  key: string;
  load: number;
  capacity: number;
  state: CellState;
  taskIds: number[];
}
export interface WorkloadPerson {
  id: number;
  name: string;
  perDay: number;
  own: boolean;
  cells: WorkloadCell[];
}
export interface WorkloadView {
  from: string;
  unit: WorkloadUnit;
  metric: string;
  metricLabel: string;
  metricKind: "count" | "hours" | "number";
  metrics: { key: string; label: string }[];
  columns: WorkloadColumn[];
  people: WorkloadPerson[];
  totals: number[];
  tasks: { id: number; taskNo: string; title: string; start: string | null; due: string; assigneeId: number; effort: number | null }[];
  projectDefault: { perDay: number; own: boolean };
  canEdit: boolean;
  today: string;
}
export async function loadWorkload(projectId: number, actor: TaskActor, query: { from?: string; unit?: string; metric?: string }, now = new Date()): Promise<Result<WorkloadView>> {
  if (!(await reportingOn(actor))) return fail(OFF);
  const found = await access(projectId, actor);
  if (!found) return fail(NOT_FOUND);
  const today = indiaDay(now);
  const unit: WorkloadUnit = query.unit === "week" ? "week" : "day";
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from ?? "") && !Number.isNaN(Date.parse(query.from!)) ? query.from! : today;
  const defs = await fieldsRepo.listFieldDefs(projectId);
  const effortFields = defs.filter((field) => field.type === "NUMBER" || field.type === "TIMER");
  const wanted = parseMetricKey(query.metric);
  const effort = wanted ? (effortFields.find((field) => field.id === wanted) ?? null) : null;
  const metric = metricKey(effort?.id ?? null);
  const [calendar, holidayNames] = await Promise.all([workCalendar(getDbPool()), calendarHolidays(undefined, null)]);
  const columns = workloadColumns(from, unit, calendar, holidayNames);
  const first = columns[0]!.days[0]!;
  const last = columns.at(-1)!.days.at(-1)!;
  const [tasks, members, capacity] = await Promise.all([reports.workloadTasks(projectId, found.viewer, first, last, effort?.id ?? null, effort?.type === "TIMER"), reports.projectPeople(projectId), reports.capacityRows(projectId)]);
  const kind = effort ? "effort" : "count";
  const loads = tasks.map((task) => ({ id: task.id, assigneeId: task.assigneeId, load: spreadLoad({ start: task.start, due: task.due, effort: task.effort ?? 0 }, calendar, kind) }));
  // The project's assignees in the window and its members (so work can go to someone with none yet).
  const names = new Map<number, string>(members.map((member) => [member.id, member.name]));
  for (const task of tasks) names.set(task.assigneeId, task.assigneeName);
  const people: WorkloadPerson[] = [...names]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, name]) => {
      const cap = capacityFor(capacity, id, metric);
      const mine = loads.filter((task) => task.assigneeId === id);
      return {
        id,
        name,
        perDay: cap.perDay,
        own: cap.own,
        cells: columns.map((column) => {
          const { load, taskIds } = cellLoad(mine, column.days, kind);
          const cellCap = cellCapacity(cap.perDay, column);
          return { key: column.key, load, capacity: cellCap, state: cellState(load, cellCap), taskIds };
        }),
      };
    });
  const totals = columns.map((_, index) => round(people.reduce((sum, person) => sum + person.cells[index]!.load, 0)));
  const projectRow = capacity.find((row) => row.userId === null && row.metric === metric);
  return {
    ok: true,
    value: {
      from: columns[0]!.key,
      unit,
      metric,
      metricLabel: effort ? effort.name : "Task count",
      metricKind: effort ? (effort.type === "TIMER" ? "hours" : "number") : "count",
      metrics: [{ key: "count", label: "Task count" }, ...effortFields.map((field) => ({ key: metricKey(field.id), label: field.type === "TIMER" ? `${field.name} (hours)` : field.name }))],
      columns,
      people,
      totals,
      tasks: tasks.map((task) => ({ id: task.id, taskNo: task.taskNo, title: task.title, start: task.start, due: task.due, assigneeId: task.assigneeId, effort: task.effort })),
      projectDefault: projectRow ? { perDay: projectRow.perDay, own: true } : { perDay: capacityFor([], 0, metric).perDay, own: false },
      canEdit: found.edit,
      today,
    },
  };
}

// Capacity per working day: the project's default (userId null) or one
// person's (owners and editors; null perDay = back to the default).
export async function saveCapacity(projectId: number, input: { userId: number | null; metric: string; perDay: number | null }, actor: TaskActor): Promise<Result> {
  if (!(await reportingOn(actor))) return fail(OFF);
  const found = await access(projectId, actor);
  if (!found) return fail(NOT_FOUND);
  if (!found.edit) return fail("Only the project's owners and editors set capacity.");
  const fieldId = parseMetricKey(input.metric);
  if (fieldId === undefined) return fail("That metric isn't valid.");
  if (fieldId !== null) {
    const field = (await fieldsRepo.listFieldDefs(projectId)).find((item) => item.id === fieldId);
    if (!field || (field.type !== "NUMBER" && field.type !== "TIMER")) return fail("That metric isn't valid.");
  }
  if (input.perDay !== null && !capacitySchema.safeParse(input.perDay).success) return fail("Capacity is a number from 0 to 10,000 a day.");
  if (input.userId !== null) {
    const names = await reports.peopleNames([input.userId]);
    if (!names.size) return fail(NOT_FOUND);
  }
  await withTransaction((connection) => reports.saveCapacity(projectId, input.userId, metricKey(fieldId), input.perDay === null ? null : round(input.perDay), actor.id, connection));
  await recordAudit({ actorUserId: actor.id, action: "WORK_CAPACITY_SET", entityType: "PROJECT", entityId: projectId, ipAddress: actor.ipAddress ?? null, sessionId: actor.sessionId ?? null, metadata: { userId: input.userId, metric: metricKey(fieldId), perDay: input.perDay } });
  return { ok: true, value: undefined, message: input.perDay === null ? "Back to the project's capacity." : "Capacity saved." };
}
