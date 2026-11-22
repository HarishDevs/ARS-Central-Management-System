import "server-only";
import { VISIBLE_TO_MODULES_SQL } from "@/server/notifications/categories";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";
import type { ProjectColor, ProjectFacts, ProjectPrivacy, ProjectRole, ProjectStatusKind, ProjectView, WorkViewer } from "@/server/work/access";
import { effectiveProjectRole, parseProjectPermissions, type ProjectPermissions } from "@/server/work/access";
import type { MySystemSection, WorkSearch } from "@/server/work/rules";
import { MY_SECTION_NAMES, MY_SECTION_ORDER } from "@/server/work/rules";
import type { TaskPriority } from "@/server/modules/settings";
import type { TaskStatus } from "@/server/modules/task-rules";
import type { TabRow, TabScope, TabView } from "@/server/work/view-tabs";
import type { FieldType } from "@/server/work/custom-fields";
import { assignIds, idFieldsOfProject } from "@/lib/db/repositories/fields.repository";

// D-215: Task & Project Management data. Every list that shows tasks uses
// visibleTaskClause, the SQL twin of server/work/access.ts taskRights().view.
type Row = RowDataPacket & Record<string, unknown>;
const num = (value: unknown) => Number(value);
const maybeNum = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const str = (value: unknown) => (value === null || value === undefined ? null : String(value));
const dateOnly = (value: unknown) => (value === null || value === undefined ? null : value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));

// ---- visibility ------------------------------------------------------------------------
// Projects the viewer can see (alias `p`).
export function visibleProjectClause(viewer: WorkViewer, alias = "p"): { sql: string; params: unknown[] } {
  // D-308: without the Projects module, no project is seen.
  if (viewer.projects === false) return { sql: "FALSE", params: [] };
  if (viewer.isAdmin) return { sql: `${alias}.deleted_at IS NULL`, params: [] };
  const dept = viewer.departmentId;
  return {
    sql: `${alias}.deleted_at IS NULL AND (${alias}.privacy = 'ORGANISATION'
      OR (${alias}.privacy = 'DEPARTMENT' AND ? IS NOT NULL AND ${alias}.department_id = ?)
      OR EXISTS (SELECT 1 FROM project_members vm WHERE vm.project_id = ${alias}.id
        AND ((vm.member_type = 'USER' AND vm.member_id IN (?)) OR (vm.member_type = 'DEPARTMENT' AND ? IS NOT NULL AND vm.member_id = ?))))`,
    // D-216: the viewer and everyone below them in the reporting chain.
    params: [dept, dept, [viewer.id, ...viewer.teamIds], dept, dept],
  };
}

// Tasks the viewer can see (alias `t`, its assignee joined as `a`): a party
// to it (assignee, creator, assigner), anyone above its assignee in the
// reporting chain (D-216, every level), a follower,
// anyone who sees one of its projects; a subtask also by its top task.
export function visibleTaskClause(viewer: WorkViewer): { sql: string; params: unknown[] } {
  if (viewer.isAdmin) return { sql: "t.deleted_at IS NULL", params: [] };
  const project = visibleProjectClause(viewer, "vp");
  // D-308: without the Projects module a project opens no task (only tasks the person is on).
  const throughProject = viewer.projects === false ? "" : `
      OR EXISTS (SELECT 1 FROM task_projects vtp JOIN projects vp ON vp.id = vtp.project_id WHERE vtp.task_id IN (t.id, COALESCE(t.root_task_id, t.id)) AND ${project.sql})`;
  return {
    sql: `t.deleted_at IS NULL AND (t.assignee_id IN (?) OR t.created_by = ? OR t.assigned_by = ? OR a.reporting_manager_id = ?
      OR EXISTS (SELECT 1 FROM task_followers vf WHERE vf.task_id IN (t.id, COALESCE(t.root_task_id, t.id)) AND vf.user_id = ?)${throughProject}
      OR (t.root_task_id IS NOT NULL AND EXISTS (SELECT 1 FROM tasks vr WHERE vr.id = t.root_task_id AND (vr.assignee_id = ? OR vr.created_by = ? OR vr.assigned_by = ?))))`,
    // D-216: tasks of everyone below the viewer in the reporting chain too.
    params: [[viewer.id, ...viewer.teamIds], viewer.id, viewer.id, viewer.id, viewer.id, ...project.params, viewer.id, viewer.id, viewer.id],
  };
}

// ---- projects --------------------------------------------------------------------------
export interface ProjectRecord {
  id: number;
  name: string;
  description: string | null;
  color: ProjectColor;
  departmentId: number | null;
  departmentName: string | null;
  privacy: ProjectPrivacy;
  defaultAccessRole: Exclude<ProjectRole, "OWNER">;
  defaultView: ProjectView;
  ownerId: number;
  ownerName: string;
  startOn: string | null;
  dueOn: string | null;
  currentStatus: ProjectStatusKind | null;
  completedAt: Date | null;
  archivedAt: Date | null;
  deletedAt: Date | null;
  deletedBy: number | null;
  rowVersion: number;
  createdBy: number;
  createdAt: Date;
  isTemplate: boolean; // D-218
  permissions: ProjectPermissions; // D-222
}
export interface ProjectMember {
  type: "USER" | "DEPARTMENT";
  id: number;
  name: string;
  role: ProjectRole;
}

const PROJECT_SELECT = `SELECT p.*, d.name AS department_name, o.name AS owner_name FROM projects p LEFT JOIN departments d ON d.id = p.department_id JOIN users o ON o.id = p.owner_id`;
const toProject = (row: Row): ProjectRecord => ({
  id: num(row.id),
  name: String(row.name),
  description: str(row.description),
  color: String(row.color) as ProjectColor,
  departmentId: maybeNum(row.department_id),
  departmentName: str(row.department_name),
  privacy: row.privacy as ProjectPrivacy,
  defaultAccessRole: row.default_access_role as Exclude<ProjectRole, "OWNER">,
  defaultView: row.default_view as ProjectView,
  ownerId: num(row.owner_id),
  ownerName: String(row.owner_name),
  startOn: dateOnly(row.start_on),
  dueOn: dateOnly(row.due_on),
  currentStatus: (row.current_status as ProjectStatusKind | null) ?? null,
  completedAt: (row.completed_at as Date | null) ?? null,
  archivedAt: (row.archived_at as Date | null) ?? null,
  deletedAt: (row.deleted_at as Date | null) ?? null,
  deletedBy: maybeNum(row.deleted_by),
  rowVersion: num(row.row_version),
  createdBy: num(row.created_by),
  createdAt: row.created_at as Date,
  isTemplate: Boolean(row.is_template),
  permissions: parseProjectPermissions(row.permissions_json ?? null),
});

export async function findProject(id: number, db: Queryable = getDbPool(), lock = false): Promise<ProjectRecord | null> {
  if (lock) await db.query("SELECT id FROM projects WHERE id = ? FOR UPDATE", [id]);
  const [rows] = await db.query<Row[]>(`${PROJECT_SELECT} WHERE p.id = ?`, [id]);
  return rows[0] ? toProject(rows[0]) : null;
}

export async function listProjectMembers(projectId: number, db: Queryable = getDbPool()): Promise<ProjectMember[]> {
  const [rows] = await db.query<Row[]>(
    `SELECT m.member_type, m.member_id, m.role, COALESCE(u.name, d.name, '?') AS name
     FROM project_members m LEFT JOIN users u ON m.member_type = 'USER' AND u.id = m.member_id LEFT JOIN departments d ON m.member_type = 'DEPARTMENT' AND d.id = m.member_id
     WHERE m.project_id = ? ORDER BY FIELD(m.role, 'OWNER', 'EDITOR', 'COMMENTER', 'VIEWER'), name`,
    [projectId],
  );
  return rows.map((row) => ({ type: row.member_type as "USER" | "DEPARTMENT", id: num(row.member_id), name: String(row.name), role: row.role as ProjectRole }));
}

export const projectFacts = (project: ProjectRecord, members: readonly ProjectMember[]): ProjectFacts => ({ privacy: project.privacy, departmentId: project.departmentId, defaultAccessRole: project.defaultAccessRole, members });

// The project with the viewer's role (null: not found or not visible).
export async function projectFor(id: number, viewer: WorkViewer, db: Queryable = getDbPool()): Promise<{ project: ProjectRecord; members: ProjectMember[]; role: ProjectRole } | null> {
  const project = await findProject(id, db);
  if (!project || project.deletedAt) return null;
  const members = await listProjectMembers(id, db);
  const role = effectiveProjectRole(projectFacts(project, members), viewer);
  return role ? { project, members, role } : null;
}

export interface ProjectListItem {
  id: number;
  name: string;
  color: ProjectColor;
  privacy: ProjectPrivacy;
  departmentName: string | null;
  ownerName: string;
  currentStatus: ProjectStatusKind | null;
  archivedAt: Date | null;
  isMember: boolean;
  starred: boolean;
  openTasks: number;
  doneTasks: number;
}
export async function listVisibleProjects(viewer: WorkViewer, options: { archived?: boolean; q?: string; onlyMine?: boolean } = {}, db: Queryable = getDbPool()): Promise<ProjectListItem[]> {
  const visible = visibleProjectClause(viewer);
  const where = [visible.sql, "p.is_template = FALSE", options.archived ? "p.archived_at IS NOT NULL" : "p.archived_at IS NULL"];
  const params: unknown[] = [...visible.params];
  if (options.q) {
    where.push("p.name LIKE ?");
    params.push(`%${options.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
  if (options.onlyMine) {
    where.push("EXISTS (SELECT 1 FROM project_members mm WHERE mm.project_id = p.id AND ((mm.member_type = 'USER' AND mm.member_id = ?) OR (mm.member_type = 'DEPARTMENT' AND ? IS NOT NULL AND mm.member_id = ?)))");
    params.push(viewer.id, viewer.departmentId, viewer.departmentId);
  }
  const [rows] = await db.query<Row[]>(
    `SELECT p.id, p.name, p.color, p.privacy, p.current_status, p.archived_at, d.name AS department_name, o.name AS owner_name,
       EXISTS (SELECT 1 FROM project_members mm WHERE mm.project_id = p.id AND mm.member_type = 'USER' AND mm.member_id = ?) AS is_member,
       EXISTS (SELECT 1 FROM work_favourites f WHERE f.user_id = ? AND f.object_type = 'PROJECT' AND f.object_id = p.id) AS starred,
       (SELECT COUNT(*) FROM task_projects tp JOIN tasks tt ON tt.id = tp.task_id AND tt.deleted_at IS NULL WHERE tp.project_id = p.id AND tt.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED')) AS open_tasks,
       (SELECT COUNT(*) FROM task_projects tp JOIN tasks tt ON tt.id = tp.task_id AND tt.deleted_at IS NULL WHERE tp.project_id = p.id AND tt.status = 'COMPLETED') AS done_tasks
     FROM projects p LEFT JOIN departments d ON d.id = p.department_id JOIN users o ON o.id = p.owner_id
     WHERE ${where.join(" AND ")} ORDER BY starred DESC, p.name LIMIT 500`,
    [viewer.id, viewer.id, ...params],
  );
  return rows.map((row) => ({
    id: num(row.id),
    name: String(row.name),
    color: row.color as ProjectColor,
    privacy: row.privacy as ProjectPrivacy,
    departmentName: str(row.department_name),
    ownerName: String(row.owner_name),
    currentStatus: (row.current_status as ProjectStatusKind | null) ?? null,
    archivedAt: (row.archived_at as Date | null) ?? null,
    isMember: Boolean(row.is_member),
    starred: Boolean(row.starred),
    openTasks: num(row.open_tasks),
    doneTasks: num(row.done_tasks),
  }));
}

export interface NewProject {
  name: string;
  description: string | null;
  color: ProjectColor;
  departmentId: number | null;
  privacy: ProjectPrivacy;
  defaultAccessRole: Exclude<ProjectRole, "OWNER">;
  defaultView: ProjectView;
  ownerId: number;
  startOn: string | null;
  dueOn: string | null;
}
export async function insertProject(project: NewProject, db: Queryable): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO projects (name, description, color, department_id, privacy, default_access_role, default_view, owner_id, start_on, due_on, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [project.name, project.description, project.color, project.departmentId, project.privacy, project.defaultAccessRole, project.defaultView, project.ownerId, project.startOn, project.dueOn, project.ownerId],
  );
  return result.insertId;
}

// D-246 (audit DB-001): with expectedVersion, only from that version (false when someone saved first).
export async function updateProject(id: number, changes: Record<string, unknown>, db: Queryable, expectedVersion?: number): Promise<boolean> {
  const allowed = ["name", "description", "color", "department_id", "privacy", "default_access_role", "default_view", "owner_id", "start_on", "due_on", "current_status", "completed_at", "archived_at", "deleted_at", "deleted_by"];
  const keys = Object.keys(changes).filter((key) => allowed.includes(key));
  if (!keys.length) return true;
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE projects SET ${keys.map((key) => `${key} = ?`).join(", ")}, row_version = row_version + 1 WHERE id = ?${expectedVersion === undefined ? "" : " AND row_version = ?"}`,
    [...keys.map((key) => changes[key]), id, ...(expectedVersion === undefined ? [] : [expectedVersion])],
  );
  return result.affectedRows > 0;
}

export async function setProjectMember(projectId: number, type: "USER" | "DEPARTMENT", memberId: number, role: ProjectRole, addedBy: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("INSERT INTO project_members (project_id, member_type, member_id, role, added_by) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)", [projectId, type, memberId, role, addedBy]);
}
export async function removeProjectMember(projectId: number, type: "USER" | "DEPARTMENT", memberId: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("DELETE FROM project_members WHERE project_id = ? AND member_type = ? AND member_id = ?", [projectId, type, memberId]);
}

export async function appendProjectEvent(projectId: number, actorId: number | null, type: string, body: string | null, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("INSERT INTO project_events (project_id, actor_id, event_type, body) VALUES (?, ?, ?, ?)", [projectId, actorId, type, body?.slice(0, 500) ?? null]);
}
export async function listProjectEvents(projectId: number, limit = 50, db: Queryable = getDbPool()): Promise<{ id: number; actorName: string | null; type: string; body: string | null; createdAt: Date }[]> {
  const [rows] = await db.query<Row[]>("SELECT e.id, u.name, e.event_type, e.body, e.created_at FROM project_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.project_id = ? ORDER BY e.id DESC LIMIT ?", [projectId, limit]);
  return rows.map((row) => ({ id: num(row.id), actorName: str(row.name), type: String(row.event_type), body: str(row.body), createdAt: row.created_at as Date }));
}

// ---- sections --------------------------------------------------------------------------
export interface SectionRecord {
  id: number;
  name: string;
  position: number;
}
export async function listSections(projectId: number, db: Queryable = getDbPool()): Promise<SectionRecord[]> {
  const [rows] = await db.query<Row[]>("SELECT id, name, position FROM project_sections WHERE project_id = ? AND deleted_at IS NULL ORDER BY position, id", [projectId]);
  return rows.map((row) => ({ id: num(row.id), name: String(row.name), position: Number(row.position) }));
}
export async function insertSection(projectId: number, name: string, position: number, createdBy: number, db: Queryable): Promise<number> {
  const [result] = await db.query<ResultSetHeader>("INSERT INTO project_sections (project_id, name, position, created_by) VALUES (?, ?, ?, ?)", [projectId, name, position, createdBy]);
  return result.insertId;
}
export async function updateSection(id: number, changes: { name?: string; position?: number; deleted?: boolean }, db: Queryable): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (changes.name !== undefined) {
    sets.push("name = ?");
    params.push(changes.name);
  }
  if (changes.position !== undefined) {
    sets.push("position = ?");
    params.push(changes.position);
  }
  if (changes.deleted) sets.push("deleted_at = UTC_TIMESTAMP()");
  if (sets.length) await db.query<ResultSetHeader>(`UPDATE project_sections SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
}
export async function findSection(id: number, db: Queryable = getDbPool()): Promise<(SectionRecord & { projectId: number }) | null> {
  const [rows] = await db.query<Row[]>("SELECT id, project_id, name, position FROM project_sections WHERE id = ? AND deleted_at IS NULL", [id]);
  const row = rows[0];
  return row ? { id: num(row.id), projectId: num(row.project_id), name: String(row.name), position: Number(row.position) } : null;
}

// ---- tasks in projects -------------------------------------------------------------------
export interface WorkTaskItem {
  id: number;
  taskNo: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: number;
  assigneeName: string;
  assigneeDepartment?: string | null; // v1.57.3 (D-341): for Group by Department
  createdBy: number;
  createdByName: string;
  dueAt: Date | null;
  startsOn: string | null;
  completedAt: Date | null;
  isMilestone: boolean;
  parentTaskId: number | null;
  assignedAt: Date | null;
  sectionId: number | null; // the section in the project being shown
  position: number;
  subtasks: number;
  subtasksOpen: number;
  comments: number;
  likes: number;
  blockedBy: number; // open blockers
  isPeriodic: boolean; // D-219: repeats (or belongs to a repeating series)
  createdAt: Date; // D-220
  updatedAt?: Date; // v1.61.0 (D-367): the Modified sort
  followers: { id: number; name: string }[]; // D-220: collaborators
  tags: { id: number; name: string; color: string }[];
  // v1.76.0 (D-401): privacy and department for the Task visibility column.
  projects: { id: number; name: string; color: string; privacy?: "PRIVATE" | "DEPARTMENT" | "ORGANISATION"; departmentName?: string | null }[];
  summary?: string | null; // D-265: the description's start, for Home's task table
  // v1.42.1 (owner: "task created from approval should be highlighted and mapped
  // with approval unique number"): the request a task belongs to, and whether
  // it's that request's work step (D-269).
  approval?: { requestId: number; requestNo: string; workStep: boolean; linked?: boolean } | null;
}

// v1.65.0 (D-373): a link holds its successor back by its type (schedule.ts linkBlocks):
// FS and FF while the predecessor is open; SS until it has started; SF never.
export const BLOCKING_LINK = "((dp.dep_type IN ('FS', 'FF') AND bt.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED')) OR (dp.dep_type = 'SS' AND bt.status IN ('OPEN', 'BLOCKED')))";
const ITEM_SELECT = `SELECT t.id, t.task_no, t.title, t.status, t.priority, t.assignee_id, a.name AS assignee_name, (SELECT dd.name FROM departments dd WHERE dd.id = a.department_id) AS assignee_department, t.created_by, c.name AS created_by_name, t.due_at, t.starts_on,
    t.completed_at, t.created_at, t.updated_at, t.is_milestone, t.parent_task_id, t.assigned_at, LEFT(t.description, 160) AS summary, t.related_request_id, (SELECT rq.request_no FROM approval_requests rq WHERE rq.id = t.related_request_id) AS related_request_no, JSON_CONTAINS_PATH(t.form_data_json, 'one', '$.__approvalWork') AS from_approval, JSON_CONTAINS_PATH(t.form_data_json, 'one', '$.__approvalLink') AS linked_work, (t.recurrence_json IS NOT NULL OR t.series_id IS NOT NULL) AS is_periodic,
    (SELECT COUNT(*) FROM tasks s WHERE s.parent_task_id = t.id AND s.deleted_at IS NULL) AS subtasks,
    (SELECT COUNT(*) FROM tasks s WHERE s.parent_task_id = t.id AND s.deleted_at IS NULL AND s.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED')) AS subtasks_open,
    (SELECT COUNT(*) FROM task_comments cm WHERE cm.task_id = t.id AND cm.deleted_at IS NULL) AS comments,
    (SELECT COUNT(*) FROM work_likes l WHERE l.target_type = 'TASK' AND l.target_id = t.id) AS likes,
    (SELECT COUNT(*) FROM task_dependencies dp JOIN tasks bt ON bt.id = dp.blocker_task_id AND bt.deleted_at IS NULL WHERE dp.blocked_task_id = t.id AND ${BLOCKING_LINK}) AS blocked_by`;

async function decorate(rows: Row[], db: Queryable): Promise<WorkTaskItem[]> {
  const ids = rows.map((row) => num(row.id));
  const tags = new Map<number, WorkTaskItem["tags"]>();
  const projects = new Map<number, WorkTaskItem["projects"]>();
  const followers = new Map<number, WorkTaskItem["followers"]>();
  if (ids.length) {
    const [followerRows] = await db.query<Row[]>("SELECT f.task_id, u.id, u.name FROM task_followers f JOIN users u ON u.id = f.user_id WHERE f.task_id IN (?) ORDER BY f.created_at", [ids]);
    for (const row of followerRows) followers.set(num(row.task_id), [...(followers.get(num(row.task_id)) ?? []), { id: num(row.id), name: String(row.name) }]);
    const [tagRows] = await db.query<Row[]>("SELECT tt.task_id, g.id, g.name, g.color FROM task_tags tt JOIN work_tags g ON g.id = tt.tag_id WHERE tt.task_id IN (?) ORDER BY g.name", [ids]);
    for (const row of tagRows) tags.set(num(row.task_id), [...(tags.get(num(row.task_id)) ?? []), { id: num(row.id), name: String(row.name), color: String(row.color) }]);
    const [projectRows] = await db.query<Row[]>(
      "SELECT tp.task_id, p.id, p.name, p.color, p.privacy, d.name AS department_name FROM task_projects tp JOIN projects p ON p.id = tp.project_id AND p.deleted_at IS NULL LEFT JOIN departments d ON d.id = p.department_id WHERE tp.task_id IN (?) ORDER BY p.name",
      [ids],
    );
    for (const row of projectRows)
      projects.set(num(row.task_id), [
        ...(projects.get(num(row.task_id)) ?? []),
        { id: num(row.id), name: String(row.name), color: String(row.color), privacy: String(row.privacy) as "PRIVATE" | "DEPARTMENT" | "ORGANISATION", departmentName: row.department_name ? String(row.department_name) : null },
      ]);
  }
  return rows.map((row) => ({
    id: num(row.id),
    taskNo: String(row.task_no),
    title: String(row.title),
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    assigneeId: num(row.assignee_id),
    assigneeName: String(row.assignee_name),
    assigneeDepartment: row.assignee_department ? String(row.assignee_department) : null,
    createdBy: num(row.created_by),
    createdByName: String(row.created_by_name),
    dueAt: (row.due_at as Date | null) ?? null,
    startsOn: dateOnly(row.starts_on),
    completedAt: (row.completed_at as Date | null) ?? null,
    isMilestone: Boolean(row.is_milestone),
    parentTaskId: maybeNum(row.parent_task_id),
    assignedAt: (row.assigned_at as Date | null) ?? null,
    sectionId: maybeNum(row.section_id),
    position: Number(row.position ?? 0),
    subtasks: num(row.subtasks),
    subtasksOpen: num(row.subtasks_open),
    comments: num(row.comments),
    likes: num(row.likes),
    summary: row.summary ? String(row.summary) : null,
    approval: row.related_request_id && row.related_request_no ? { requestId: num(row.related_request_id), requestNo: String(row.related_request_no), workStep: Number(row.from_approval) === 1, linked: Number(row.linked_work) === 1 } : null,
    blockedBy: num(row.blocked_by),
    isPeriodic: Boolean(row.is_periodic),
    createdAt: row.created_at as Date,
    updatedAt: (row.updated_at as Date | undefined) ?? undefined,
    followers: followers.get(num(row.id)) ?? [],
    tags: tags.get(num(row.id)) ?? [],
    projects: projects.get(num(row.id)) ?? [],
  }));
}

// Everything in a project (who may see the project sees all its tasks).
export async function listProjectTasks(projectId: number, db: Queryable = getDbPool()): Promise<WorkTaskItem[]> {
  const [rows] = await db.query<Row[]>(
    `${ITEM_SELECT}, tp.section_id, tp.position FROM task_projects tp JOIN tasks t ON t.id = tp.task_id JOIN users a ON a.id = t.assignee_id JOIN users c ON c.id = t.created_by
     WHERE tp.project_id = ? AND t.deleted_at IS NULL ORDER BY tp.position, t.id LIMIT 2000`,
    [projectId],
  );
  return decorate(rows, db);
}

// QA-DB-01 (v1.42.1): a count alone, without listing and decorating rows.
export async function countTaskItems(where: string[], params: unknown[], db: Queryable = getDbPool()): Promise<number> {
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows] = await db.query<Row[]>(`SELECT COUNT(*) AS total FROM tasks t JOIN users a ON a.id = t.assignee_id ${clause}`, params);
  return num(rows[0]?.total ?? 0);
}

export async function listTaskItems(where: string[], params: unknown[], orderBy: string, limit: number, offset = 0, db: Queryable = getDbPool()): Promise<{ items: WorkTaskItem[]; total: number }> {
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows] = await db.query<Row[]>(`${ITEM_SELECT}, NULL AS section_id, t.subtask_position AS position FROM tasks t JOIN users a ON a.id = t.assignee_id JOIN users c ON c.id = t.created_by ${clause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const [count] = await db.query<Row[]>(`SELECT COUNT(*) AS total FROM tasks t JOIN users a ON a.id = t.assignee_id ${clause}`, params);
  return { items: await decorate(rows, db), total: num(count[0]?.total ?? 0) };
}

// v1.61.0 (D-367): the direct subtasks of many tasks at once (the List shows
// them inline). Like listSubtasks: whoever sees the top task sees its subtasks.
export async function listChildTasks(parentIds: readonly number[], db: Queryable = getDbPool()): Promise<WorkTaskItem[]> {
  if (!parentIds.length) return [];
  return (await listTaskItems(["t.parent_task_id IN (?)", "t.deleted_at IS NULL"], [[...parentIds]], "t.parent_task_id, t.subtask_position, t.id", 5000, 0, db)).items;
}

export async function listSubtasks(parentId: number, db: Queryable = getDbPool()): Promise<WorkTaskItem[]> {
  return (await listTaskItems(["t.parent_task_id = ?", "t.deleted_at IS NULL"], [parentId], "t.subtask_position, t.id", 500, 0, db)).items;
}

export interface TaskProjectLink {
  projectId: number;
  projectName: string;
  color: string;
  sectionId: number;
  sectionName: string;
  position: number;
}
export async function listTaskProjects(taskId: number, db: Queryable = getDbPool()): Promise<TaskProjectLink[]> {
  const [rows] = await db.query<Row[]>(
    `SELECT tp.project_id, p.name, p.color, tp.section_id, s.name AS section_name, tp.position FROM task_projects tp JOIN projects p ON p.id = tp.project_id AND p.deleted_at IS NULL
     JOIN project_sections s ON s.id = tp.section_id WHERE tp.task_id = ? ORDER BY p.name`,
    [taskId],
  );
  return rows.map((row) => ({ projectId: num(row.project_id), projectName: String(row.name), color: String(row.color), sectionId: num(row.section_id), sectionName: String(row.section_name), position: Number(row.position) }));
}
export async function countTaskProjects(taskId: number, db: Queryable): Promise<number> {
  const [rows] = await db.query<Row[]>("SELECT COUNT(*) AS n FROM task_projects WHERE task_id = ?", [taskId]);
  return num(rows[0]?.n ?? 0);
}
export async function placeTaskInProject(taskId: number, projectId: number, sectionId: number, position: number, addedBy: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>(
    "INSERT INTO task_projects (task_id, project_id, section_id, position, added_by) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE section_id = VALUES(section_id), position = VALUES(position)",
    [taskId, projectId, sectionId, position, addedBy],
  );
  // v1.64.0 (D-371): a task placed in a project gets the next number of each of
  // the project's ID fields it doesn't have yet (IDs never change afterwards).
  for (const fieldId of await idFieldsOfProject(projectId, db)) await assignIds(fieldId, [taskId], addedBy, db);
}
export async function removeTaskFromProject(taskId: number, projectId: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("DELETE FROM task_projects WHERE task_id = ? AND project_id = ?", [taskId, projectId]);
}
// Positions of a section's tasks in order (for moves and renumbering).
export async function sectionPositions(projectId: number, sectionId: number, db: Queryable): Promise<{ taskId: number; position: number }[]> {
  const [rows] = await db.query<Row[]>("SELECT task_id, position FROM task_projects WHERE project_id = ? AND section_id = ? ORDER BY position, task_id", [projectId, sectionId]);
  return rows.map((row) => ({ taskId: num(row.task_id), position: Number(row.position) }));
}
export async function renumberSection(projectId: number, sectionId: number, db: Queryable): Promise<void> {
  const rows = await sectionPositions(projectId, sectionId, db);
  for (const [index, row] of rows.entries()) await db.query<ResultSetHeader>("UPDATE task_projects SET position = ? WHERE task_id = ? AND project_id = ?", [(index + 1) * 1024, row.taskId, projectId]);
}
export async function moveSectionTasks(projectId: number, fromSection: number, toSection: number, db: Queryable): Promise<void> {
  const [rows] = await db.query<Row[]>("SELECT COALESCE(MAX(position), 0) AS top FROM task_projects WHERE project_id = ? AND section_id = ?", [projectId, toSection]);
  await db.query<ResultSetHeader>("UPDATE task_projects SET section_id = ?, position = position + ? WHERE project_id = ? AND section_id = ?", [toSection, Number(rows[0]?.top ?? 0) + 1024, projectId, fromSection]);
}

// The projects of a task and of its top task, with their facts (for rights).
export async function projectsGoverning(taskId: number, rootId: number | null, db: Queryable = getDbPool()): Promise<{ project: ProjectRecord; members: ProjectMember[] }[]> {
  const [rows] = await db.query<Row[]>("SELECT DISTINCT project_id FROM task_projects WHERE task_id IN (?, ?)", [taskId, rootId ?? taskId]);
  const out: { project: ProjectRecord; members: ProjectMember[] }[] = [];
  for (const row of rows) {
    const project = await findProject(num(row.project_id), db);
    if (project && !project.deletedAt) out.push({ project, members: await listProjectMembers(project.id, db) });
  }
  return out;
}

// ---- task tree ---------------------------------------------------------------------------
export interface TreeFacts {
  id: number;
  parentTaskId: number | null;
  rootTaskId: number | null;
  depth: number;
  isMilestone: boolean;
  deletedAt: Date | null;
  deletedBy: number | null;
  assignedAt: Date | null;
}
export async function treeFacts(taskId: number, db: Queryable = getDbPool()): Promise<TreeFacts | null> {
  const [rows] = await db.query<Row[]>("SELECT id, parent_task_id, root_task_id, depth, is_milestone, deleted_at, deleted_by, assigned_at FROM tasks WHERE id = ?", [taskId]);
  const row = rows[0];
  return row
    ? {
        id: num(row.id),
        parentTaskId: maybeNum(row.parent_task_id),
        rootTaskId: maybeNum(row.root_task_id),
        depth: num(row.depth),
        isMilestone: Boolean(row.is_milestone),
        deletedAt: (row.deleted_at as Date | null) ?? null,
        deletedBy: maybeNum(row.deleted_by),
        assignedAt: (row.assigned_at as Date | null) ?? null,
      }
    : null;
}
// The chain from the top task down to the parent (for breadcrumbs and loop checks).
export async function ancestors(taskId: number, db: Queryable = getDbPool()): Promise<{ id: number; taskNo: string; title: string }[]> {
  const chain: { id: number; taskNo: string; title: string }[] = [];
  let current = (await treeFacts(taskId, db))?.parentTaskId ?? null;
  while (current !== null && chain.length < 10) {
    const [rows] = await db.query<Row[]>("SELECT id, task_no, title, parent_task_id FROM tasks WHERE id = ?", [current]);
    const row = rows[0];
    if (!row) break;
    chain.unshift({ id: num(row.id), taskNo: String(row.task_no), title: String(row.title) });
    current = maybeNum(row.parent_task_id);
  }
  return chain;
}
// Every task below `taskId` with its depth below it (1 = child).
export async function descendants(taskId: number, db: Queryable = getDbPool()): Promise<{ id: number; level: number }[]> {
  const out: { id: number; level: number }[] = [];
  let frontier = [taskId];
  for (let level = 1; frontier.length && level <= 10; level += 1) {
    const [rows] = await db.query<Row[]>("SELECT id FROM tasks WHERE parent_task_id IN (?)", [frontier]);
    frontier = rows.map((row) => num(row.id));
    for (const id of frontier) out.push({ id, level });
  }
  return out;
}
export async function setTaskTree(taskId: number, values: { parentTaskId: number | null; rootTaskId: number | null; depth: number; position: number }, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("UPDATE tasks SET parent_task_id = ?, root_task_id = ?, depth = ?, subtask_position = ? WHERE id = ?", [values.parentTaskId, values.rootTaskId, values.depth, values.position, taskId]);
}
export async function setTaskWorkFields(taskId: number, changes: { is_milestone?: boolean; starts_on?: string | null; deleted_at?: Date | null; deleted_by?: number | null; assigned_at?: Date | null }, db: Queryable): Promise<void> {
  const keys = Object.keys(changes) as (keyof typeof changes)[];
  if (keys.length) await db.query<ResultSetHeader>(`UPDATE tasks SET ${keys.map((key) => `${key} = ?`).join(", ")} WHERE id = ?`, [...keys.map((key) => changes[key]), taskId]);
}
export async function lastSubtaskPosition(parentId: number, db: Queryable): Promise<number | null> {
  const [rows] = await db.query<Row[]>("SELECT MAX(subtask_position) AS top FROM tasks WHERE parent_task_id = ?", [parentId]);
  return rows[0]?.top === null || rows[0]?.top === undefined ? null : Number(rows[0].top);
}

// ---- followers ---------------------------------------------------------------------------
export async function listFollowers(taskId: number, db: Queryable = getDbPool()): Promise<{ id: number; name: string }[]> {
  const [rows] = await db.query<Row[]>("SELECT u.id, u.name FROM task_followers f JOIN users u ON u.id = f.user_id WHERE f.task_id = ? ORDER BY f.created_at, u.name", [taskId]);
  return rows.map((row) => ({ id: num(row.id), name: String(row.name) }));
}
export async function addFollower(taskId: number, userId: number, source: "CREATOR" | "ASSIGNEE" | "MANUAL" | "MENTION" | "COMMENT" | "FORM", addedBy: number | null, db: Queryable): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>("INSERT IGNORE INTO task_followers (task_id, user_id, source, added_by) VALUES (?, ?, ?, ?)", [taskId, userId, source, addedBy]);
  return result.affectedRows === 1;
}
export async function removeFollower(taskId: number, userId: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("DELETE FROM task_followers WHERE task_id = ? AND user_id = ?", [taskId, userId]);
}
export async function isFollowing(taskIds: readonly number[], userId: number, db: Queryable = getDbPool()): Promise<boolean> {
  const [rows] = await db.query<Row[]>("SELECT 1 FROM task_followers WHERE task_id IN (?) AND user_id = ? LIMIT 1", [taskIds, userId]);
  return rows.length > 0;
}

// ---- comments ----------------------------------------------------------------------------
export interface CommentRecord {
  id: number;
  taskId: number;
  parentCommentId: number | null;
  authorId: number;
  authorName: string;
  body: string;
  isPinned: boolean;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  likes: number;
  likedByMe: boolean;
}
export async function listComments(taskId: number, viewerId: number, db: Queryable = getDbPool()): Promise<CommentRecord[]> {
  const [rows] = await db.query<Row[]>(
    `SELECT cm.*, u.name AS author_name,
       (SELECT COUNT(*) FROM work_likes l WHERE l.target_type = 'COMMENT' AND l.target_id = cm.id) AS likes,
       EXISTS (SELECT 1 FROM work_likes l WHERE l.target_type = 'COMMENT' AND l.target_id = cm.id AND l.user_id = ?) AS liked
     FROM task_comments cm JOIN users u ON u.id = cm.author_id WHERE cm.task_id = ? ORDER BY cm.id`,
    [viewerId, taskId],
  );
  return rows.map((row) => ({
    id: num(row.id),
    taskId: num(row.task_id),
    parentCommentId: maybeNum(row.parent_comment_id),
    authorId: num(row.author_id),
    authorName: String(row.author_name),
    body: row.deleted_at ? "" : String(row.body),
    isPinned: Boolean(row.is_pinned),
    editedAt: (row.edited_at as Date | null) ?? null,
    deletedAt: (row.deleted_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
    likes: num(row.likes),
    likedByMe: Boolean(row.liked),
  }));
}
export async function findComment(id: number, db: Queryable = getDbPool()): Promise<{ id: number; taskId: number; parentCommentId: number | null; authorId: number; deletedAt: Date | null } | null> {
  const [rows] = await db.query<Row[]>("SELECT id, task_id, parent_comment_id, author_id, deleted_at FROM task_comments WHERE id = ?", [id]);
  const row = rows[0];
  return row ? { id: num(row.id), taskId: num(row.task_id), parentCommentId: maybeNum(row.parent_comment_id), authorId: num(row.author_id), deletedAt: (row.deleted_at as Date | null) ?? null } : null;
}
export async function insertComment(taskId: number, parentId: number | null, authorId: number, body: string, db: Queryable): Promise<number> {
  const [result] = await db.query<ResultSetHeader>("INSERT INTO task_comments (task_id, parent_comment_id, author_id, body) VALUES (?, ?, ?, ?)", [taskId, parentId, authorId, body]);
  return result.insertId;
}
export async function updateComment(id: number, changes: { body?: string; pinned?: boolean; deletedBy?: number }, db: Queryable): Promise<void> {
  if (changes.body !== undefined) await db.query<ResultSetHeader>("UPDATE task_comments SET body = ?, edited_at = UTC_TIMESTAMP() WHERE id = ?", [changes.body, id]);
  if (changes.pinned !== undefined) await db.query<ResultSetHeader>("UPDATE task_comments SET is_pinned = ? WHERE id = ?", [changes.pinned, id]);
  if (changes.deletedBy !== undefined) await db.query<ResultSetHeader>("UPDATE task_comments SET deleted_at = UTC_TIMESTAMP(), deleted_by = ?, is_pinned = FALSE WHERE id = ?", [changes.deletedBy, id]);
}

// ---- likes -----------------------------------------------------------------------------
export async function toggleLike(target: "TASK" | "COMMENT" | "STATUS", targetId: number, userId: number, db: Queryable = getDbPool()): Promise<boolean> {
  const [removed] = await db.query<ResultSetHeader>("DELETE FROM work_likes WHERE target_type = ? AND target_id = ? AND user_id = ?", [target, targetId, userId]);
  if (removed.affectedRows) return false;
  await db.query<ResultSetHeader>("INSERT IGNORE INTO work_likes (target_type, target_id, user_id) VALUES (?, ?, ?)", [target, targetId, userId]);
  return true;
}
export async function likesOf(target: "TASK" | "COMMENT" | "STATUS", targetId: number, db: Queryable = getDbPool()): Promise<{ id: number; name: string }[]> {
  const [rows] = await db.query<Row[]>("SELECT u.id, u.name FROM work_likes l JOIN users u ON u.id = l.user_id WHERE l.target_type = ? AND l.target_id = ? ORDER BY l.created_at", [target, targetId]);
  return rows.map((row) => ({ id: num(row.id), name: String(row.name) }));
}

// ---- dependencies --------------------------------------------------------------------------
// v1.65.0 (D-373): each link with its type (FS/SS/FF/SF), lag (reserved, 0) and the other task's due date.
export interface DependencyItem {
  id: number;
  taskNo: string;
  title: string;
  status: TaskStatus;
  type: "FS" | "SS" | "FF" | "SF";
  lag: number;
  dueAt: Date | null;
}
export async function listDependencies(taskId: number, db: Queryable = getDbPool()): Promise<{ blockedBy: DependencyItem[]; blocking: DependencyItem[] }> {
  const pick = async (sql: string) => {
    const [rows] = await db.query<Row[]>(sql, [taskId]);
    return rows.map((row) => ({ id: num(row.id), taskNo: String(row.task_no), title: String(row.title), status: row.status as TaskStatus, type: (row.dep_type ?? "FS") as DependencyItem["type"], lag: Number(row.lag_days ?? 0), dueAt: (row.due_at as Date | null) ?? null }));
  };
  return {
    blockedBy: await pick("SELECT t.id, t.task_no, t.title, t.status, t.due_at, d.dep_type, d.lag_days FROM task_dependencies d JOIN tasks t ON t.id = d.blocker_task_id AND t.deleted_at IS NULL WHERE d.blocked_task_id = ? ORDER BY t.id"),
    blocking: await pick("SELECT t.id, t.task_no, t.title, t.status, t.due_at, d.dep_type, d.lag_days FROM task_dependencies d JOIN tasks t ON t.id = d.blocked_task_id AND t.deleted_at IS NULL WHERE d.blocker_task_id = ? ORDER BY t.id"),
  };
}
// The dependency edges reachable from these tasks (enough for the loop check).
export async function dependencyEdges(db: Queryable): Promise<[number, number][]> {
  const [rows] = await db.query<Row[]>("SELECT blocker_task_id, blocked_task_id FROM task_dependencies LIMIT 100000");
  return rows.map((row) => [num(row.blocker_task_id), num(row.blocked_task_id)]);
}
export async function addDependency(blocker: number, blocked: number, by: number, db: Queryable): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>("INSERT IGNORE INTO task_dependencies (blocker_task_id, blocked_task_id, created_by) VALUES (?, ?, ?)", [blocker, blocked, by]);
  return result.affectedRows === 1;
}
export async function removeDependency(blocker: number, blocked: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("DELETE FROM task_dependencies WHERE blocker_task_id = ? AND blocked_task_id = ?", [blocker, blocked]);
}
export async function countDependencies(taskId: number, db: Queryable): Promise<number> {
  const [rows] = await db.query<Row[]>("SELECT COUNT(*) AS n FROM task_dependencies WHERE blocker_task_id = ? OR blocked_task_id = ?", [taskId, taskId]);
  return num(rows[0]?.n ?? 0);
}

// ---- tags ------------------------------------------------------------------------------
export async function listTags(db: Queryable = getDbPool()): Promise<{ id: number; name: string; color: string }[]> {
  const [rows] = await db.query<Row[]>("SELECT id, name, color FROM work_tags ORDER BY name LIMIT 1000");
  return rows.map((row) => ({ id: num(row.id), name: String(row.name), color: String(row.color) }));
}
export async function tagByName(name: string, createdBy: number, color: string, db: Queryable): Promise<number> {
  await db.query<ResultSetHeader>("INSERT IGNORE INTO work_tags (name, color, created_by) VALUES (?, ?, ?)", [name, color, createdBy]);
  const [rows] = await db.query<Row[]>("SELECT id FROM work_tags WHERE name = ?", [name]);
  return num(rows[0]!.id);
}
export async function setTaskTag(taskId: number, tagId: number, on: boolean, by: number, db: Queryable): Promise<void> {
  if (on) await db.query<ResultSetHeader>("INSERT IGNORE INTO task_tags (task_id, tag_id, added_by) VALUES (?, ?, ?)", [taskId, tagId, by]);
  else await db.query<ResultSetHeader>("DELETE FROM task_tags WHERE task_id = ? AND tag_id = ?", [taskId, tagId]);
}

// ---- status updates ----------------------------------------------------------------------
export interface StatusUpdate {
  id: number;
  status: ProjectStatusKind;
  title: string;
  body: string | null;
  snapshot: { open: number; completed: number; overdue: number };
  authorId: number;
  authorName: string;
  createdAt: Date;
  projectId: number;
  projectName: string;
  // v1.65.0 (D-373): the fuller composer's parts (null on older updates).
  ownerName?: string | null;
  startOn?: string | null;
  dueOn?: string | null;
  nextSteps?: string | null;
  highlights?: { id: number; taskNo: string; title: string; milestone: boolean; completedOn: string }[];
  recipients?: number;
}
const json = (value: unknown): unknown => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
const dayText = (value: unknown): string | null => (value instanceof Date ? value.toISOString().slice(0, 10) : typeof value === "string" && value ? value.slice(0, 10) : null);
const toStatus = (row: Row): StatusUpdate => {
  const snapshot = (typeof row.snapshot_json === "string" ? JSON.parse(row.snapshot_json) : row.snapshot_json) as StatusUpdate["snapshot"];
  const highlights = json(row.highlights_json);
  const recipients = json(row.recipients_json);
  return {
    id: num(row.id),
    status: row.status as ProjectStatusKind,
    title: String(row.title),
    body: str(row.body),
    snapshot,
    authorId: num(row.author_id),
    authorName: String(row.author_name),
    createdAt: row.created_at as Date,
    projectId: num(row.project_id),
    projectName: String(row.project_name),
    ownerName: row.owner_name === undefined ? null : str(row.owner_name),
    startOn: dayText(row.start_on),
    dueOn: dayText(row.due_on),
    nextSteps: row.next_steps === undefined ? null : str(row.next_steps),
    highlights: Array.isArray(highlights) ? (highlights as StatusUpdate["highlights"]) : [],
    recipients: Array.isArray(recipients) ? recipients.length : 0,
  };
};
export async function listStatusUpdates(projectId: number, db: Queryable = getDbPool()): Promise<StatusUpdate[]> {
  const [rows] = await db.query<Row[]>(
    "SELECT s.*, u.name AS author_name, p.name AS project_name, (SELECT o.name FROM users o WHERE o.id = s.owner_id) AS owner_name FROM project_status_updates s JOIN users u ON u.id = s.author_id JOIN projects p ON p.id = s.project_id WHERE s.project_id = ? AND s.deleted_at IS NULL ORDER BY s.id DESC LIMIT 50",
    [projectId],
  );
  return rows.map(toStatus);
}
export async function recentStatusUpdates(viewer: WorkViewer, limit: number, db: Queryable = getDbPool()): Promise<StatusUpdate[]> {
  const visible = visibleProjectClause(viewer);
  const [rows] = await db.query<Row[]>(
    `SELECT s.*, u.name AS author_name, p.name AS project_name FROM project_status_updates s JOIN users u ON u.id = s.author_id JOIN projects p ON p.id = s.project_id
     WHERE s.deleted_at IS NULL AND p.archived_at IS NULL AND ${visible.sql} ORDER BY s.id DESC LIMIT ?`,
    [...visible.params, limit],
  );
  return rows.map(toStatus);
}
export async function insertStatusUpdate(projectId: number, status: ProjectStatusKind, title: string, body: string | null, snapshot: StatusUpdate["snapshot"], authorId: number, db: Queryable): Promise<number> {
  const [result] = await db.query<ResultSetHeader>("INSERT INTO project_status_updates (project_id, status, title, body, snapshot_json, author_id) VALUES (?, ?, ?, ?, ?, ?)", [projectId, status, title, body, JSON.stringify(snapshot), authorId]);
  return result.insertId;
}
export async function findStatusUpdate(id: number, db: Queryable = getDbPool()): Promise<{ id: number; projectId: number; authorId: number } | null> {
  const [rows] = await db.query<Row[]>("SELECT id, project_id, author_id FROM project_status_updates WHERE id = ? AND deleted_at IS NULL", [id]);
  return rows[0] ? { id: num(rows[0].id), projectId: num(rows[0].project_id), authorId: num(rows[0].author_id) } : null;
}
export async function deleteStatusUpdate(id: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("UPDATE project_status_updates SET deleted_at = UTC_TIMESTAMP() WHERE id = ?", [id]);
}
export async function projectCounts(projectId: number, db: Queryable = getDbPool()): Promise<StatusUpdate["snapshot"]> {
  const [rows] = await db.query<Row[]>(
    `SELECT SUM(t.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED')) AS open_n, SUM(t.status = 'COMPLETED') AS done_n,
       SUM(t.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED') AND t.due_at < UTC_TIMESTAMP()) AS late_n
     FROM task_projects tp JOIN tasks t ON t.id = tp.task_id AND t.deleted_at IS NULL WHERE tp.project_id = ?`,
    [projectId],
  );
  return { open: num(rows[0]?.open_n ?? 0), completed: num(rows[0]?.done_n ?? 0), overdue: num(rows[0]?.late_n ?? 0) };
}

// ---- favourites and recents ----------------------------------------------------------------
export async function toggleFavourite(userId: number, type: "PROJECT" | "SEARCH", id: number, db: Queryable = getDbPool()): Promise<boolean> {
  const [removed] = await db.query<ResultSetHeader>("DELETE FROM work_favourites WHERE user_id = ? AND object_type = ? AND object_id = ?", [userId, type, id]);
  if (removed.affectedRows) return false;
  await db.query<ResultSetHeader>("INSERT IGNORE INTO work_favourites (user_id, object_type, object_id) VALUES (?, ?, ?)", [userId, type, id]);
  return true;
}
export async function touchRecentProject(userId: number, projectId: number, db: Queryable = getDbPool()): Promise<void> {
  await db.query<ResultSetHeader>("INSERT INTO work_recent_projects (user_id, project_id, opened_at) VALUES (?, ?, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE opened_at = UTC_TIMESTAMP()", [userId, projectId]);
}
export async function homeProjects(viewer: WorkViewer, limit: number, db: Queryable = getDbPool()): Promise<(ProjectListItem & { recentAt: Date | null })[]> {
  const visible = visibleProjectClause(viewer);
  const [rows] = await db.query<Row[]>(
    `SELECT p.id, p.name, p.color, p.privacy, p.current_status, p.archived_at, d.name AS department_name, o.name AS owner_name, r.opened_at,
       EXISTS (SELECT 1 FROM work_favourites f WHERE f.user_id = ? AND f.object_type = 'PROJECT' AND f.object_id = p.id) AS starred,
       (SELECT COUNT(*) FROM task_projects tp JOIN tasks tt ON tt.id = tp.task_id AND tt.deleted_at IS NULL WHERE tp.project_id = p.id AND tt.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED')) AS open_tasks,
       (SELECT COUNT(*) FROM task_projects tp JOIN tasks tt ON tt.id = tp.task_id AND tt.deleted_at IS NULL WHERE tp.project_id = p.id AND tt.status = 'COMPLETED') AS done_tasks
     FROM projects p LEFT JOIN departments d ON d.id = p.department_id JOIN users o ON o.id = p.owner_id
     LEFT JOIN work_recent_projects r ON r.project_id = p.id AND r.user_id = ?
     WHERE p.archived_at IS NULL AND p.is_template = FALSE AND ${visible.sql}
       AND (r.opened_at IS NOT NULL OR EXISTS (SELECT 1 FROM work_favourites f WHERE f.user_id = ? AND f.object_type = 'PROJECT' AND f.object_id = p.id)
         OR EXISTS (SELECT 1 FROM project_members mm WHERE mm.project_id = p.id AND mm.member_type = 'USER' AND mm.member_id = ?))
     ORDER BY starred DESC, r.opened_at IS NULL, r.opened_at DESC, p.name LIMIT ?`,
    [viewer.id, viewer.id, ...visible.params, viewer.id, viewer.id, limit],
  );
  return rows.map((row) => ({
    id: num(row.id),
    name: String(row.name),
    color: row.color as ProjectColor,
    privacy: row.privacy as ProjectPrivacy,
    departmentName: str(row.department_name),
    ownerName: String(row.owner_name),
    currentStatus: (row.current_status as ProjectStatusKind | null) ?? null,
    archivedAt: null,
    isMember: true,
    starred: Boolean(row.starred),
    openTasks: num(row.open_tasks),
    doneTasks: num(row.done_tasks),
    recentAt: (row.opened_at as Date | null) ?? null,
  }));
}

// ---- My Tasks --------------------------------------------------------------------------
export interface MySection {
  id: number;
  name: string;
  position: number;
  system: MySystemSection | null;
}
// The built-in sections exist once per person (made on first use). D-225:
// Overdue, added later, goes above the person's first section.
export async function ensureMySections(userId: number, db: Queryable = getDbPool()): Promise<MySection[]> {
  const read = async () => {
    const [rows] = await db.query<Row[]>("SELECT id, name, position, system_key FROM my_task_sections WHERE user_id = ? ORDER BY position, id", [userId]);
    return rows.map((row) => ({ id: num(row.id), name: String(row.name), position: Number(row.position), system: (row.system_key as MySystemSection | null) ?? null }));
  };
  let sections = await read();
  const missing = MY_SECTION_ORDER.filter((key) => !sections.some((section) => section.system === key));
  if (missing.length) {
    const top = sections.length ? Math.min(...sections.map((section) => section.position)) : 1024;
    for (const key of missing) {
      const position = key === "OVERDUE" ? top - 1024 : (MY_SECTION_ORDER.indexOf(key) + 1) * 1024;
      await db.query<ResultSetHeader>("INSERT IGNORE INTO my_task_sections (user_id, name, position, system_key) VALUES (?, ?, ?, ?)", [userId, MY_SECTION_NAMES[key], position, key]);
    }
    sections = await read();
  }
  return sections;
}
export async function insertMySection(userId: number, name: string, position: number, db: Queryable = getDbPool()): Promise<number> {
  const [result] = await db.query<ResultSetHeader>("INSERT INTO my_task_sections (user_id, name, position) VALUES (?, ?, ?)", [userId, name, position]);
  return result.insertId;
}
export async function updateMySection(userId: number, id: number, changes: { name?: string; position?: number }, db: Queryable = getDbPool()): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (changes.name !== undefined) {
    sets.push("name = ?");
    params.push(changes.name);
  }
  if (changes.position !== undefined) {
    sets.push("position = ?");
    params.push(changes.position);
  }
  if (!sets.length) return true;
  const [result] = await db.query<ResultSetHeader>(`UPDATE my_task_sections SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`, [...params, id, userId]);
  return result.affectedRows === 1;
}
// Deleting one's own section puts its tasks back to "by date" (no placement).
export async function deleteMySection(userId: number, id: number, db: Queryable = getDbPool()): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>("DELETE FROM my_task_sections WHERE id = ? AND user_id = ? AND system_key IS NULL", [id, userId]);
  return result.affectedRows === 1;
}
export async function myPlacements(userId: number, db: Queryable = getDbPool()): Promise<Map<number, { sectionId: number; position: number }>> {
  const [rows] = await db.query<Row[]>("SELECT task_id, section_id, position FROM my_task_placements WHERE user_id = ?", [userId]);
  return new Map(rows.map((row) => [num(row.task_id), { sectionId: num(row.section_id), position: Number(row.position) }]));
}
export async function placeMyTask(userId: number, taskId: number, sectionId: number, position: number, db: Queryable = getDbPool()): Promise<void> {
  await db.query<ResultSetHeader>(
    "INSERT INTO my_task_placements (user_id, task_id, section_id, position) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE section_id = VALUES(section_id), position = VALUES(position), placed_at = UTC_TIMESTAMP()",
    [userId, taskId, sectionId, position],
  );
}
// A new assignee starts fresh: earlier placements of the task are forgotten.
export async function clearPlacements(taskId: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("DELETE FROM my_task_placements WHERE task_id = ?", [taskId]);
}
// v1.76.0 (D-401): the placements with the rule that last moved each task.
export async function myPlacementsWithRule(userId: number, db: Queryable = getDbPool()): Promise<Map<number, { sectionId: number; position: number; ruleKey: string | null }>> {
  const [rows] = await db.query<Row[]>("SELECT task_id, section_id, position, rule_key FROM my_task_placements WHERE user_id = ?", [userId]);
  return new Map(rows.map((row) => [num(row.task_id), { sectionId: num(row.section_id), position: Number(row.position), ruleKey: row.rule_key ? String(row.rule_key) : null }]));
}
// A rule's move: the task goes to the end of the section, marked with the rule and due day.
export async function placeByRule(userId: number, taskId: number, sectionId: number, ruleKey: string, db: Queryable): Promise<void> {
  const [[top]] = await db.query<Row[]>("SELECT COALESCE(MAX(position), 0) AS top FROM my_task_placements WHERE user_id = ? AND section_id = ?", [userId, sectionId]);
  await db.query<ResultSetHeader>(
    "INSERT INTO my_task_placements (user_id, task_id, section_id, position, rule_key) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE section_id = VALUES(section_id), position = VALUES(position), rule_key = VALUES(rule_key), placed_at = UTC_TIMESTAMP()",
    [userId, taskId, sectionId, Number(top?.top ?? 0) + 1024, ruleKey],
  );
}
// The next task of a repeating series keeps its predecessor's section (BR-MYT-023).
export async function copyPlacement(fromTaskId: number, toTaskId: number, userId: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>(
    "INSERT IGNORE INTO my_task_placements (user_id, task_id, section_id, position) SELECT user_id, ?, section_id, position FROM my_task_placements WHERE task_id = ? AND user_id = ?",
    [toTaskId, fromTaskId, userId],
  );
}
export interface MyRulesRow {
  todayOn: boolean;
  upcomingOn: boolean;
  upcomingDays: number;
  lastRunDay: string | null;
}
const rulesRow = (row: Row): MyRulesRow => ({
  todayOn: Boolean(row.today_on),
  upcomingOn: Boolean(row.upcoming_on),
  upcomingDays: Number(row.upcoming_days),
  lastRunDay: row.last_run_day ? (row.last_run_day instanceof Date ? row.last_run_day.toISOString().slice(0, 10) : String(row.last_run_day).slice(0, 10)) : null,
});
// The person's section rules; null until they use My sections.
export async function findMyRules(userId: number, db: Queryable = getDbPool()): Promise<MyRulesRow | null> {
  const [rows] = await db.query<Row[]>("SELECT today_on, upcoming_on, upcoming_days, DATE_FORMAT(last_run_day, '%Y-%m-%d') AS last_run_day FROM my_task_rules WHERE user_id = ?", [userId]);
  return rows[0] ? rulesRow(rows[0]) : null;
}
// Made with the defaults the first time; true when it was made now.
export async function ensureMyRules(userId: number, db: Queryable = getDbPool()): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>("INSERT IGNORE INTO my_task_rules (user_id) VALUES (?)", [userId]);
  return result.affectedRows === 1;
}
export async function saveMyRules(userId: number, rules: { todayOn: boolean; upcomingOn: boolean; upcomingDays: number }, db: Queryable = getDbPool()): Promise<void> {
  await db.query<ResultSetHeader>(
    "INSERT INTO my_task_rules (user_id, today_on, upcoming_on, upcoming_days) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE today_on = VALUES(today_on), upcoming_on = VALUES(upcoming_on), upcoming_days = VALUES(upcoming_days)",
    [userId, rules.todayOn, rules.upcomingOn, rules.upcomingDays],
  );
}
export async function markRulesRun(userId: number, day: string, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("UPDATE my_task_rules SET last_run_day = ? WHERE user_id = ?", [day, userId]);
}
// The people whose rules haven't run for `today` yet (a batch).
export async function rulesDueFor(today: string, limit: number, db: Queryable = getDbPool()): Promise<number[]> {
  const [rows] = await db.query<Row[]>(
    "SELECT r.user_id FROM my_task_rules r JOIN users u ON u.id = r.user_id AND u.active = TRUE WHERE (r.today_on OR r.upcoming_on) AND (r.last_run_day IS NULL OR r.last_run_day < ?) ORDER BY r.user_id LIMIT ?",
    [today, limit],
  );
  return rows.map((row) => num(row.user_id));
}
// Open tasks given to the person due from `from` to `to` (India days).
export async function openTasksDueBetween(userId: number, from: string, to: string, db: Queryable): Promise<{ id: number; dueDay: string }[]> {
  const [rows] = await db.query<Row[]>(
    "SELECT id, DATE_FORMAT(DATE_ADD(due_at, INTERVAL 330 MINUTE), '%Y-%m-%d') AS due_day FROM tasks WHERE assignee_id = ? AND deleted_at IS NULL AND status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED') AND due_at IS NOT NULL AND DATE(DATE_ADD(due_at, INTERVAL 330 MINUTE)) BETWEEN ? AND ?",
    [userId, from, to],
  );
  return rows.map((row) => ({ id: num(row.id), dueDay: String(row.due_day) }));
}
// How many tasks a section of the person holds (the delete confirmation).
export async function mySectionCounts(userId: number, db: Queryable = getDbPool()): Promise<Map<number, number>> {
  const [rows] = await db.query<Row[]>(
    "SELECT p.section_id, COUNT(*) AS n FROM my_task_placements p JOIN tasks t ON t.id = p.task_id AND t.assignee_id = p.user_id AND t.deleted_at IS NULL WHERE p.user_id = ? GROUP BY p.section_id",
    [userId],
  );
  return new Map(rows.map((row) => [num(row.section_id), Number(row.n)]));
}

// ---- saved searches ----------------------------------------------------------------------
export async function listSavedSearches(userId: number, db: Queryable = getDbPool()): Promise<{ id: number; name: string; query: string; starred: boolean }[]> {
  const [rows] = await db.query<Row[]>(
    "SELECT s.id, s.name, s.query, EXISTS (SELECT 1 FROM work_favourites f WHERE f.user_id = s.user_id AND f.object_type = 'SEARCH' AND f.object_id = s.id) AS starred FROM work_saved_searches s WHERE s.user_id = ? ORDER BY s.name",
    [userId],
  );
  return rows.map((row) => ({ id: num(row.id), name: String(row.name), query: String(row.query), starred: Boolean(row.starred) }));
}
export async function insertSavedSearch(userId: number, name: string, query: string, db: Queryable = getDbPool()): Promise<"OK" | "DUPLICATE" | "TOO_MANY"> {
  const [count] = await db.query<Row[]>("SELECT COUNT(*) AS n FROM work_saved_searches WHERE user_id = ?", [userId]);
  if (num(count[0]?.n ?? 0) >= 50) return "TOO_MANY";
  try {
    await db.query<ResultSetHeader>("INSERT INTO work_saved_searches (user_id, name, query) VALUES (?, ?, ?)", [userId, name, query]);
    return "OK";
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return "DUPLICATE";
    throw error;
  }
}
export async function deleteSavedSearch(userId: number, id: number, db: Queryable = getDbPool()): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>("DELETE FROM work_saved_searches WHERE id = ? AND user_id = ?", [id, userId]);
  if (result.affectedRows) await db.query<ResultSetHeader>("DELETE FROM work_favourites WHERE user_id = ? AND object_type = 'SEARCH' AND object_id = ?", [userId, id]);
  return result.affectedRows === 1;
}

// ---- search ------------------------------------------------------------------------------
export const WORK_SEARCH_PAGE = 50;
export function workSearchSql(viewer: WorkViewer, search: WorkSearch, now: Date): { where: string[]; params: unknown[] } {
  const visible = visibleTaskClause(viewer);
  const where = [visible.sql];
  const params: unknown[] = [...visible.params];
  if (search.status === "open") where.push("t.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED')");
  else if (search.status === "completed") where.push("t.status = 'COMPLETED'");
  else if (search.status === "cancelled") where.push("t.status = 'CANCELLED'");
  if (search.q) {
    const like = `%${search.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push("(t.task_no = ? OR t.title LIKE ? OR t.description LIKE ? OR EXISTS (SELECT 1 FROM task_comments sc WHERE sc.task_id = t.id AND sc.deleted_at IS NULL AND sc.body LIKE ?))");
    params.push(search.q.toUpperCase(), like, like, like);
  }
  if (search.assignee !== null) {
    where.push("t.assignee_id = ?");
    params.push(search.assignee === "me" ? viewer.id : search.assignee);
  }
  if (search.createdBy !== null) {
    where.push("(t.created_by = ? OR t.assigned_by = ?)");
    params.push(search.createdBy === "me" ? viewer.id : search.createdBy, search.createdBy === "me" ? viewer.id : search.createdBy);
  }
  if (search.project !== null) {
    where.push("EXISTS (SELECT 1 FROM task_projects sp WHERE sp.task_id = t.id AND sp.project_id = ?)");
    params.push(search.project);
  }
  if (search.priority) {
    where.push("t.priority = ?");
    params.push(search.priority);
  }
  if (search.tag !== null) {
    where.push("EXISTS (SELECT 1 FROM task_tags st WHERE st.task_id = t.id AND st.tag_id = ?)");
    params.push(search.tag);
  }
  if (search.dueFrom) {
    where.push("t.due_at >= ?");
    params.push(new Date(`${search.dueFrom}T00:00:00+05:30`));
  }
  if (search.dueTo) {
    where.push("t.due_at < ?");
    params.push(new Date(new Date(`${search.dueTo}T00:00:00+05:30`).getTime() + 86_400_000));
  }
  if (search.followed) {
    where.push("EXISTS (SELECT 1 FROM task_followers sf WHERE sf.task_id = t.id AND sf.user_id = ?)");
    params.push(viewer.id);
  }
  // D-219: periodic (repeating) or ad hoc (one-time) tasks.
  if (search.kind === "periodic") where.push("(t.recurrence_json IS NOT NULL OR t.series_id IS NOT NULL)");
  if (search.kind === "adhoc") where.push("t.recurrence_json IS NULL AND t.series_id IS NULL");
  if (search.team) {
    where.push("t.assignee_id IN (?)");
    params.push(viewer.teamIds.length ? [...viewer.teamIds] : [0]);
  }
  if (search.overdue) {
    where.push("t.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED') AND t.due_at < ?");
    params.push(now);
  }
  return { where, params };
}

// Quick search (command palette): tasks and projects by number or words.
export async function quickWork(viewer: WorkViewer, q: string, db: Queryable = getDbPool()): Promise<{ tasks: { id: number; taskNo: string; title: string; status: TaskStatus }[]; projects: { id: number; name: string }[] }> {
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const visible = visibleTaskClause(viewer);
  const [taskRows] = await db.query<Row[]>(
    `SELECT t.id, t.task_no, t.title, t.status FROM tasks t JOIN users a ON a.id = t.assignee_id WHERE ${visible.sql} AND (t.task_no = ? OR t.title LIKE ?)
     ORDER BY t.status IN ('COMPLETED', 'CANCELLED'), t.updated_at DESC LIMIT 6`,
    [...visible.params, q.toUpperCase(), like],
  );
  const projects = await listVisibleProjects(viewer, { q });
  return {
    tasks: taskRows.map((row) => ({ id: num(row.id), taskNo: String(row.task_no), title: String(row.title), status: row.status as TaskStatus })),
    projects: projects.slice(0, 5).map((project) => ({ id: project.id, name: project.name })),
  };
}

// The general task type's live version (for tasks added in projects and My Tasks).
export async function generalTypeVersion(db: Queryable = getDbPool()): Promise<{ typeId: number; versionId: number } | null> {
  const [rows] = await db.query<Row[]>(
    "SELECT mt.id AS type_id, v.id AS version_id FROM module_types mt JOIN module_type_versions v ON v.type_id = mt.id AND v.status = 'PUBLISHED' WHERE mt.module = 'TASK' AND mt.code = 'GENERAL' AND mt.active = TRUE",
  );
  return rows[0] ? { typeId: num(rows[0].type_id), versionId: num(rows[0].version_id) } : null;
}

// Deleted tasks the person created or deleted (last 30 days), for Restore.
export async function listDeletedTasks(userId: number, db: Queryable = getDbPool()): Promise<{ id: number; taskNo: string; title: string; deletedAt: Date }[]> {
  const [rows] = await db.query<Row[]>(
    "SELECT id, task_no, title, deleted_at FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY) AND (created_by = ? OR deleted_by = ?) AND parent_task_id IS NULL ORDER BY deleted_at DESC LIMIT 100",
    [userId, userId],
  );
  return rows.map((row) => ({ id: num(row.id), taskNo: String(row.task_no), title: String(row.title), deletedAt: row.deleted_at as Date }));
}
export async function listDeletedProjects(viewer: WorkViewer, db: Queryable = getDbPool()): Promise<{ id: number; name: string; deletedAt: Date }[]> {
  const [rows] = await db.query<Row[]>(
    `SELECT p.id, p.name, p.deleted_at FROM projects p WHERE p.deleted_at IS NOT NULL AND p.deleted_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)
     AND (? OR p.deleted_by = ? OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.member_type = 'USER' AND m.member_id = ? AND m.role = 'OWNER')) ORDER BY p.deleted_at DESC LIMIT 100`,
    [viewer.isAdmin, viewer.id, viewer.id],
  );
  return rows.map((row) => ({ id: num(row.id), name: String(row.name), deletedAt: row.deleted_at as Date }));
}

// D-216: the reporting line below a manager (every level), with their open,
// overdue and recently completed tasks, nearest reports first.
export async function teamWorkload(teamIds: readonly number[], managerId: number, db: Queryable = getDbPool()): Promise<{ id: number; name: string; managerName: string | null; direct: boolean; open: number; overdue: number; doneWeek: number }[]> {
  if (!teamIds.length) return [];
  const [rows] = await db.query<Row[]>(
    `SELECT u.id, u.name, m.name AS manager_name, u.reporting_manager_id,
       (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.deleted_at IS NULL AND t.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED')) AS open_n,
       (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.deleted_at IS NULL AND t.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED') AND t.due_at < UTC_TIMESTAMP()) AS late_n,
       (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.deleted_at IS NULL AND t.status = 'COMPLETED' AND t.completed_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)) AS done_n
     FROM users u LEFT JOIN users m ON m.id = u.reporting_manager_id WHERE u.id IN (?) AND u.active = TRUE ORDER BY u.reporting_manager_id = ? DESC, late_n DESC, u.name LIMIT 200`,
    [[...teamIds], managerId],
  );
  return rows.map((row) => ({ id: num(row.id), name: String(row.name), managerName: str(row.manager_name), direct: num(row.reporting_manager_id) === managerId, open: num(row.open_n), overdue: num(row.late_n), doneWeek: num(row.done_n) }));
}

// ---- custom fields (D-218; v1.64.0 D-371: through project_field_links) --------------------
export interface ProjectField {
  id: number;
  projectId: number; // the project asked about
  name: string;
  kind: FieldType;
  options: string[]; // the active options' names
}
export async function listProjectFields(projectId: number, db: Queryable = getDbPool()): Promise<ProjectField[]> {
  const [rows] = await db.query<Row[]>(
    `SELECT f.id, f.name, f.kind, f.options_json FROM project_field_links l JOIN project_fields f ON f.id = l.field_id
     WHERE l.project_id = ? AND l.removed_at IS NULL AND f.deleted_at IS NULL ORDER BY l.position, f.id`,
    [projectId],
  );
  return rows.map((row) => ({
    id: num(row.id),
    projectId,
    name: String(row.name),
    kind: row.kind as FieldType,
    options: (typeof row.options_json === "string" ? JSON.parse(row.options_json) : row.options_json) as string[],
  }));
}
// A local field in the project, with its options (templates and copies).
export async function insertProjectField(projectId: number, name: string, kind: ProjectField["kind"], options: string[], by: number, db: Queryable = getDbPool()): Promise<number> {
  const [result] = await db.query<ResultSetHeader>("INSERT INTO project_fields (project_id, name, kind, options_json, config_json, created_by) VALUES (?, ?, ?, ?, '{}', ?)", [projectId, name, kind, JSON.stringify(options), by]);
  const id = result.insertId;
  let position = 1024;
  for (const [index, option] of options.entries()) {
    await db.query("INSERT INTO project_field_options (field_id, name, color, position) VALUES (?, ?, ?, ?)", [id, option, (index % 8) + 1, position]);
    position += 1024;
  }
  const [top] = await db.query<Row[]>("SELECT COALESCE(MAX(position), 0) AS top FROM project_field_links WHERE project_id = ?", [projectId]);
  await db.query("INSERT INTO project_field_links (project_id, field_id, position, added_by) VALUES (?, ?, ?, ?)", [projectId, id, Number(top[0]?.top ?? 0) + 1024, by]);
  return id;
}
// Values of the given tasks as plain text (the old `value` column, kept up to
// date for every type): task id → field id → value. Templates and copies.
export async function fieldValues(taskIds: readonly number[], db: Queryable = getDbPool()): Promise<Map<number, Record<number, string>>> {
  const out = new Map<number, Record<number, string>>();
  if (!taskIds.length) return out;
  const [rows] = await db.query<Row[]>("SELECT task_id, field_id, value FROM task_field_values WHERE task_id IN (?)", [[...taskIds]]);
  for (const row of rows) out.set(num(row.task_id), { ...(out.get(num(row.task_id)) ?? {}), [num(row.field_id)]: String(row.value) });
  return out;
}

// ---- templates (D-218) ----------------------------------------------------------------
export async function listTemplates(viewer: WorkViewer, db: Queryable = getDbPool()): Promise<{ id: number; name: string; description: string | null; ownerName: string; body: unknown }[]> {
  const visible = visibleProjectClause(viewer);
  const [rows] = await db.query<Row[]>(
    `SELECT p.id, p.name, p.description, o.name AS owner_name, p.template_json FROM projects p JOIN users o ON o.id = p.owner_id WHERE p.is_template = TRUE AND ${visible.sql} ORDER BY p.name LIMIT 200`,
    visible.params,
  );
  return rows.map((row) => ({ id: num(row.id), name: String(row.name), description: str(row.description), ownerName: String(row.owner_name), body: row.template_json }));
}
export async function setTemplateBody(projectId: number, body: unknown, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("UPDATE projects SET is_template = TRUE, template_json = ? WHERE id = ?", [JSON.stringify(body), projectId]);
}
export async function templateBody(projectId: number, db: Queryable = getDbPool()): Promise<unknown> {
  const [rows] = await db.query<Row[]>("SELECT template_json FROM projects WHERE id = ? AND is_template = TRUE AND deleted_at IS NULL", [projectId]);
  return rows[0]?.template_json ?? null;
}

// ---- task inbox (D-218) ---------------------------------------------------------------
export type InboxTab = "activity" | "bookmarks" | "archive";
export interface InboxItem {
  id: number;
  title: string;
  message: string;
  link: string | null;
  createdAt: Date;
  readAt: Date | null;
  archivedAt: Date | null;
  bookmarkedAt: Date | null;
  eventType: string;
}
// D-308: project notices only for people with the Projects module.
const TASK_NOTICE = `(n.category = 'TASK' OR n.event_type LIKE 'WORK|_%' ESCAPE '|') AND ${VISIBLE_TO_MODULES_SQL}`;
export async function listInbox(userId: number, tab: InboxTab, unreadOnly: boolean, limit = 100, db: Queryable = getDbPool()): Promise<InboxItem[]> {
  const where = ["n.user_id = ?", TASK_NOTICE, tab === "archive" ? "n.archived_at IS NOT NULL" : tab === "bookmarks" ? "n.bookmarked_at IS NOT NULL" : "n.archived_at IS NULL"];
  if (unreadOnly) where.push("n.read_at IS NULL");
  const [rows] = await db.query<Row[]>(
    `SELECT n.id, n.title, n.message, n.deep_link, n.created_at, n.read_at, n.archived_at, n.bookmarked_at, n.event_type FROM notifications n WHERE ${where.join(" AND ")} ORDER BY n.id DESC LIMIT ?`,
    [userId, limit],
  );
  return rows.map((row) => ({
    id: num(row.id),
    title: String(row.title),
    message: String(row.message),
    link: str(row.deep_link),
    createdAt: row.created_at as Date,
    readAt: (row.read_at as Date | null) ?? null,
    archivedAt: (row.archived_at as Date | null) ?? null,
    bookmarkedAt: (row.bookmarked_at as Date | null) ?? null,
    eventType: String(row.event_type),
  }));
}
export async function inboxUnread(userId: number, db: Queryable = getDbPool()): Promise<number> {
  const [rows] = await db.query<Row[]>(`SELECT COUNT(*) AS n FROM notifications n WHERE n.user_id = ? AND ${TASK_NOTICE} AND n.archived_at IS NULL AND n.read_at IS NULL`, [userId]);
  return num(rows[0]?.n ?? 0);
}
const INBOX_SET: Record<string, string> = {
  READ: "read_at = COALESCE(read_at, UTC_TIMESTAMP())",
  UNREAD: "read_at = NULL",
  ARCHIVE: "archived_at = UTC_TIMESTAMP(), read_at = COALESCE(read_at, UTC_TIMESTAMP())",
  UNARCHIVE: "archived_at = NULL",
  BOOKMARK: "bookmarked_at = UTC_TIMESTAMP()",
  UNBOOKMARK: "bookmarked_at = NULL",
};
export const INBOX_COMMANDS = Object.keys(INBOX_SET);
// Only the person's own notices change; `ids` null = all of them (not
// archived), only the task ones unless `everything` (D-237: the one Inbox).
export async function setInbox(userId: number, ids: readonly number[] | null, command: string, db: Queryable = getDbPool(), everything = false): Promise<number> {
  const set = INBOX_SET[command];
  if (!set) return 0;
  const scope = everything ? "" : `AND ${TASK_NOTICE}`;
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE notifications n SET ${set} WHERE n.user_id = ? ${scope} ${ids === null ? "AND n.archived_at IS NULL" : "AND n.id IN (?)"}`,
    ids === null ? [userId] : [userId, ids.length ? [...ids] : [0]],
  );
  return result.affectedRows;
}

// D-219: the live task of every repeating series the person can see.
export async function listPeriodic(viewer: WorkViewer, db: Queryable = getDbPool()): Promise<(WorkTaskItem & { rule: unknown; doneInSeries: number })[]> {
  const visible = visibleTaskClause(viewer);
  const { items } = await listTaskItems([visible.sql, "t.recurrence_json IS NOT NULL"], visible.params, "t.due_at IS NULL, t.due_at, t.id", 500, 0, db);
  if (!items.length) return [];
  const [rows] = await db.query<Row[]>(
    `SELECT t.id, t.recurrence_json, (SELECT COUNT(*) FROM tasks s WHERE s.series_id = COALESCE(t.series_id, t.id) AND s.status = 'COMPLETED' AND s.deleted_at IS NULL) AS done_n
     FROM tasks t WHERE t.id IN (?)`,
    [items.map((item) => item.id)],
  );
  const extra = new Map(rows.map((row) => [num(row.id), { rule: row.recurrence_json, done: num(row.done_n) }]));
  return items.map((item) => ({ ...item, rule: extra.get(item.id)?.rule ?? null, doneInSeries: extra.get(item.id)?.done ?? 0 }));
}

// v1.54.7: the repeat rule and how many of the series are done, for the listed tasks.
export async function periodicDetails(ids: readonly number[], db: Queryable = getDbPool()): Promise<Map<number, { rule: unknown; doneInSeries: number }>> {
  if (!ids.length) return new Map();
  const [rows] = await db.query<Row[]>(
    `SELECT t.id, t.recurrence_json, (SELECT COUNT(*) FROM tasks s WHERE s.series_id = COALESCE(t.series_id, t.id) AND s.status = 'COMPLETED' AND s.deleted_at IS NULL) AS done_n
     FROM tasks t WHERE t.id IN (?)`,
    [[...ids]],
  );
  return new Map(rows.map((row) => [num(row.id), { rule: row.recurrence_json, doneInSeries: num(row.done_n) }]));
}

// ---- saved view tabs (D-220) -----------------------------------------------------------
export interface WorkView {
  id: number;
  name: string;
  config: unknown;
}
export async function listWorkViews(scope: "MY_TASKS" | "PROJECT", scopeId: number, db: Queryable = getDbPool()): Promise<WorkView[]> {
  // v1.61.0 (D-367): only List tabs here (My Tasks, and the old project strip).
  const [rows] = await db.query<Row[]>("SELECT id, name, config_json FROM work_views WHERE scope = ? AND scope_id = ? AND view_type = 'LIST' ORDER BY position, id", [scope, scopeId]);
  return rows.map((row) => ({ id: num(row.id), name: String(row.name), config: typeof row.config_json === "string" ? JSON.parse(row.config_json) : row.config_json }));
}

// v1.61.0 (D-367): a project's tabs of every view type, and whether its strip is stored.
// v1.63.0 (D-369, PM-A13): the same for a person's My Tasks (scope MY_TASKS,
// scope_id = the person). Whether a person's strip is stored is the
// user_settings key "work.my_tabs_set"; a project keeps projects.view_tabs_set.
export interface TabOwner {
  scope: TabScope;
  id: number;
}
export const MY_TABS_SET = "work.my_tabs_set";
export async function listTabs(owner: TabOwner, db: Queryable = getDbPool()): Promise<{ rows: TabRow[]; tabsSet: boolean; defaultView: string }> {
  const [[flag], [rows]] = await Promise.all([
    owner.scope === "PROJECT"
      ? db.query<Row[]>("SELECT view_tabs_set AS tabs_set, default_view FROM projects WHERE id = ?", [owner.id])
      : db.query<Row[]>("SELECT TRUE AS tabs_set, 'LIST' AS default_view FROM user_settings WHERE user_id = ? AND setting_key = ? AND value = '1'", [owner.id, MY_TABS_SET]),
    db.query<Row[]>("SELECT id, view_type, name, config_json, is_default, position FROM work_views WHERE scope = ? AND scope_id = ? ORDER BY position, id", [owner.scope, owner.id]),
  ]);
  return {
    tabsSet: Boolean(flag[0]?.tabs_set),
    defaultView: String(flag[0]?.default_view ?? "LIST"),
    rows: rows.map((row) => ({
      id: num(row.id),
      type: String(row.view_type) as TabView,
      name: String(row.name),
      config: typeof row.config_json === "string" ? JSON.parse(row.config_json) : row.config_json,
      isDefault: Boolean(row.is_default),
      position: Number(row.position),
    })),
  };
}
export const listProjectTabs = (projectId: number, db: Queryable = getDbPool()) => listTabs({ scope: "PROJECT", id: projectId }, db);
export const listMyTabs = (userId: number, db: Queryable = getDbPool()) => listTabs({ scope: "MY_TASKS", id: userId }, db);
export async function findTab(owner: TabOwner, id: number, db: Queryable = getDbPool()): Promise<TabRow | null> {
  const [rows] = await db.query<Row[]>("SELECT id, view_type, name, config_json, is_default, position FROM work_views WHERE id = ? AND scope = ? AND scope_id = ?", [id, owner.scope, owner.id]);
  const row = rows[0];
  if (!row) return null;
  return { id: num(row.id), type: String(row.view_type) as TabView, name: String(row.name), config: typeof row.config_json === "string" ? JSON.parse(row.config_json) : row.config_json, isDefault: Boolean(row.is_default), position: Number(row.position) };
}
export async function findProjectTab(id: number, db: Queryable = getDbPool()): Promise<(TabRow & { projectId: number }) | null> {
  const [rows] = await db.query<Row[]>("SELECT id, scope_id, view_type, name, config_json, is_default, position FROM work_views WHERE id = ? AND scope = 'PROJECT'", [id]);
  const row = rows[0];
  if (!row) return null;
  return { id: num(row.id), projectId: num(row.scope_id), type: String(row.view_type) as TabView, name: String(row.name), config: typeof row.config_json === "string" ? JSON.parse(row.config_json) : row.config_json, isDefault: Boolean(row.is_default), position: Number(row.position) };
}
export async function insertTab(owner: TabOwner, input: { type: TabView; name: string; config: unknown; position: number; isDefault?: boolean }, by: number, db: Queryable): Promise<number | "DUPLICATE"> {
  try {
    const [result] = await db.query<ResultSetHeader>(
      "INSERT INTO work_views (scope, scope_id, view_type, name, config_json, position, is_default, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [owner.scope, owner.id, input.type, input.name, JSON.stringify(input.config ?? {}), input.position, Boolean(input.isDefault), by],
    );
    return result.insertId;
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return "DUPLICATE";
    throw error;
  }
}
export const insertProjectTab = (projectId: number, input: Parameters<typeof insertTab>[1], by: number, db: Queryable) => insertTab({ scope: "PROJECT", id: projectId }, input, by, db);
export async function setOwnerTabPositions(owner: TabOwner, ids: readonly number[], db: Queryable): Promise<void> {
  for (const [index, id] of ids.entries()) await db.query<ResultSetHeader>("UPDATE work_views SET position = ? WHERE id = ? AND scope = ? AND scope_id = ?", [(index + 1) * 1024, id, owner.scope, owner.id]);
}
export const setTabPositions = (projectId: number, ids: readonly number[], db: Queryable) => setOwnerTabPositions({ scope: "PROJECT", id: projectId }, ids, db);
export async function setOwnerDefaultTab(owner: TabOwner, id: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("UPDATE work_views SET is_default = (id = ?) WHERE scope = ? AND scope_id = ?", [id, owner.scope, owner.id]);
}
export const setDefaultTab = (projectId: number, id: number, db: Queryable) => setOwnerDefaultTab({ scope: "PROJECT", id: projectId }, id, db);
export async function renameWorkView(id: number, name: string, db: Queryable = getDbPool()): Promise<"DUPLICATE" | "OK"> {
  try {
    await db.query<ResultSetHeader>("UPDATE work_views SET name = ? WHERE id = ?", [name, id]);
    return "OK";
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return "DUPLICATE";
    throw error;
  }
}
export async function markTabsSet(owner: TabOwner, db: Queryable): Promise<void> {
  if (owner.scope === "PROJECT") await db.query<ResultSetHeader>("UPDATE projects SET view_tabs_set = TRUE WHERE id = ?", [owner.id]);
  else await db.query<ResultSetHeader>("INSERT INTO user_settings (user_id, setting_key, value) VALUES (?, ?, '1') ON DUPLICATE KEY UPDATE value = '1'", [owner.id, MY_TABS_SET]);
}
export const markProjectTabsSet = (projectId: number, db: Queryable) => markTabsSet({ scope: "PROJECT", id: projectId }, db);
// Serialises changes to one strip (the project row, or the person's row).
export async function lockTabOwner(owner: TabOwner, db: Queryable): Promise<void> {
  await db.query<Row[]>(owner.scope === "PROJECT" ? "SELECT id FROM projects WHERE id = ? FOR UPDATE" : "SELECT id FROM users WHERE id = ? FOR UPDATE", [owner.id]);
}
export const lockProjectRow = (projectId: number, db: Queryable) => lockTabOwner({ scope: "PROJECT", id: projectId }, db);
export async function findWorkView(id: number, db: Queryable = getDbPool()): Promise<{ id: number; scope: "MY_TASKS" | "PROJECT"; scopeId: number; name: string } | null> {
  const [rows] = await db.query<Row[]>("SELECT id, scope, scope_id, name FROM work_views WHERE id = ?", [id]);
  return rows[0] ? { id: num(rows[0].id), scope: rows[0].scope as "MY_TASKS" | "PROJECT", scopeId: num(rows[0].scope_id), name: String(rows[0].name) } : null;
}
export async function insertWorkView(scope: "MY_TASKS" | "PROJECT", scopeId: number, name: string, config: unknown, by: number, db: Queryable = getDbPool()): Promise<"DUPLICATE" | "TOO_MANY" | number> {
  const [count] = await db.query<Row[]>("SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS top FROM work_views WHERE scope = ? AND scope_id = ?", [scope, scopeId]);
  if (num(count[0]?.n ?? 0) >= (scope === "PROJECT" ? 50 : 30)) return "TOO_MANY"; // v1.61.0 (D-367): 50 tabs per project
  try {
    const [result] = await db.query<ResultSetHeader>("INSERT INTO work_views (scope, scope_id, name, config_json, position, created_by) VALUES (?, ?, ?, ?, ?, ?)", [scope, scopeId, name, JSON.stringify(config), Number(count[0]?.top ?? 0) + 1024, by]);
    return result.insertId;
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return "DUPLICATE";
    throw error;
  }
}
export async function updateWorkView(id: number, changes: { name?: string; config?: unknown }, db: Queryable = getDbPool()): Promise<void> {
  if (changes.name !== undefined) await db.query<ResultSetHeader>("UPDATE work_views SET name = ? WHERE id = ?", [changes.name, id]);
  if (changes.config !== undefined) await db.query<ResultSetHeader>("UPDATE work_views SET config_json = ? WHERE id = ?", [JSON.stringify(changes.config), id]);
}
export async function deleteWorkView(id: number, db: Queryable = getDbPool()): Promise<void> {
  await db.query<ResultSetHeader>("DELETE FROM work_views WHERE id = ?", [id]);
}

// D-222: the project's permissions (fields and sharing tasks).
export async function setProjectPermissions(projectId: number, permissions: ProjectPermissions, db: Queryable = getDbPool()): Promise<void> {
  await db.query<ResultSetHeader>("UPDATE projects SET permissions_json = ? WHERE id = ?", [JSON.stringify(permissions), projectId]);
}

// D-222: the other copies of an ad hoc task given to several people.
export async function assignGroup(taskId: number, db: Queryable = getDbPool()): Promise<{ id: number; taskNo: string; assigneeName: string; status: string }[]> {
  const [rows] = await db.query<Row[]>(
    `SELECT t.id, t.task_no, u.name, t.status FROM tasks t JOIN users u ON u.id = t.assignee_id
     WHERE t.assign_group_id = (SELECT assign_group_id FROM tasks WHERE id = ?) AND t.id <> ? AND t.deleted_at IS NULL ORDER BY u.name`,
    [taskId, taskId],
  );
  return rows.map((row) => ({ id: num(row.id), taskNo: String(row.task_no), assigneeName: String(row.name), status: String(row.status) }));
}

// v1.61.0 (D-367): the person's row density for task lists ("work.density" in user_settings).
export async function workDensity(userId: number, db: Queryable = getDbPool()): Promise<"COMFORTABLE" | "COMPACT"> {
  const [rows] = await db.query<Row[]>("SELECT value FROM user_settings WHERE user_id = ? AND setting_key = 'work.density'", [userId]);
  return rows[0]?.value === "COMPACT" ? "COMPACT" : "COMFORTABLE";
}
