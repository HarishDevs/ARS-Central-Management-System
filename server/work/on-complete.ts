import { linkBlocks } from "@/server/work/schedule";
import "server-only";
import { workMirrorLink, WORK_MIRROR_KEY } from "@/server/approvals/work-mirror";
import { afterResponse } from "@/lib/http/after-response";

import type { RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import { insertOutbox } from "@/lib/db/repositories/outbox.repository";
import { nextRequestNumber } from "@/lib/db/repositories/approvals.repository";
import { appendTaskEvent, findTask, insertTask, updateTask, type TaskRecord } from "@/lib/db/repositories/tasks.repository";
import * as repo from "@/lib/db/repositories/work.repository";
import { deliverOutbox } from "@/server/approvals/service";
import { taskMessages } from "@/server/modules/messages";
import { OPEN_STATUSES } from "@/server/modules/task-rules";
import { indiaDate } from "@/server/workflows/calendar";
import { nearestWorkingDay } from "@/server/work/holidays";
import { departmentOf, holidayContext, loadSetting } from "@/server/work/holiday-store";
import { daysBetween, nextOccurrence, parseRecurrence, parseRecurrenceSettings, RECURRENCE_SETTINGS_KEY, ruleToGiveBack, undoNextDecision } from "@/server/work/more-rules";
import { positionBetween } from "@/server/work/rules";
import { logError } from "@/lib/logging/logger";
import type { NotifyInput } from "@/server/notifications/notify";

// QA-WF-03 (v1.42.1): a repeat or copy of a task is never a request's work step.
const withoutMirrorLink = (formData: Record<string, unknown>) => Object.fromEntries(Object.entries(formData).filter(([key]) => key !== WORK_MIRROR_KEY));

// D-218: what happens after a task is completed, however it was completed
// (the tick in a list, the task page): people waiting for it hear when it
// was the last task they waited for, and a repeating task makes its next one.
const info = (task: Pick<TaskRecord, "id" | "taskNo" | "title" | "dueAt">) => ({ id: task.id, taskNo: task.taskNo, title: task.title, dueAt: task.dueAt });

export async function afterTaskCompleted(taskId: number, actor: { id: number; name: string }): Promise<void> {
  try {
    await tellUnblocked(taskId);
  } catch (error) {
    logError("tellUnblocked failed", error);
  }
  try {
    await createNextOccurrence(taskId, actor);
  } catch (error) {
    logError("createNextOccurrence failed", error, { taskId });
  }
}

async function tellUnblocked(taskId: number): Promise<void> {
  const deps = await repo.listDependencies(taskId);
  const messages: NotifyInput[] = [];
  for (const blocked of deps.blocking) {
    if (!OPEN_STATUSES.includes(blocked.status)) continue;
    // v1.65.0 (D-373): per type: an SF link never held the task back, so its completion tells nobody;
    // the task is ready when no link still holds it (FS/FF: predecessor open; SS: not started).
    if (blocked.type === "SF") continue;
    const others = await repo.listDependencies(blocked.id);
    if (others.blockedBy.every((item) => !linkBlocks(item.type, item.status))) {
      const full = await findTask(blocked.id);
      if (full) messages.push(taskMessages.unblocked(info(full), full.assigneeId));
    }
  }
  if (messages.length) {
    const ids = await insertOutbox(null, messages, getDbPool());
    await afterResponse("task completion messages", () => deliverOutbox(ids));
  }
}

// The next task of a series. The rule moves to the new task (the completed
// one keeps none), so reopening and completing again never makes two.
// v1.90.0 (D-428): Undo (reopen) gives the rule back when the next task is
// still untouched (undoNextOccurrence), so completing again makes it again.
export async function createNextOccurrence(taskId: number, actor: { id: number; name: string }): Promise<number | null> {
  const settings = parseRecurrenceSettings(await loadSetting(RECURRENCE_SETTINGS_KEY));
  if (!settings.enabled) return null;
  const outcome = await withTransaction(async (connection) => {
    const task = await findTask(taskId, connection, true);
    if (!task || task.deletedAt || task.status !== "COMPLETED") return null;
    const [rows] = await connection.query<RowDataPacket[]>("SELECT recurrence_json, series_id FROM tasks WHERE id = ?", [taskId]);
    const rule = parseRecurrence(rows[0]?.recurrence_json ?? null);
    if (!rule) return null;
    const dueDay = task.dueAt ? indiaDate(task.dueAt) : null;
    // QA-WF-04 (v1.42.1): from the series' planned day and day of the month, not the last (moved) due day.
    const occurrence = nextOccurrence(rule, dueDay, indiaDate(task.completedAt ?? new Date()));
    let next = occurrence.planned;
    if (settings.skipHolidays) {
      const { settings: holidays, calendar } = await holidayContext(connection, await departmentOf(task.assigneeId, connection));
      if (holidays.mode !== "OFF") next = nearestWorkingDay(next, calendar, holidays, "NEXT");
    }
    const shift = dueDay ? daysBetween(dueDay, next) : 0;
    const dueAt = task.dueAt ? new Date(task.dueAt.getTime() + shift * 86_400_000) : new Date(`${next}T23:59:00+05:30`);
    const seriesId = rows[0]?.series_id ? Number(rows[0].series_id) : task.id;
    const newId = await cloneTask(task, { parentId: task.parentTaskId, rootId: task.rootTaskId, depth: task.depth, dueAt, shiftDays: shift, recurrence: JSON.stringify(occurrence.rule), seriesId, withProjects: true, keepCreator: true }, actor.id, connection);
    await connection.query("UPDATE tasks SET recurrence_json = NULL, series_id = ? WHERE id = ?", [seriesId, task.id]);
    const created = (await findTask(newId, connection))!;
    // v1.76.0 (D-401, BR-MYT-023): the next one stays in the person's own section.
    await repo.copyPlacement(task.id, newId, created.assigneeId, connection);
    // v1.90.0 (D-428): the rule as it was, so an Undo can give it back unchanged.
    await appendTaskEvent(task.id, { actorId: actor.id, type: "RECURRED", body: `Next: ${created.taskNo}, due ${next}`, payload: { nextId: newId, rule: rule } }, connection);
    await recordAudit({ actorUserId: actor.id, action: "TASK_RECURRED", entityType: "TASK", entityId: newId, metadata: { from: task.id, due: next } }, connection);
    const messages = created.assigneeId !== actor.id ? [taskMessages.assigned(info(created), created.assigneeId, `${actor.name} (repeating task)`)] : [];
    return { newId, outbox: await insertOutbox(null, messages, connection) };
  });
  if (!outcome) return null;
  if (outcome.outbox.length) await afterResponse("next occurrence messages", () => deliverOutbox(outcome.outbox));
  return outcome.newId;
}

// v1.90.0 (D-428, owner: "after completing a task, if we click on Undo and
// then complete the same task again, the task for the next day is not being
// created"). Root cause: completing moves the repeat rule to the new task, and
// reopening left the reopened task with no rule, so completing it again made
// nothing (and the first next task stayed, beside the reopened one).
// Now reopening a completed task of a series removes the next task its
// completion made, and gives the rule back, when that next task is untouched:
// still open, not deleted, and nobody has worked on it or its subtasks (no
// comment, edit, field change, file, time, timer, completed subtask; only its
// creation and project placement in its history). Then completing again makes
// the next task again, once. A next task someone has touched is kept, the
// reopened task stays without the rule, and completing it again makes no
// second one: never a duplicate, never none. Runs inside the reopen's
// transaction. Returns what happened, for the history and the message.
export type UndoNextOutcome = { removed: { id: number; taskNo: string } } | { kept: { id: number; taskNo: string } } | null;
const UNTOUCHED_EVENTS = ["CREATED", "ADDED_TO_PROJECT"];
export async function undoNextOccurrence(task: Pick<TaskRecord, "id" | "taskNo">, actorId: number, connection: Queryable): Promise<UndoNextOutcome> {
  const [own] = await connection.query<RowDataPacket[]>("SELECT recurrence_json, series_id FROM tasks WHERE id = ?", [task.id]);
  if (!own[0] || own[0].recurrence_json !== null || own[0].series_id === null) return null;
  const [events] = await connection.query<RowDataPacket[]>("SELECT payload_json FROM task_events WHERE task_id = ? AND event_type = 'RECURRED' ORDER BY id DESC LIMIT 1", [task.id]);
  if (!events[0]) return null;
  const payload = (typeof events[0].payload_json === "string" ? JSON.parse(events[0].payload_json) : events[0].payload_json) as { nextId?: unknown; rule?: unknown } | null;
  const nextId = Number(payload?.nextId);
  if (!Number.isInteger(nextId) || nextId <= 0) return null;
  const next = await findTask(nextId, connection, true);
  if (!next || next.deletedAt) return null;
  const [nextRule] = await connection.query<RowDataPacket[]>("SELECT recurrence_json, series_id FROM tasks WHERE id = ?", [nextId]);
  const kept = { kept: { id: next.id, taskNo: next.taskNo } } as const;
  const tree = [nextId, ...(await repo.descendants(nextId, connection)).map((item) => item.id)];
  const [touchedRows] = await connection.query<RowDataPacket[]>(
    `SELECT
       (SELECT COUNT(*) FROM task_events WHERE task_id IN (?) AND event_type NOT IN (?)) +
       (SELECT COUNT(*) FROM task_comments WHERE task_id IN (?)) +
       (SELECT COUNT(*) FROM task_time_entries WHERE task_id IN (?)) +
       (SELECT COUNT(*) FROM task_field_timer_runs WHERE task_id IN (?)) +
       (SELECT COUNT(*) FROM record_files WHERE entity_type = 'TASK' AND entity_id IN (?)) +
       (SELECT COUNT(*) FROM tasks WHERE id IN (?) AND id <> ? AND (status <> 'OPEN' OR deleted_at IS NOT NULL)) AS n`,
    [tree, UNTOUCHED_EVENTS, tree, tree, tree, tree, tree, nextId],
  );
  // Only the series' newest task carries the rule; another task's rule isn't ours to take.
  const decision = undoNextDecision({ nextOpen: next.status === "OPEN", nextCarriesRule: Boolean(nextRule[0]?.recurrence_json), sameSeries: Number(nextRule[0]?.series_id) === Number(own[0].series_id), touches: Number(touchedRows[0]?.n ?? 0) });
  const rule = decision === "REMOVE" ? ruleToGiveBack(payload?.rule, nextRule[0]?.recurrence_json) : null;
  if (!rule) return kept;
  const now = new Date();
  for (const id of tree) {
    const item = await findTask(id, connection, true);
    if (!item || item.deletedAt) continue;
    await repo.setTaskWorkFields(id, { deleted_at: now, deleted_by: actorId }, connection);
    await updateTask(id, item.rowVersion, { status: "CANCELLED", cancelled_by: actorId, cancelled_at: now, recurrence_json: null }, connection);
    await appendTaskEvent(id, { actorId, type: "DELETED", from: item.status, to: "CANCELLED", body: id === nextId ? `Removed by Undo on ${task.taskNo}: the repeat goes back to it` : null, payload: { status: item.status, undoneRecurrence: task.id } }, connection);
  }
  await connection.query("UPDATE tasks SET recurrence_json = ? WHERE id = ?", [JSON.stringify(rule), task.id]);
  await recordAudit({ actorUserId: actorId, action: "TASK_RECURRENCE_UNDONE", entityType: "TASK", entityId: task.id, metadata: { removed: nextId, taskNo: next.taskNo } }, connection);
  return { removed: { id: next.id, taskNo: next.taskNo } };
}

// A fresh, open copy of a task and its subtasks: title, description,
// priority, assignee, form values, tags, followers, (optionally) projects.
async function cloneTask(
  source: TaskRecord,
  place: { parentId: number | null; rootId: number | null; depth: number; dueAt: Date | null; shiftDays: number; recurrence: unknown; seriesId: number | null; withProjects: boolean; keepCreator?: boolean },
  actorId: number,
  db: Queryable,
): Promise<number> {
  const taskNo = await nextRequestNumber("TSK", db);
  const id = await insertTask(
    { taskNo, typeVersionId: source.typeVersionId, title: source.title, description: source.description, priority: source.priority, createdBy: place.keepCreator ? source.createdBy : actorId, assigneeId: source.assigneeId, dueAt: place.dueAt, startsOn: source.startsOn ? shiftDay(source.startsOn, place.shiftDays) : null, formData: withoutMirrorLink(source.formData), relatedRequestId: workMirrorLink(source.formData) ? null : source.relatedRequestId, submissionKey: null },
    db,
  );
  const position = place.parentId === null ? 0 : positionBetween(await repo.lastSubtaskPosition(place.parentId, db), null);
  await repo.setTaskTree(id, { parentTaskId: place.parentId, rootTaskId: place.rootId, depth: place.depth, position }, db);
  await db.query("UPDATE tasks SET recurrence_json = ?, series_id = ?, is_milestone = ? WHERE id = ?", [place.recurrence === null || place.recurrence === undefined ? null : typeof place.recurrence === "string" ? place.recurrence : JSON.stringify(place.recurrence), place.seriesId, source.isMilestone, id]);
  await appendTaskEvent(id, { actorId, type: "CREATED", to: "OPEN", body: place.seriesId ? "Repeats" : null, payload: { copiedFrom: source.id } }, db);
  if (place.withProjects) {
    for (const link of await repo.listTaskProjects(source.id, db)) {
      const rows = await repo.sectionPositions(link.projectId, link.sectionId, db);
      await repo.placeTaskInProject(id, link.projectId, link.sectionId, positionBetween(rows.at(-1)?.position ?? null, null), actorId, db);
    }
  }
  await db.query("INSERT IGNORE INTO task_tags (task_id, tag_id, added_by) SELECT ?, tag_id, ? FROM task_tags WHERE task_id = ?", [id, actorId, source.id]);
  await db.query("INSERT IGNORE INTO task_followers (task_id, user_id, source, added_by) SELECT ?, user_id, source, ? FROM task_followers WHERE task_id = ?", [id, actorId, source.id]);
  // v1.64.0 (D-371): typed values too; an ID field gives the new task its own
  // number (placeTaskInProject) and a timer starts again from zero.
  await db.query(
    `INSERT IGNORE INTO task_field_values (task_id, field_id, value, text_value, number_value, date_value, time_value, option_id, ids_json, typed_at, updated_by)
     SELECT ?, v.field_id, v.value, v.text_value, v.number_value, v.date_value, v.time_value, v.option_id, v.ids_json, v.typed_at, ? FROM task_field_values v JOIN project_fields f ON f.id = v.field_id
     WHERE v.task_id = ? AND f.kind NOT IN ('ID', 'TIMER')`,
    [id, actorId, source.id],
  );
  for (const child of await repo.listSubtasks(source.id, db)) {
    const full = await findTask(child.id, db);
    if (!full || full.status === "CANCELLED") continue;
    const dueAt = full.dueAt ? new Date(full.dueAt.getTime() + place.shiftDays * 86_400_000) : null;
    await cloneTask(full, { parentId: id, rootId: place.rootId ?? id, depth: place.depth + 1, dueAt, shiftDays: place.shiftDays, recurrence: null, seriesId: null, withProjects: false }, actorId, db);
  }
  return id;
}

function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
