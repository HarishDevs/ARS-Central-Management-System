import "server-only";
import { withTransaction } from "@/lib/db/transaction";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import { appendTaskEvent, findTask } from "@/lib/db/repositories/tasks.repository";
import * as collab from "@/lib/db/repositories/pm-collab.repository";
import { toCsv } from "@/server/import/csv";
import type { TaskActor } from "@/server/modules/tasks";
import { indiaDay } from "@/server/work/rules";
import { rightsOn, workViewer } from "@/server/work/task-access";
import { checkWorkDay, cleanNote, elapsedMinutes, estimateProgress, formatMinutes, hoursOf, mayChangeEntry, parseDuration, parseEstimate, TIME_CSV_HEADER, timeTotals } from "@/server/work/collab-rules";
import { extrasOn } from "@/server/work/templates";
import { projectAccess } from "@/server/work/collab";
import { featureOn } from "@/server/settings/features";
import { planningBasis, taskEstimate, type PlanningBasis } from "@/server/work/durations";
import type { EstimateSource } from "@/server/work/working-days";

// v1.71.0 (D-384, PM phase E part 2): time tracking on a task, behind
// "pm_extras". Building on the D-371 timer field, but its own entries: a
// person logs time by hand (day, duration, note) or with Start/Stop (one
// running entry per person and task; at most a day an entry). Who:
// - sees the Time section: everyone who sees the task;
// - logs their own time: people who may work on the task (the timer rule:
//   rights.progress or rights.planning);
// - sets the estimate: people who may plan it (rights.planning);
// - changes or deletes an entry: its person, IT, and the owners/editors of a
//   project the task is in (others' entries are audited with before/after).
// Totals roll up to the project (Overview) and the Dashboard's "time
// entries" source (reporting.repository) counts them too.
type Result<T = undefined> = { ok: true; value: T; message?: string } | { ok: false; message: string; fieldErrors?: Record<string, string> };
const fail = (message: string, fieldErrors?: Record<string, string>): { ok: false; message: string; fieldErrors?: Record<string, string> } => ({ ok: false, message, fieldErrors });
const NOT_FOUND = "Not found.";
const OFF = "This isn't switched on yet (Super Admin → Features → Projects E).";

async function taskFor(taskId: number, actor: TaskActor) {
  if (!(await extrasOn(actor))) return null;
  const task = await findTask(taskId);
  if (!task || task.deletedAt) return null;
  const viewer = await workViewer(actor);
  const rights = await rightsOn(task, viewer);
  if (!rights.view) return null;
  return { task, viewer, rights, canLog: rights.progress || rights.planning, canEstimate: rights.planning, manageOthers: viewer.isAdmin || rights.bestRole === "OWNER" || rights.bestRole === "EDITOR" };
}

export interface TimeEntryView {
  id: number;
  userId: number;
  userName: string;
  workDay: string;
  minutes: number | null;
  note: string | null;
  source: "MANUAL" | "TIMER";
  startedAt: string | null;
  edited: boolean;
  canChange: boolean;
}
export interface TaskTimeView {
  taskId: number;
  entries: TimeEntryView[];
  total: number;
  people: { userId: number; name: string; minutes: number }[];
  estimate: number | null; // v1.74.0 (D-398): the effective estimate (manual, else from the dates)
  estimateSource: EstimateSource | null;
  manualEstimate: number | null;
  durationDays: number | null; // working days from the start (From) to the due date (To)
  hoursPerDay: number | null; // null: the planning features are off
  progress: { percent: number | null; over: boolean };
  running: { id: number; startedAt: string } | null; // the viewer's own running entry
  canLog: boolean;
  canEstimate: boolean;
  today: string;
}
export async function loadTaskTime(taskId: number, actor: TaskActor, now = new Date()): Promise<TaskTimeView | null> {
  const found = await taskFor(taskId, actor);
  if (!found) return null;
  const [entries, manual, basis] = await Promise.all([collab.listTaskEntries(taskId), collab.taskEstimate(taskId), planningBasisFor(actor)]);
  const totals = timeTotals(entries);
  // v1.74.0 (D-398): without a manual estimate, the task's working days × hours per day.
  const effective = taskEstimate({ manualMinutes: manual, start: found.task.startsOn, due: found.task.dueAt ? indiaDay(found.task.dueAt) : null, milestone: found.task.isMilestone }, basis);
  const estimate = effective.minutes;
  const mine = entries.find((entry) => entry.userId === actor.id && entry.minutes === null && entry.source === "TIMER");
  return {
    taskId,
    entries: entries.map((entry) => ({
      id: entry.id,
      userId: entry.userId,
      userName: entry.userName,
      workDay: entry.workDay,
      minutes: entry.minutes,
      note: entry.note,
      source: entry.source,
      startedAt: entry.startedAt?.toISOString() ?? null,
      edited: entry.edited,
      canChange: mayChangeEntry(entry.userId, { id: actor.id, isAdmin: found.viewer.isAdmin, projectRole: found.manageOthers ? "EDITOR" : null }),
    })),
    total: totals.total,
    people: totals.people,
    estimate,
    estimateSource: effective.source,
    manualEstimate: manual,
    durationDays: basis ? effective.days : null,
    hoursPerDay: basis?.hoursPerDay ?? null,
    progress: estimateProgress(totals.total, estimate),
    running: mine?.startedAt ? { id: mine.id, startedAt: mine.startedAt.toISOString() } : null,
    canLog: found.canLog && !found.task.deletedAt,
    canEstimate: found.canEstimate,
    today: indiaDay(now),
  };
}

const audit = (actor: TaskActor, action: string, taskId: number, metadata: Record<string, unknown>) => ({ actorUserId: actor.id, action, entityType: "TASK", entityId: taskId, sessionId: actor.sessionId ?? null, ipAddress: actor.ipAddress ?? null, metadata });

// Log time by hand: the day, how long, a note (only for yourself).
export async function logTime(taskId: number, input: { workDay?: unknown; duration?: unknown; note?: unknown }, actor: TaskActor, now = new Date()): Promise<Result<{ id: number }>> {
  if (!(await extrasOn(actor))) return fail(OFF);
  const found = await taskFor(taskId, actor);
  if (!found) return fail(NOT_FOUND);
  if (!found.canLog) return fail("You can't log time on this task.");
  const today = indiaDay(now);
  const workDay = checkWorkDay(input.workDay, today);
  if (!workDay) return fail("Pick a day: today or up to a year back.", { workDay: "Pick a day: today or up to a year back." });
  const minutes = parseDuration(input.duration);
  if (!minutes) return fail("Write how long, e.g. 1h 30m, 45m or 1:30 (at most 24 hours).", { duration: "Write how long, e.g. 1h 30m, 45m or 1:30 (at most 24 hours)." });
  const note = cleanNote(input.note);
  if (note === undefined) return fail("A note has at most 500 characters.", { note: "A note has at most 500 characters." });
  const id = await withTransaction(async (connection) => {
    const entryId = await collab.insertEntry({ taskId, userId: actor.id, workDay, minutes, note, source: "MANUAL", startedAt: null, createdBy: actor.id }, connection);
    await appendTaskEvent(taskId, { actorId: actor.id, type: "FIELD_SET", body: `logged ${formatMinutes(minutes)} for ${workDay}` }, connection);
    await recordAudit(audit(actor, "TIME_LOGGED", taskId, { entryId, minutes, workDay }), connection);
    return entryId;
  });
  return { ok: true, value: { id }, message: `${formatMinutes(minutes)} logged.` };
}

// Start/Stop: one running entry per person and task.
export async function timeTimer(taskId: number, command: "start" | "stop", actor: TaskActor, now = new Date()): Promise<Result<{ minutes: number }>> {
  if (!(await extrasOn(actor))) return fail(OFF);
  const found = await taskFor(taskId, actor);
  if (!found) return fail(NOT_FOUND);
  if (!found.canLog) return fail("You can't log time on this task.");
  const outcome = await withTransaction(async (connection) => {
    await connection.query("SELECT id FROM tasks WHERE id = ? FOR UPDATE", [taskId]);
    const running = await collab.runningEntry(taskId, actor.id, connection, true);
    if (command === "start") {
      if (running) return { kind: "already" as const };
      const entryId = await collab.insertEntry({ taskId, userId: actor.id, workDay: indiaDay(now), minutes: null, note: null, source: "TIMER", startedAt: now, createdBy: actor.id }, connection);
      await recordAudit(audit(actor, "TIME_TIMER_STARTED", taskId, { entryId }), connection);
      return { kind: "started" as const, minutes: 0 };
    }
    if (!running?.startedAt) return { kind: "not-running" as const };
    const { minutes, capped } = elapsedMinutes(running.startedAt, now);
    await collab.stopEntry(running.id, minutes, connection);
    await appendTaskEvent(taskId, { actorId: actor.id, type: "FIELD_SET", body: `logged ${formatMinutes(minutes)} with the timer` }, connection);
    await recordAudit(audit(actor, "TIME_TIMER_STOPPED", taskId, { entryId: running.id, minutes, capped }), connection);
    return { kind: "stopped" as const, minutes, capped };
  });
  if (outcome.kind === "already") return fail("Your timer is already running on this task.");
  if (outcome.kind === "not-running") return fail("Your timer isn't running on this task.");
  if (outcome.kind === "started") return { ok: true, value: { minutes: 0 }, message: "Timer started." };
  return { ok: true, value: { minutes: outcome.minutes }, message: `${formatMinutes(outcome.minutes)} logged.${outcome.capped ? " An entry is at most 24 hours; change it if you need to." : ""}` };
}

// Change an entry's day, duration or note; or delete it. Others' entries by
// owners/editors and IT, audited with what it was.
export async function changeEntry(entryId: number, change: { workDay?: unknown; duration?: unknown; note?: unknown } | { delete: true }, actor: TaskActor, now = new Date()): Promise<Result> {
  if (!(await extrasOn(actor))) return fail(OFF);
  const entry = await collab.findEntry(entryId);
  if (!entry) return fail(NOT_FOUND);
  const found = await taskFor(entry.taskId, actor);
  if (!found) return fail(NOT_FOUND);
  if (!mayChangeEntry(entry.userId, { id: actor.id, isAdmin: found.viewer.isAdmin, projectRole: found.manageOthers ? "EDITOR" : null })) return fail("Only the person who logged it, the project's owners and editors, and IT can change this entry.");
  let next: { workDay: string; minutes: number; note: string | null } | null = null;
  if (!("delete" in change)) {
    if (entry.minutes === null) return fail("Stop the timer first.");
    const workDay = checkWorkDay(change.workDay ?? entry.workDay, indiaDay(now));
    if (!workDay) return fail("Pick a day: today or up to a year back.", { workDay: "Pick a day: today or up to a year back." });
    const minutes = parseDuration(change.duration ?? entry.minutes);
    if (!minutes) return fail("Write how long, e.g. 1h 30m, 45m or 1:30 (at most 24 hours).", { duration: "Write how long, e.g. 1h 30m, 45m or 1:30 (at most 24 hours)." });
    const note = change.note === undefined ? entry.note : cleanNote(change.note);
    if (note === undefined) return fail("A note has at most 500 characters.", { note: "A note has at most 500 characters." });
    next = { workDay, minutes, note };
  }
  const done = await withTransaction(async (connection) => {
    const current = await collab.findEntry(entryId, connection, true);
    if (!current) return false;
    const before = { workDay: current.workDay, minutes: current.minutes, note: current.note, userId: current.userId };
    if (next) await collab.updateEntry(entryId, next, actor.id, connection);
    else await collab.deleteEntry(entryId, connection);
    const others = current.userId !== actor.id;
    await recordAudit(audit(actor, next ? "TIME_ENTRY_CHANGED" : "TIME_ENTRY_DELETED", current.taskId, { entryId, others, before, after: next }), connection);
    if (others) await appendTaskEvent(current.taskId, { actorId: actor.id, type: "FIELD_SET", body: next ? `changed ${current.userName}'s time entry (${formatMinutes(current.minutes ?? 0)} → ${formatMinutes(next.minutes)})` : `deleted ${current.userName}'s time entry (${formatMinutes(current.minutes ?? 0)})` }, connection);
    return true;
  });
  if (!done) return fail(NOT_FOUND);
  return { ok: true, value: undefined, message: next ? "Entry saved." : "Entry deleted." };
}

export async function setEstimate(taskId: number, raw: unknown, actor: TaskActor): Promise<Result<{ minutes: number | null }>> {
  if (!(await extrasOn(actor))) return fail(OFF);
  const found = await taskFor(taskId, actor);
  if (!found) return fail(NOT_FOUND);
  if (!found.canEstimate) return fail("You can't change this task's estimate.");
  const minutes = parseEstimate(raw);
  if (minutes === undefined) return fail("Write the estimate like 4h, 90m or 1:30 (up to 10,000 hours), or leave it empty.", { estimate: "Write the estimate like 4h, 90m or 1:30 (up to 10,000 hours), or leave it empty." });
  await withTransaction(async (connection) => {
    const before = await collab.taskEstimate(taskId, connection);
    await collab.setEstimate(taskId, minutes, connection);
    await appendTaskEvent(taskId, { actorId: actor.id, type: "FIELD_SET", body: minutes === null ? "cleared the estimate" : `set the estimate to ${formatMinutes(minutes)}` }, connection);
    await recordAudit(audit(actor, "TIME_ESTIMATE_SET", taskId, { before, after: minutes }), connection);
  });
  return { ok: true, value: { minutes }, message: minutes === null ? "Estimate cleared." : `Estimate set to ${formatMinutes(minutes)}.` };
}

// v1.74.0 (D-398): date-based estimates come with the planning features ("pm_planning").
async function planningBasisFor(actor: TaskActor): Promise<PlanningBasis | null> {
  return (await featureOn("pm_planning", actor).catch(() => false)) ? planningBasis() : null;
}

// The project's totals (Overview), over the tasks the viewer may see.
// v1.74.0 (D-398): the estimate adds up each task's effective estimate
// (manual, else from its dates with "pm_planning" on); `fromDates` counts the
// tasks whose estimate comes from their dates.
export async function projectTime(projectId: number, actor: TaskActor): Promise<{ logged: number; estimate: number; tasksWithEstimate: number; fromDates: number } | null> {
  const found = await projectAccess(projectId, actor);
  if (!found) return null;
  const [totals, rows, basis] = await Promise.all([collab.projectTimeTotals(projectId, found.viewer), collab.projectEstimateRows(projectId, found.viewer), planningBasisFor(actor)]);
  let estimate = 0;
  let fromDates = 0;
  for (const row of rows) {
    const effective = taskEstimate(row, basis);
    if (effective.minutes === null) continue;
    estimate += effective.minutes;
    if (effective.source === "DATES") fromDates += 1;
  }
  return { logged: totals.logged, estimate, tasksWithEstimate: totals.tasksWithEstimate, fromDates };
}

// CSV of the project's time entries (anyone who sees the project; only visible tasks).
export async function timeCsv(projectId: number, actor: TaskActor): Promise<Result<{ name: string; csv: string }>> {
  const found = await projectAccess(projectId, actor);
  if (!found) return fail(NOT_FOUND);
  const rows = await collab.projectTimeRows(projectId, found.viewer);
  const csv = toCsv(
    TIME_CSV_HEADER,
    rows.map((row) => [row.workDay, row.person, row.taskNo, row.title, row.section, String(hoursOf(row.minutes)), String(row.minutes), row.note ?? "", row.source === "TIMER" ? "Timer" : "By hand", indiaDay(row.createdAt)]),
  );
  await recordAudit({ actorUserId: actor.id, action: "PROJECT_TIME_EXPORTED", entityType: "PROJECT", entityId: projectId, sessionId: actor.sessionId ?? null, ipAddress: actor.ipAddress ?? null, metadata: { rows: rows.length } });
  return { ok: true, value: { name: found.project.name, csv } };
}

