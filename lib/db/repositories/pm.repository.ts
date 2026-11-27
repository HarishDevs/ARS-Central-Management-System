import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";
import { visibleProjectClause } from "@/lib/db/repositories/work.repository";
import type { WorkViewer } from "@/server/work/access";
import { PURGE_DAYS, type ReactionKey, type SidebarList, type SidebarProject } from "@/server/work/pm-rules";

// v1.62.0 (D-368, PM phase A part 2): reactions on task comments, the
// sidebar's project lists, and the rows the 30-day purge removes.
type Row = RowDataPacket & Record<string, unknown>;
const num = (value: unknown) => Number(value);
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value ? new Date(String(value)).toISOString() : null);

// ---- reactions -------------------------------------------------------------------------
export async function reactionRows(commentIds: readonly number[], viewerId: number, db: Queryable = getDbPool()): Promise<{ commentId: number; key: string; count: number; mine: boolean }[]> {
  if (!commentIds.length) return [];
  const [rows] = await db.query<Row[]>(
    `SELECT comment_id, reaction, COUNT(*) AS n, MAX(user_id = ?) AS mine FROM comment_reactions WHERE comment_id IN (?) GROUP BY comment_id, reaction`,
    [viewerId, commentIds],
  );
  return rows.map((row) => ({ commentId: num(row.comment_id), key: String(row.reaction), count: num(row.n), mine: Number(row.mine) === 1 }));
}
// Adds the reaction, or removes it when the person already gave it. True when it is now on.
export async function toggleReaction(commentId: number, userId: number, key: ReactionKey, db: Queryable = getDbPool()): Promise<boolean> {
  const [removed] = await db.query<ResultSetHeader>("DELETE FROM comment_reactions WHERE comment_id = ? AND user_id = ? AND reaction = ?", [commentId, userId, key]);
  if (removed.affectedRows) return false;
  await db.query<ResultSetHeader>("INSERT IGNORE INTO comment_reactions (comment_id, user_id, reaction) VALUES (?, ?, ?)", [commentId, userId, key]);
  return true;
}

// ---- sidebar ---------------------------------------------------------------------------
// Starred: the projects the person starred that they can still see.
// Departments: projects shared with the person's department (its privacy, or
// the department as a member), that they can see. Never archived, templates or deleted.
export async function sidebarProjects(viewer: WorkViewer, list: SidebarList, db: Queryable = getDbPool()): Promise<SidebarProject[]> {
  if (viewer.projects === false) return [];
  if (list === "DEPARTMENTS" && !viewer.departmentId) return [];
  const visible = visibleProjectClause(viewer);
  const which =
    list === "STARRED"
      ? { sql: "f.created_at IS NOT NULL", params: [] as unknown[] }
      : {
          sql: "((p.privacy = 'DEPARTMENT' AND p.department_id = ?) OR EXISTS (SELECT 1 FROM project_members dm WHERE dm.project_id = p.id AND dm.member_type = 'DEPARTMENT' AND dm.member_id = ?))",
          params: [viewer.departmentId, viewer.departmentId] as unknown[],
        };
  const [rows] = await db.query<Row[]>(
    `SELECT p.id, p.name, p.color, o.position, r.opened_at, f.created_at AS starred_at
     FROM projects p
     LEFT JOIN work_favourites f ON f.user_id = ? AND f.object_type = 'PROJECT' AND f.object_id = p.id
     LEFT JOIN work_project_order o ON o.user_id = ? AND o.list_key = ? AND o.project_id = p.id
     LEFT JOIN work_recent_projects r ON r.user_id = ? AND r.project_id = p.id
     WHERE p.archived_at IS NULL AND p.is_template = FALSE AND ${visible.sql} AND ${which.sql}
     ORDER BY p.name LIMIT 200`,
    [viewer.id, viewer.id, list, viewer.id, ...visible.params, ...which.params],
  );
  return rows.map((row) => ({
    id: num(row.id),
    name: String(row.name),
    color: String(row.color),
    position: row.position === null || row.position === undefined ? null : Number(row.position),
    openedAt: iso(row.opened_at),
    starredAt: iso(row.starred_at),
  }));
}
// The person's manual order for one list (every id given gets its place).
export async function saveProjectOrder(userId: number, list: SidebarList, ids: readonly number[], db: Queryable = getDbPool()): Promise<void> {
  for (const [index, projectId] of ids.entries()) {
    await db.query<ResultSetHeader>(
      "INSERT INTO work_project_order (user_id, list_key, project_id, position) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE position = VALUES(position)",
      [userId, list, projectId, (index + 1) * 1024],
    );
  }
}

// ---- purge after 30 days in Deleted ----------------------------------------------------
// Tasks deleted more than 30 days ago that may be purged: not a ticket's or a
// meeting's task (those can't be deleted on their own anyway), and not linked
// to a request under a legal hold.
export async function purgeTaskCandidates(limit: number, db: Queryable = getDbPool()): Promise<{ id: number; parentId: number | null; depth: number }[]> {
  const [rows] = await db.query<Row[]>(
    `SELECT t.id, t.parent_task_id, t.depth FROM tasks t
     WHERE t.deleted_at IS NOT NULL AND t.deleted_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${PURGE_DAYS} DAY)
       AND t.ticket_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM tickets k WHERE k.task_id = t.id)
       -- v1.94.0 (D-455): a task in the Super Admin bin is deleted for good only by Super Admin (Delete permanently).
       AND NOT EXISTS (SELECT 1 FROM superadmin_bin sb WHERE sb.active_key = CONCAT('TASK:', t.id))
       AND NOT EXISTS (SELECT 1 FROM meeting_actions ma WHERE ma.task_id = t.id)
       AND (t.related_request_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM approval_requests r JOIN legal_holds h ON h.released_at IS NULL AND (
           (h.scope_type = 'REQUEST' AND h.scope_id = r.id) OR (h.scope_type = 'REQUESTER' AND h.scope_id = r.requester_id)
           OR (h.scope_type = 'WORKFLOW' AND h.scope_id = (SELECT v.workflow_id FROM workflow_versions v WHERE v.id = r.workflow_version_id)))
         WHERE r.id = t.related_request_id))
     ORDER BY t.deleted_at, t.id LIMIT ?`,
    [limit],
  );
  return rows.map((row) => ({ id: num(row.id), parentId: row.parent_task_id === null ? null : num(row.parent_task_id), depth: num(row.depth) }));
}
// Every subtask of these tasks (deleted or not): a subtask that stays keeps its parent.
export async function childrenOf(ids: readonly number[], db: Queryable = getDbPool()): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  if (!ids.length) return out;
  const [rows] = await db.query<Row[]>("SELECT id, parent_task_id FROM tasks WHERE parent_task_id IN (?)", [ids]);
  for (const row of rows) out.set(num(row.parent_task_id), [...(out.get(num(row.parent_task_id)) ?? []), num(row.id)]);
  return out;
}
// Removes the tasks (already ordered subtasks first) and every row that
// hangs on them, children before parents. Returns the stored file paths to
// remove from disk after the transaction commits.
export async function purgeTasks(ids: readonly number[], db: Queryable): Promise<{ tasks: number; files: string[] }> {
  if (!ids.length) return { tasks: 0, files: [] };
  const [comments] = await db.query<Row[]>("SELECT id FROM task_comments WHERE task_id IN (?)", [ids]);
  const commentIds = comments.map((row) => num(row.id));
  if (commentIds.length) {
    await db.query("DELETE FROM comment_reactions WHERE comment_id IN (?)", [commentIds]);
    await db.query("DELETE FROM work_likes WHERE target_type = 'COMMENT' AND target_id IN (?)", [commentIds]);
    await db.query("DELETE FROM comment_versions WHERE target = 'TASK' AND comment_id IN (?)", [commentIds]);
    // Replies first (they point at their thread's first comment).
    await db.query("DELETE FROM task_comments WHERE task_id IN (?) AND parent_comment_id IS NOT NULL", [ids]);
    await db.query("DELETE FROM task_comments WHERE task_id IN (?)", [ids]);
  }
  const [files] = await db.query<Row[]>("SELECT stored_path FROM record_files WHERE entity_type = 'TASK' AND entity_id IN (?)", [ids]);
  await db.query("DELETE FROM record_files WHERE entity_type = 'TASK' AND entity_id IN (?)", [ids]);
  await db.query("DELETE FROM work_likes WHERE target_type = 'TASK' AND target_id IN (?)", [ids]);
  await db.query("DELETE FROM task_dependencies WHERE blocker_task_id IN (?) OR blocked_task_id IN (?)", [ids, ids]);
  // v1.71.0 (D-384): time entries logged on the task go with it.
  for (const table of ["task_tags", "task_followers", "task_field_values", "task_field_timer_runs", "task_time_entries", "task_item_reminders", "my_task_placements", "task_projects", "task_events"]) {
    await db.query(`DELETE FROM ${table} WHERE task_id IN (?)`, [ids]);
  }
  await db.query("DELETE FROM notification_rule_sends WHERE record_kind = 'TASK' AND record_id IN (?)", [ids]);
  // v1.67.1 (D-379): a task made from an intake form (D-374) has its submission
  // (the answers) pointing at it; it goes with the task.
  await db.query("DELETE FROM project_form_submissions WHERE task_id IN (?)", [ids]);
  // v1.68.0: automation events of these tasks go; run log rows keep their task number but lose the link.
  await db.query("DELETE FROM automation_events WHERE task_id IN (?)", [ids]);
  await db.query("UPDATE automation_runs SET task_id = NULL WHERE task_id IN (?)", [ids]);
  await db.query("UPDATE automation_webhook_deliveries SET task_id = NULL WHERE task_id IN (?)", [ids]);
  await db.query("DELETE FROM gcal_links WHERE entity_type = 'TASK' AND entity_id IN (?)", [ids]);
  // Subtasks before parents: one at a time in the given order.
  let removed = 0;
  for (const id of ids) {
    const [result] = await db.query<ResultSetHeader>("DELETE FROM tasks WHERE id = ? AND deleted_at IS NOT NULL", [id]);
    removed += result.affectedRows;
  }
  return { tasks: removed, files: files.map((row) => String(row.stored_path)) };
}

// Projects deleted more than 30 days ago (templates included).
export async function purgeProjectCandidates(limit: number, db: Queryable = getDbPool()): Promise<number[]> {
  const [rows] = await db.query<Row[]>(`SELECT id FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${PURGE_DAYS} DAY) ORDER BY deleted_at, id LIMIT ?`, [limit]);
  return rows.map((row) => num(row.id));
}
// Removes a project and everything that belongs to it. Its tasks are not
// deleted (a task can be in other projects, and has its own people); they
// only leave this project, as when it was deleted.
export async function purgeProject(projectId: number, db: Queryable, files: string[] = []): Promise<number> {
  // v1.67.1 (D-379): the project's intake forms (D-374) with their versions and
  // submissions, and its dashboard widgets and capacity (D-375). Tasks made from
  // a form stay (like the project's other tasks) and only lose the link to it.
  const [forms] = await db.query<Row[]>("SELECT id, cover_path FROM project_forms WHERE project_id = ?", [projectId]);
  if (forms.length) {
    const formIds = forms.map((row) => num(row.id));
    await db.query("UPDATE tasks SET source_form_id = NULL WHERE source_form_id IN (?)", [formIds]);
    await db.query("UPDATE project_forms SET current_version_id = NULL WHERE id IN (?)", [formIds]);
    await db.query("DELETE FROM project_form_submissions WHERE form_id IN (?)", [formIds]);
    await db.query("DELETE FROM project_form_versions WHERE form_id IN (?)", [formIds]);
    await db.query("DELETE FROM project_forms WHERE id IN (?)", [formIds]);
    for (const row of forms) if (row.cover_path) files.push(String(row.cover_path));
  }
  for (const table of ["project_dashboard_widgets", "project_capacity"]) await db.query(`DELETE FROM ${table} WHERE project_id = ?`, [projectId]);
  // v1.64.0 (D-371): the project's own (local) fields go with their values,
  // options, timers and links; library fields only lose this project's link.
  for (const table of ["task_field_values", "task_field_timer_runs", "project_field_options", "project_field_links"])
    await db.query(`DELETE x FROM ${table} x JOIN project_fields f ON f.id = x.field_id WHERE f.project_id = ?`, [projectId]);
  await db.query("DELETE FROM project_field_links WHERE project_id = ?", [projectId]);
  await db.query("DELETE FROM task_projects WHERE project_id = ?", [projectId]);
  for (const table of ["project_fields", "project_sections", "project_members", "project_status_updates", "project_events", "work_recent_projects", "work_project_order"]) {
    await db.query(`DELETE FROM ${table} WHERE project_id = ?`, [projectId]);
  }
  // v1.68.0 (D-380): the project's automations with their run logs and webhook calls.
  await db.query("DELETE r FROM automation_runs r JOIN project_automations a ON a.id = r.automation_id WHERE a.project_id = ?", [projectId]);
  await db.query("DELETE w FROM automation_webhook_deliveries w JOIN project_automations a ON a.id = w.automation_id WHERE a.project_id = ?", [projectId]);
  await db.query("DELETE FROM project_automations WHERE project_id = ?", [projectId]);
  // v1.69.0 (D-382): the project leaves every portfolio it was in (with that row's column values).
  await db.query("DELETE v FROM portfolio_field_values v JOIN portfolio_items i ON i.id = v.item_id WHERE i.project_id = ?", [projectId]);
  await db.query("DELETE FROM portfolio_items WHERE project_id = ?", [projectId]);
  await db.query("DELETE FROM work_views WHERE scope = 'PROJECT' AND scope_id = ?", [projectId]);
  // v1.70.0 (D-383): calendar addresses for the project stop with it.
  await db.query("DELETE FROM calendar_feeds WHERE project_id = ?", [projectId]);
  // v1.71.0 (D-384): the project's messages (replies first) with their files,
  // reactions and earlier versions, and its page with its versions.
  const [messages] = await db.query<Row[]>("SELECT id FROM project_messages WHERE project_id = ?", [projectId]);
  if (messages.length) {
    const messageIds = messages.map((row) => num(row.id));
    const [messageFiles] = await db.query<Row[]>("SELECT stored_path FROM record_files WHERE entity_type = 'PROJECT_MESSAGE' AND entity_id IN (?)", [messageIds]);
    for (const row of messageFiles) files.push(String(row.stored_path));
    await db.query("DELETE FROM record_files WHERE entity_type = 'PROJECT_MESSAGE' AND entity_id IN (?)", [messageIds]);
    await db.query("DELETE FROM project_message_reactions WHERE message_id IN (?)", [messageIds]);
    await db.query("DELETE FROM project_message_versions WHERE message_id IN (?)", [messageIds]);
    await db.query("DELETE FROM project_messages WHERE project_id = ? AND parent_id IS NOT NULL", [projectId]);
    await db.query("DELETE FROM project_messages WHERE project_id = ?", [projectId]);
  }
  await db.query("DELETE FROM project_page_versions WHERE project_id = ?", [projectId]);
  await db.query("DELETE FROM project_pages WHERE project_id = ?", [projectId]);
  await db.query("DELETE FROM work_favourites WHERE object_type = 'PROJECT' AND object_id = ?", [projectId]);
  const [result] = await db.query<ResultSetHeader>("DELETE FROM projects WHERE id = ? AND deleted_at IS NOT NULL", [projectId]);
  return result.affectedRows;
}

// v1.69.0 (D-382): portfolios deleted more than 30 days ago.
export async function purgePortfolioCandidates(limit: number, db: Queryable = getDbPool()): Promise<number[]> {
  const [rows] = await db.query<Row[]>(`SELECT id FROM portfolios WHERE deleted_at IS NOT NULL AND deleted_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${PURGE_DAYS} DAY) ORDER BY deleted_at, id LIMIT ?`, [limit]);
  return rows.map((row) => num(row.id));
}
// Removes a portfolio with its people, columns, values, status updates and
// stars, and takes it out of every portfolio that held it. The projects and
// portfolios it held stay (only the link goes).
export async function purgePortfolio(portfolioId: number, db: Queryable): Promise<number> {
  await db.query("DELETE v FROM portfolio_field_values v JOIN portfolio_items i ON i.id = v.item_id WHERE i.portfolio_id = ? OR i.child_portfolio_id = ?", [portfolioId, portfolioId]);
  await db.query("DELETE FROM portfolio_items WHERE portfolio_id = ? OR child_portfolio_id = ?", [portfolioId, portfolioId]);
  await db.query("DELETE v FROM portfolio_field_values v JOIN portfolio_fields f ON f.id = v.field_id WHERE f.portfolio_id = ?", [portfolioId]);
  for (const table of ["portfolio_fields", "portfolio_members", "portfolio_status_updates"]) await db.query(`DELETE FROM ${table} WHERE portfolio_id = ?`, [portfolioId]);
  await db.query("DELETE FROM work_favourites WHERE object_type = 'PORTFOLIO' AND object_id = ?", [portfolioId]);
  const [result] = await db.query<ResultSetHeader>("DELETE FROM portfolios WHERE id = ? AND deleted_at IS NOT NULL", [portfolioId]);
  return result.affectedRows;
}

export async function departmentName(id: number | null, db: Queryable = getDbPool()): Promise<string | null> {
  if (!id) return null;
  const [rows] = await db.query<Row[]>("SELECT name FROM departments WHERE id = ?", [id]);
  return rows[0] ? String(rows[0].name) : null;
}

// Does any record still point at this stored file?
export async function storedFileInUse(storedPath: string, db: Queryable = getDbPool()): Promise<boolean> {
  const [rows] = await db.query<Row[]>("SELECT 1 FROM record_files WHERE stored_path = ? LIMIT 1", [storedPath]);
  if (rows.length > 0) return true;
  // v1.67.1: an intake form's cover image (a duplicated form shares its file).
  const [covers] = await db.query<Row[]>("SELECT 1 FROM project_forms WHERE cover_path = ? LIMIT 1", [storedPath]);
  return covers.length > 0;
}
