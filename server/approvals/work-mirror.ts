import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { endOfIndiaDay, findWorkflowVersion, lockRequest, nextRequestNumber } from "@/lib/db/repositories/approvals.repository";
import { appendTaskEvent, findTask, insertTask, updateTask, type TaskRecord } from "@/lib/db/repositories/tasks.repository";
import { logError } from "@/lib/logging/logger";
import { addFollower, generalTypeVersion } from "@/lib/db/repositories/work.repository";

// D-269 (owner: "the task raised also should be created in task management"):
// a request's work step ("Work task: they do it and mark it done") is also a
// task in Task Management for each person on it, so it shows in My Tasks,
// the boards, the calendar and Home's figures. The request stays the source of
// truth: the task follows the step (opened, handed over, done, closed), and
// ticking the task done records "done" on the request (WORK_MIRROR_KEY).
export const WORK_MIRROR_KEY = "__approvalWork";
export type WorkMirrorLink = { requestId: number; taskKey: string };

// D-273: work handed out by a background work step: an ordinary task linked
// to the request (it can be handed over, ticked, reopened as any task), which
// never decides anything on the request. Its key is "<event id>:<user id>".
export const WORK_LINK_KEY = "__approvalLink";

export function workMirrorLink(formData: unknown): WorkMirrorLink | null {
  const value = formData && typeof formData === "object" ? (formData as Record<string, unknown>)[WORK_MIRROR_KEY] : null;
  if (!value || typeof value !== "object") return null;
  const link = value as Record<string, unknown>;
  return typeof link.requestId === "number" && typeof link.taskKey === "string" ? { requestId: link.requestId, taskKey: link.taskKey } : null;
}

// Brings a request's work-step tasks in line with its steps. Runs in the same
// transaction as every change to the request (after syncTasks).
export async function mirrorWorkTasks(requestId: number, db: Queryable): Promise<void> {
  await linkBackgroundWork(requestId, db);
  const [steps] = await db.query<RowDataPacket[]>(
    `SELECT t.task_key, t.node_id, t.node_label, t.approver_id, t.status, t.due_at, t.decided_by, r.title, r.request_no, r.requester_id, r.deleted_at, r.workflow_version_id
     FROM approval_tasks t JOIN approval_requests r ON r.id = t.request_id
     WHERE t.request_id = ? AND t.task_type = 'WORK'`,
    [requestId],
  );
  if (steps.length === 0) return;
  // v1.57.6 (D-347): a first look only; every change re-reads the task under its row lock.
  const [mirrors] = await db.query<RowDataPacket[]>(
    `SELECT id, status, assignee_id, due_at, row_version, JSON_UNQUOTE(JSON_EXTRACT(form_data_json, '$.${WORK_MIRROR_KEY}.taskKey')) AS task_key
     FROM tasks WHERE related_request_id = ? AND deleted_at IS NULL AND JSON_EXTRACT(form_data_json, '$.${WORK_MIRROR_KEY}') IS NOT NULL`,
    [requestId],
  );
  const byKey = new Map(mirrors.map((row) => [String(row.task_key), row]));
  // v1.50.0 (owner): the work step's priority (its due date is already the step's due time).
  const version = await findWorkflowVersion(Number(steps[0]!.workflow_version_id), db);
  const priorityOf = (nodeId: string) => {
    const node = version?.definition.nodes.find((item) => item.id === nodeId);
    return node?.kind === "APPROVAL" && node.workPriority ? node.workPriority : "NORMAL";
  };
  let general: Awaited<ReturnType<typeof generalTypeVersion>> | undefined;
  for (const step of steps) {
    const key = String(step.task_key);
    const mirror = byKey.get(key);
    const pending = step.status === "PENDING" && !step.deleted_at;
    if (pending && !mirror) {
      general ??= await generalTypeVersion(db);
      if (!general) continue; // the General task type is switched off: no new task, but finished steps still close theirs (QA-WF-07)
      const taskNo = await nextRequestNumber("TSK", db);
      const id = await insertTask(
        {
          taskNo,
          typeVersionId: general.versionId,
          title: `${String(step.node_label)}: ${String(step.title)}`.slice(0, 200),
          description: `A work step of request ${String(step.request_no)}. Do the work, then tick this task done (or press Mark as done on the request); the request then moves on.`,
          priority: priorityOf(String(step.node_id)),
          createdBy: Number(step.requester_id),
          assigneeId: Number(step.approver_id),
          dueAt: (step.due_at as Date | null) ?? null,
          startsOn: null,
          formData: { [WORK_MIRROR_KEY]: { requestId, taskKey: key } },
          relatedRequestId: requestId,
          submissionKey: null,
        },
        db,
      );
      await addFollower(id, Number(step.approver_id), "ASSIGNEE", Number(step.requester_id), db);
      await appendTaskEvent(id, { actorId: Number(step.requester_id), type: "CREATED", to: "OPEN", body: `From the work step of ${String(step.request_no)}`, payload: { assigneeId: Number(step.approver_id), requestId } }, db);
      continue;
    }
    if (!mirror || !OPEN_TASK.includes(String(mirror.status))) continue;
    // v1.57.6 (D-347, owner): "lock and check". The task row is locked in this
    // transaction and re-read, then written with its row_version (WHERE
    // row_version = ?), so a person editing the task at the same moment is
    // never overwritten. The task event's "from" is the status read under the lock.
    await underTaskLock(Number(mirror.id), requestId, db, async (task) => {
      let version = task.rowVersion;
      if (pending) {
        // Handed over on the request: the task follows the person.
        // QA-WF-02 (v1.42.1): the due time follows the step (handover restarts it; a hold or question adds the waiting time).
        const due = (step.due_at as Date | null)?.getTime() ?? null;
        if (due !== (task.dueAt?.getTime() ?? null)) {
          if (!(await updateTask(task.id, version, { due_at: step.due_at ?? null }, db))) return false;
          version += 1;
        }
        if (task.assigneeId !== Number(step.approver_id)) {
          if (!(await updateTask(task.id, version, { assignee_id: step.approver_id, assigned_at: new Date() }, db))) return false;
          await addFollower(task.id, Number(step.approver_id), "ASSIGNEE", Number(step.requester_id), db);
          await appendTaskEvent(task.id, { actorId: null, type: "REASSIGN", from: task.status, to: task.status, body: "Handed over on the request", payload: { from: task.assigneeId, to: Number(step.approver_id) } }, db);
        }
        return true;
      }
      // The step is over: done (approved) → completed; otherwise the task closes too.
      const done = step.status === "APPROVED";
      // QA-WF-08: closed by the engine (sent back, rejected, withdrawn…) → nobody in particular, not the worker.
      const by = step.decided_by ?? (done ? step.approver_id : null);
      const changes = done ? { status: "COMPLETED", completed_by: by, completed_at: new Date() } : { status: "CANCELLED", cancelled_by: by, cancelled_at: new Date() };
      if (!(await updateTask(task.id, version, changes, db))) return false;
      await appendTaskEvent(
        task.id,
        { actorId: step.decided_by ? Number(step.decided_by) : null, type: done ? "COMPLETE" : "CANCEL", from: task.status, to: done ? "COMPLETED" : "CANCELLED", body: done ? `Marked done on ${String(step.request_no)}` : `The step closed on ${String(step.request_no)}` },
        db,
      );
      return true;
    });
  }
}

const OPEN_TASK = ["OPEN", "IN_PROGRESS", "BLOCKED"];

// v1.57.6 (D-347, owner): locks the task row (SELECT … FOR UPDATE on the
// caller's transaction), re-reads it and applies the change. If the row_version
// check still fails, it re-reads and tries again, at most 3 times, then logs and
// gives up: a task that can't be brought in line never undoes the approval decision.
// A task no longer open (finished or deleted meanwhile) is left as it is.
async function underTaskLock(taskId: number, requestId: number, db: Queryable, apply: (task: TaskRecord) => Promise<boolean>): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const task = await findTask(taskId, db, true);
    if (!task || task.deletedAt || !OPEN_TASK.includes(task.status)) return;
    if (await apply(task)) return;
  }
  logError("work-mirror: task changed under the lock three times; left as it is", new Error("row_version mismatch"), { taskId, requestId });
}

// D-273: one task per person for each WORK_ASSIGNED event, made once (a task
// deleted later isn't made again). Due after the step's response time, if it has one.
async function linkBackgroundWork(requestId: number, db: Queryable): Promise<void> {
  const [events] = await db.query<RowDataPacket[]>(
    `SELECT e.id, e.payload_json, e.created_at, r.title, r.request_no, r.requester_id, r.deleted_at
     FROM approval_events e JOIN approval_requests r ON r.id = e.request_id
     WHERE e.request_id = ? AND e.event_type = 'WORK_ASSIGNED' ORDER BY e.id`,
    [requestId],
  );
  if (events.length === 0 || events[0]!.deleted_at) return;
  const [made] = await db.query<RowDataPacket[]>(
    `SELECT JSON_UNQUOTE(JSON_EXTRACT(form_data_json, '$.${WORK_LINK_KEY}.key')) AS link_key FROM tasks WHERE related_request_id = ? AND JSON_EXTRACT(form_data_json, '$.${WORK_LINK_KEY}') IS NOT NULL`,
    [requestId],
  );
  const have = new Set(made.map((row) => String(row.link_key)));
  let general: Awaited<ReturnType<typeof generalTypeVersion>> | undefined;
  for (const event of events) {
    const payload = (typeof event.payload_json === "string" ? JSON.parse(event.payload_json) : event.payload_json) as { nodeId: string; label: string; userIds: number[]; slaHours?: number; workPriority?: "LOW" | "NORMAL" | "ELEVATED" | "IMPORTANT" | "HIGH" | "URGENT"; workDueOn?: string };
    for (const userId of payload.userIds ?? []) {
      const key = `${String(event.id)}:${userId}`;
      if (have.has(key)) continue;
      general ??= await generalTypeVersion(db);
      if (!general) return;
      const dueAt = payload.workDueOn ? endOfIndiaDay(payload.workDueOn) : payload.slaHours ? new Date((event.created_at as Date).getTime() + payload.slaHours * 3_600_000) : null;
      const taskNo = await nextRequestNumber("TSK", db);
      const id = await insertTask(
        {
          taskNo,
          typeVersionId: general.versionId,
          title: `${payload.label}: ${String(event.title)}`.slice(0, 200),
          description: `A task from request ${String(event.request_no)}. The request doesn't wait for it, and finishing it doesn't decide anything on the request.`,
          priority: payload.workPriority ?? "NORMAL",
          createdBy: Number(event.requester_id),
          assigneeId: userId,
          dueAt,
          startsOn: null,
          formData: { [WORK_LINK_KEY]: { requestId, key, nodeId: payload.nodeId } },
          relatedRequestId: requestId,
          submissionKey: null,
        },
        db,
      );
      await addFollower(id, userId, "ASSIGNEE", Number(event.requester_id), db);
      await appendTaskEvent(id, { actorId: Number(event.requester_id), type: "CREATED", to: "OPEN", body: `From ${String(event.request_no)} (${payload.label})`, payload: { assigneeId: userId, requestId } }, db);
      have.add(key);
    }
  }
}

// QA-WF-09 (v1.42.1): work steps already open before this feature (or whose
// task was missed) get their task on the next job run; D-273: so does
// background work whose tasks were missed. Idempotent: each
// request is locked and synced as on any change; at most 100 per run.
export async function backfillWorkMirrors(): Promise<{ requests: number }> {
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    `SELECT DISTINCT a.request_id FROM approval_tasks a JOIN approval_requests r ON r.id = a.request_id AND r.deleted_at IS NULL
     WHERE a.task_type = 'WORK' AND a.status = 'PENDING'
       AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.related_request_id = a.request_id AND t.deleted_at IS NULL
                         AND JSON_UNQUOTE(JSON_EXTRACT(t.form_data_json, '$.${WORK_MIRROR_KEY}.taskKey')) = a.task_key)
     UNION
     SELECT DISTINCT e.request_id FROM approval_events e JOIN approval_requests r ON r.id = e.request_id AND r.deleted_at IS NULL
     WHERE e.event_type = 'WORK_ASSIGNED'
       AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.related_request_id = e.request_id
                         AND JSON_UNQUOTE(JSON_EXTRACT(t.form_data_json, '$.${WORK_LINK_KEY}.key')) LIKE CONCAT(e.id, ':%'))
     LIMIT 100`,
  );
  for (const row of rows) {
    await withTransaction(async (connection) => {
      await lockRequest(Number(row.request_id), connection);
      await mirrorWorkTasks(Number(row.request_id), connection);
    });
  }
  return { requests: rows.length };
}
