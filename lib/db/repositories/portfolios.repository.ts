import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";
import { visibleProjectClause } from "@/lib/db/repositories/work.repository";
import type { ProjectPrivacy, ProjectRole, ProjectStatusKind, WorkViewer } from "@/server/work/access";
import type { ItemLink, PortfolioFieldKind, PortfolioPriority, TaskCounts } from "@/server/work/portfolio-rules";

// v1.69.0 (D-382, PM phase D part 3): portfolios, their people, what they
// hold (projects and other portfolios), their own columns and status
// updates. visiblePortfolioClause is the SQL twin of effectivePortfolioRole
// (server/work/portfolio-rules.ts), as visibleProjectClause is for projects.
type Row = RowDataPacket & Record<string, unknown>;
const num = (value: unknown) => Number(value);
const maybeNum = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const str = (value: unknown) => (value === null || value === undefined ? null : String(value));
const day = (value: unknown) => (value === null || value === undefined ? null : value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));
const iso = (value: unknown) => (value === null || value === undefined ? null : value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString());
const escapeLike = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function visiblePortfolioClause(viewer: WorkViewer, alias = "pf"): { sql: string; params: unknown[] } {
  if (viewer.projects === false) return { sql: "FALSE", params: [] };
  if (viewer.isAdmin) return { sql: `${alias}.deleted_at IS NULL`, params: [] };
  const dept = viewer.departmentId;
  return {
    sql: `${alias}.deleted_at IS NULL AND (${alias}.privacy = 'ORGANISATION'
      OR (${alias}.privacy = 'DEPARTMENT' AND ? IS NOT NULL AND ${alias}.department_id = ?)
      OR EXISTS (SELECT 1 FROM portfolio_members vpm WHERE vpm.portfolio_id = ${alias}.id AND vpm.user_id IN (?)))`,
    params: [dept, dept, [viewer.id, ...viewer.teamIds]],
  };
}

// ---- portfolios --------------------------------------------------------------------------
export interface PortfolioRecord {
  id: number;
  name: string;
  color: string;
  ownerId: number;
  ownerName: string;
  privacy: ProjectPrivacy;
  departmentId: number | null;
  departmentName: string | null;
  defaultAccessRole: Exclude<ProjectRole, "OWNER">;
  description: string | null;
  startOn: string | null;
  dueOn: string | null;
  currentStatus: ProjectStatusKind | null;
  defaultTab: "LIST" | "TIMELINE" | "PROGRESS" | "DASHBOARD";
  archivedAt: Date | null;
  deletedAt: Date | null;
  rowVersion: number;
  createdAt: Date;
}
export interface PortfolioMember {
  id: number;
  name: string;
  role: ProjectRole;
}
const toPortfolio = (row: Row): PortfolioRecord => ({
  id: num(row.id),
  name: String(row.name),
  color: String(row.color),
  ownerId: num(row.owner_id),
  ownerName: String(row.owner_name),
  privacy: row.privacy as ProjectPrivacy,
  departmentId: maybeNum(row.department_id),
  departmentName: str(row.department_name),
  defaultAccessRole: row.default_access_role as Exclude<ProjectRole, "OWNER">,
  description: str(row.description),
  startOn: day(row.start_on),
  dueOn: day(row.due_on),
  currentStatus: (row.current_status as ProjectStatusKind | null) ?? null,
  defaultTab: row.default_tab as PortfolioRecord["defaultTab"],
  archivedAt: (row.archived_at as Date | null) ?? null,
  deletedAt: (row.deleted_at as Date | null) ?? null,
  rowVersion: num(row.row_version),
  createdAt: row.created_at as Date,
});
const SELECT = "SELECT pf.*, o.name AS owner_name, d.name AS department_name FROM portfolios pf JOIN users o ON o.id = pf.owner_id LEFT JOIN departments d ON d.id = pf.department_id";

export async function findPortfolio(id: number, db: Queryable = getDbPool(), lock = false): Promise<PortfolioRecord | null> {
  if (lock) await db.query("SELECT id FROM portfolios WHERE id = ? FOR UPDATE", [id]);
  const [rows] = await db.query<Row[]>(`${SELECT} WHERE pf.id = ?`, [id]);
  return rows[0] ? toPortfolio(rows[0]) : null;
}
export async function listPortfolioMembers(id: number, db: Queryable = getDbPool()): Promise<PortfolioMember[]> {
  const [rows] = await db.query<Row[]>(
    "SELECT m.user_id, m.role, u.name FROM portfolio_members m JOIN users u ON u.id = m.user_id WHERE m.portfolio_id = ? ORDER BY FIELD(m.role, 'OWNER', 'EDITOR', 'COMMENTER', 'VIEWER'), u.name",
    [id],
  );
  return rows.map((row) => ({ id: num(row.user_id), name: String(row.name), role: row.role as ProjectRole }));
}

export interface PortfolioListItem {
  id: number;
  name: string;
  color: string;
  privacy: ProjectPrivacy;
  ownerName: string;
  currentStatus: ProjectStatusKind | null;
  items: number;
  isMember: boolean;
  starred: boolean;
  archivedAt: Date | null;
}
export async function listVisiblePortfolios(viewer: WorkViewer, options: { onlyMine?: boolean; archived?: boolean; q?: string; starredOnly?: boolean; limit?: number } = {}, db: Queryable = getDbPool()): Promise<PortfolioListItem[]> {
  const visible = visiblePortfolioClause(viewer);
  const where = [visible.sql, options.archived ? "pf.archived_at IS NOT NULL" : "pf.archived_at IS NULL"];
  const params: unknown[] = [...visible.params];
  if (options.q) {
    where.push("pf.name LIKE ?");
    params.push(escapeLike(options.q));
  }
  if (options.onlyMine) {
    where.push("EXISTS (SELECT 1 FROM portfolio_members mm WHERE mm.portfolio_id = pf.id AND mm.user_id = ?)");
    params.push(viewer.id);
  }
  if (options.starredOnly) {
    where.push("EXISTS (SELECT 1 FROM work_favourites sf WHERE sf.user_id = ? AND sf.object_type = 'PORTFOLIO' AND sf.object_id = pf.id)");
    params.push(viewer.id);
  }
  const [rows] = await db.query<Row[]>(
    `SELECT pf.id, pf.name, pf.color, pf.privacy, pf.current_status, pf.archived_at, o.name AS owner_name,
       (SELECT COUNT(*) FROM portfolio_items i LEFT JOIN projects ip ON ip.id = i.project_id LEFT JOIN portfolios ic ON ic.id = i.child_portfolio_id
         WHERE i.portfolio_id = pf.id AND (ip.deleted_at IS NULL AND ic.deleted_at IS NULL)) AS item_count,
       EXISTS (SELECT 1 FROM portfolio_members mm WHERE mm.portfolio_id = pf.id AND mm.user_id = ?) AS is_member,
       EXISTS (SELECT 1 FROM work_favourites f WHERE f.user_id = ? AND f.object_type = 'PORTFOLIO' AND f.object_id = pf.id) AS starred
     FROM portfolios pf JOIN users o ON o.id = pf.owner_id
     WHERE ${where.join(" AND ")} ORDER BY starred DESC, pf.name LIMIT ?`,
    [viewer.id, viewer.id, ...params, options.limit ?? 500],
  );
  return rows.map((row) => ({
    id: num(row.id),
    name: String(row.name),
    color: String(row.color),
    privacy: row.privacy as ProjectPrivacy,
    ownerName: String(row.owner_name),
    currentStatus: (row.current_status as ProjectStatusKind | null) ?? null,
    items: num(row.item_count),
    isMember: Boolean(row.is_member),
    starred: Boolean(row.starred),
    archivedAt: (row.archived_at as Date | null) ?? null,
  }));
}
export async function listDeletedPortfolios(viewer: WorkViewer, db: Queryable = getDbPool()): Promise<{ id: number; name: string; deletedAt: Date }[]> {
  const [rows] = await db.query<Row[]>(
    `SELECT pf.id, pf.name, pf.deleted_at FROM portfolios pf WHERE pf.deleted_at IS NOT NULL AND pf.deleted_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)
     AND (? OR pf.deleted_by = ? OR EXISTS (SELECT 1 FROM portfolio_members m WHERE m.portfolio_id = pf.id AND m.user_id = ? AND m.role = 'OWNER')) ORDER BY pf.deleted_at DESC LIMIT 100`,
    [viewer.isAdmin, viewer.id, viewer.id],
  );
  return rows.map((row) => ({ id: num(row.id), name: String(row.name), deletedAt: row.deleted_at as Date }));
}

export interface NewPortfolio {
  name: string;
  color: string;
  ownerId: number;
  privacy: ProjectPrivacy;
  departmentId: number | null;
  defaultAccessRole: Exclude<ProjectRole, "OWNER">;
  description: string | null;
  defaultTab: PortfolioRecord["defaultTab"];
}
export async function insertPortfolio(value: NewPortfolio, db: Queryable): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    "INSERT INTO portfolios (name, color, owner_id, privacy, department_id, default_access_role, description, default_tab, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [value.name, value.color, value.ownerId, value.privacy, value.departmentId, value.defaultAccessRole, value.description, value.defaultTab, value.ownerId],
  );
  return result.insertId;
}
const COLUMNS = new Set(["name", "color", "owner_id", "privacy", "department_id", "default_access_role", "description", "start_on", "due_on", "current_status", "default_tab", "archived_at", "deleted_at", "deleted_by"]);
export async function updatePortfolio(id: number, changes: Record<string, unknown>, db: Queryable, expectedVersion?: number): Promise<boolean> {
  const keys = Object.keys(changes).filter((key) => COLUMNS.has(key));
  if (!keys.length) return true;
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE portfolios SET ${keys.map((key) => `${key} = ?`).join(", ")}, row_version = row_version + 1 WHERE id = ?${expectedVersion === undefined ? "" : " AND row_version = ?"}`,
    [...keys.map((key) => changes[key]), id, ...(expectedVersion === undefined ? [] : [expectedVersion])],
  );
  return result.affectedRows > 0;
}
export async function setPortfolioMember(id: number, userId: number, role: ProjectRole, by: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("INSERT INTO portfolio_members (portfolio_id, user_id, role, added_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)", [id, userId, role, by]);
}
export async function removePortfolioMember(id: number, userId: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("DELETE FROM portfolio_members WHERE portfolio_id = ? AND user_id = ?", [id, userId]);
}
// Active people with the Projects module (or Super Admin): who may be told or added.
export async function withProjectsModule(userIds: readonly number[], db: Queryable = getDbPool()): Promise<number[]> {
  if (!userIds.length) return [];
  const [rows] = await db.query<Row[]>(
    "SELECT u.id FROM users u WHERE u.id IN (?) AND u.active = TRUE AND (FIND_IN_SET('PROJECT', u.module_access) > 0 OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.code = 'SUPER_ADMIN'))",
    [[...userIds]],
  );
  const allowed = new Set(rows.map((row) => num(row.id)));
  return userIds.filter((id) => allowed.has(id));
}
export async function activePeople(userIds: readonly number[], db: Queryable = getDbPool()): Promise<Set<number>> {
  if (!userIds.length) return new Set();
  const [rows] = await db.query<Row[]>("SELECT id FROM users WHERE id IN (?) AND active = TRUE", [[...userIds]]);
  return new Set(rows.map((row) => num(row.id)));
}
export async function isStarred(userId: number, id: number, db: Queryable = getDbPool()): Promise<boolean> {
  const [rows] = await db.query<Row[]>("SELECT 1 FROM work_favourites WHERE user_id = ? AND object_type = 'PORTFOLIO' AND object_id = ?", [userId, id]);
  return rows.length > 0;
}
export async function toggleStar(userId: number, id: number, db: Queryable = getDbPool()): Promise<boolean> {
  const [removed] = await db.query<ResultSetHeader>("DELETE FROM work_favourites WHERE user_id = ? AND object_type = 'PORTFOLIO' AND object_id = ?", [userId, id]);
  if (removed.affectedRows) return false;
  await db.query<ResultSetHeader>("INSERT IGNORE INTO work_favourites (user_id, object_type, object_id) VALUES (?, 'PORTFOLIO', ?)", [userId, id]);
  return true;
}

// ---- items ---------------------------------------------------------------------------------
export interface ItemRecord {
  id: number;
  portfolioId: number;
  projectId: number | null;
  childId: number | null;
  priority: PortfolioPriority | null;
  position: number;
  addedById: number;
  addedByName: string;
  addedAt: string;
}
const toItem = (row: Row): ItemRecord => ({
  id: num(row.id),
  portfolioId: num(row.portfolio_id),
  projectId: maybeNum(row.project_id),
  childId: maybeNum(row.child_portfolio_id),
  priority: (row.priority as PortfolioPriority | null) ?? null,
  position: Number(row.position),
  addedById: num(row.added_by),
  addedByName: String(row.added_by_name),
  addedAt: iso(row.added_at)!,
});
// A portfolio's items, without deleted projects or portfolios (they come back on restore).
export async function listItems(portfolioId: number, db: Queryable = getDbPool()): Promise<ItemRecord[]> {
  const [rows] = await db.query<Row[]>(
    `SELECT i.*, u.name AS added_by_name FROM portfolio_items i JOIN users u ON u.id = i.added_by
     LEFT JOIN projects p ON p.id = i.project_id LEFT JOIN portfolios c ON c.id = i.child_portfolio_id
     WHERE i.portfolio_id = ? AND p.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY i.position, i.id`,
    [portfolioId],
  );
  return rows.map(toItem);
}
export async function findItem(id: number, db: Queryable = getDbPool()): Promise<ItemRecord | null> {
  const [rows] = await db.query<Row[]>("SELECT i.*, u.name AS added_by_name FROM portfolio_items i JOIN users u ON u.id = i.added_by WHERE i.id = ?", [id]);
  return rows[0] ? toItem(rows[0]) : null;
}
export async function countItems(portfolioId: number, db: Queryable): Promise<number> {
  const [rows] = await db.query<Row[]>("SELECT COUNT(*) AS n FROM portfolio_items WHERE portfolio_id = ?", [portfolioId]);
  return num(rows[0]?.n ?? 0);
}
export async function insertItem(portfolioId: number, item: { projectId: number | null; childId: number | null }, by: number, db: Queryable): Promise<number | "DUPLICATE"> {
  const [last] = await db.query<Row[]>("SELECT COALESCE(MAX(position), 0) AS p FROM portfolio_items WHERE portfolio_id = ?", [portfolioId]);
  try {
    const [result] = await db.query<ResultSetHeader>("INSERT INTO portfolio_items (portfolio_id, project_id, child_portfolio_id, position, added_by) VALUES (?, ?, ?, ?, ?)", [
      portfolioId,
      item.projectId,
      item.childId,
      Number(last[0]?.p ?? 0) + 1024,
      by,
    ]);
    return result.insertId;
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return "DUPLICATE";
    throw error;
  }
}
export async function deleteItem(id: number, db: Queryable): Promise<void> {
  await db.query("DELETE FROM portfolio_field_values WHERE item_id = ?", [id]);
  await db.query("DELETE FROM portfolio_items WHERE id = ?", [id]);
}
export async function setItemPriority(id: number, priority: PortfolioPriority | null, db: Queryable = getDbPool()): Promise<void> {
  await db.query("UPDATE portfolio_items SET priority = ? WHERE id = ?", [priority, id]);
}
// Every portfolio-in-portfolio link (deleted portfolios too, so a restore can't make a circle).
export async function nestingEdges(db: Queryable = getDbPool()): Promise<[number, number][]> {
  const [rows] = await db.query<Row[]>("SELECT portfolio_id, child_portfolio_id FROM portfolio_items WHERE child_portfolio_id IS NOT NULL");
  return rows.map((row) => [num(row.portfolio_id), num(row.child_portfolio_id)]);
}
// Every live item link (for roll-ups through nested portfolios).
export async function allItemLinks(db: Queryable = getDbPool()): Promise<ItemLink[]> {
  const [rows] = await db.query<Row[]>(
    `SELECT i.portfolio_id, i.project_id, i.child_portfolio_id FROM portfolio_items i JOIN portfolios pf ON pf.id = i.portfolio_id AND pf.deleted_at IS NULL
     LEFT JOIN projects p ON p.id = i.project_id LEFT JOIN portfolios c ON c.id = i.child_portfolio_id
     WHERE p.deleted_at IS NULL AND c.deleted_at IS NULL`,
  );
  return rows.map((row) => ({ portfolioId: num(row.portfolio_id), projectId: maybeNum(row.project_id), childId: maybeNum(row.child_portfolio_id) }));
}

// ---- what the viewer can see -------------------------------------------------------------------
export async function visibleProjectIds(viewer: WorkViewer, ids: readonly number[], db: Queryable = getDbPool()): Promise<Set<number>> {
  if (!ids.length) return new Set();
  const visible = visibleProjectClause(viewer);
  const [rows] = await db.query<Row[]>(`SELECT p.id FROM projects p WHERE p.id IN (?) AND p.is_template = FALSE AND ${visible.sql}`, [[...ids], ...visible.params]);
  return new Set(rows.map((row) => num(row.id)));
}
export async function visiblePortfolioIds(viewer: WorkViewer, ids: readonly number[], db: Queryable = getDbPool()): Promise<Set<number>> {
  if (!ids.length) return new Set();
  const visible = visiblePortfolioClause(viewer);
  const [rows] = await db.query<Row[]>(`SELECT pf.id FROM portfolios pf WHERE pf.id IN (?) AND ${visible.sql}`, [[...ids], ...visible.params]);
  return new Set(rows.map((row) => num(row.id)));
}

// ---- figures ----------------------------------------------------------------------------------
export interface ProjectInfo {
  id: number;
  name: string;
  color: string;
  status: ProjectStatusKind | null;
  statusAt: string | null;
  startOn: string | null;
  dueOn: string | null;
  ownerId: number;
  ownerName: string;
  archived: boolean;
}
export async function projectInfo(ids: readonly number[], db: Queryable = getDbPool()): Promise<Map<number, ProjectInfo>> {
  const out = new Map<number, ProjectInfo>();
  if (!ids.length) return out;
  const [rows] = await db.query<Row[]>(
    `SELECT p.id, p.name, p.color, p.current_status, p.start_on, p.due_on, p.owner_id, o.name AS owner_name, p.archived_at,
       (SELECT MAX(s.created_at) FROM project_status_updates s WHERE s.project_id = p.id AND s.deleted_at IS NULL) AS status_at
     FROM projects p JOIN users o ON o.id = p.owner_id WHERE p.id IN (?)`,
    [[...ids]],
  );
  for (const row of rows)
    out.set(num(row.id), {
      id: num(row.id),
      name: String(row.name),
      color: String(row.color),
      status: (row.current_status as ProjectStatusKind | null) ?? null,
      statusAt: iso(row.status_at),
      startOn: day(row.start_on),
      dueOn: day(row.due_on),
      ownerId: num(row.owner_id),
      ownerName: String(row.owner_name),
      archived: row.archived_at !== null,
    });
  return out;
}
export async function portfolioInfo(ids: readonly number[], db: Queryable = getDbPool()): Promise<Map<number, ProjectInfo>> {
  const out = new Map<number, ProjectInfo>();
  if (!ids.length) return out;
  const [rows] = await db.query<Row[]>(
    `SELECT pf.id, pf.name, pf.color, pf.current_status, pf.start_on, pf.due_on, pf.owner_id, o.name AS owner_name, pf.archived_at,
       (SELECT MAX(s.created_at) FROM portfolio_status_updates s WHERE s.portfolio_id = pf.id AND s.deleted_at IS NULL) AS status_at
     FROM portfolios pf JOIN users o ON o.id = pf.owner_id WHERE pf.id IN (?)`,
    [[...ids]],
  );
  for (const row of rows)
    out.set(num(row.id), {
      id: num(row.id),
      name: String(row.name),
      color: String(row.color),
      status: (row.current_status as ProjectStatusKind | null) ?? null,
      statusAt: iso(row.status_at),
      startOn: day(row.start_on),
      dueOn: day(row.due_on),
      ownerId: num(row.owner_id),
      ownerName: String(row.owner_name),
      archived: row.archived_at !== null,
    });
  return out;
}
// Tasks of each project (top-level tasks in the project; cancelled and deleted never count).
export async function taskCountsByProject(ids: readonly number[], db: Queryable = getDbPool()): Promise<Map<number, TaskCounts>> {
  const out = new Map<number, TaskCounts>();
  if (!ids.length) return out;
  const [rows] = await db.query<Row[]>(
    `SELECT tp.project_id, SUM(t.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED')) AS total_n, SUM(t.status = 'COMPLETED') AS done_n,
       SUM(t.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED') AND t.due_at < UTC_TIMESTAMP()) AS late_n
     FROM task_projects tp JOIN tasks t ON t.id = tp.task_id AND t.deleted_at IS NULL WHERE tp.project_id IN (?) GROUP BY tp.project_id`,
    [[...ids]],
  );
  for (const row of rows) out.set(num(row.project_id), { total: num(row.total_n ?? 0), completed: num(row.done_n ?? 0), overdue: num(row.late_n ?? 0) });
  return out;
}
// The same over a set of projects, each task once (a task can be in two of them).
export async function distinctTaskCounts(ids: readonly number[], db: Queryable = getDbPool()): Promise<TaskCounts> {
  if (!ids.length) return { total: 0, completed: 0, overdue: 0 };
  const [rows] = await db.query<Row[]>(
    `SELECT SUM(t.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED')) AS total_n, SUM(t.status = 'COMPLETED') AS done_n,
       SUM(t.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED') AND t.due_at < UTC_TIMESTAMP()) AS late_n
     FROM tasks t WHERE t.deleted_at IS NULL AND t.id IN (SELECT tp.task_id FROM task_projects tp WHERE tp.project_id IN (?))`,
    [[...ids]],
  );
  return { total: num(rows[0]?.total_n ?? 0), completed: num(rows[0]?.done_n ?? 0), overdue: num(rows[0]?.late_n ?? 0) };
}
// India days each task was created and completed (for the burnup), each task once.
export async function taskDays(ids: readonly number[], db: Queryable = getDbPool()): Promise<{ created: string; completed: string | null }[]> {
  if (!ids.length) return [];
  const [rows] = await db.query<Row[]>(
    `SELECT DATE_FORMAT(DATE_ADD(t.created_at, INTERVAL 330 MINUTE), '%Y-%m-%d') AS c,
       CASE WHEN t.status = 'COMPLETED' AND t.completed_at IS NOT NULL THEN DATE_FORMAT(DATE_ADD(t.completed_at, INTERVAL 330 MINUTE), '%Y-%m-%d') END AS d
     FROM tasks t WHERE t.deleted_at IS NULL AND t.status <> 'CANCELLED' AND t.id IN (SELECT tp.task_id FROM task_projects tp WHERE tp.project_id IN (?))`,
    [[...ids]],
  );
  return rows.map((row) => ({ created: String(row.c), completed: str(row.d) }));
}

// ---- own columns -------------------------------------------------------------------------------
export interface PortfolioField {
  id: number;
  name: string;
  kind: PortfolioFieldKind;
  options: string[];
}
export async function listFields(portfolioId: number, db: Queryable = getDbPool()): Promise<PortfolioField[]> {
  const [rows] = await db.query<Row[]>("SELECT id, name, kind, options_json FROM portfolio_fields WHERE portfolio_id = ? ORDER BY position, id", [portfolioId]);
  return rows.map((row) => {
    const raw = typeof row.options_json === "string" ? (JSON.parse(row.options_json) as unknown) : row.options_json;
    return { id: num(row.id), name: String(row.name), kind: row.kind as PortfolioFieldKind, options: Array.isArray(raw) ? raw.map(String) : [] };
  });
}
export async function insertField(portfolioId: number, field: { name: string; kind: PortfolioFieldKind; options: string[] }, by: number, db: Queryable): Promise<number> {
  const [last] = await db.query<Row[]>("SELECT COALESCE(MAX(position), 0) AS p FROM portfolio_fields WHERE portfolio_id = ?", [portfolioId]);
  const [result] = await db.query<ResultSetHeader>("INSERT INTO portfolio_fields (portfolio_id, name, kind, options_json, position, created_by) VALUES (?, ?, ?, ?, ?, ?)", [
    portfolioId,
    field.name,
    field.kind,
    field.kind === "SELECT" ? JSON.stringify(field.options) : null,
    Number(last[0]?.p ?? 0) + 1024,
    by,
  ]);
  return result.insertId;
}
export async function deleteField(fieldId: number, db: Queryable): Promise<void> {
  await db.query("DELETE FROM portfolio_field_values WHERE field_id = ?", [fieldId]);
  await db.query("DELETE FROM portfolio_fields WHERE id = ?", [fieldId]);
}
export async function fieldValues(itemIds: readonly number[], db: Queryable = getDbPool()): Promise<Map<number, Record<number, string>>> {
  const out = new Map<number, Record<number, string>>();
  if (!itemIds.length) return out;
  const [rows] = await db.query<Row[]>("SELECT item_id, field_id, value FROM portfolio_field_values WHERE item_id IN (?)", [[...itemIds]]);
  for (const row of rows) out.set(num(row.item_id), { ...(out.get(num(row.item_id)) ?? {}), [num(row.field_id)]: String(row.value) });
  return out;
}
export async function setFieldValue(itemId: number, fieldId: number, value: string | null, by: number, db: Queryable = getDbPool()): Promise<void> {
  if (value === null) await db.query("DELETE FROM portfolio_field_values WHERE item_id = ? AND field_id = ?", [itemId, fieldId]);
  else await db.query("INSERT INTO portfolio_field_values (item_id, field_id, value, updated_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)", [itemId, fieldId, value, by]);
}

// ---- status updates ----------------------------------------------------------------------------
export interface PortfolioStatusUpdate {
  id: number;
  status: ProjectStatusKind;
  title: string;
  body: string | null;
  authorId: number;
  authorName: string;
  createdAt: Date;
}
export async function listStatusUpdates(portfolioId: number, limit = 20, db: Queryable = getDbPool()): Promise<PortfolioStatusUpdate[]> {
  const [rows] = await db.query<Row[]>(
    "SELECT s.*, u.name AS author_name FROM portfolio_status_updates s JOIN users u ON u.id = s.author_id WHERE s.portfolio_id = ? AND s.deleted_at IS NULL ORDER BY s.id DESC LIMIT ?",
    [portfolioId, limit],
  );
  return rows.map((row) => ({ id: num(row.id), status: row.status as ProjectStatusKind, title: String(row.title), body: str(row.body), authorId: num(row.author_id), authorName: String(row.author_name), createdAt: row.created_at as Date }));
}
export async function insertStatusUpdate(portfolioId: number, value: { status: ProjectStatusKind; title: string; body: string | null }, authorId: number, db: Queryable): Promise<number> {
  const [result] = await db.query<ResultSetHeader>("INSERT INTO portfolio_status_updates (portfolio_id, status, title, body, author_id) VALUES (?, ?, ?, ?, ?)", [portfolioId, value.status, value.title, value.body, authorId]);
  return result.insertId;
}
export async function findStatusUpdate(id: number, db: Queryable = getDbPool()): Promise<{ id: number; portfolioId: number; authorId: number } | null> {
  const [rows] = await db.query<Row[]>("SELECT id, portfolio_id, author_id FROM portfolio_status_updates WHERE id = ? AND deleted_at IS NULL", [id]);
  return rows[0] ? { id: num(rows[0].id), portfolioId: num(rows[0].portfolio_id), authorId: num(rows[0].author_id) } : null;
}
export async function deleteStatusUpdate(id: number, db: Queryable): Promise<void> {
  await db.query("UPDATE portfolio_status_updates SET deleted_at = UTC_TIMESTAMP() WHERE id = ?", [id]);
}
// The status of the latest live update (after one is deleted), or none.
export async function latestStatus(portfolioId: number, db: Queryable): Promise<ProjectStatusKind | null> {
  const [rows] = await db.query<Row[]>("SELECT status FROM portfolio_status_updates WHERE portfolio_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1", [portfolioId]);
  return (rows[0]?.status as ProjectStatusKind | undefined) ?? null;
}

// ---- notifications -------------------------------------------------------------------------------
// Live portfolios that hold a project directly, with their owners (members with OWNER, and the owner).
export async function portfoliosHoldingProject(projectId: number, db: Queryable = getDbPool()): Promise<{ id: number; name: string; ownerIds: number[] }[]> {
  const [rows] = await db.query<Row[]>(
    `SELECT pf.id, pf.name, pf.owner_id, (SELECT GROUP_CONCAT(m.user_id) FROM portfolio_members m WHERE m.portfolio_id = pf.id AND m.role = 'OWNER') AS owners
     FROM portfolio_items i JOIN portfolios pf ON pf.id = i.portfolio_id WHERE i.project_id = ? AND pf.deleted_at IS NULL AND pf.archived_at IS NULL`,
    [projectId],
  );
  return rows.map((row) => ({
    id: num(row.id),
    name: String(row.name),
    ownerIds: [...new Set([num(row.owner_id), ...String(row.owners ?? "").split(",").filter(Boolean).map(Number)])],
  }));
}

// ---- pickers --------------------------------------------------------------------------------------
// Projects and portfolios the person can see, by name (Add work, the wizard).
export async function workCandidates(viewer: WorkViewer, q: string, limit = 30, db: Queryable = getDbPool()): Promise<{ projects: { id: number; name: string; color: string }[]; portfolios: { id: number; name: string; color: string; items: number }[] }> {
  const project = visibleProjectClause(viewer);
  const like = escapeLike(q);
  const [projects] = await db.query<Row[]>(`SELECT p.id, p.name, p.color FROM projects p WHERE p.is_template = FALSE AND p.archived_at IS NULL AND ${project.sql} AND p.name LIKE ? ORDER BY p.name LIMIT ?`, [...project.params, like, limit]);
  const portfolios = await listVisiblePortfolios(viewer, { q, limit }, db);
  return {
    projects: projects.map((row) => ({ id: num(row.id), name: String(row.name), color: String(row.color) })),
    portfolios: portfolios.map((item) => ({ id: item.id, name: item.name, color: item.color, items: item.items })),
  };
}
