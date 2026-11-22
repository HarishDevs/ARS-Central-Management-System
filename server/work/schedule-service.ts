import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { appendTaskEvent, findTask } from "@/lib/db/repositories/tasks.repository";
import { insertOutbox } from "@/lib/db/repositories/outbox.repository";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import * as repo from "@/lib/db/repositories/work.repository";
import { getWorkingDays } from "@/lib/db/repositories/calendar.repository";
import { WEEKDAYS } from "@/server/workflows/calendar";
import { afterResponse } from "@/lib/http/after-response";
import { deliverOutbox } from "@/server/approvals/service";
import { projectMessages, taskMessages } from "@/server/modules/messages";
import type { NotifyInput } from "@/server/notifications/notify";
import type { TaskActor } from "@/server/modules/tasks";
import { featureOn } from "@/server/settings/features";
import { OPEN_STATUSES } from "@/server/modules/task-rules";
import { projectAbilities, STATUS_KIND_LABEL, STATUS_KINDS } from "@/server/work/access";
import { dependencyLoop, indiaDay, MAX_DEPENDENCIES } from "@/server/work/rules";
import { rightsOn, workViewer } from "@/server/work/task-access";
import {
  DEP_TYPE_LABEL,
  highlightDays,
  isDepType,
  isShiftMode,
  MAX_EXTRA_RECIPIENTS,
  MAX_HIGHLIGHTS,
  planShift,
  reminderDue,
  SHIFT_MODE_LABEL,
  SHIFT_UNDO_MINUTES,
  type DepType,
  type ShiftLink,
  type ShiftMode,
  type ShiftTask,
  type TaskDates,
  type WorkCalendar,
} from "@/server/work/schedule";

// v1.65.0 (D-373, PM phase B part 2): typed dependencies, the project's
// scheduling settings, auto-shifting dependent tasks in one transaction (with
// Undo), and the fuller status update (highlights, recipients, weekly
// reminder). Every operation checks the person's rights on the server, and the
// whole of it needs the "pm_planning" switch.
type Result<T = undefined> = { ok: true; value: T; message?: string } | { ok: false; message: string; fieldErrors?: Record<string, string> };
const fail = (message: string, fieldErrors?: Record<string, string>): { ok: false; message: string; fieldErrors?: Record<string, string> } => ({ ok: false, message, fieldErrors });
const NOT_FOUND = "Not found.";
const OFF = "This needs the planning features, which aren't switched on yet.";
const planningOn = (actor: TaskActor) => featureOn("pm_planning", actor).catch(() => false);
const num = (value: unknown) => Number(value);
const istDay = (value: Date) => indiaDay(value);
async function send(ids: number[]) {
  if (ids.length) await afterResponse("schedule messages", () => deliverOutbox(ids));
}

// The people (of these) who have the Projects module (as service.ts withProjects, D-307/D-308).
async function withProjectsModule(userIds: readonly number[], db: Queryable): Promise<number[]> {
  if (!userIds.length) return [];
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT u.id FROM users u WHERE u.id IN (?) AND u.active = TRUE AND (FIND_IN_SET('PROJECT', u.module_access) > 0 OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.code = 'SUPER_ADMIN'))",
    [userIds],
  );
  const allowed = new Set(rows.map((row) => num(row.id)));
  return userIds.filter((id) => allowed.has(id));
}

async function taskFor(taskId: number, actor: TaskActor) {
  const task = await findTask(taskId);
  if (!task || task.deletedAt) return null;
  const viewer = await workViewer(actor);
  const rights = await rightsOn(task, viewer);
  return rights.view ? { task, viewer, rights } : null;
}

// ---- dependencies ---------------------------------------------------------------------------
// Add, change the type of, or remove a link. `role` says what the other task
// is to this one: BLOCKED_BY (it waits for the other) or BLOCKING (the other
// waits for it). The successor's dates are what a link constrains, so the
// person needs the planning right on the successor (D-222) and must see the
// predecessor; both outside each other's family (parent/subtasks).
export async function setTypedDependency(input: { taskId: number; otherId: number; role: "BLOCKED_BY" | "BLOCKING"; type: string; on: boolean }, actor: TaskActor): Promise<Result<{ type: DepType | null }>> {
  if (!(await planningOn(actor))) return fail(OFF);
  const here = await taskFor(input.taskId, actor);
  const other = await taskFor(input.otherId, actor);
  if (!here) return fail(NOT_FOUND);
  if (!other) return fail("No task with that name that you can see.", { other: "Choose a task you can see." });
  const [pred, succ] = input.role === "BLOCKED_BY" ? [other, here] : [here, other];
  if (!succ.rights.planning) return fail(succ.rights.adhoc ? "Only its creator can change what an ad hoc task waits for." : `You can't change what ${succ.task.taskNo} waits for.`);
  const type: DepType = isDepType(input.type) ? input.type : "FS";
  if (!input.on) {
    await withTransaction(async (connection) => {
      const [result] = await connection.query<ResultSetHeader>("DELETE FROM task_dependencies WHERE blocker_task_id = ? AND blocked_task_id = ?", [pred.task.id, succ.task.id]);
      if (result.affectedRows) {
        await appendTaskEvent(succ.task.id, { actorId: actor.id, type: "DEPENDENCY_REMOVED", body: pred.task.taskNo }, connection);
        await appendTaskEvent(pred.task.id, { actorId: actor.id, type: "DEPENDENCY_REMOVED", body: `No longer blocking ${succ.task.taskNo}` }, connection);
      }
    });
    return { ok: true, value: { type: null }, message: "Removed." };
  }
  const family = new Set([...(await repo.ancestors(succ.task.id)).map((item) => item.id), ...(await repo.descendants(succ.task.id)).map((item) => item.id)]);
  if (pred.task.id === succ.task.id) return fail("A task can't wait for itself.", { other: "Choose another task." });
  if (family.has(pred.task.id)) return fail("A task can't wait for its own parent or subtasks.", { other: "Choose a task outside this one's family." });
  const problem = await withTransaction(async (connection) => {
    // Lock both tasks so two people linking at once can't make a loop together.
    await connection.query("SELECT id FROM tasks WHERE id IN (?) ORDER BY id FOR UPDATE", [[pred.task.id, succ.task.id]]);
    const [existing] = await connection.query<RowDataPacket[]>("SELECT dep_type FROM task_dependencies WHERE blocker_task_id = ? AND blocked_task_id = ?", [pred.task.id, succ.task.id]);
    if (existing[0]) {
      if (existing[0].dep_type === type) return null;
      await connection.query("UPDATE task_dependencies SET dep_type = ? WHERE blocker_task_id = ? AND blocked_task_id = ?", [type, pred.task.id, succ.task.id]);
      await appendTaskEvent(succ.task.id, { actorId: actor.id, type: "DEPENDENCY_ADDED", body: `Now waits for ${pred.task.taskNo} as ${DEP_TYPE_LABEL[type]}` }, connection);
      return null;
    }
    for (const id of [pred.task.id, succ.task.id]) if ((await repo.countDependencies(id, connection)) >= MAX_DEPENDENCIES) return `A task has at most ${MAX_DEPENDENCIES} dependencies.`;
    if (dependencyLoop(pred.task.id, succ.task.id, await repo.dependencyEdges(connection))) return "This would create a circular dependency.";
    await connection.query("INSERT INTO task_dependencies (blocker_task_id, blocked_task_id, dep_type, lag_days, created_by) VALUES (?, ?, ?, 0, ?)", [pred.task.id, succ.task.id, type, actor.id]);
    // Spec BR-PROJ-042: the story on the task that waits.
    await appendTaskEvent(succ.task.id, { actorId: actor.id, type: "DEPENDENCY_ADDED", body: `Marked this task as blocked by ${pred.task.taskNo} (${DEP_TYPE_LABEL[type]})` }, connection);
    await appendTaskEvent(pred.task.id, { actorId: actor.id, type: "DEPENDENCY_ADDED", body: `Marked this task as blocking ${succ.task.taskNo} (${DEP_TYPE_LABEL[type]})` }, connection);
    return null;
  });
  if (problem) return fail(problem, { other: problem });
  return { ok: true, value: { type }, message: `${succ.task.taskNo} now waits for ${pred.task.taskNo} (${DEP_TYPE_LABEL[type]}).` };
}

// Tasks the person can see whose number or name matches (spec BR-PROJ-041:
// across every project they can see), each with its first project's name.
export async function dependencyTargets(q: string, actor: TaskActor, excludeId: number | null): Promise<Result<{ id: number; taskNo: string; title: string; projectName: string | null; dueAt: string | null; status: string }[]>> {
  if (!(await planningOn(actor))) return fail(OFF);
  const text = q.replace(/\s+/g, " ").trim().slice(0, 80);
  if (text.length < 2) return { ok: true, value: [] };
  const viewer = await workViewer(actor);
  const visible = repo.visibleTaskClause(viewer);
  const like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    `SELECT t.id, t.task_no, t.title, t.status, t.due_at,
       (SELECT p.name FROM task_projects tp JOIN projects p ON p.id = tp.project_id AND p.deleted_at IS NULL WHERE tp.task_id = t.id ORDER BY p.name LIMIT 1) AS project_name
     FROM tasks t JOIN users a ON a.id = t.assignee_id WHERE ${visible.sql} AND t.id <> ? AND (t.task_no = ? OR t.title LIKE ?)
     ORDER BY t.status IN ('COMPLETED', 'CANCELLED'), t.updated_at DESC LIMIT 8`,
    [...visible.params, excludeId ?? 0, text.toUpperCase(), like],
  );
  return { ok: true, value: rows.map((row) => ({ id: num(row.id), taskNo: String(row.task_no), title: String(row.title), projectName: row.project_name ? String(row.project_name) : null, dueAt: row.due_at ? (row.due_at as Date).toISOString() : null, status: String(row.status) })) };
}

// Links among a set of tasks (a project's view) and, for the Gantt's
// "Blocked by" column, every predecessor of those tasks.
export async function linksFor(taskIds: readonly number[], db: Queryable = getDbPool()): Promise<{ predecessor: number; successor: number; type: DepType; lag: number; predNo: string; predTitle: string; predStatus: string }[]> {
  if (!taskIds.length) return [];
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT d.blocker_task_id, d.blocked_task_id, d.dep_type, d.lag_days, t.task_no, t.title, t.status FROM task_dependencies d JOIN tasks t ON t.id = d.blocker_task_id AND t.deleted_at IS NULL
     WHERE d.blocked_task_id IN (?) ORDER BY d.blocked_task_id, t.id LIMIT 20000`,
    [taskIds],
  );
  return rows.map((row) => ({ predecessor: num(row.blocker_task_id), successor: num(row.blocked_task_id), type: row.dep_type as DepType, lag: num(row.lag_days), predNo: String(row.task_no), predTitle: String(row.title), predStatus: String(row.status) }));
}

// ---- project scheduling settings --------------------------------------------------------------
export interface ProjectSchedule {
  mode: ShiftMode;
  skipOffDays: boolean;
  statusReminder: boolean;
}
export async function projectSchedule(projectId: number, db: Queryable = getDbPool()): Promise<ProjectSchedule> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT shift_mode, shift_skip_off_days, status_reminder FROM projects WHERE id = ?", [projectId]);
  const row = rows[0];
  return { mode: isShiftMode(row?.shift_mode) ? row.shift_mode : "OFF", skipOffDays: row ? Boolean(row.shift_skip_off_days) : true, statusReminder: Boolean(row?.status_reminder) };
}

// Project settings → Dependencies and Scheduling: owners only (like Details).
export async function saveProjectSchedule(projectId: number, input: { mode?: unknown; skipOffDays?: unknown }, actor: TaskActor): Promise<Result> {
  if (!(await planningOn(actor))) return fail(OFF);
  const found = await repo.projectFor(projectId, await workViewer(actor));
  if (!found) return fail(NOT_FOUND);
  if (!projectAbilities(found.role).manage) return fail("Only the project's owners can change its scheduling.");
  const changes: string[] = [];
  const params: unknown[] = [];
  const notes: string[] = [];
  if (input.mode !== undefined) {
    if (!isShiftMode(input.mode)) return fail("Choose what dependent tasks do.", { mode: "Choose one." });
    changes.push("shift_mode = ?");
    params.push(input.mode);
    notes.push(`Dependent tasks: ${SHIFT_MODE_LABEL[input.mode]}`);
  }
  if (input.skipOffDays !== undefined) {
    if (typeof input.skipOffDays !== "boolean") return fail("Choose whether to skip weekly offs and holidays.");
    changes.push("shift_skip_off_days = ?");
    params.push(input.skipOffDays);
    notes.push(input.skipOffDays ? "Shifts skip weekly offs and holidays" : "Shifts count every day");
  }
  if (!changes.length) return { ok: true, value: undefined };
  await withTransaction(async (connection) => {
    await connection.query(`UPDATE projects SET ${changes.join(", ")} WHERE id = ?`, [...params, projectId]);
    await repo.appendProjectEvent(projectId, actor.id, "SCHEDULING", notes.join("; ").slice(0, 500), connection);
    await recordAudit({ actorUserId: actor.id, action: "WORK_PROJECT_SCHEDULING", entityType: "PROJECT", entityId: String(projectId), metadata: { mode: input.mode ?? null, skipOffDays: input.skipOffDays ?? null } }, connection);
  });
  return { ok: true, value: undefined, message: "Saved." };
}

// ---- auto-shift ---------------------------------------------------------------------------------
export async function workCalendar(db: Queryable): Promise<WorkCalendar> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT DATE_FORMAT(holiday_on, '%Y-%m-%d') AS day FROM holidays WHERE holiday_on >= DATE_SUB(UTC_DATE(), INTERVAL 400 DAY) AND holiday_on < DATE_ADD(UTC_DATE(), INTERVAL 1200 DAY)",
  );
  const working = await getWorkingDays(db);
  return { offDays: new Set(rows.map((row) => String(row.day))), workingWeekdays: new Set(working.map((day) => WEEKDAYS.indexOf(day))) };
}

const datesOf = (row: RowDataPacket): TaskDates => ({ start: row.starts_on ? (row.starts_on instanceof Date ? row.starts_on.toISOString().slice(0, 10) : String(row.starts_on).slice(0, 10)) : null, due: istDay(row.due_at as Date) });
// The new due time: the same India time of day on the new day (India has no daylight saving).
const movedDue = (dueAt: Date, fromDay: string, toDay: string) => new Date(dueAt.getTime() + (Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)));

export interface ShiftOutcome {
  batchId: number;
  moved: number;
}

// Called inside setTaskFields' transaction once the source task has its new
// dates: moves the dependent tasks the source's projects say to move, writes
// their stories (by the mover where they may plan the task, else by the
// system), records the batch for Undo and returns the messages to send.
export async function shiftDependents(connection: Queryable, sourceId: number, before: TaskDates, beforeDueAt: Date, actor: TaskActor): Promise<{ outcome: ShiftOutcome | null; messages: NotifyInput[] }> {
  // Every task reachable from the source over links (bounded).
  const links: { predecessor: number; successor: number; type: DepType; lag: number }[] = [];
  const seen = new Set<number>([sourceId]);
  let frontier = [sourceId];
  for (let depth = 0; frontier.length && depth < 60 && seen.size < 2000; depth += 1) {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT blocker_task_id, blocked_task_id, dep_type, lag_days FROM task_dependencies WHERE blocker_task_id IN (?)", [frontier]);
    const next: number[] = [];
    for (const row of rows) {
      links.push({ predecessor: num(row.blocker_task_id), successor: num(row.blocked_task_id), type: row.dep_type as DepType, lag: num(row.lag_days) });
      if (!seen.has(num(row.blocked_task_id))) {
        seen.add(num(row.blocked_task_id));
        next.push(num(row.blocked_task_id));
      }
    }
    frontier = next;
  }
  if (!links.length) return { outcome: null, messages: [] };
  const ids = [...seen];
  // Each link uses the setting of a project both tasks share (the lowest id
  // with shifting on): the project's settings never reach another project's tasks.
  const [placeRows] = await connection.query<RowDataPacket[]>(
    "SELECT tp.task_id, p.id, p.shift_mode, p.shift_skip_off_days FROM task_projects tp JOIN projects p ON p.id = tp.project_id AND p.deleted_at IS NULL WHERE tp.task_id IN (?) AND p.shift_mode <> 'OFF' ORDER BY p.id",
    [ids],
  );
  const places = new Map<number, Map<number, { mode: ShiftMode; skip: boolean }>>();
  for (const row of placeRows) {
    const map = places.get(num(row.task_id)) ?? new Map();
    map.set(num(row.id), { mode: row.shift_mode as ShiftMode, skip: Boolean(row.shift_skip_off_days) });
    places.set(num(row.task_id), map);
  }
  const shiftLinks: ShiftLink[] = links.map((link) => {
    const a = places.get(link.predecessor);
    const b = places.get(link.successor);
    let chosen: { mode: ShiftMode; skip: boolean } = { mode: "OFF", skip: true };
    if (a && b) for (const [projectId, setting] of a) if (b.has(projectId)) {
      chosen = setting;
      break;
    }
    return { ...link, mode: chosen.mode, skip: chosen.skip };
  });
  if (shiftLinks.every((link) => link.mode === "OFF")) return { outcome: null, messages: [] };
  const [taskRows] = await connection.query<RowDataPacket[]>("SELECT id, task_no, title, status, starts_on, due_at, assignee_id, deleted_at FROM tasks WHERE id IN (?) ORDER BY id FOR UPDATE", [ids]);
  const rowsById = new Map(taskRows.map((row) => [num(row.id), row]));
  const tasks = new Map<number, ShiftTask>();
  for (const row of taskRows) if (row.due_at) tasks.set(num(row.id), { id: num(row.id), dates: datesOf(row), movable: !row.deleted_at && OPEN_STATUSES.includes(row.status) });
  const source = rowsById.get(sourceId);
  if (!source || !tasks.has(sourceId)) return { outcome: null, messages: [] };
  const moves = planShift(sourceId, before, tasks, shiftLinks, await workCalendar(connection));
  if (!moves.length) return { outcome: null, messages: [] };
  const viewer = await workViewer(actor);
  const messages: NotifyInput[] = [];
  const undo: { id: number; start: string | null; due: string; newStart: string | null; newDue: string }[] = [];
  const sourceRow = rowsById.get(sourceId)!;
  undo.push({ id: sourceId, start: before.start, due: beforeDueAt.toISOString(), newStart: datesOf(sourceRow).start, newDue: (sourceRow.due_at as Date).toISOString() });
  for (const move of moves) {
    const row = rowsById.get(move.id)!;
    const dueAt = row.due_at as Date;
    const newDue = movedDue(dueAt, move.from.due, move.to.due);
    await connection.query("UPDATE tasks SET starts_on = ?, due_at = ?, row_version = row_version + 1 WHERE id = ?", [move.to.start, newDue, move.id]);
    const record = await findTask(move.id, connection);
    const mine = record ? (await rightsOn(record, viewer, connection)).planning : false;
    const cause = rowsById.get(move.because);
    const what = `Dates moved with ${cause ? String(cause.task_no) : "a task it waits for"} (${move.mode === "KEEP_GAP" ? "keep the gap" : "use up the slack"}): due ${move.from.due} → ${move.to.due}${move.to.start ? `, start ${move.from.start ?? "—"} → ${move.to.start}` : ""}`;
    await appendTaskEvent(move.id, { actorId: mine ? actor.id : null, type: "EDIT", body: what, payload: { dueChanged: true, shiftedBy: actor.id, because: move.because } }, connection);
    undo.push({ id: move.id, start: move.from.start, due: dueAt.toISOString(), newStart: move.to.start, newDue: newDue.toISOString() });
    if (num(row.assignee_id) !== actor.id) messages.push(taskMessages.updated({ id: move.id, taskNo: String(row.task_no), title: String(row.title), dueAt: newDue }, num(row.assignee_id), `due date moved to ${move.to.due} because ${cause ? String(cause.task_no) : "a task it waits for"} moved`));
  }
  const [result] = await connection.query<ResultSetHeader>("INSERT INTO task_shift_batches (actor_id, source_task_id, moved, undo_json) VALUES (?, ?, ?, ?)", [actor.id, sourceId, moves.length, JSON.stringify(undo)]);
  return { outcome: { batchId: result.insertId, moved: moves.length }, messages };
}

// Undo: only the person who moved them, within 15 minutes, once. Each task
// goes back only if its dates are still what the shift set (a later change
// by anyone wins and is left alone).
export async function undoShift(batchId: number, actor: TaskActor): Promise<Result<{ restored: number; skipped: number }>> {
  if (!(await planningOn(actor))) return fail(OFF);
  const outcome = await withTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT actor_id, undo_json, undone_at, created_at FROM task_shift_batches WHERE id = ? FOR UPDATE", [batchId]);
    const batch = rows[0];
    if (!batch || num(batch.actor_id) !== actor.id) return "NOT_FOUND" as const;
    if (batch.undone_at) return "DONE" as const;
    if (Date.now() - (batch.created_at as Date).getTime() > SHIFT_UNDO_MINUTES * 60_000) return "LATE" as const;
    const entries = (typeof batch.undo_json === "string" ? JSON.parse(batch.undo_json) : batch.undo_json) as { id: number; start: string | null; due: string; newStart: string | null; newDue: string }[];
    let restored = 0;
    let skipped = 0;
    const [current] = await connection.query<RowDataPacket[]>("SELECT id, starts_on, due_at, deleted_at FROM tasks WHERE id IN (?) FOR UPDATE", [entries.map((entry) => entry.id)]);
    const byId = new Map(current.map((row) => [num(row.id), row]));
    for (const entry of entries) {
      const row = byId.get(entry.id);
      const same = row && !row.deleted_at && datesOf(row).start === entry.newStart && (row.due_at as Date).toISOString() === entry.newDue;
      if (!same) {
        skipped += 1;
        continue;
      }
      await connection.query("UPDATE tasks SET starts_on = ?, due_at = ?, row_version = row_version + 1 WHERE id = ?", [entry.start, new Date(entry.due), entry.id]);
      await appendTaskEvent(entry.id, { actorId: actor.id, type: "EDIT", body: `Dates put back (Undo): due ${istDay(new Date(entry.due))}${entry.start ? `, start ${entry.start}` : ""}`, payload: { dueChanged: true } }, connection);
      restored += 1;
    }
    await connection.query("UPDATE task_shift_batches SET undone_at = UTC_TIMESTAMP() WHERE id = ?", [batchId]);
    return { restored, skipped };
  });
  if (outcome === "NOT_FOUND") return fail(NOT_FOUND);
  if (outcome === "DONE") return fail("That was already undone.");
  if (outcome === "LATE") return fail(`Undo is possible for ${SHIFT_UNDO_MINUTES} minutes; change the dates by hand instead.`);
  return { ok: true, value: outcome, message: outcome.skipped ? `Put back ${outcome.restored}; ${outcome.skipped} had changed since and were left as they are.` : "Dates put back." };
}

// ---- status updates -----------------------------------------------------------------------------
export interface HighlightItem {
  id: number;
  taskNo: string;
  title: string;
  milestone: boolean;
  completedOn: string;
}
// Completed milestones and tasks of the project in the last N days (spec
// "Highlights"), newest first, for the author to pick from.
export async function statusHighlights(projectId: number, days: unknown, actor: TaskActor): Promise<Result<{ days: number; items: HighlightItem[] }>> {
  if (!(await planningOn(actor))) return fail(OFF);
  const found = await repo.projectFor(projectId, await workViewer(actor));
  if (!found) return fail(NOT_FOUND);
  const window = highlightDays(days);
  return { ok: true, value: { days: window, items: await highlightRows(projectId, window) } };
}
async function highlightRows(projectId: number, days: number, db: Queryable = getDbPool()): Promise<HighlightItem[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT t.id, t.task_no, t.title, t.is_milestone, t.completed_at FROM tasks t JOIN task_projects tp ON tp.task_id = t.id AND tp.project_id = ?
     WHERE t.deleted_at IS NULL AND t.status = 'COMPLETED' AND t.completed_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
     ORDER BY t.is_milestone DESC, t.completed_at DESC LIMIT 100`,
    [projectId, days],
  );
  return rows.map((row) => ({ id: num(row.id), taskNo: String(row.task_no), title: String(row.title), milestone: Boolean(row.is_milestone), completedOn: istDay(row.completed_at as Date) }));
}

export interface StatusInput {
  status: string;
  title: string;
  summary: string;
  nextSteps: string;
  ownerId: number | null;
  startOn: string;
  dueOn: string;
  highlightDays: number;
  highlightIds: number[];
  extraRecipients: number[];
}
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// The fuller composer (spec PM §3.22): owners and editors post; the status is
// required; highlights are checked against the project's completed tasks in
// the window and frozen; the members (and the extra people, who must have the
// Projects module and be active) are told; the project's status changes.
export async function postStatusUpdate(projectId: number, input: StatusInput, actor: TaskActor): Promise<Result<{ id: number; notified: number }>> {
  if (!(await planningOn(actor))) return fail(OFF);
  const found = await repo.projectFor(projectId, await workViewer(actor));
  if (!found) return fail(NOT_FOUND);
  if (!projectAbilities(found.role).edit) return fail("Only owners and editors can post status updates.");
  if (!(STATUS_KINDS as readonly string[]).includes(input.status)) return fail("Choose a status.", { status: "Choose a status." });
  const status = input.status as (typeof STATUS_KINDS)[number];
  const title = input.title.replace(/\s+/g, " ").trim().slice(0, 200) || STATUS_KIND_LABEL[status];
  const summary = input.summary.trim().slice(0, 4000);
  const nextSteps = input.nextSteps.trim().slice(0, 4000);
  // Spec: "≥ 1 text block"; a headline alone counts too (as before v1.65.0).
  if (!summary && !nextSteps && !input.title.trim()) return fail("Write a headline, a summary or the next steps.", { summary: "Write how the project is going." });
  const startOn = DAY.test(input.startOn) ? input.startOn : null;
  const dueOn = DAY.test(input.dueOn) ? input.dueOn : null;
  if (startOn && dueOn && startOn > dueOn) return fail("The start date can't be after the due date.", { due_on: "Choose a date on or after the start." });
  const memberIds = found.members.filter((member) => member.type === "USER").map((member) => member.id);
  const ownerId = input.ownerId && (memberIds.includes(input.ownerId) || input.ownerId === found.project.ownerId) ? input.ownerId : found.project.ownerId;
  const picked = [...new Set(input.highlightIds)].slice(0, MAX_HIGHLIGHTS);
  const available = picked.length ? await highlightRows(projectId, highlightDays(input.highlightDays)) : [];
  const highlights = available.filter((item) => picked.includes(item.id));
  if (highlights.length !== picked.length) return fail("Some highlights are no longer completed in that period. Pick them again.");
  const extras = [...new Set(input.extraRecipients)].filter((id) => id > 0 && id !== actor.id);
  if (extras.length > MAX_EXTRA_RECIPIENTS) return fail(`Add at most ${MAX_EXTRA_RECIPIENTS} extra people.`);
  const outbox = await withTransaction(async (connection) => {
    const [active] = extras.length ? await connection.query<RowDataPacket[]>("SELECT id FROM users WHERE id IN (?) AND active = TRUE", [extras]) : [[] as RowDataPacket[]];
    const extraOk = (active as RowDataPacket[]).map((row) => num(row.id));
    const people = await withProjectsModule([...new Set([...memberIds.filter((id) => id !== actor.id), ...extraOk])], connection);
    const snapshot = await repo.projectCounts(projectId, connection);
    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO project_status_updates (project_id, status, title, body, owner_id, start_on, due_on, next_steps, highlights_json, recipients_json, snapshot_json, author_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [projectId, status, title, summary || null, ownerId, startOn, dueOn, nextSteps || null, JSON.stringify(highlights), JSON.stringify(people), JSON.stringify(snapshot), actor.id],
    );
    await repo.updateProject(projectId, { current_status: status, completed_at: status === "COMPLETE" ? new Date() : null }, connection);
    await repo.appendProjectEvent(projectId, actor.id, "STATUS", `${STATUS_KIND_LABEL[status]}: ${title}`.slice(0, 500), connection);
    const ids = await insertOutbox(null, people.map((person) => projectMessages.status({ id: projectId, name: found.project.name }, person, actor.name, STATUS_KIND_LABEL[status], title)), connection);
    return { ids, id: result.insertId, notified: people.length };
  });
  await send(outbox.ids);
  return { ok: true, value: { id: outbox.id, notified: outbox.notified }, message: outbox.notified ? `Status update posted; ${outbox.notified} ${outbox.notified === 1 ? "person" : "people"} told.` : "Status update posted." };
}

// "Remind the owner every Friday": owners and editors switch it.
export async function setStatusReminder(projectId: number, on: boolean, actor: TaskActor): Promise<Result> {
  if (!(await planningOn(actor))) return fail(OFF);
  const found = await repo.projectFor(projectId, await workViewer(actor));
  if (!found) return fail(NOT_FOUND);
  if (!projectAbilities(found.role).edit) return fail("Only owners and editors can change the reminder.");
  await withTransaction(async (connection) => {
    await connection.query("UPDATE projects SET status_reminder = ? WHERE id = ?", [on, projectId]);
    await repo.appendProjectEvent(projectId, actor.id, "SCHEDULING", on ? "Weekly status reminder on" : "Weekly status reminder off", connection);
  });
  return { ok: true, value: undefined, message: on ? "The owner will be reminded every Friday." : "Reminder off." };
}

// Job runner step: on Friday (India) from 9 am, each live project with the
// reminder on tells its owner once (claimed by the India day, so a repeat or
// a second runner sends nothing more). Also drops Undo records over 7 days old.
export async function runStatusReminders(now = new Date()): Promise<{ statusReminders: number; shiftBatchesPruned: number }> {
  const db = getDbPool();
  const [pruned] = await db.query<ResultSetHeader>("DELETE FROM task_shift_batches WHERE created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY) LIMIT 5000");
  const india = new Date(now.getTime() + 330 * 60_000);
  const today = { day: india.toISOString().slice(0, 10), hour: india.getUTCHours() };
  if (!reminderDue(today, null)) return { statusReminders: 0, shiftBatchesPruned: pruned.affectedRows };
  const [mode] = await db.query<RowDataPacket[]>("SELECT value FROM system_settings WHERE setting_key = 'features.pm_planning' LIMIT 1");
  if ((mode[0]?.value ?? "OFF") === "OFF") return { statusReminders: 0, shiftBatchesPruned: pruned.affectedRows };
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, name, owner_id FROM projects WHERE status_reminder = TRUE AND deleted_at IS NULL AND archived_at IS NULL AND is_template = FALSE
       AND (current_status IS NULL OR current_status NOT IN ('COMPLETE', 'DROPPED')) AND (status_reminded_on IS NULL OR status_reminded_on < ?) LIMIT 500`,
    [today.day],
  );
  let sent = 0;
  for (const row of rows) {
    const ids = await withTransaction(async (connection) => {
      const [claim] = await connection.query<ResultSetHeader>("UPDATE projects SET status_reminded_on = ? WHERE id = ? AND (status_reminded_on IS NULL OR status_reminded_on < ?)", [today.day, row.id, today.day]);
      if (!claim.affectedRows) return [];
      const owner = await withProjectsModule([num(row.owner_id)], connection);
      return insertOutbox(null, owner.map((person) => projectMessages.reminder({ id: num(row.id), name: String(row.name) }, person)), connection);
    });
    if (ids.length) {
      sent += 1;
      await deliverOutbox(ids).catch(() => undefined);
    }
  }
  return { statusReminders: sent, shiftBatchesPruned: pruned.affectedRows };
}

// For the composer: the project's members to show as recipients.
export async function statusRecipients(projectId: number): Promise<number> {
  const [rows] = await getDbPool().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM project_members WHERE project_id = ? AND member_type = 'USER'", [projectId]);
  return num(rows[0]?.n ?? 0);
}
