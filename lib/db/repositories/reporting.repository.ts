import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";
import { visibleTaskClause } from "@/lib/db/repositories/work.repository";
import type { WorkViewer } from "@/server/work/access";
import type { FieldType } from "@/server/work/custom-fields";
import { addDays } from "@/server/work/schedule";
import { chartConfigSchema, type ChartConfig, type ChartDimension, type ChartFilters, type DateUnit, type GroupRow, type WidgetSeed } from "@/server/work/reporting";

// v1.67.0 (D-375, PM phase D part 1): dashboard widgets, Workload capacity,
// and the SQL behind every chart. Every figure query is limited to one
// project and to the tasks the viewer may see (visibleTaskClause), so a
// chart never counts a task the person couldn't open. Cancelled and deleted
// tasks are never counted.
type Row = RowDataPacket & Record<string, unknown>;
const num = (value: unknown) => Number(value);
const db = () => getDbPool();

// ---- widgets -------------------------------------------------------------------------------
export interface WidgetRecord {
  id: number;
  projectId: number;
  kind: "CHART" | "TEXT";
  title: string;
  config: ChartConfig | null;
  body: string | null;
  size: "HALF" | "FULL";
  position: number;
  rowVersion: number;
}
const parseConfig = (raw: unknown): ChartConfig | null => {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    const parsed = chartConfigSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
const toWidget = (row: Row): WidgetRecord => ({
  id: num(row.id),
  projectId: num(row.project_id),
  kind: row.kind as "CHART" | "TEXT",
  title: String(row.title),
  config: row.kind === "CHART" ? parseConfig(row.config_json) : null,
  body: row.body === null || row.body === undefined ? null : String(row.body),
  size: row.size as "HALF" | "FULL",
  position: num(row.position),
  rowVersion: num(row.row_version),
});
export async function listWidgets(projectId: number, connection: Queryable = db()): Promise<WidgetRecord[]> {
  const [rows] = await connection.query<Row[]>("SELECT * FROM project_dashboard_widgets WHERE project_id = ? ORDER BY position, id", [projectId]);
  return rows.map(toWidget);
}
export async function findWidget(id: number, connection: Queryable = db()): Promise<WidgetRecord | null> {
  const [rows] = await connection.query<Row[]>("SELECT * FROM project_dashboard_widgets WHERE id = ?", [id]);
  return rows[0] ? toWidget(rows[0]) : null;
}
// Locks the project row and says whether its default widgets were written.
export async function lockDashboard(projectId: number, connection: Queryable): Promise<boolean> {
  const [rows] = await connection.query<Row[]>("SELECT dashboard_set FROM projects WHERE id = ? FOR UPDATE", [projectId]);
  return Boolean(rows[0]?.dashboard_set);
}
export async function markDashboardSet(projectId: number, connection: Queryable): Promise<void> {
  await connection.query("UPDATE projects SET dashboard_set = TRUE WHERE id = ?", [projectId]);
}
export async function insertWidget(projectId: number, seed: WidgetSeed, position: number, by: number | null, connection: Queryable): Promise<number> {
  const [result] = await connection.query<ResultSetHeader>(
    "INSERT INTO project_dashboard_widgets (project_id, kind, title, config_json, body, size, position, created_by, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())",
    [projectId, seed.kind, seed.title, seed.config ? JSON.stringify(seed.config) : null, seed.body, seed.size, position, by, by],
  );
  return result.insertId;
}
// Saves a widget's title, setup, words and size when its row version still matches.
export async function updateWidget(id: number, change: { title: string; config: ChartConfig | null; body: string | null; size: "HALF" | "FULL" }, rowVersion: number | null, by: number, connection: Queryable): Promise<boolean> {
  const [result] = await connection.query<ResultSetHeader>(
    `UPDATE project_dashboard_widgets SET title = ?, config_json = ?, body = ?, size = ?, updated_by = ?, updated_at = UTC_TIMESTAMP(), row_version = row_version + 1
     WHERE id = ?${rowVersion === null ? "" : " AND row_version = ?"}`,
    [change.title, change.config ? JSON.stringify(change.config) : null, change.body, change.size, by, id, ...(rowVersion === null ? [] : [rowVersion])],
  );
  return result.affectedRows === 1;
}
export async function setWidgetPositions(projectId: number, ids: readonly number[], connection: Queryable): Promise<void> {
  for (const [index, id] of ids.entries()) await connection.query("UPDATE project_dashboard_widgets SET position = ? WHERE id = ? AND project_id = ?", [(index + 1) * 1024, id, projectId]);
}
export async function deleteWidget(id: number, connection: Queryable): Promise<void> {
  await connection.query("DELETE FROM project_dashboard_widgets WHERE id = ?", [id]);
}

// ---- capacity ------------------------------------------------------------------------------
export interface CapacityRow {
  userId: number | null;
  metric: string;
  perDay: number;
}
export async function capacityRows(projectId: number, connection: Queryable = db()): Promise<CapacityRow[]> {
  const [rows] = await connection.query<Row[]>("SELECT user_id, metric, per_day FROM project_capacity WHERE project_id = ?", [projectId]);
  return rows.map((row) => ({ userId: row.user_id === null ? null : num(row.user_id), metric: String(row.metric), perDay: num(row.per_day) }));
}
export async function saveCapacity(projectId: number, userId: number | null, metric: string, perDay: number | null, by: number, connection: Queryable): Promise<void> {
  if (perDay === null) {
    await connection.query("DELETE FROM project_capacity WHERE project_id = ? AND metric = ? AND user_key = ?", [projectId, metric, userId ?? 0]);
    return;
  }
  await connection.query(
    "INSERT INTO project_capacity (project_id, user_id, metric, per_day, updated_by) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE per_day = VALUES(per_day), updated_by = VALUES(updated_by)",
    [projectId, userId, metric, perDay, by],
  );
}

// ---- the figures behind a chart -------------------------------------------------------------
export interface FigureField {
  id: number;
  type: FieldType;
}
export interface FigureSpec {
  projectId: number;
  viewer: WorkViewer;
  today: string; // India day
  config: ChartConfig;
  fields: ReadonlyMap<number, FigureField>;
  xUnit: DateUnit | null; // the date unit actually used for a date X-axis (it may be coarser than asked)
  // Field filters the SQL leaves out (formula, lookup, reference): the service applies them in code.
  codeFilterIds: ReadonlySet<number>;
}
interface Sql {
  text: string;
  params: unknown[];
}
const istDay = (expr: string) => `DATE(DATE_ADD(${expr}, INTERVAL 330 MINUTE))`;
const bucket = (day: string, unit: DateUnit) =>
  unit === "day" ? `DATE_FORMAT(${day}, '%Y-%m-%d')` : unit === "week" ? `DATE_FORMAT(DATE_SUB(${day}, INTERVAL WEEKDAY(${day}) DAY), '%Y-%m-%d')` : `DATE_FORMAT(${day}, '%Y-%m-01')`;
// The India due day's status (DUE_STATUSES in reporting.ts).
const dueStatusSql = (today: string): Sql => ({
  text: `(CASE WHEN t.status = 'COMPLETED' THEN 'done' WHEN t.due_at IS NULL THEN 'none'
    WHEN ${istDay("t.due_at")} < ? THEN 'overdue' WHEN ${istDay("t.due_at")} = ? THEN 'today'
    WHEN ${istDay("t.due_at")} <= ? THEN 'week' ELSE 'later' END)`,
  params: [today, today, addDays(today, 7)],
});

// A grouping's key expression and the joins it needs.
function dimensionSql(dim: ChartDimension, alias: string, spec: FigureSpec, unit: DateUnit): { key: Sql; joins: Sql[] } {
  const time = spec.config.source === "time";
  switch (dim.by) {
    case "assignee":
      return { key: { text: "CAST(t.assignee_id AS CHAR)", params: [] }, joins: [] };
    case "creator":
      return { key: { text: "CAST(t.created_by AS CHAR)", params: [] }, joins: [] };
    case "person":
      return { key: { text: "CAST(r.user_id AS CHAR)", params: [] }, joins: [] };
    case "section":
      return { key: { text: "CAST(tp.section_id AS CHAR)", params: [] }, joins: [] };
    case "type":
      return { key: { text: "IF(t.is_milestone, 'MILESTONE', 'TASK')", params: [] }, joins: [] };
    case "completion":
      return { key: { text: "IF(t.status = 'COMPLETED', 'done', 'open')", params: [] }, joins: [] };
    case "dueStatus":
      return { key: dueStatusSql(spec.today), joins: [] };
    case "date": {
      const day = time ? istDay("r.started_at") : dim.dateField === "start" ? "t.starts_on" : dim.dateField === "created" ? istDay("t.created_at") : dim.dateField === "completed" ? `IF(t.status = 'COMPLETED', ${istDay("t.completed_at")}, NULL)` : istDay("t.due_at");
      return { key: { text: bucket(day, unit), params: [] }, joins: [] };
    }
    case "field": {
      const field = spec.fields.get(dim.fieldId ?? 0);
      const join: Sql = { text: `LEFT JOIN task_field_values ${alias}v ON ${alias}v.task_id = t.id AND ${alias}v.field_id = ?`, params: [dim.fieldId] };
      if (field?.type === "SELECT") return { key: { text: `CAST(${alias}v.option_id AS CHAR)`, params: [] }, joins: [join] };
      if (field?.type === "DATE") return { key: { text: bucket(`${alias}v.date_value`, unit), params: [] }, joins: [join] };
      // Multi-select and people: a task falls under each of its values.
      return {
        key: { text: `CAST(${alias}j.v AS CHAR)`, params: [] },
        joins: [join, { text: `LEFT JOIN JSON_TABLE(COALESCE(${alias}v.ids_json, JSON_ARRAY()), '$[*]' COLUMNS (v BIGINT PATH '$')) AS ${alias}j ON TRUE`, params: [] }],
      };
    }
  }
}

// One field filter as SQL (types the SQL can read: select, multi-select,
// people, number, timer, date, text, ID). Same meaning as matchFieldFilter.
function fieldFilterSql(filter: ChartFilters["fields"][number], type: FieldType, viewerId: number): Sql | null {
  const has = (condition: string, params: unknown[] = []): Sql => ({ text: `EXISTS (SELECT 1 FROM task_field_values ff WHERE ff.task_id = t.id AND ff.field_id = ? AND ${condition})`, params: [filter.fieldId, ...params] });
  const not = (sql: Sql): Sql => ({ text: `NOT ${sql.text}`, params: sql.params });
  if (type === "SELECT" || type === "MULTI_SELECT" || type === "PEOPLE") {
    const filled = type === "SELECT" ? has("ff.option_id IS NOT NULL") : has("JSON_LENGTH(ff.ids_json) > 0");
    if (filter.op === "empty") return not(filled);
    if (filter.op === "notEmpty") return filled;
    if (!filter.value) return null;
    const wanted = filter.value === "me" ? viewerId : Number(filter.value);
    if (!Number.isFinite(wanted)) return null;
    const match = type === "SELECT" ? has("ff.option_id = ?", [wanted]) : has("JSON_CONTAINS(ff.ids_json, CAST(? AS JSON))", [String(wanted)]);
    return filter.op === "isNot" ? not(match) : match;
  }
  if (type === "NUMBER" || type === "TIMER" || type === "DATE") {
    const column = type === "DATE" ? "ff.date_value" : "ff.number_value";
    const filled = type === "TIMER" ? has("ff.number_value > 0") : has(`${column} IS NOT NULL`);
    if (filter.op === "empty") return not(filled);
    if (filter.op === "notEmpty") return filled;
    if (!filter.value) return null;
    let right: string | number;
    if (type === "DATE") {
      if (!/^\d{4}-\d{2}-\d{2}/.test(filter.value)) return null;
      right = filter.value.slice(0, 10);
    } else {
      const parsed = Number(filter.value.replace(/[,\s₹%]/g, ""));
      if (!Number.isFinite(parsed)) return null;
      right = type === "TIMER" ? parsed * 60 : parsed; // a timer filter is typed in minutes
    }
    const op = filter.op === "gt" ? ">" : filter.op === "lt" ? "<" : "=";
    return has(`${column} ${op} ?`, [right]);
  }
  // Text and ID.
  const filled = has("ff.text_value IS NOT NULL AND ff.text_value <> ''");
  if (filter.op === "empty") return not(filled);
  if (filter.op === "notEmpty") return filled;
  if (!filter.value) return null;
  if (filter.op === "is") return has("ff.text_value = ?", [filter.value]);
  if (filter.op === "isNot") return not(has("ff.text_value = ?", [filter.value]));
  return has("ff.text_value LIKE ?", [`%${filter.value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`]);
}

// FROM … WHERE … shared by every figure query.
function baseSql(spec: FigureSpec): { from: Sql; where: Sql } {
  const visible = visibleTaskClause(spec.viewer);
  const f = spec.config.filters;
  const where: string[] = ["t.deleted_at IS NULL", "t.status <> 'CANCELLED'", visible.sql];
  const params: unknown[] = [...visible.params];
  if (f.completion === "open") where.push("t.status <> 'COMPLETED'");
  if (f.completion === "done") where.push("t.status = 'COMPLETED'");
  if (f.types.length === 1) where.push(f.types[0] === "MILESTONE" ? "t.is_milestone = TRUE" : "t.is_milestone = FALSE");
  if (f.mine) {
    where.push("t.assignee_id = ?");
    params.push(spec.viewer.id);
  }
  if (f.assignees.length) {
    where.push("t.assignee_id IN (?)");
    params.push([...f.assignees]);
  }
  if (f.creators.length) {
    where.push("t.created_by IN (?)");
    params.push([...f.creators]);
  }
  if (f.sections.length) {
    where.push("tp.section_id IN (?)");
    params.push([...f.sections]);
  }
  if (f.dueStatus.length) {
    const status = dueStatusSql(spec.today);
    where.push(`${status.text} IN (?)`);
    params.push(...status.params, [...f.dueStatus]);
  }
  for (const filter of f.fields) {
    const field = spec.fields.get(filter.fieldId);
    if (!field || spec.codeFilterIds.has(filter.fieldId)) continue;
    const sql = fieldFilterSql(filter, field.type, spec.viewer.id);
    if (!sql) continue;
    where.push(sql.text);
    params.push(...sql.params);
  }
  if (spec.config.source === "time") {
    const one = spec.config.timerFieldId;
    return {
      from: {
        text: `FROM task_field_timer_runs r
          JOIN task_projects tp ON tp.task_id = r.task_id AND tp.project_id = ?
          JOIN project_field_links rl ON rl.field_id = r.field_id AND rl.project_id = tp.project_id AND rl.removed_at IS NULL
          JOIN tasks t ON t.id = r.task_id JOIN users a ON a.id = t.assignee_id`,
        params: [spec.projectId],
      },
      where: { text: `WHERE r.stopped_at IS NOT NULL${one ? " AND r.field_id = ?" : ""} AND ${where.join(" AND ")}`, params: [...(one ? [one] : []), ...params] },
    };
  }
  return {
    from: { text: "FROM task_projects tp JOIN tasks t ON t.id = tp.task_id JOIN users a ON a.id = t.assignee_id", params: [] },
    where: { text: `WHERE tp.project_id = ? AND ${where.join(" AND ")}`, params: [spec.projectId, ...params] },
  };
}

// The metric value columns (raw, per row): a field's number (a timer's
// seconds as hours), or a time entry's hours.
function metricSql(spec: FigureSpec): { values: string[]; joins: Sql[] } {
  const values: string[] = [];
  const joins: Sql[] = [];
  spec.config.metrics.forEach((metric, index) => {
    if (metric.measure === "count") values.push("NULL");
    else if (spec.config.source === "time") values.push("TIMESTAMPDIFF(SECOND, r.started_at, r.stopped_at) / 3600");
    else {
      const field = spec.fields.get(metric.fieldId ?? 0);
      if (!field || field.type === "FORMULA") values.push("NULL"); // formulas: worked out in code
      else {
        joins.push({ text: `LEFT JOIN task_field_values m${index} ON m${index}.task_id = t.id AND m${index}.field_id = ?`, params: [metric.fieldId] });
        values.push(field.type === "TIMER" ? `m${index}.number_value / 3600` : `m${index}.number_value`);
      }
    }
  });
  return { values, joins };
}

function groupingSql(spec: FigureSpec): { x: Sql; s: Sql; joins: Sql[] } {
  const none: Sql = { text: "NULL", params: [] };
  const x = spec.config.x ? dimensionSql(spec.config.x, "x", spec, spec.xUnit ?? spec.config.x.unit) : null;
  const s = spec.config.series ? dimensionSql(spec.config.series, "s", spec, spec.config.series.unit) : null;
  return { x: x?.key ?? none, s: s?.key ?? none, joins: [...(x?.joins ?? []), ...(s?.joins ?? [])] };
}
const joinText = (joins: readonly Sql[]) => joins.map((join) => join.text).join(" ");
const joinParams = (joins: readonly Sql[]) => joins.flatMap((join) => join.params);

// Grouped figures, added up by MySQL: per (X key, series key) the number of
// tasks (or time entries) and per metric the sum and count of its values.
export async function groupedFigures(spec: FigureSpec, connection: Queryable = db()): Promise<GroupRow[]> {
  const { from, where } = baseSql(spec);
  const group = groupingSql(spec);
  const metric = metricSql(spec);
  const unit = spec.config.source === "time" ? "r.id" : "t.id";
  const columns = metric.values.map((value, index) => `COALESCE(SUM(${value}), 0) AS sum${index}, COUNT(${value}) AS n${index}`).join(", ");
  const sql = `SELECT ${group.x.text} AS k, ${group.s.text} AS s, COUNT(DISTINCT ${unit}) AS tasks, ${columns}
    ${from.text} ${joinText(group.joins)} ${joinText(metric.joins)} ${where.text}
    GROUP BY k, s`;
  const params = [...group.x.params, ...group.s.params, ...from.params, ...joinParams(group.joins), ...joinParams(metric.joins), ...where.params];
  const [rows] = await connection.query<Row[]>(sql, params);
  return rows.map((row) => ({
    k: row.k === null ? null : String(row.k),
    s: row.s === null ? null : String(row.s),
    tasks: num(row.tasks),
    sums: metric.values.map((_, index) => num(row[`sum${index}`] ?? 0)),
    counts: metric.values.map((_, index) => num(row[`n${index}`] ?? 0)),
  }));
}

// The same rows one by one (for formula metrics and filters the SQL can't
// read): each counted thing with its task, groupings and raw metric values.
export async function rawFigures(spec: FigureSpec, connection: Queryable = db()): Promise<{ unit: number; taskId: number; k: string | null; s: string | null; values: (number | null)[] }[]> {
  const { from, where } = baseSql(spec);
  const group = groupingSql(spec);
  const metric = metricSql(spec);
  const unit = spec.config.source === "time" ? "r.id" : "t.id";
  const sql = `SELECT ${unit} AS unit_id, t.id AS task_id, ${group.x.text} AS k, ${group.s.text} AS s${metric.values.map((value, index) => `, ${value} AS v${index}`).join("")}
    ${from.text} ${joinText(group.joins)} ${joinText(metric.joins)} ${where.text} LIMIT 20000`;
  const params = [...group.x.params, ...group.s.params, ...from.params, ...joinParams(group.joins), ...joinParams(metric.joins), ...where.params];
  const [rows] = await connection.query<Row[]>(sql, params);
  return rows.map((row) => ({
    unit: num(row.unit_id),
    taskId: num(row.task_id),
    k: row.k === null ? null : String(row.k),
    s: row.s === null ? null : String(row.s),
    values: metric.values.map((_, index) => (row[`v${index}`] === null || row[`v${index}`] === undefined ? null : num(row[`v${index}`]))),
  }));
}

// Burnup and burndown: each task's India created day and completed day.
export async function burnFigures(spec: FigureSpec, connection: Queryable = db()): Promise<{ taskId: number; created: string; completed: string | null }[]> {
  const { from, where } = baseSql(spec);
  const [rows] = await connection.query<Row[]>(
    `SELECT t.id, DATE_FORMAT(${istDay("t.created_at")}, '%Y-%m-%d') AS created,
       IF(t.status = 'COMPLETED', DATE_FORMAT(${istDay("COALESCE(t.completed_at, t.updated_at)")}, '%Y-%m-%d'), NULL) AS completed
     ${from.text} ${where.text} LIMIT 20000`,
    [...from.params, ...where.params],
  );
  return rows.map((row) => ({ taskId: num(row.id), created: String(row.created), completed: row.completed === null ? null : String(row.completed) }));
}

// Names for people keys.
export async function peopleNames(ids: readonly number[], connection: Queryable = db()): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const [rows] = await connection.query<Row[]>("SELECT id, name FROM users WHERE id IN (?)", [[...ids]]);
  return new Map(rows.map((row) => [num(row.id), String(row.name)]));
}

// ---- Workload -----------------------------------------------------------------------------
export interface WorkloadTask {
  id: number;
  taskNo: string;
  title: string;
  assigneeId: number;
  assigneeName: string;
  start: string | null;
  due: string;
  status: string;
  effort: number | null; // the effort field's value (a timer's hours)
}
// The project's open, visible tasks with a due date that touch [from, to].
export async function workloadTasks(projectId: number, viewer: WorkViewer, from: string, to: string, effortFieldId: number | null, effortIsTimer: boolean, connection: Queryable = db()): Promise<WorkloadTask[]> {
  const visible = visibleTaskClause(viewer);
  const [rows] = await connection.query<Row[]>(
    `SELECT t.id, t.task_no, t.title, t.assignee_id, a.name AS assignee_name, t.status,
       DATE_FORMAT(t.starts_on, '%Y-%m-%d') AS start_day, DATE_FORMAT(${istDay("t.due_at")}, '%Y-%m-%d') AS due_day,
       ${effortFieldId ? (effortIsTimer ? "ev.number_value / 3600" : "ev.number_value") : "NULL"} AS effort
     FROM task_projects tp JOIN tasks t ON t.id = tp.task_id JOIN users a ON a.id = t.assignee_id
     ${effortFieldId ? "LEFT JOIN task_field_values ev ON ev.task_id = t.id AND ev.field_id = ?" : ""}
     WHERE tp.project_id = ? AND t.deleted_at IS NULL AND t.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED') AND t.due_at IS NOT NULL
       AND ${istDay("t.due_at")} >= ? AND COALESCE(LEAST(t.starts_on, ${istDay("t.due_at")}), ${istDay("t.due_at")}) <= ?
       AND ${visible.sql}
     ORDER BY t.due_at, t.id LIMIT 3000`,
    [...(effortFieldId ? [effortFieldId] : []), projectId, from, to, ...visible.params],
  );
  return rows.map((row) => ({
    id: num(row.id),
    taskNo: String(row.task_no),
    title: String(row.title),
    assigneeId: num(row.assignee_id),
    assigneeName: String(row.assignee_name),
    start: row.start_day === null ? null : String(row.start_day),
    due: String(row.due_day),
    status: String(row.status),
    effort: row.effort === null || row.effort === undefined ? null : num(row.effort),
  }));
}
// People with a USER role on the project (members), active.
export async function projectPeople(projectId: number, connection: Queryable = db()): Promise<{ id: number; name: string }[]> {
  const [rows] = await connection.query<Row[]>(
    "SELECT u.id, u.name FROM project_members m JOIN users u ON u.id = m.member_id WHERE m.project_id = ? AND m.member_type = 'USER' AND u.active = TRUE ORDER BY u.name",
    [projectId],
  );
  return rows.map((row) => ({ id: num(row.id), name: String(row.name) }));
}
