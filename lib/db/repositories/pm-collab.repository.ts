import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";
import { visibleTaskClause } from "@/lib/db/repositories/work.repository";
import type { WorkViewer } from "@/server/work/access";
import type { FileItem, FileSource } from "@/server/work/collab-rules";

// v1.71.0 (D-384, PM phase E part 2): the project's files (from its tasks,
// their form submissions and its messages), project messages with their
// versions and reactions, the project page with its versions, and time
// entries on tasks. Raw SQL; the service (server/work/collab.ts,
// server/work/time-tracking.ts) checks every permission first.
type Row = RowDataPacket & Record<string, unknown>;
const db = () => getDbPool();
const num = (value: unknown) => Number(value);
const iso = (value: unknown) => (value instanceof Date ? value : new Date(String(value))).toISOString();
const textOrNull = (value: unknown) => (value === null || value === undefined ? null : String(value));

// ---- files --------------------------------------------------------------------------------
// Files on the project's tasks and their subtasks that the viewer may see,
// and files on the project's messages that aren't deleted. Newest first, at most 2,000.
export async function projectFiles(projectId: number, viewer: WorkViewer, connection: Queryable = db()): Promise<FileItem[]> {
  const visible = visibleTaskClause(viewer);
  const [taskRows] = await connection.query<Row[]>(
    `SELECT f.id, f.original_name, f.content_type, f.size_bytes, f.created_at, f.uploaded_by, u.name AS uploader_name,
       t.id AS task_id, t.task_no, t.title AS task_title,
       (t.source_form_id IS NOT NULL AND EXISTS (SELECT 1 FROM project_form_submissions s WHERE s.task_id = t.id AND s.submitter_id = f.uploaded_by
          AND ABS(TIMESTAMPDIFF(SECOND, s.created_at, f.created_at)) < 120)) AS from_form
     FROM record_files f
     JOIN users u ON u.id = f.uploaded_by
     JOIN tasks t ON t.id = f.entity_id
     JOIN users a ON a.id = t.assignee_id
     WHERE f.entity_type = 'TASK'
       AND EXISTS (SELECT 1 FROM task_projects ftp WHERE ftp.project_id = ? AND ftp.task_id IN (t.id, COALESCE(t.root_task_id, t.id)))
       AND ${visible.sql}
     ORDER BY f.id DESC LIMIT 2000`,
    [projectId, ...visible.params],
  );
  const [messageRows] = await connection.query<Row[]>(
    `SELECT f.id, f.original_name, f.content_type, f.size_bytes, f.created_at, f.uploaded_by, u.name AS uploader_name,
       COALESCE(m.parent_id, m.id) AS thread_id, COALESCE(p.subject, m.subject) AS subject
     FROM record_files f
     JOIN users u ON u.id = f.uploaded_by
     JOIN project_messages m ON m.id = f.entity_id
     LEFT JOIN project_messages p ON p.id = m.parent_id
     WHERE f.entity_type = 'PROJECT_MESSAGE' AND m.project_id = ? AND m.deleted_at IS NULL AND (p.id IS NULL OR p.deleted_at IS NULL)
     ORDER BY f.id DESC LIMIT 2000`,
    [projectId],
  );
  const base = (row: Row) => ({
    id: num(row.id),
    name: String(row.original_name),
    contentType: String(row.content_type),
    size: num(row.size_bytes),
    createdAt: iso(row.created_at),
    uploaderId: num(row.uploaded_by),
    uploaderName: String(row.uploader_name),
  });
  return [
    ...taskRows.map((row) => ({ ...base(row), source: (Number(row.from_form) ? "FORM" : "TASK") as FileSource, taskId: num(row.task_id), taskNo: String(row.task_no), taskTitle: String(row.task_title), messageId: null, messageSubject: null })),
    ...messageRows.map((row) => ({ ...base(row), source: "MESSAGE" as FileSource, taskId: null, taskNo: null, taskTitle: null, messageId: num(row.thread_id), messageSubject: textOrNull(row.subject) })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
}

// ---- messages -----------------------------------------------------------------------------
export interface MessageRow {
  id: number;
  projectId: number;
  parentId: number | null;
  authorId: number;
  authorName: string;
  subject: string | null;
  body: string;
  createdAt: Date;
  lastActivity: Date;
  edited: boolean;
  deleted: boolean;
  replies: number;
}
const toMessage = (row: Row): MessageRow => ({
  id: num(row.id),
  projectId: num(row.project_id),
  parentId: row.parent_id === null ? null : num(row.parent_id),
  authorId: num(row.author_id),
  authorName: String(row.author_name ?? "Someone"),
  subject: textOrNull(row.subject),
  body: String(row.body),
  createdAt: new Date(row.created_at as string),
  lastActivity: new Date(row.last_activity as string),
  edited: row.edited_at !== null,
  deleted: row.deleted_at !== null,
  replies: num(row.replies ?? 0),
});
const MESSAGE_SELECT = "SELECT m.*, u.name AS author_name FROM project_messages m LEFT JOIN users u ON u.id = m.author_id";

export async function insertMessage(input: { projectId: number; parentId: number | null; authorId: number; subject: string | null; body: string }, connection: Queryable): Promise<number> {
  const [result] = await connection.query<ResultSetHeader>("INSERT INTO project_messages (project_id, parent_id, author_id, subject, body) VALUES (?, ?, ?, ?, ?)", [input.projectId, input.parentId, input.authorId, input.subject, input.body]);
  if (input.parentId) await connection.query("UPDATE project_messages SET last_activity = CURRENT_TIMESTAMP(3) WHERE id = ?", [input.parentId]);
  return result.insertId;
}
// The project's threads, the newest activity first (deleted ones too: they read "deleted").
export async function listThreads(projectId: number, connection: Queryable = db()): Promise<MessageRow[]> {
  const [rows] = await connection.query<Row[]>(
    `SELECT m.*, u.name AS author_name, (SELECT COUNT(*) FROM project_messages r WHERE r.parent_id = m.id AND r.deleted_at IS NULL) AS replies
     FROM project_messages m LEFT JOIN users u ON u.id = m.author_id
     WHERE m.project_id = ? AND m.parent_id IS NULL ORDER BY m.last_activity DESC, m.id DESC LIMIT 500`,
    [projectId],
  );
  return rows.map(toMessage);
}
export async function listReplies(threadIds: readonly number[], connection: Queryable = db()): Promise<MessageRow[]> {
  if (!threadIds.length) return [];
  const [rows] = await connection.query<Row[]>(`${MESSAGE_SELECT} WHERE m.parent_id IN (?) ORDER BY m.id`, [[...threadIds]]);
  return rows.map(toMessage);
}
export async function findMessage(id: number, connection: Queryable = db(), lock = false): Promise<MessageRow | null> {
  const [rows] = await connection.query<Row[]>(`${MESSAGE_SELECT} WHERE m.id = ?${lock ? " FOR UPDATE" : ""}`, [id]);
  return rows[0] ? toMessage(rows[0]) : null;
}
// Everyone who wrote in a thread (its author and those who replied).
export async function threadPeople(threadId: number, connection: Queryable = db()): Promise<number[]> {
  const [rows] = await connection.query<Row[]>("SELECT DISTINCT author_id FROM project_messages WHERE (id = ? OR parent_id = ?) AND deleted_at IS NULL", [threadId, threadId]);
  return rows.map((row) => num(row.author_id));
}
export async function changeMessage(id: number, old: { subject: string | null; body: string }, change: { subject: string | null; body: string } | { delete: true }, actorId: number, connection: Queryable): Promise<void> {
  await connection.query("INSERT INTO project_message_versions (message_id, subject, body, change_kind, changed_by) VALUES (?, ?, ?, ?, ?)", [id, old.subject, old.body, "delete" in change ? "DELETE" : "EDIT", actorId]);
  if ("delete" in change) await connection.query("UPDATE project_messages SET deleted_at = UTC_TIMESTAMP(), deleted_by = ? WHERE id = ?", [actorId, id]);
  else await connection.query("UPDATE project_messages SET subject = ?, body = ?, edited_at = UTC_TIMESTAMP(), edited_by = ? WHERE id = ?", [change.subject, change.body, actorId, id]);
}
export interface MessageVersion {
  id: number;
  subject: string | null;
  body: string;
  kind: "EDIT" | "DELETE";
  changedByName: string;
  changedAt: Date;
}
export async function listMessageVersions(id: number, connection: Queryable = db()): Promise<MessageVersion[]> {
  const [rows] = await connection.query<Row[]>("SELECT v.*, u.name FROM project_message_versions v LEFT JOIN users u ON u.id = v.changed_by WHERE v.message_id = ? ORDER BY v.id", [id]);
  return rows.map((row) => ({ id: num(row.id), subject: textOrNull(row.subject), body: String(row.body), kind: row.change_kind as "EDIT" | "DELETE", changedByName: String(row.name ?? "Someone"), changedAt: new Date(row.changed_at as string) }));
}
export async function toggleMessageReaction(messageId: number, userId: number, key: string, connection: Queryable = db()): Promise<boolean> {
  const [removed] = await connection.query<ResultSetHeader>("DELETE FROM project_message_reactions WHERE message_id = ? AND user_id = ? AND reaction = ?", [messageId, userId, key]);
  if (removed.affectedRows) return false;
  await connection.query("INSERT IGNORE INTO project_message_reactions (message_id, user_id, reaction) VALUES (?, ?, ?)", [messageId, userId, key]);
  return true;
}
export async function messageReactions(messageIds: readonly number[], userId: number, connection: Queryable = db()): Promise<{ commentId: number; key: string; count: number; mine: boolean }[]> {
  if (!messageIds.length) return [];
  const [rows] = await connection.query<Row[]>("SELECT message_id, reaction, COUNT(*) AS total, SUM(user_id = ?) AS mine FROM project_message_reactions WHERE message_id IN (?) GROUP BY message_id, reaction", [userId, [...messageIds]]);
  return rows.map((row) => ({ commentId: num(row.message_id), key: String(row.reaction), count: num(row.total), mine: num(row.mine) > 0 }));
}
export interface MessageFile {
  id: number;
  messageId: number;
  name: string;
  contentType: string;
  size: number;
}
export async function messageFiles(messageIds: readonly number[], connection: Queryable = db()): Promise<MessageFile[]> {
  if (!messageIds.length) return [];
  const [rows] = await connection.query<Row[]>("SELECT id, entity_id, original_name, content_type, size_bytes FROM record_files WHERE entity_type = 'PROJECT_MESSAGE' AND entity_id IN (?) ORDER BY id", [[...messageIds]]);
  return rows.map((row) => ({ id: num(row.id), messageId: num(row.entity_id), name: String(row.original_name), contentType: String(row.content_type), size: num(row.size_bytes) }));
}

// ---- page ---------------------------------------------------------------------------------
export interface PageRow {
  projectId: number;
  title: string;
  body: string;
  rowVersion: number;
  updatedByName: string;
  updatedAt: Date;
}
export async function findPage(projectId: number, connection: Queryable = db(), lock = false): Promise<PageRow | null> {
  const [rows] = await connection.query<Row[]>(`SELECT pg.*, u.name AS updated_by_name FROM project_pages pg LEFT JOIN users u ON u.id = pg.updated_by WHERE pg.project_id = ?${lock ? " FOR UPDATE" : ""}`, [projectId]);
  const row = rows[0];
  return row ? { projectId, title: String(row.title), body: String(row.body), rowVersion: num(row.row_version), updatedByName: String(row.updated_by_name ?? "Someone"), updatedAt: new Date(row.updated_at as string) } : null;
}
// Writes the page (a new row at version 1, or the next version) and its version row.
export async function writePage(projectId: number, input: { title: string; body: string; restoredFrom: number | null }, current: PageRow | null, actorId: number, connection: Queryable): Promise<number> {
  const next = (current?.rowVersion ?? 0) + 1;
  if (current) await connection.query("UPDATE project_pages SET title = ?, body = ?, row_version = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE project_id = ?", [input.title, input.body, next, actorId, projectId]);
  else await connection.query("INSERT INTO project_pages (project_id, title, body, row_version, updated_by) VALUES (?, ?, ?, 1, ?)", [projectId, input.title, input.body, actorId]);
  await connection.query("INSERT INTO project_page_versions (project_id, version_no, title, body, restored_from, saved_by) VALUES (?, ?, ?, ?, ?, ?)", [projectId, next, input.title, input.body, input.restoredFrom, actorId]);
  return next;
}
export async function pageVersionNumbers(projectId: number, connection: Queryable): Promise<number[]> {
  const [rows] = await connection.query<Row[]>("SELECT version_no FROM project_page_versions WHERE project_id = ?", [projectId]);
  return rows.map((row) => num(row.version_no));
}
export async function dropPageVersions(projectId: number, versionNos: readonly number[], connection: Queryable): Promise<void> {
  if (versionNos.length) await connection.query("DELETE FROM project_page_versions WHERE project_id = ? AND version_no IN (?)", [projectId, [...versionNos]]);
}
export interface PageVersionItem {
  versionNo: number;
  title: string;
  size: number;
  restoredFrom: number | null;
  savedByName: string;
  savedAt: Date;
}
export async function listPageVersions(projectId: number, connection: Queryable = db()): Promise<PageVersionItem[]> {
  const [rows] = await connection.query<Row[]>(
    "SELECT v.version_no, v.title, CHAR_LENGTH(v.body) AS size, v.restored_from, v.saved_at, u.name FROM project_page_versions v LEFT JOIN users u ON u.id = v.saved_by WHERE v.project_id = ? ORDER BY v.version_no DESC LIMIT 50",
    [projectId],
  );
  return rows.map((row) => ({ versionNo: num(row.version_no), title: String(row.title), size: num(row.size), restoredFrom: row.restored_from === null ? null : num(row.restored_from), savedByName: String(row.name ?? "Someone"), savedAt: new Date(row.saved_at as string) }));
}
export async function findPageVersion(projectId: number, versionNo: number, connection: Queryable = db()): Promise<{ title: string; body: string } | null> {
  const [rows] = await connection.query<Row[]>("SELECT title, body FROM project_page_versions WHERE project_id = ? AND version_no = ?", [projectId, versionNo]);
  return rows[0] ? { title: String(rows[0].title), body: String(rows[0].body) } : null;
}
// Tasks the page links to, with what the viewer may see of them.
export async function linkedTasks(ids: readonly number[], viewer: WorkViewer, connection: Queryable = db()): Promise<{ id: number; taskNo: string; title: string; status: string; dueAt: Date | null; assigneeName: string }[]> {
  if (!ids.length) return [];
  const visible = visibleTaskClause(viewer);
  const [rows] = await connection.query<Row[]>(`SELECT t.id, t.task_no, t.title, t.status, t.due_at, a.name AS assignee_name FROM tasks t JOIN users a ON a.id = t.assignee_id WHERE t.id IN (?) AND ${visible.sql}`, [[...ids], ...visible.params]);
  const byId = new Map(rows.map((row) => [num(row.id), { id: num(row.id), taskNo: String(row.task_no), title: String(row.title), status: String(row.status), dueAt: row.due_at ? new Date(row.due_at as string) : null, assigneeName: String(row.assignee_name) }]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

// ---- time entries -------------------------------------------------------------------------
export interface TimeEntryRow {
  id: number;
  taskId: number;
  userId: number;
  userName: string;
  workDay: string;
  minutes: number | null;
  note: string | null;
  source: "MANUAL" | "TIMER";
  startedAt: Date | null;
  createdBy: number;
  createdAt: Date;
  edited: boolean;
}
const toEntry = (row: Row): TimeEntryRow => ({
  id: num(row.id),
  taskId: num(row.task_id),
  userId: num(row.user_id),
  userName: String(row.user_name ?? "Someone"),
  workDay: String(row.day),
  minutes: row.minutes === null ? null : num(row.minutes),
  note: textOrNull(row.note),
  source: row.source as "MANUAL" | "TIMER",
  startedAt: row.started_at ? new Date(row.started_at as string) : null,
  createdBy: num(row.created_by),
  createdAt: new Date(row.created_at as string),
  edited: row.edited_at !== null,
});
const ENTRY_SELECT = "SELECT e.*, DATE_FORMAT(e.work_day, '%Y-%m-%d') AS day, u.name AS user_name FROM task_time_entries e LEFT JOIN users u ON u.id = e.user_id";
export async function listTaskEntries(taskId: number, connection: Queryable = db()): Promise<TimeEntryRow[]> {
  const [rows] = await connection.query<Row[]>(`${ENTRY_SELECT} WHERE e.task_id = ? ORDER BY e.work_day DESC, e.id DESC LIMIT 500`, [taskId]);
  return rows.map(toEntry);
}
export async function findEntry(id: number, connection: Queryable = db(), lock = false): Promise<TimeEntryRow | null> {
  const [rows] = await connection.query<Row[]>(`${ENTRY_SELECT} WHERE e.id = ?${lock ? " FOR UPDATE" : ""}`, [id]);
  return rows[0] ? toEntry(rows[0]) : null;
}
export async function runningEntry(taskId: number, userId: number, connection: Queryable = db(), lock = false): Promise<TimeEntryRow | null> {
  const [rows] = await connection.query<Row[]>(`${ENTRY_SELECT} WHERE e.task_id = ? AND e.user_id = ? AND e.running = 1${lock ? " FOR UPDATE" : ""}`, [taskId, userId]);
  return rows[0] ? toEntry(rows[0]) : null;
}
export async function insertEntry(input: { taskId: number; userId: number; workDay: string; minutes: number | null; note: string | null; source: "MANUAL" | "TIMER"; startedAt: Date | null; createdBy: number }, connection: Queryable): Promise<number> {
  const [result] = await connection.query<ResultSetHeader>(
    "INSERT INTO task_time_entries (task_id, user_id, work_day, minutes, note, source, started_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [input.taskId, input.userId, input.workDay, input.minutes, input.note, input.source, input.startedAt, input.createdBy],
  );
  return result.insertId;
}
export async function updateEntry(id: number, change: { workDay: string; minutes: number; note: string | null }, actorId: number, connection: Queryable): Promise<void> {
  await connection.query("UPDATE task_time_entries SET work_day = ?, minutes = ?, note = ?, edited_at = UTC_TIMESTAMP(), edited_by = ? WHERE id = ?", [change.workDay, change.minutes, change.note, actorId, id]);
}
export async function stopEntry(id: number, minutes: number, connection: Queryable): Promise<void> {
  await connection.query("UPDATE task_time_entries SET minutes = ? WHERE id = ? AND minutes IS NULL", [minutes, id]);
}
export async function deleteEntry(id: number, connection: Queryable): Promise<void> {
  await connection.query("DELETE FROM task_time_entries WHERE id = ?", [id]);
}
export async function taskEstimate(taskId: number, connection: Queryable = db()): Promise<number | null> {
  const [rows] = await connection.query<Row[]>("SELECT time_estimate_minutes FROM tasks WHERE id = ?", [taskId]);
  return rows[0]?.time_estimate_minutes === null || rows[0]?.time_estimate_minutes === undefined ? null : num(rows[0].time_estimate_minutes);
}
export async function setEstimate(taskId: number, minutes: number | null, connection: Queryable): Promise<void> {
  await connection.query("UPDATE tasks SET time_estimate_minutes = ? WHERE id = ?", [minutes, taskId]);
}
// The project's totals over the tasks (and subtasks) the viewer may see.
export async function projectTimeTotals(projectId: number, viewer: WorkViewer, connection: Queryable = db()): Promise<{ logged: number; estimate: number; tasksWithEstimate: number }> {
  const visible = visibleTaskClause(viewer);
  const inProject = "EXISTS (SELECT 1 FROM task_projects xtp WHERE xtp.project_id = ? AND xtp.task_id IN (t.id, COALESCE(t.root_task_id, t.id)))";
  const [rows] = await connection.query<Row[]>(
    `SELECT
       (SELECT COALESCE(SUM(e.minutes), 0) FROM task_time_entries e JOIN tasks t ON t.id = e.task_id JOIN users a ON a.id = t.assignee_id WHERE ${inProject} AND ${visible.sql}) AS logged,
       (SELECT COALESCE(SUM(t.time_estimate_minutes), 0) FROM tasks t JOIN users a ON a.id = t.assignee_id WHERE t.status <> 'CANCELLED' AND ${inProject} AND ${visible.sql}) AS estimate,
       (SELECT COUNT(*) FROM tasks t JOIN users a ON a.id = t.assignee_id WHERE t.time_estimate_minutes IS NOT NULL AND t.status <> 'CANCELLED' AND ${inProject} AND ${visible.sql}) AS with_estimate`,
    [projectId, ...visible.params, projectId, ...visible.params, projectId, ...visible.params],
  );
  return { logged: num(rows[0]?.logged ?? 0), estimate: num(rows[0]?.estimate ?? 0), tasksWithEstimate: num(rows[0]?.with_estimate ?? 0) };
}
export interface TimeExportRow {
  workDay: string;
  person: string;
  taskNo: string;
  title: string;
  section: string;
  minutes: number;
  note: string | null;
  source: "MANUAL" | "TIMER";
  createdAt: Date;
}
// Every stopped entry on the project's visible tasks, by day.
export async function projectTimeRows(projectId: number, viewer: WorkViewer, connection: Queryable = db()): Promise<TimeExportRow[]> {
  const visible = visibleTaskClause(viewer);
  const [rows] = await connection.query<Row[]>(
    `SELECT DATE_FORMAT(e.work_day, '%Y-%m-%d') AS day, u.name AS person, t.task_no, t.title, COALESCE(s.name, '') AS section_name, e.minutes, e.note, e.source, e.created_at
     FROM task_time_entries e
     JOIN tasks t ON t.id = e.task_id
     JOIN users a ON a.id = t.assignee_id
     JOIN users u ON u.id = e.user_id
     JOIN task_projects tp ON tp.project_id = ? AND tp.task_id = COALESCE(t.root_task_id, t.id)
     LEFT JOIN project_sections s ON s.id = tp.section_id
     WHERE e.minutes IS NOT NULL AND ${visible.sql}
     ORDER BY e.work_day, u.name, e.id LIMIT 20000`,
    [projectId, ...visible.params],
  );
  return rows.map((row) => ({ workDay: String(row.day), person: String(row.person), taskNo: String(row.task_no), title: String(row.title), section: String(row.section_name), minutes: num(row.minutes), note: textOrNull(row.note), source: row.source as "MANUAL" | "TIMER", createdAt: new Date(row.created_at as string) }));
}
