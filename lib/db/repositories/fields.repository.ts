import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";
import { checkValue, idText, parseFieldConfig, type FieldConfig, type FieldDef, type FieldType, type OptionInput, type StoredValue } from "@/server/work/custom-fields";

// v1.64.0 (D-371, PM phase B part 1): custom field definitions, the projects
// that show them (project_field_links), their options, typed values, ID
// numbers and timer runs. Raw SQL; rights are checked in fields-service.ts.
type Row = RowDataPacket & Record<string, unknown>;
const num = (value: unknown) => Number(value);
const maybeNum = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const str = (value: unknown) => (value === null || value === undefined ? null : String(value));
const day = (value: unknown) => (value === null || value === undefined ? null : value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));
const json = (value: unknown): unknown => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export interface FieldRecord extends FieldDef {
  description: string | null;
  library: boolean;
  notify: boolean;
  homeProjectId: number | null; // a local field's project; null for a library field
  createdBy: number;
  createdByName: string;
  createdAt: Date;
  deletedAt: Date | null;
  deletedBy: number | null;
  idPrefix: string | null;
  // In the project asked about (listFieldDefs): its place and whether cards show it.
  position?: number;
  showOnCards?: boolean;
}

const FIELD_COLUMNS = `f.id, f.project_id, f.name, f.description, f.kind, f.is_library, f.notify_on_change, f.config_json, f.id_prefix, f.created_by, u.name AS creator_name, f.created_at, f.deleted_at, f.deleted_by`;
function toField(row: Row, options: Map<number, FieldDef["options"]>): FieldRecord {
  const id = num(row.id);
  return {
    id,
    name: String(row.name),
    type: row.kind as FieldType,
    config: parseFieldConfig(row.config_json),
    options: options.get(id) ?? [],
    description: str(row.description),
    library: Boolean(row.is_library),
    notify: Boolean(row.notify_on_change),
    homeProjectId: row.project_id === null ? null : num(row.project_id),
    createdBy: num(row.created_by),
    createdByName: String(row.creator_name ?? ""),
    createdAt: row.created_at as Date,
    deletedAt: (row.deleted_at as Date | null) ?? null,
    deletedBy: maybeNum(row.deleted_by),
    idPrefix: str(row.id_prefix),
    ...(row.link_position !== undefined ? { position: Number(row.link_position), showOnCards: Boolean(row.show_on_cards) } : {}),
  };
}
async function optionsOf(fieldIds: readonly number[], db: Queryable): Promise<Map<number, FieldDef["options"]>> {
  const out = new Map<number, FieldDef["options"]>();
  if (!fieldIds.length) return out;
  const [rows] = await db.query<Row[]>("SELECT id, field_id, name, color, archived_at FROM project_field_options WHERE field_id IN (?) ORDER BY position, id", [[...fieldIds]]);
  for (const row of rows) {
    const list = out.get(num(row.field_id)) ?? [];
    list.push({ id: num(row.id), name: String(row.name), color: num(row.color), archived: row.archived_at !== null });
    out.set(num(row.field_id), list);
  }
  return out;
}

// The fields a project shows, in its order (removed and deleted ones left out).
export async function listFieldDefs(projectId: number, db: Queryable = getDbPool()): Promise<FieldRecord[]> {
  const [rows] = await db.query<Row[]>(
    `SELECT ${FIELD_COLUMNS}, l.position AS link_position, l.show_on_cards FROM project_field_links l JOIN project_fields f ON f.id = l.field_id JOIN users u ON u.id = f.created_by
     WHERE l.project_id = ? AND l.removed_at IS NULL AND f.deleted_at IS NULL ORDER BY l.position, f.id`,
    [projectId],
  );
  const options = await optionsOf(rows.map((row) => num(row.id)), db);
  return rows.map((row) => toField(row, options));
}
// Fields of several projects at once: project id → its fields.
export async function fieldDefsOfProjects(projectIds: readonly number[], db: Queryable = getDbPool()): Promise<Map<number, FieldRecord[]>> {
  const out = new Map<number, FieldRecord[]>();
  if (!projectIds.length) return out;
  const [rows] = await db.query<Row[]>(
    `SELECT ${FIELD_COLUMNS}, l.project_id AS link_project, l.position AS link_position, l.show_on_cards FROM project_field_links l JOIN project_fields f ON f.id = l.field_id JOIN users u ON u.id = f.created_by
     WHERE l.project_id IN (?) AND l.removed_at IS NULL AND f.deleted_at IS NULL ORDER BY l.position, f.id`,
    [[...projectIds]],
  );
  const options = await optionsOf([...new Set(rows.map((row) => num(row.id)))], db);
  for (const row of rows) {
    const list = out.get(num(row.link_project)) ?? [];
    list.push(toField(row, options));
    out.set(num(row.link_project), list);
  }
  return out;
}
export async function findField(id: number, db: Queryable = getDbPool(), includeDeleted = false): Promise<FieldRecord | null> {
  const [rows] = await db.query<Row[]>(`SELECT ${FIELD_COLUMNS} FROM project_fields f JOIN users u ON u.id = f.created_by WHERE f.id = ? ${includeDeleted ? "" : "AND f.deleted_at IS NULL"}`, [id]);
  if (!rows[0]) return null;
  return toField(rows[0], await optionsOf([id], db));
}
export async function fieldsByIds(ids: readonly number[], db: Queryable = getDbPool()): Promise<FieldRecord[]> {
  if (!ids.length) return [];
  const [rows] = await db.query<Row[]>(`SELECT ${FIELD_COLUMNS} FROM project_fields f JOIN users u ON u.id = f.created_by WHERE f.id IN (?) AND f.deleted_at IS NULL`, [[...ids]]);
  const options = await optionsOf(rows.map((row) => num(row.id)), db);
  return rows.map((row) => toField(row, options));
}
// Projects that show the field now.
export async function fieldProjects(fieldId: number, db: Queryable = getDbPool()): Promise<number[]> {
  const [rows] = await db.query<Row[]>("SELECT l.project_id FROM project_field_links l JOIN projects p ON p.id = l.project_id AND p.deleted_at IS NULL WHERE l.field_id = ? AND l.removed_at IS NULL", [fieldId]);
  return rows.map((row) => num(row.project_id));
}
export async function countProjectFields(projectId: number, db: Queryable = getDbPool()): Promise<number> {
  const [rows] = await db.query<Row[]>("SELECT COUNT(*) AS n FROM project_field_links l JOIN project_fields f ON f.id = l.field_id WHERE l.project_id = ? AND l.removed_at IS NULL AND f.deleted_at IS NULL", [projectId]);
  return num(rows[0]?.n ?? 0);
}

export interface NewField {
  homeProjectId: number | null;
  name: string;
  type: FieldType;
  description: string | null;
  library: boolean;
  notify: boolean;
  config: FieldConfig;
  idPrefix: string | null;
  createdBy: number;
}
export async function insertField(field: NewField, db: Queryable): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    "INSERT INTO project_fields (project_id, name, description, kind, is_library, notify_on_change, options_json, config_json, id_prefix, created_by) VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)",
    [field.homeProjectId, field.name, field.description, field.type, field.library, field.notify, JSON.stringify(field.config), field.idPrefix, field.createdBy],
  );
  return result.insertId;
}
export async function updateFieldRow(id: number, changes: { name?: string; description?: string | null; notify?: boolean; config?: FieldConfig; library?: boolean; homeProjectId?: number | null }, db: Queryable): Promise<void> {
  const sets: string[] = ["updated_at = UTC_TIMESTAMP()"];
  const params: unknown[] = [];
  if (changes.name !== undefined) {
    sets.push("name = ?");
    params.push(changes.name);
  }
  if (changes.description !== undefined) {
    sets.push("description = ?");
    params.push(changes.description);
  }
  if (changes.notify !== undefined) {
    sets.push("notify_on_change = ?");
    params.push(changes.notify);
  }
  if (changes.config !== undefined) {
    sets.push("config_json = ?");
    params.push(JSON.stringify(changes.config));
  }
  if (changes.library !== undefined) {
    sets.push("is_library = ?");
    params.push(changes.library);
  }
  if (changes.homeProjectId !== undefined) {
    sets.push("project_id = ?");
    params.push(changes.homeProjectId);
  }
  await db.query<ResultSetHeader>(`UPDATE project_fields SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
}
// Show the field in the project (again): at the end, or back where it was.
export async function linkField(projectId: number, fieldId: number, by: number, db: Queryable): Promise<void> {
  const [top] = await db.query<Row[]>("SELECT COALESCE(MAX(position), 0) AS top FROM project_field_links WHERE project_id = ?", [projectId]);
  await db.query<ResultSetHeader>(
    "INSERT INTO project_field_links (project_id, field_id, position, added_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE removed_at = NULL, added_by = VALUES(added_by)",
    [projectId, fieldId, Number(top[0]?.top ?? 0) + 1024, by],
  );
}
export async function unlinkField(projectId: number, fieldId: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("UPDATE project_field_links SET removed_at = UTC_TIMESTAMP() WHERE project_id = ? AND field_id = ? AND removed_at IS NULL", [projectId, fieldId]);
}
export async function moveFieldLink(projectId: number, fieldId: number, position: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("UPDATE project_field_links SET position = ? WHERE project_id = ? AND field_id = ?", [position, projectId, fieldId]);
}
export async function setShowOnCards(projectId: number, fieldId: number, show: boolean, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("UPDATE project_field_links SET show_on_cards = ? WHERE project_id = ? AND field_id = ?", [show, projectId, fieldId]);
}

// Options: rows with an id are updated (name, colour, order, archived), new
// ones are added; options left out are archived (never deleted: tasks keep
// them, BR-CF-002). options_json keeps the active names for v1.63 code.
export async function saveOptions(fieldId: number, options: readonly OptionInput[], db: Queryable): Promise<void> {
  const [rows] = await db.query<Row[]>("SELECT id FROM project_field_options WHERE field_id = ?", [fieldId]);
  const existing = new Set(rows.map((row) => num(row.id)));
  const kept = new Set<number>();
  let position = 1024;
  for (const option of options) {
    if (option.id && existing.has(option.id)) {
      kept.add(option.id);
      await db.query("UPDATE project_field_options SET name = ?, color = ?, position = ?, archived_at = IF(?, COALESCE(archived_at, UTC_TIMESTAMP()), NULL) WHERE id = ?", [option.name, option.color, position, Boolean(option.archived), option.id]);
    } else await db.query("INSERT INTO project_field_options (field_id, name, color, position, archived_at) VALUES (?, ?, ?, ?, IF(?, UTC_TIMESTAMP(), NULL))", [fieldId, option.name, option.color, position, Boolean(option.archived)]);
    position += 1024;
  }
  const gone = [...existing].filter((id) => !kept.has(id));
  if (gone.length) await db.query("UPDATE project_field_options SET archived_at = COALESCE(archived_at, UTC_TIMESTAMP()) WHERE id IN (?)", [gone]);
  await db.query("UPDATE project_fields SET options_json = ? WHERE id = ?", [JSON.stringify(options.filter((item) => !item.archived).map((item) => item.name)), fieldId]);
}

export async function softDeleteField(id: number, by: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("UPDATE project_fields SET deleted_at = UTC_TIMESTAMP(), deleted_by = ? WHERE id = ? AND deleted_at IS NULL", [by, id]);
}
export async function restoreFieldRow(id: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("UPDATE project_fields SET deleted_at = NULL, deleted_by = NULL WHERE id = ?", [id]);
}
// A project's deleted fields still within 30 days, and fields removed from it.
export async function listGoneFields(projectId: number, db: Queryable = getDbPool()): Promise<{ deleted: FieldRecord[]; removed: FieldRecord[] }> {
  const [rows] = await db.query<Row[]>(
    `SELECT ${FIELD_COLUMNS}, l.removed_at FROM project_field_links l JOIN project_fields f ON f.id = l.field_id JOIN users u ON u.id = f.created_by
     WHERE l.project_id = ? AND ((f.deleted_at IS NOT NULL AND f.deleted_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)) OR (f.deleted_at IS NULL AND l.removed_at IS NOT NULL))
     ORDER BY COALESCE(f.deleted_at, l.removed_at) DESC LIMIT 200`,
    [projectId],
  );
  const options = await optionsOf(rows.map((row) => num(row.id)), db);
  const all = rows.map((row) => ({ field: toField(row, options), deleted: row.deleted_at !== null }));
  return { deleted: all.filter((item) => item.deleted).map((item) => item.field), removed: all.filter((item) => !item.deleted).map((item) => item.field) };
}

// The organisation's field library (search by name), with how many projects use each.
export async function listLibrary(query: string, db: Queryable = getDbPool()): Promise<(FieldRecord & { usage: number })[]> {
  const like = `%${query.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const [rows] = await db.query<Row[]>(
    `SELECT ${FIELD_COLUMNS}, (SELECT COUNT(*) FROM project_field_links l JOIN projects p ON p.id = l.project_id AND p.deleted_at IS NULL WHERE l.field_id = f.id AND l.removed_at IS NULL) AS usage_n
     FROM project_fields f JOIN users u ON u.id = f.created_by WHERE f.is_library = TRUE AND f.deleted_at IS NULL AND f.name LIKE ? ORDER BY f.name LIMIT 200`,
    [like],
  );
  const options = await optionsOf(rows.map((row) => num(row.id)), db);
  return rows.map((row) => ({ ...toField(row, options), usage: num(row.usage_n) }));
}
export async function libraryNameTaken(name: string, exceptId: number | null, db: Queryable = getDbPool()): Promise<boolean> {
  const [rows] = await db.query<Row[]>("SELECT id FROM project_fields WHERE library_key = ? AND id <> ?", [name, exceptId ?? 0]);
  return rows.length > 0;
}

// ---- values ------------------------------------------------------------------------------
interface ValueRow {
  typed: boolean;
  legacy: string;
  stored: StoredValue;
}
function toStored(row: Row): StoredValue {
  const ids = json(row.ids_json);
  return {
    text: str(row.text_value),
    number: row.number_value === null || row.number_value === undefined ? null : Number(row.number_value),
    date: day(row.date_value),
    time: row.time_value === null || row.time_value === undefined ? null : String(row.time_value).slice(0, 5),
    optionId: maybeNum(row.option_id),
    ids: Array.isArray(ids) ? ids.map(Number) : null,
  };
}
// Raw value rows: task id → field id → value.
export async function valueRows(taskIds: readonly number[], db: Queryable = getDbPool()): Promise<Map<number, Map<number, ValueRow>>> {
  const out = new Map<number, Map<number, ValueRow>>();
  if (!taskIds.length) return out;
  const [rows] = await db.query<Row[]>("SELECT task_id, field_id, value, text_value, number_value, date_value, time_value, option_id, ids_json, typed_at FROM task_field_values WHERE task_id IN (?)", [[...taskIds]]);
  for (const row of rows) {
    const map = out.get(num(row.task_id)) ?? new Map<number, ValueRow>();
    map.set(num(row.field_id), { typed: row.typed_at !== null, legacy: String(row.value ?? ""), stored: toStored(row) });
    out.set(num(row.task_id), map);
  }
  return out;
}
// A value as typed storage: rows written before v1.64 that the migration
// couldn't read are read from the old `value` column by the field's rules.
export function storedOf(field: FieldDef, row: ValueRow | undefined): StoredValue | null {
  if (!row) return null;
  if (row.typed) return row.stored;
  const checked = checkValue(field, field.type === "SELECT" ? row.legacy : row.legacy);
  if (checked.ok) return checked.stored;
  return { text: row.legacy || null, number: null, date: null, time: null, optionId: null, ids: null };
}
export async function writeValue(taskId: number, fieldId: number, stored: StoredValue | null, legacy: string, by: number, db: Queryable): Promise<void> {
  if (!stored) {
    await db.query<ResultSetHeader>("DELETE FROM task_field_values WHERE task_id = ? AND field_id = ? AND id_seq IS NULL", [taskId, fieldId]);
    return;
  }
  await db.query<ResultSetHeader>(
    `INSERT INTO task_field_values (task_id, field_id, value, text_value, number_value, date_value, time_value, option_id, ids_json, updated_by, typed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE value = VALUES(value), text_value = VALUES(text_value), number_value = VALUES(number_value), date_value = VALUES(date_value),
       time_value = VALUES(time_value), option_id = VALUES(option_id), ids_json = VALUES(ids_json), updated_by = VALUES(updated_by), typed_at = VALUES(typed_at)`,
    [taskId, fieldId, legacy, stored.text, stored.number, stored.date, stored.time, stored.optionId, stored.ids ? JSON.stringify(stored.ids) : null, by],
  );
}
// How many fields have a value on the task (the per-task limit).
export async function fieldsWithValues(taskId: number, db: Queryable = getDbPool()): Promise<number[]> {
  const [rows] = await db.query<Row[]>("SELECT v.field_id FROM task_field_values v JOIN project_fields f ON f.id = v.field_id AND f.deleted_at IS NULL WHERE v.task_id = ?", [taskId]);
  return rows.map((row) => num(row.field_id));
}

// ---- ID fields --------------------------------------------------------------------------
// Give each listed task without one the field's next number (PREFIX-n), in
// the order given. Locks the field's counter row; IDs never change after.
export async function assignIds(fieldId: number, taskIds: readonly number[], by: number, db: Queryable): Promise<{ taskId: number; text: string }[]> {
  if (!taskIds.length) return [];
  const [fieldRows] = await db.query<Row[]>("SELECT id_prefix, id_next FROM project_fields WHERE id = ? AND kind = 'ID' AND deleted_at IS NULL FOR UPDATE", [fieldId]);
  const field = fieldRows[0];
  if (!field || !field.id_prefix) return [];
  const [have] = await db.query<Row[]>("SELECT task_id FROM task_field_values WHERE field_id = ? AND task_id IN (?)", [fieldId, [...taskIds]]);
  const done = new Set(have.map((row) => num(row.task_id)));
  let next = num(field.id_next);
  const out: { taskId: number; text: string }[] = [];
  for (const taskId of taskIds) {
    if (done.has(taskId)) continue;
    done.add(taskId);
    const text = idText(String(field.id_prefix), next);
    await db.query("INSERT INTO task_field_values (task_id, field_id, value, text_value, number_value, id_seq, updated_by, typed_at) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())", [taskId, fieldId, text, text, next, next, by]);
    out.push({ taskId, text });
    next += 1;
  }
  await db.query("UPDATE project_fields SET id_next = ? WHERE id = ?", [next, fieldId]);
  return out;
}
// The project's ID fields (for a task just placed in it).
export async function idFieldsOfProject(projectId: number, db: Queryable): Promise<number[]> {
  const [rows] = await db.query<Row[]>(
    "SELECT f.id FROM project_field_links l JOIN project_fields f ON f.id = l.field_id WHERE l.project_id = ? AND l.removed_at IS NULL AND f.deleted_at IS NULL AND f.kind = 'ID'",
    [projectId],
  );
  return rows.map((row) => num(row.id));
}
// The project's tasks (top-level first, then subtasks) in list order, for numbering existing tasks.
export async function projectTaskOrder(projectId: number, db: Queryable): Promise<number[]> {
  const [rows] = await db.query<Row[]>(
    `SELECT t.id FROM task_projects tp JOIN tasks t ON t.id = tp.task_id LEFT JOIN project_sections s ON s.id = tp.section_id
     WHERE tp.project_id = ? AND t.deleted_at IS NULL ORDER BY COALESCE(s.position, 0), tp.position, t.id`,
    [projectId],
  );
  return rows.map((row) => num(row.id));
}

// ---- timers -----------------------------------------------------------------------------
export interface TimerRun {
  taskId: number;
  fieldId: number;
  userId: number;
  startedAt: Date;
}
export async function runningTimers(taskIds: readonly number[], db: Queryable = getDbPool()): Promise<TimerRun[]> {
  if (!taskIds.length) return [];
  const [rows] = await db.query<Row[]>("SELECT task_id, field_id, user_id, started_at FROM task_field_timer_runs WHERE task_id IN (?) AND stopped_at IS NULL", [[...taskIds]]);
  return rows.map((row) => ({ taskId: num(row.task_id), fieldId: num(row.field_id), userId: num(row.user_id), startedAt: row.started_at as Date }));
}
export async function startTimerRun(taskId: number, fieldId: number, userId: number, db: Queryable): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>("INSERT IGNORE INTO task_field_timer_runs (task_id, field_id, user_id, started_at) VALUES (?, ?, ?, UTC_TIMESTAMP())", [taskId, fieldId, userId]);
  return result.affectedRows > 0;
}
// Stops the person's run; returns the seconds it ran (null: none running).
export async function stopTimerRun(taskId: number, fieldId: number, userId: number, db: Queryable): Promise<number | null> {
  const [rows] = await db.query<Row[]>("SELECT id, TIMESTAMPDIFF(SECOND, started_at, UTC_TIMESTAMP()) AS secs FROM task_field_timer_runs WHERE task_id = ? AND field_id = ? AND user_id = ? AND stopped_at IS NULL FOR UPDATE", [taskId, fieldId, userId]);
  if (!rows[0]) return null;
  await db.query("UPDATE task_field_timer_runs SET stopped_at = UTC_TIMESTAMP() WHERE id = ?", [num(rows[0].id)]);
  return Math.max(0, num(rows[0].secs));
}

// ---- migration and purge -------------------------------------------------------------------
// The same copy as the v1.64 migration: values not yet in the typed columns
// are copied there (side by side; `value` stays). Safe to run again.
export async function backfillTypedValues(db: Queryable = getDbPool()): Promise<number> {
  let changed = 0;
  const run = async (sql: string) => {
    const [result] = await db.query<ResultSetHeader>(sql);
    changed += result.affectedRows;
  };
  await run("UPDATE task_field_values v JOIN project_fields f ON f.id = v.field_id SET v.text_value = v.value, v.typed_at = UTC_TIMESTAMP() WHERE f.kind = 'TEXT' AND v.typed_at IS NULL");
  await run(
    "UPDATE task_field_values v JOIN project_fields f ON f.id = v.field_id SET v.number_value = CAST(v.value AS DECIMAL(30, 6)), v.typed_at = UTC_TIMESTAMP() WHERE f.kind = 'NUMBER' AND v.typed_at IS NULL AND v.value REGEXP '^-?[0-9]{1,15}(\\\\.[0-9]{1,6})?$'",
  );
  await run("UPDATE task_field_values v JOIN project_fields f ON f.id = v.field_id SET v.date_value = CAST(v.value AS DATE), v.typed_at = UTC_TIMESTAMP() WHERE f.kind = 'DATE' AND v.typed_at IS NULL AND v.value REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'");
  await run(
    "UPDATE task_field_values v JOIN project_fields f ON f.id = v.field_id JOIN project_field_options o ON o.field_id = v.field_id AND o.name = v.value SET v.option_id = o.id, v.typed_at = UTC_TIMESTAMP() WHERE f.kind = 'SELECT' AND v.typed_at IS NULL",
  );
  return changed;
}
// Fields deleted more than 30 days ago, with their values, options, links
// and timer runs (the purge job; at most `limit` fields per run).
export async function purgeDeletedFields(limit: number, db: Queryable): Promise<number[]> {
  const [rows] = await db.query<Row[]>("SELECT id FROM project_fields WHERE deleted_at IS NOT NULL AND deleted_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY) ORDER BY id LIMIT ?", [limit]);
  const ids = rows.map((row) => num(row.id));
  if (!ids.length) return [];
  for (const table of ["task_field_values", "task_field_timer_runs", "project_field_options", "project_field_links"]) await db.query(`DELETE FROM ${table} WHERE field_id IN (?)`, [ids]);
  await db.query("DELETE FROM project_fields WHERE id IN (?)", [ids]);
  return ids;
}
