import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";

// D-265 (owner's Approval Overview and My Work briefs): Home's figures,
// counted in the database from the real records. Each figure says what it
// counts; nothing here is stored or made up.
const OPEN = "t.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED')";
// India day of a stored (UTC) time.
const IST_DAY = (column: string) => `DATE(DATE_ADD(${column}, INTERVAL 330 MINUTE))`;
const n = (value: unknown) => Number(value ?? 0);

// ---- Approvals --------------------------------------------------------------
export interface ApprovalInsights {
  raised: number; // requests I submitted in the period
  raisedBefore: number; // the same, previous period
  approved: number; // my requests approved in the period (closed_at)
  avgHours: number | null; // submitted → approved, for those approved in the period; null when none
  returned: number; // my requests sent back for changes in the period
  decided: number; // approval steps I decided in the period
  decidedBefore: number; // v1.79.0 (D-406): the same, previous period
}

export async function approvalInsights(userId: number, period: { from: Date; to: Date; prevFrom: Date; prevTo: Date }, db: Queryable = getDbPool()): Promise<ApprovalInsights> {
  const [[mine], [decided]] = await Promise.all([
    db.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(r.submitted_at >= ? AND r.submitted_at < ?), 0) AS raised,
              COALESCE(SUM(r.submitted_at >= ? AND r.submitted_at < ?), 0) AS raised_before,
              COALESCE(SUM(r.status = 'APPROVED' AND r.closed_at >= ? AND r.closed_at < ?), 0) AS approved,
              AVG(CASE WHEN r.status = 'APPROVED' AND r.closed_at >= ? AND r.closed_at < ? THEN TIMESTAMPDIFF(MINUTE, r.submitted_at, r.closed_at) END) AS avg_minutes
       FROM approval_requests r
       WHERE r.requester_id = ? AND r.deleted_at IS NULL AND (r.submitted_at >= ? OR r.closed_at >= ?)`,
      [period.from, period.to, period.prevFrom, period.prevTo, period.from, period.to, period.from, period.to, userId, period.prevFrom, period.prevFrom],
    ),
    db.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(t.decided_at >= ? AND t.decided_at < ?), 0) AS decided,
              COALESCE(SUM(t.decided_at >= ? AND t.decided_at < ?), 0) AS decided_before,
              (SELECT COUNT(DISTINCT t2.request_id) FROM approval_tasks t2 JOIN approval_requests r2 ON r2.id = t2.request_id
                WHERE r2.requester_id = ? AND r2.deleted_at IS NULL AND t2.status = 'CHANGES_REQUESTED' AND t2.decided_at >= ? AND t2.decided_at < ?) AS returned
       FROM approval_tasks t WHERE t.approver_id = ? AND t.status IN ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED') AND t.decided_at >= ? AND t.decided_at < ?`,
      [period.from, period.to, period.prevFrom, period.prevTo, userId, period.from, period.to, userId, period.prevFrom, period.to],
    ),
  ]);
  const row = (mine[0] ?? {}) as RowDataPacket;
  const minutes = row.avg_minutes === null || row.avg_minutes === undefined ? null : Number(row.avg_minutes);
  return {
    raised: n(row.raised),
    raisedBefore: n(row.raised_before),
    approved: n(row.approved),
    avgHours: minutes === null ? null : minutes / 60,
    returned: n(decided[0]?.returned),
    decided: n(decided[0]?.decided),
    decidedBefore: n(decided[0]?.decided_before),
  };
}

// v1.79.0 (D-406): the per-day spread used by every overview's day-by-day
// chart (Monday first, India days, within the period).
const spreadDays = (rows: RowDataPacket[]) => {
  const out = [0, 0, 0, 0, 0, 0, 0];
  for (const row of rows) out[n(row.d)] = n(row.c);
  return out;
};
const WEEKDAY = (column: string) => `WEEKDAY(DATE_ADD(${column}, INTERVAL 330 MINUTE))`;

// Approvals chart: requests I raised (submitted_at) and approval steps I
// decided (decided_at), by day of the week within the period.
export async function approvalDaily(userId: number, period: { from: Date; to: Date }, db: Queryable = getDbPool()): Promise<{ raised: number[]; decided: number[] }> {
  const [[raised], [decided]] = await Promise.all([
    db.query<RowDataPacket[]>(
      `SELECT ${WEEKDAY("r.submitted_at")} AS d, COUNT(*) AS c FROM approval_requests r
       WHERE r.requester_id = ? AND r.deleted_at IS NULL AND r.submitted_at >= ? AND r.submitted_at < ? GROUP BY d`,
      [userId, period.from, period.to],
    ),
    db.query<RowDataPacket[]>(
      `SELECT ${WEEKDAY("t.decided_at")} AS d, COUNT(*) AS c FROM approval_tasks t
       WHERE t.approver_id = ? AND t.status IN ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED') AND t.decided_at >= ? AND t.decided_at < ? GROUP BY d`,
      [userId, period.from, period.to],
    ),
  ]);
  return { raised: spreadDays(raised), decided: spreadDays(decided) };
}

// ---- Meetings (personal figures, D-406) ---------------------------------------
// "Held" = a meeting that started (actual_start) in the period which the person
// ran (owner or coordinator) or attended (marked present or late). Only their
// own meetings, so no dashboard access is needed for these.
const HELD_BY = `(m.owner_id = ? OR m.coordinator_id = ? OR EXISTS (SELECT 1 FROM meeting_participants p WHERE p.meeting_id = m.id AND p.user_id = ? AND p.attendance IN ('PRESENT', 'LATE')))`;

export async function meetingSummary(userId: number, period: { from: Date; to: Date; prevFrom: Date; prevTo: Date }, db: Queryable = getDbPool()): Promise<{ held: number; heldBefore: number }> {
  const [[row]] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(m.actual_start >= ? AND m.actual_start < ?), 0) AS held,
            COALESCE(SUM(m.actual_start >= ? AND m.actual_start < ?), 0) AS held_before
     FROM meetings m WHERE m.status <> 'CANCELLED' AND m.actual_start >= ? AND m.actual_start < ? AND ${HELD_BY}`,
    [period.from, period.to, period.prevFrom, period.prevTo, period.prevFrom, period.to, userId, userId, userId],
  );
  return { held: n(row?.held), heldBefore: n(row?.held_before) };
}

// Meetings chart: meetings held or attended (by actual start) and my meeting
// action items completed (their task's completed_at), by day of the week.
export async function meetingDaily(userId: number, period: { from: Date; to: Date }, db: Queryable = getDbPool()): Promise<{ held: number[]; done: number[] }> {
  const [[held], [done]] = await Promise.all([
    db.query<RowDataPacket[]>(
      `SELECT ${WEEKDAY("m.actual_start")} AS d, COUNT(*) AS c FROM meetings m
       WHERE m.status <> 'CANCELLED' AND m.actual_start >= ? AND m.actual_start < ? AND ${HELD_BY} GROUP BY d`,
      [period.from, period.to, userId, userId, userId],
    ),
    db.query<RowDataPacket[]>(
      `SELECT ${WEEKDAY("t.completed_at")} AS d, COUNT(*) AS c FROM meeting_actions a JOIN tasks t ON t.id = a.task_id AND t.deleted_at IS NULL
       WHERE a.owner_id = ? AND t.status = 'COMPLETED' AND t.completed_at >= ? AND t.completed_at < ? GROUP BY d`,
      [userId, period.from, period.to],
    ),
  ]);
  return { held: spreadDays(held), done: spreadDays(done) };
}

// ---- My Work: Quick insights (D-406) ---------------------------------------------
export interface TaskInsights {
  given: number; // given to me in the period (assigned_at, else created_at)
  givenDone: number; // of those, completed now
  completed: number; // completed in the period
  withDue: number; // of those, the ones that had a due date
  onTime: number; // of those, completed on or before the due day (India days)
  avgDays: number | null; // given → completed, for those completed in the period; null when none
}

export async function taskInsights(userId: number, period: { from: Date; to: Date }, db: Queryable = getDbPool()): Promise<TaskInsights> {
  const assignedAt = "COALESCE(t.assigned_at, t.created_at)";
  const doneIn = "(t.status = 'COMPLETED' AND t.completed_at >= ? AND t.completed_at < ?)";
  const [[row]] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(${assignedAt} >= ? AND ${assignedAt} < ?), 0) AS given,
            COALESCE(SUM(${assignedAt} >= ? AND ${assignedAt} < ? AND t.status = 'COMPLETED'), 0) AS given_done,
            COALESCE(SUM(${doneIn}), 0) AS completed,
            COALESCE(SUM(${doneIn} AND t.due_at IS NOT NULL), 0) AS with_due,
            COALESCE(SUM(${doneIn} AND t.due_at IS NOT NULL AND ${IST_DAY("t.completed_at")} <= ${IST_DAY("t.due_at")}), 0) AS on_time,
            AVG(CASE WHEN ${doneIn} THEN TIMESTAMPDIFF(MINUTE, ${assignedAt}, t.completed_at) END) AS avg_minutes
     FROM tasks t WHERE t.assignee_id = ? AND t.deleted_at IS NULL`,
    [period.from, period.to, period.from, period.to, period.from, period.to, period.from, period.to, period.from, period.to, period.from, period.to, userId],
  );
  const minutes = row?.avg_minutes === null || row?.avg_minutes === undefined ? null : Math.max(0, Number(row.avg_minutes));
  return { given: n(row?.given), givenDone: n(row?.given_done), completed: n(row?.completed), withDue: n(row?.with_due), onTime: n(row?.on_time), avgDays: minutes === null ? null : minutes / 1440 };
}

// ---- My Work ----------------------------------------------------------------
export interface WorkSummary {
  open: number; // open now (any due date)
  upcoming: number; // open, due today or later (India days, as My Tasks)
  overdue: number; // open, due before today (as My Tasks)
  noDue: number; // open, no due date
  completed: number; // completed in the period (completed_at)
  completedBefore: number; // the same, previous period
  assigned: number; // given to me in the period (assigned_at, else created_at)
  assignedBefore: number;
}

export async function workSummary(userId: number, today: string, period: { from: Date; to: Date; prevFrom: Date; prevTo: Date }, db: Queryable = getDbPool()): Promise<WorkSummary> {
  const assignedAt = "COALESCE(t.assigned_at, t.created_at)";
  const [[row]] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(${OPEN}), 0) AS open_count,
            COALESCE(SUM(${OPEN} AND t.due_at IS NOT NULL AND ${IST_DAY("t.due_at")} >= ?), 0) AS upcoming,
            COALESCE(SUM(${OPEN} AND t.due_at IS NOT NULL AND ${IST_DAY("t.due_at")} < ?), 0) AS overdue,
            COALESCE(SUM(${OPEN} AND t.due_at IS NULL), 0) AS no_due,
            COALESCE(SUM(t.status = 'COMPLETED' AND t.completed_at >= ? AND t.completed_at < ?), 0) AS completed,
            COALESCE(SUM(t.status = 'COMPLETED' AND t.completed_at >= ? AND t.completed_at < ?), 0) AS completed_before,
            COALESCE(SUM(${assignedAt} >= ? AND ${assignedAt} < ?), 0) AS assigned,
            COALESCE(SUM(${assignedAt} >= ? AND ${assignedAt} < ?), 0) AS assigned_before
     FROM tasks t WHERE t.assignee_id = ? AND t.deleted_at IS NULL`,
    [today, today, period.from, period.to, period.prevFrom, period.prevTo, period.from, period.to, period.prevFrom, period.prevTo, userId],
  );
  return {
    open: n(row?.open_count),
    upcoming: n(row?.upcoming),
    overdue: n(row?.overdue),
    noDue: n(row?.no_due),
    completed: n(row?.completed),
    completedBefore: n(row?.completed_before),
    assigned: n(row?.assigned),
    assignedBefore: n(row?.assigned_before),
  };
}

// Assigned and completed per day of the week (Monday first) within the
// period: given to me (assigned_at, else created_at) and completed by the
// actual completion time, never the due date.
export async function weeklyWorkload(userId: number, period: { from: Date; to: Date }, db: Queryable = getDbPool()): Promise<{ assigned: number[]; completed: number[] }> {
  const assignedAt = "COALESCE(t.assigned_at, t.created_at)";
  const [[given], [done]] = await Promise.all([
    db.query<RowDataPacket[]>(
      `SELECT WEEKDAY(DATE_ADD(${assignedAt}, INTERVAL 330 MINUTE)) AS d, COUNT(*) AS c FROM tasks t
       WHERE t.assignee_id = ? AND t.deleted_at IS NULL AND ${assignedAt} >= ? AND ${assignedAt} < ? GROUP BY d`,
      [userId, period.from, period.to],
    ),
    db.query<RowDataPacket[]>(
      `SELECT WEEKDAY(DATE_ADD(t.completed_at, INTERVAL 330 MINUTE)) AS d, COUNT(*) AS c FROM tasks t
       WHERE t.assignee_id = ? AND t.deleted_at IS NULL AND t.status = 'COMPLETED' AND t.completed_at >= ? AND t.completed_at < ? GROUP BY d`,
      [userId, period.from, period.to],
    ),
  ]);
  const spread = (rows: RowDataPacket[]) => {
    const out = [0, 0, 0, 0, 0, 0, 0];
    for (const row of rows) out[n(row.d)] = n(row.c);
    return out;
  };
  return { assigned: spread(given), completed: spread(done) };
}

export interface WorkActivity {
  id: number;
  type: string;
  taskId: number;
  taskNo: string;
  taskTitle: string;
  actorName: string | null;
  actorId: number | null;
  body: string | null;
  payload: Record<string, unknown> | null;
  createdAt: Date;
}

// The latest events on tasks I'm given, gave, or follow (task_events is
// append-only). Bounded: the newest tasks of each kind, then their events.
export async function workActivity(userId: number, limit: number, db: Queryable = getDbPool()): Promise<WorkActivity[]> {
  // QA-DB-05 (v1.42.1): the task ids first (each list by its own index), then
  // their events by (task_id, id), so MySQL never walks all events backwards.
  const [idRows] = await db.query<RowDataPacket[]>(
    `(SELECT id FROM tasks WHERE assignee_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 200)
     UNION (SELECT id FROM tasks WHERE created_by = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 200)
     UNION (SELECT task_id FROM task_followers WHERE user_id = ? ORDER BY task_id DESC LIMIT 200)`,
    [userId, userId, userId],
  );
  const ids = idRows.map((row) => n(row.id));
  if (ids.length === 0) return [];
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT e.id, e.event_type, e.task_id, e.actor_id, e.body, e.payload_json, e.created_at, t.task_no, t.title, u.name AS actor_name
     FROM task_events e FORCE INDEX (idx_task_events_task)
     JOIN tasks t ON t.id = e.task_id AND t.deleted_at IS NULL
     LEFT JOIN users u ON u.id = e.actor_id
     WHERE e.task_id IN (?) AND e.event_type NOT IN ('MOVED_SECTION', 'FIELD_SET', 'SUBTASK_ADDED', 'PARENT_CHANGED', 'MY_SECTION_RULE')
     ORDER BY e.id DESC LIMIT ?`,
    [ids, limit],
  );
  return rows.map((row) => ({
    id: n(row.id),
    type: String(row.event_type),
    taskId: n(row.task_id),
    taskNo: String(row.task_no),
    taskTitle: String(row.title),
    actorName: row.actor_name ? String(row.actor_name) : null,
    actorId: row.actor_id === null ? null : n(row.actor_id),
    body: row.body ? String(row.body) : null,
    payload: (typeof row.payload_json === "string" ? safeJson(row.payload_json) : (row.payload_json as Record<string, unknown> | null)) ?? null,
    createdAt: row.created_at as Date,
  }));
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Home's default (owner): approvers start on Approvals, others on Task
// Management. An approver: their designation is ticked Approver, or a step is
// waiting for them now.
export async function isApproverForHome(userId: number, db: Queryable = getDbPool()): Promise<boolean> {
  const [[row]] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE((SELECT d.is_approver FROM users u JOIN designations d ON d.id = u.designation_id WHERE u.id = ?), FALSE) AS by_designation,
            EXISTS (SELECT 1 FROM approval_tasks WHERE approver_id = ? AND status = 'PENDING') AS has_waiting`,
    [userId, userId],
  );
  return n(row?.by_designation) === 1 || n(row?.has_waiting) === 1;
}

// QA-DB-06 (v1.42.1): the Approvals Home counts, counted (not taken from the
// 200-row list): open (in progress or on hold) and sent back for changes.
export async function myRequestCounts(userId: number, db: Queryable = getDbPool()): Promise<{ open: number; returned: number }> {
  const [[row]] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(status IN ('IN_PROGRESS', 'ON_HOLD')), 0) AS open_count, COALESCE(SUM(status = 'CHANGES_REQUIRED'), 0) AS returned
     FROM approval_requests WHERE requester_id = ? AND deleted_at IS NULL`,
    [userId],
  );
  return { open: n(row?.open_count), returned: n(row?.returned) };
}
