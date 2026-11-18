import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";
import type { TicketStatus } from "@/server/tickets/rules";
import type { TicketPriority } from "@/server/modules/settings";

// v1.55.0 (D-326, D-327): Ticketing System data. Bound values only.
type Row = RowDataPacket & Record<string, unknown>;
const num = (value: unknown) => Number(value ?? 0);
const json = <T,>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

// ---- categories --------------------------------------------------------------------------
export interface TicketCategory {
  id: number;
  code: string;
  name: string;
  numberPrefix: string;
  numberDigits: number;
  position: number;
  active: boolean;
}
const toCategory = (row: Row): TicketCategory => ({ id: num(row.id), code: String(row.code), name: String(row.name), numberPrefix: String(row.number_prefix), numberDigits: num(row.number_digits), position: num(row.position), active: Boolean(row.active) });

export async function listTicketCategories(activeOnly = false, db: Queryable = getDbPool()): Promise<TicketCategory[]> {
  const [rows] = await db.query<Row[]>(`SELECT * FROM ticket_categories ${activeOnly ? "WHERE active = TRUE" : ""} ORDER BY position, name`);
  return rows.map(toCategory);
}
export async function findTicketCategory(id: number, db: Queryable = getDbPool()): Promise<TicketCategory | null> {
  const [rows] = await db.query<Row[]>("SELECT * FROM ticket_categories WHERE id = ?", [id]);
  return rows[0] ? toCategory(rows[0]) : null;
}
export async function insertTicketCategory(input: { code: string; name: string; numberPrefix: string; numberDigits: number; position: number }, by: number, db: Queryable): Promise<number | "DUPLICATE"> {
  try {
    const [result] = await db.query<ResultSetHeader>("INSERT INTO ticket_categories (code, name, number_prefix, number_digits, position, created_by) VALUES (?, ?, ?, ?, ?, ?)", [input.code, input.name, input.numberPrefix, input.numberDigits, input.position, by]);
    return result.insertId;
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return "DUPLICATE";
    throw error;
  }
}
export async function updateTicketCategory(id: number, input: { name: string; numberPrefix: string; numberDigits: number; position: number; active: boolean }, db: Queryable): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>("UPDATE ticket_categories SET name = ?, number_prefix = ?, number_digits = ?, position = ?, active = ? WHERE id = ?", [input.name, input.numberPrefix, input.numberDigits, input.position, input.active, id]);
  return result.affectedRows === 1;
}

// ---- a form's category and coordinators (kept with the form, not a version) -----------------
export interface TicketFormSetupData {
  categoryId: number | null;
  coordinatorIds: number[];
  categories: TicketCategory[];
}
export async function ticketFormSetup(typeId: number, db: Queryable = getDbPool()): Promise<TicketFormSetupData> {
  const [[category], [coordinators], categories] = await Promise.all([
    db.query<Row[]>("SELECT category_id FROM ticket_request_types WHERE type_id = ?", [typeId]),
    db.query<Row[]>("SELECT c.user_id FROM ticket_coordinators c JOIN users u ON u.id = c.user_id WHERE c.type_id = ? ORDER BY u.name", [typeId]),
    listTicketCategories(false, db),
  ]);
  return { categoryId: category[0] ? num(category[0].category_id) : null, coordinatorIds: coordinators.map((row) => num(row.user_id)), categories };
}
export async function saveTicketFormSetup(typeId: number, categoryId: number, userIds: readonly number[], by: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("INSERT INTO ticket_request_types (type_id, category_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE category_id = VALUES(category_id)", [typeId, categoryId]);
  await db.query<ResultSetHeader>(userIds.length ? "DELETE FROM ticket_coordinators WHERE type_id = ? AND user_id NOT IN (?)" : "DELETE FROM ticket_coordinators WHERE type_id = ?", userIds.length ? [typeId, [...userIds]] : [typeId]);
  for (const userId of userIds) await db.query<ResultSetHeader>("INSERT IGNORE INTO ticket_coordinators (type_id, user_id, added_by) VALUES (?, ?, ?)", [typeId, userId, by]);
}
// Active coordinators of a form.
export async function coordinatorsOf(typeId: number, db: Queryable = getDbPool()): Promise<{ id: number; name: string }[]> {
  const [rows] = await db.query<Row[]>("SELECT u.id, u.name FROM ticket_coordinators c JOIN users u ON u.id = c.user_id WHERE c.type_id = ? AND u.active = TRUE ORDER BY u.name", [typeId]);
  return rows.map((row) => ({ id: num(row.id), name: String(row.name) }));
}
export async function isCoordinatorOf(typeId: number, userId: number, db: Queryable = getDbPool()): Promise<boolean> {
  const [rows] = await db.query<Row[]>("SELECT 1 FROM ticket_coordinators WHERE type_id = ? AND user_id = ? LIMIT 1", [typeId, userId]);
  return rows.length > 0;
}
export async function coordinatesAny(userId: number, db: Queryable = getDbPool()): Promise<boolean> {
  const [rows] = await db.query<Row[]>("SELECT 1 FROM ticket_coordinators WHERE user_id = ? LIMIT 1", [userId]);
  return rows.length > 0;
}

// Live ticket forms people can raise, with their category (only forms with a category).
export interface RaisableForm {
  typeId: number;
  versionId: number;
  name: string;
  description: string | null;
  categoryId: number;
  categoryName: string;
}
export async function listRaisableForms(db: Queryable = getDbPool()): Promise<RaisableForm[]> {
  const [rows] = await db.query<Row[]>(
    `SELECT t.id AS type_id, v.id AS version_id, t.name, t.description, c.id AS category_id, c.name AS category_name
     FROM module_types t
     JOIN module_type_versions v ON v.type_id = t.id AND v.status = 'PUBLISHED'
     JOIN ticket_request_types rt ON rt.type_id = t.id
     JOIN ticket_categories c ON c.id = rt.category_id AND c.active = TRUE
     WHERE t.module = 'TICKET' AND t.active = TRUE
     ORDER BY c.position, c.name, rt.position, t.name`,
  );
  return rows.map((row) => ({ typeId: num(row.type_id), versionId: num(row.version_id), name: String(row.name), description: row.description ? String(row.description) : null, categoryId: num(row.category_id), categoryName: String(row.category_name) }));
}

// ---- tickets --------------------------------------------------------------------------------
export interface TicketRecord {
  id: number;
  ticketNo: string;
  categoryId: number;
  categoryName: string;
  typeId: number;
  typeName: string;
  typeVersionId: number;
  title: string;
  description: string | null;
  formData: Record<string, unknown>;
  requesterId: number;
  requesterName: string;
  requesterDepartmentId: number | null;
  departmentName: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  closeKind: string | null;
  closeReason: string | null;
  requiredOn: string | null;
  requesterLoginId: string;
  requesterEmail: string;
  assigneeId: number | null;
  assigneeName: string | null;
  coordinatorId: number | null;
  coordinatorName: string | null;
  taskId: number | null;
  taskNo: string | null;
  dueAt: Date | null;
  submittedAt: Date;
  firstResponseAt: Date | null;
  assignedAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  confirmDueOn: string | null;
  resolutionText: string | null;
  reopenCount: number;
  rowVersion: number;
}
const TICKET_SELECT = `SELECT k.*, c.name AS category_name, v.type_id, t.name AS type_name, r.name AS requester_name, r.login_id AS requester_login, r.email AS requester_email, d.name AS department_name,
    a.name AS assignee_name, co.name AS coordinator_name, tk.task_no
  FROM tickets k
  JOIN ticket_categories c ON c.id = k.category_id
  JOIN module_type_versions v ON v.id = k.type_version_id
  JOIN module_types t ON t.id = v.type_id
  JOIN users r ON r.id = k.requester_id
  LEFT JOIN departments d ON d.id = k.requester_department_id
  LEFT JOIN users a ON a.id = k.assignee_id
  LEFT JOIN users co ON co.id = k.coordinator_id
  LEFT JOIN tasks tk ON tk.id = k.task_id`;
const date = (value: unknown) => (value ? new Date(value as string) : null);
const day = (value: unknown) => (value ? (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10) : null);
const toTicket = (row: Row): TicketRecord => ({
  id: num(row.id),
  ticketNo: String(row.ticket_no),
  categoryId: num(row.category_id),
  categoryName: String(row.category_name),
  typeId: num(row.type_id),
  typeName: String(row.type_name),
  typeVersionId: num(row.type_version_id),
  title: String(row.title),
  description: row.description ? String(row.description) : null,
  formData: json<Record<string, unknown>>(row.form_data_json, {}),
  requesterId: num(row.requester_id),
  requesterName: String(row.requester_name),
  requesterDepartmentId: row.requester_department_id === null ? null : num(row.requester_department_id),
  departmentName: row.department_name ? String(row.department_name) : null,
  priority: String(row.priority) as TicketPriority,
  status: String(row.status) as TicketStatus,
  closeKind: row.close_kind ? String(row.close_kind) : null,
  closeReason: row.close_reason ? String(row.close_reason) : null,
  requiredOn: day(row.required_on),
  requesterLoginId: String(row.requester_login),
  requesterEmail: String(row.requester_email),
  assigneeId: row.assignee_id === null ? null : num(row.assignee_id),
  assigneeName: row.assignee_name ? String(row.assignee_name) : null,
  coordinatorId: row.coordinator_id === null ? null : num(row.coordinator_id),
  coordinatorName: row.coordinator_name ? String(row.coordinator_name) : null,
  taskId: row.task_id === null ? null : num(row.task_id),
  taskNo: row.task_no ? String(row.task_no) : null,
  dueAt: date(row.due_at),
  submittedAt: new Date(row.submitted_at as string),
  firstResponseAt: date(row.first_response_at),
  assignedAt: date(row.assigned_at),
  resolvedAt: date(row.resolved_at),
  closedAt: date(row.closed_at),
  confirmDueOn: day(row.confirm_due_on),
  resolutionText: row.resolution_text ? String(row.resolution_text) : null,
  reopenCount: num(row.reopen_count),
  rowVersion: num(row.row_version),
});

export async function findTicket(id: number, db: Queryable = getDbPool(), lock = false): Promise<TicketRecord | null> {
  if (lock) await db.query<Row[]>("SELECT id FROM tickets WHERE id = ? FOR UPDATE", [id]);
  const [rows] = await db.query<Row[]>(`${TICKET_SELECT} WHERE k.id = ?`, [id]);
  return rows[0] ? toTicket(rows[0]) : null;
}

export async function insertTicket(
  input: { ticketNo: string; categoryId: number; typeVersionId: number; title: string; description: string | null; formData: Record<string, unknown>; requesterId: number; departmentId: number | null; priority: TicketPriority; requiredOn: string | null; submissionKey: string },
  db: Queryable,
): Promise<number | "DUPLICATE"> {
  try {
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO tickets (ticket_no, category_id, type_version_id, title, description, form_data_json, requester_id, requester_department_id, priority, required_on, status, submission_key, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', ?, UTC_TIMESTAMP())`,
      [input.ticketNo, input.categoryId, input.typeVersionId, input.title, input.description, JSON.stringify(input.formData), input.requesterId, input.departmentId, input.priority, input.requiredOn, input.submissionKey],
    );
    return result.insertId;
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return "DUPLICATE";
    throw error;
  }
}

// Every change goes through here, guarded by the row version read under the lock.
const UPDATABLE = ["status", "priority", "assignee_id", "coordinator_id", "task_id", "due_at", "first_response_at", "assigned_at", "work_started_at", "resolved_at", "confirmation_requested_at", "confirm_due_on", "closed_at", "close_kind", "close_reason", "resolution_text", "reopen_count"];
export async function updateTicket(id: number, expectedVersion: number, changes: Record<string, unknown>, db: Queryable): Promise<boolean> {
  const keys = Object.keys(changes).filter((key) => UPDATABLE.includes(key));
  if (keys.length === 0) return true;
  const [result] = await db.query<ResultSetHeader>(`UPDATE tickets SET ${keys.map((key) => `${key} = ?`).join(", ")}, row_version = row_version + 1 WHERE id = ? AND row_version = ?`, [...keys.map((key) => changes[key]), id, expectedVersion]);
  return result.affectedRows === 1;
}

export async function linkTaskToTicket(taskId: number, ticketId: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("UPDATE tasks SET ticket_id = ? WHERE id = ?", [ticketId, taskId]);
}

// ---- timeline and comments ---------------------------------------------------------------------
export interface TicketEvent {
  id: number;
  actorName: string | null;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  detail: Record<string, unknown> | null;
  internal: boolean;
  createdAt: Date;
}
export async function appendTicketEvent(ticketId: number, event: { actorId: number | null; action: string; from?: string | null; to?: string | null; detail?: Record<string, unknown> | null; internal?: boolean }, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("INSERT INTO ticket_events (ticket_id, actor_id, action, from_status, to_status, detail_json, internal) VALUES (?, ?, ?, ?, ?, ?, ?)", [
    ticketId,
    event.actorId,
    event.action,
    event.from ?? null,
    event.to ?? null,
    event.detail ? JSON.stringify(event.detail) : null,
    Boolean(event.internal),
  ]);
}
export async function listTicketEvents(ticketId: number, includeInternal: boolean, db: Queryable = getDbPool()): Promise<TicketEvent[]> {
  const [rows] = await db.query<Row[]>(`SELECT e.*, u.name AS actor_name FROM ticket_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.ticket_id = ? ${includeInternal ? "" : "AND e.internal = FALSE"} ORDER BY e.id`, [ticketId]);
  return rows.map((row) => ({ id: num(row.id), actorName: row.actor_name ? String(row.actor_name) : null, action: String(row.action), fromStatus: row.from_status ? String(row.from_status) : null, toStatus: row.to_status ? String(row.to_status) : null, detail: json<Record<string, unknown> | null>(row.detail_json, null), internal: Boolean(row.internal), createdAt: new Date(row.created_at as string) }));
}
export interface TicketComment {
  id: number;
  authorId: number;
  authorName: string;
  body: string;
  internal: boolean;
  createdAt: Date;
}
export async function insertTicketComment(ticketId: number, authorId: number, body: string, internal: boolean, db: Queryable): Promise<number> {
  const [result] = await db.query<ResultSetHeader>("INSERT INTO ticket_comments (ticket_id, author_id, body, internal) VALUES (?, ?, ?, ?)", [ticketId, authorId, body, internal]);
  return result.insertId;
}
export async function listTicketComments(ticketId: number, includeInternal: boolean, db: Queryable = getDbPool()): Promise<TicketComment[]> {
  const [rows] = await db.query<Row[]>(`SELECT c.*, u.name AS author_name FROM ticket_comments c JOIN users u ON u.id = c.author_id WHERE c.ticket_id = ? AND c.deleted_at IS NULL ${includeInternal ? "" : "AND c.internal = FALSE"} ORDER BY c.id`, [ticketId]);
  return rows.map((row) => ({ id: num(row.id), authorId: num(row.author_id), authorName: String(row.author_name), body: String(row.body), internal: Boolean(row.internal), createdAt: new Date(row.created_at as string) }));
}

// ---- lists ------------------------------------------------------------------------------------
export const TICKET_SCOPES = ["mine", "assigned", "coordinating", "all"] as const;
export type TicketScope = (typeof TICKET_SCOPES)[number];
export interface TicketListFilter {
  scope: TicketScope;
  categoryId: number | null;
  // "auto" = Closed – auto closed; "overdue" = open past the target date.
  status: "open" | "closed" | "auto" | "overdue" | TicketStatus | null;
  q: string;
  page: number;
  // Dashboard filters (owner's brief): date raised, department, priority, assigned employee.
  from?: string | null;
  to?: string | null;
  departmentId?: number | null;
  priority?: TicketPriority | null;
  assigneeId?: number | null;
}
export interface TicketListItem {
  id: number;
  ticketNo: string;
  title: string;
  categoryName: string;
  typeName: string;
  requesterName: string;
  departmentName: string | null;
  assigneeName: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  closeKind: string | null;
  submittedAt: Date;
  dueAt: Date | null;
}
export const TICKET_PAGE_SIZE = 25;
// The WHERE of a list or dashboard (scope first: it can't be widened by a filter).
function ticketWhere(filter: TicketListFilter, viewer: { id: number; isAdmin: boolean }): { clause: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.scope === "mine") {
    where.push("k.requester_id = ?");
    params.push(viewer.id);
  } else if (filter.scope === "assigned") {
    where.push("k.assignee_id = ?");
    params.push(viewer.id);
  } else if (filter.scope === "coordinating" || !viewer.isAdmin) {
    // "all" for a non-admin is what they coordinate.
    where.push("v.type_id IN (SELECT type_id FROM ticket_coordinators WHERE user_id = ?)");
    params.push(viewer.id);
  }
  if (filter.categoryId) {
    where.push("k.category_id = ?");
    params.push(filter.categoryId);
  }
  if (filter.status === "open") where.push("k.status <> 'CLOSED'");
  else if (filter.status === "closed") where.push("k.status = 'CLOSED'");
  else if (filter.status === "auto") where.push("k.status = 'CLOSED' AND k.close_kind = 'AUTO'");
  else if (filter.status === "overdue") where.push("k.status NOT IN ('CLOSED', 'AWAITING_CONFIRMATION') AND k.due_at IS NOT NULL AND k.due_at < UTC_TIMESTAMP()");
  else if (filter.status) {
    where.push("k.status = ?");
    params.push(filter.status);
  }
  if (filter.q) {
    const like = `%${filter.q.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    where.push("(k.ticket_no LIKE ? OR k.title LIKE ?)");
    params.push(like, like);
  }
  if (filter.from) {
    where.push("k.submitted_at >= (? - INTERVAL 330 MINUTE)");
    params.push(`${filter.from} 00:00:00`);
  }
  if (filter.to) {
    where.push("k.submitted_at < (? + INTERVAL 1 DAY - INTERVAL 330 MINUTE)");
    params.push(`${filter.to} 00:00:00`);
  }
  if (filter.departmentId) {
    where.push("k.requester_department_id = ?");
    params.push(filter.departmentId);
  }
  if (filter.priority) {
    where.push("k.priority = ?");
    params.push(filter.priority);
  }
  if (filter.assigneeId) {
    where.push("k.assignee_id = ?");
    params.push(filter.assigneeId);
  }
  return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}
const LIST_FROM = `FROM tickets k JOIN module_type_versions v ON v.id = k.type_version_id JOIN module_types t ON t.id = v.type_id JOIN ticket_categories c ON c.id = k.category_id JOIN users r ON r.id = k.requester_id LEFT JOIN users a ON a.id = k.assignee_id LEFT JOIN departments d ON d.id = k.requester_department_id`;

export async function listTickets(filter: TicketListFilter, viewer: { id: number; isAdmin: boolean }, db: Queryable = getDbPool()): Promise<{ items: TicketListItem[]; total: number }> {
  const { clause, params } = ticketWhere(filter, viewer);
  const [[count]] = await db.query<Row[]>(`SELECT COUNT(*) AS n ${LIST_FROM} ${clause}`, params);
  const [rows] = await db.query<Row[]>(
    `SELECT k.id, k.ticket_no, k.title, c.name AS category_name, t.name AS type_name, r.name AS requester_name, d.name AS department_name, a.name AS assignee_name, k.priority, k.status, k.close_kind, k.submitted_at, k.due_at ${LIST_FROM} ${clause} ORDER BY k.id DESC LIMIT ? OFFSET ?`,
    [...params, TICKET_PAGE_SIZE, (Math.max(1, filter.page) - 1) * TICKET_PAGE_SIZE],
  );
  return {
    total: num(count?.n),
    items: rows.map((row) => ({
      id: num(row.id),
      ticketNo: String(row.ticket_no),
      title: String(row.title),
      categoryName: String(row.category_name),
      typeName: String(row.type_name),
      requesterName: String(row.requester_name),
      departmentName: row.department_name ? String(row.department_name) : null,
      assigneeName: row.assignee_name ? String(row.assignee_name) : null,
      priority: String(row.priority) as TicketPriority,
      status: String(row.status) as TicketStatus,
      closeKind: row.close_kind ? String(row.close_kind) : null,
      submittedAt: new Date(row.submitted_at as string),
      dueAt: date(row.due_at),
    })),
  };
}

// The dashboard's numbers, from the same filters (status filter ignored: these ARE the statuses).
export interface TicketCounts {
  total: number;
  NEW: number;
  ASSIGNED: number;
  IN_PROGRESS: number;
  AWAITING_CONFIRMATION: number;
  REOPENED: number;
  CLOSED: number;
  AUTO: number;
  overdue: number;
}
export async function ticketCounts(filter: TicketListFilter, viewer: { id: number; isAdmin: boolean }, db: Queryable = getDbPool()): Promise<TicketCounts> {
  const { clause, params } = ticketWhere({ ...filter, status: null }, viewer);
  const [[row]] = await db.query<Row[]>(
    `SELECT COUNT(*) AS total,
       SUM(k.status = 'NEW') AS s_new, SUM(k.status = 'ASSIGNED') AS s_assigned, SUM(k.status = 'IN_PROGRESS') AS s_progress,
       SUM(k.status = 'AWAITING_CONFIRMATION') AS s_awaiting, SUM(k.status = 'REOPENED') AS s_reopened, SUM(k.status = 'CLOSED') AS s_closed,
       SUM(k.status = 'CLOSED' AND k.close_kind = 'AUTO') AS s_auto,
       SUM(k.status NOT IN ('CLOSED', 'AWAITING_CONFIRMATION') AND k.due_at IS NOT NULL AND k.due_at < UTC_TIMESTAMP()) AS s_overdue
     ${LIST_FROM} ${clause}`,
    params,
  );
  return { total: num(row?.total), NEW: num(row?.s_new), ASSIGNED: num(row?.s_assigned), IN_PROGRESS: num(row?.s_progress), AWAITING_CONFIRMATION: num(row?.s_awaiting), REOPENED: num(row?.s_reopened), CLOSED: num(row?.s_closed), AUTO: num(row?.s_auto), overdue: num(row?.s_overdue) };
}

// ---- the confirmation clock (auto-close job) -----------------------------------------------------
export async function awaitingTickets(db: Queryable = getDbPool()): Promise<{ id: number; requestedAt: Date; reopenCount: number }[]> {
  const [rows] = await db.query<Row[]>("SELECT id, confirmation_requested_at, reopen_count FROM tickets WHERE status = 'AWAITING_CONFIRMATION' AND confirmation_requested_at IS NOT NULL ORDER BY id LIMIT 500");
  return rows.map((row) => ({ id: num(row.id), requestedAt: new Date(row.confirmation_requested_at as string), reopenCount: num(row.reopen_count) }));
}
// Claims one stage of one confirmation cycle; only the first caller gets true.
export async function claimConfirmStep(ticketId: number, cycle: number, stage: string, db: Queryable): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>("INSERT IGNORE INTO ticket_confirm_steps (ticket_id, cycle, stage) VALUES (?, ?, ?)", [ticketId, cycle, stage]);
  return result.affectedRows === 1;
}
export async function insertTicketFeedback(ticketId: number, cycle: number, rating: number | null, comment: string | null, by: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("INSERT INTO ticket_feedback (ticket_id, cycle, rating, comment, given_by) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment)", [ticketId, cycle, rating, comment, by]);
}
export async function findTicketFeedback(ticketId: number, db: Queryable = getDbPool()): Promise<{ rating: number | null; comment: string | null; givenAt: Date } | null> {
  const [rows] = await db.query<Row[]>("SELECT rating, comment, given_at FROM ticket_feedback WHERE ticket_id = ? ORDER BY cycle DESC LIMIT 1", [ticketId]);
  return rows[0] ? { rating: rows[0].rating === null ? null : num(rows[0].rating), comment: rows[0].comment ? String(rows[0].comment) : null, givenAt: new Date(rows[0].given_at as string) } : null;
}
// The ticket a task carries out (for the task hooks).
export async function ticketIdForTask(taskId: number, db: Queryable = getDbPool()): Promise<number | null> {
  const [rows] = await db.query<Row[]>("SELECT ticket_id FROM tasks WHERE id = ?", [taskId]);
  return rows[0]?.ticket_id ? num(rows[0].ticket_id) : null;
}
