import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import { insertOutbox } from "@/lib/db/repositories/outbox.repository";
import { visibleTaskClause } from "@/lib/db/repositories/work.repository";
import { afterResponse } from "@/lib/http/after-response";
import { personLabel } from "@/lib/people/label";
import { deliverOutbox } from "@/server/approvals/service";
import { summaryMessages } from "@/server/modules/messages";
import type { TaskActor } from "@/server/modules/tasks";
import { overLimit } from "@/server/security/limits";
import type { WorkViewer } from "@/server/work/access";
import type { FileItem } from "@/server/work/collab-rules";
import { changeShare, personRow, summaryAccess, type ShareResult } from "@/server/work/summary-share";
import {
  accessRequestSchema,
  answerRequestSchema,
  cleanNotes,
  cleanRequestNote,
  mayReadNotes,
  notesInputSchema,
  PROFILE_CARD_MAX,
  profileCardTasks,
  rangeLength,
  requestProblem,
  summaryDashboard,
  type DashboardRange,
  type DashboardTask,
  type SummaryDashboardView,
  type SummaryPriority,
} from "@/server/work/summary-extras-rules";
import { addDays } from "@/server/work/schedule";

// v1.78.0 (D-405, Task Summary release 3): the Dashboard, Notes and Files tabs,
// Request access and the profile's Tasks card. Every check is here, on the
// server. Someone else's Task Summary is read-only and shows only the tasks
// the viewer may see themselves (visibleTaskClause), omitted, never masked.
type Row = RowDataPacket & Record<string, unknown>;
const OPEN = "t.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED')";
const IST_DAY = (column: string) => `DATE_FORMAT(DATE_ADD(${column}, INTERVAL 330 MINUTE), '%Y-%m-%d')`;
const iso = (value: unknown) => (value instanceof Date ? value : new Date(String(value))).toISOString();
const indiaToday = (now: Date) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

// ---- Dashboard tab -------------------------------------------------------------------------
// The owner's tasks (open, and completed within the range) that the viewer may see.
export async function loadSummaryDashboard(ownerId: number, viewer: WorkViewer, range: DashboardRange, now = new Date(), db: Queryable = getDbPool()): Promise<SummaryDashboardView> {
  const today = indiaToday(now);
  const from = addDays(today, -(rangeLength(range) - 1));
  const fromAt = new Date(`${from}T00:00:00+05:30`);
  const seen = visibleTaskClause(viewer);
  const [rows] = await db.query<Row[]>(
    `SELECT t.id, t.status, t.priority, ${IST_DAY("t.due_at")} AS due_day, ${IST_DAY("t.completed_at")} AS completed_day
     FROM tasks t JOIN users a ON a.id = t.assignee_id
     WHERE t.assignee_id = ? AND (${OPEN} OR (t.status = 'COMPLETED' AND t.completed_at >= ?)) AND ${seen.sql}
     LIMIT 5000`,
    [ownerId, fromAt, ...seen.params],
  );
  const names = new Map<number, string[]>();
  if (rows.length) {
    const [projectRows] = await db.query<Row[]>("SELECT tp.task_id, p.name FROM task_projects tp JOIN projects p ON p.id = tp.project_id AND p.deleted_at IS NULL WHERE tp.task_id IN (?) ORDER BY p.name", [rows.map((row) => Number(row.id))]);
    for (const row of projectRows) names.set(Number(row.task_id), [...(names.get(Number(row.task_id)) ?? []), String(row.name)]);
  }
  const tasks: DashboardTask[] = rows.map((row) => ({
    id: Number(row.id),
    open: ["OPEN", "IN_PROGRESS", "BLOCKED"].includes(String(row.status)),
    done: String(row.status) === "COMPLETED",
    dueDay: row.due_day ? String(row.due_day) : null,
    completedDay: row.completed_day ? String(row.completed_day) : null,
    priority: String(row.priority) as SummaryPriority,
    projects: names.get(Number(row.id)) ?? [],
  }));
  return summaryDashboard(tasks, today, range);
}

// ---- Files tab -----------------------------------------------------------------------------
// Files on the tasks given to the owner that the viewer may see. Newest first, at most 2,000.
export async function loadSummaryFiles(ownerId: number, viewer: WorkViewer, db: Queryable = getDbPool()): Promise<FileItem[]> {
  const seen = visibleTaskClause(viewer);
  const [rows] = await db.query<Row[]>(
    `SELECT f.id, f.original_name, f.content_type, f.size_bytes, f.created_at, f.uploaded_by, u.name AS uploader_name, t.id AS task_id, t.task_no, t.title AS task_title
     FROM record_files f
     JOIN users u ON u.id = f.uploaded_by
     JOIN tasks t ON t.id = f.entity_id
     JOIN users a ON a.id = t.assignee_id
     WHERE f.entity_type = 'TASK' AND t.assignee_id = ? AND ${seen.sql}
     ORDER BY f.id DESC LIMIT 2000`,
    [ownerId, ...seen.params],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.original_name),
    contentType: String(row.content_type),
    size: Number(row.size_bytes),
    createdAt: iso(row.created_at),
    uploaderId: Number(row.uploaded_by),
    uploaderName: String(row.uploader_name),
    source: "TASK" as const,
    taskId: Number(row.task_id),
    taskNo: String(row.task_no),
    taskTitle: String(row.task_title),
    messageId: null,
    messageSubject: null,
  }));
}

// ---- Notes tab -----------------------------------------------------------------------------
export interface SummaryNotes {
  body: string;
  rowVersion: number; // 0 = never saved
  updatedAt: string | null;
}
// The person's own notes. Nobody else reads them (null), managers and shared viewers included.
export async function loadSummaryNotes(viewer: WorkViewer, ownerId: number, db: Queryable = getDbPool()): Promise<SummaryNotes | null> {
  if (!mayReadNotes(viewer.id === ownerId ? "OWN" : null)) return null;
  const [rows] = await db.query<Row[]>("SELECT body, row_version, updated_at FROM task_summary_notes WHERE user_id = ?", [ownerId]);
  const row = rows[0];
  return row ? { body: String(row.body), rowVersion: Number(row.row_version), updatedAt: iso(row.updated_at) } : { body: "", rowVersion: 0, updatedAt: null };
}

export type NotesResult = { ok: true; message: string; rowVersion: number } | { ok: false; message: string; conflict?: boolean };
// Saves the signed-in person's notes (always their own). A save from an older
// copy (another tab saved since) is refused, so nothing is lost silently.
export async function saveSummaryNotes(input: unknown, actor: TaskActor): Promise<NotesResult> {
  const parsed = notesInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "These notes can't be saved." };
  const body = cleanNotes(parsed.data.body);
  if (body === null) return { ok: false, message: "Notes can be at most 50,000 characters." };
  return withTransaction(async (db): Promise<NotesResult> => {
    const [[row]] = await db.query<Row[]>("SELECT row_version FROM task_summary_notes WHERE user_id = ? FOR UPDATE", [actor.id]);
    const current = row ? Number(row.row_version) : 0;
    if (current !== parsed.data.rowVersion) return { ok: false, conflict: true, message: "Your notes were changed in another window. Reload to see the latest, then make your change again." };
    if (row) await db.query<ResultSetHeader>("UPDATE task_summary_notes SET body = ?, row_version = row_version + 1 WHERE user_id = ?", [body, actor.id]);
    else await db.query<ResultSetHeader>("INSERT INTO task_summary_notes (user_id, body) VALUES (?, ?)", [actor.id, body]);
    // The first save is audited (the notes now exist); later auto-saves are not, one by one.
    if (!row) await recordAudit({ actorUserId: actor.id, action: "TASK_SUMMARY_NOTES_STARTED", entityType: "USER", entityId: actor.id, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: {} }, db);
    return { ok: true, message: "Saved.", rowVersion: current + 1 };
  });
}

// ---- Request access ------------------------------------------------------------------------
export interface AccessRequestView {
  id: number;
  requesterId: number;
  name: string;
  label: string;
  note: string | null;
  requestedAt: string;
}
// The open requests to the owner's Task Summary, newest first (active people only).
export async function listAccessRequests(ownerId: number, db: Queryable = getDbPool()): Promise<AccessRequestView[]> {
  const [rows] = await db.query<Row[]>(
    `SELECT r.id, r.requester_id, r.note, r.requested_at, u.name, u.login_id FROM task_summary_access_requests r JOIN users u ON u.id = r.requester_id
     WHERE r.owner_id = ? AND r.resolved_at IS NULL AND u.active = TRUE ORDER BY r.requested_at DESC, r.id DESC LIMIT 100`,
    [ownerId],
  );
  return rows.map((row) => ({ id: Number(row.id), requesterId: Number(row.requester_id), name: String(row.name), label: personLabel({ name: String(row.name), loginId: String(row.login_id) }), note: row.note ? String(row.note) : null, requestedAt: iso(row.requested_at) }));
}

// Has the viewer an open request to this owner? (the refusal page says so)
export async function hasOpenRequest(ownerId: number, requesterId: number, db: Queryable = getDbPool()): Promise<boolean> {
  const [rows] = await db.query<Row[]>("SELECT 1 FROM task_summary_access_requests WHERE owner_id = ? AND requester_id = ? AND resolved_at IS NULL", [ownerId, requesterId]);
  return rows.length > 0;
}

// Someone refused a Task Summary asks its owner. The owner is told (in-app and
// email) and answers from Share. Asking again while a request is open sends nothing.
export async function requestSummaryAccess(input: unknown, actor: TaskActor, viewer: WorkViewer): Promise<ShareResult> {
  const parsed = accessRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Not found." };
  const { ownerId } = parsed.data;
  const note = cleanRequestNote(parsed.data.note) || null;
  const owner = ownerId === actor.id ? null : await personRow(ownerId);
  const { access } = ownerId === actor.id ? { access: "OWN" as const } : await summaryAccess(viewer, ownerId);
  const problem = requestProblem({ requesterId: actor.id, ownerId, ownerActive: ownerId === actor.id ? true : owner ? owner.active : null, access });
  if (problem) return { ok: false, message: problem };
  if (await overLimit(`summary-access:${actor.id}`, 10)) return { ok: false, message: "You're asking very quickly. Wait a minute and try again." };
  const outcome = await withTransaction(async (db): Promise<ShareResult & { outbox?: number[] }> => {
    const [[existing]] = await db.query<Row[]>("SELECT id, resolved_at FROM task_summary_access_requests WHERE owner_id = ? AND requester_id = ? FOR UPDATE", [ownerId, actor.id]);
    if (existing && existing.resolved_at === null) return { ok: true, message: `You've already asked ${owner!.name}. They'll see your request when they open Share.` };
    if (existing) await db.query<ResultSetHeader>("UPDATE task_summary_access_requests SET note = ?, requested_at = UTC_TIMESTAMP(), resolved_at = NULL, resolved_by = NULL, outcome = NULL WHERE id = ?", [note, Number(existing.id)]);
    else await db.query<ResultSetHeader>("INSERT INTO task_summary_access_requests (owner_id, requester_id, note) VALUES (?, ?, ?)", [ownerId, actor.id, note]);
    await recordAudit({ actorUserId: actor.id, action: "TASK_SUMMARY_ACCESS_REQUESTED", entityType: "USER", entityId: ownerId, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { note: Boolean(note) } }, db);
    const outbox = await insertOutbox(null, [summaryMessages.accessRequested({ id: actor.id, name: actor.name }, ownerId, note)], db);
    return { ok: true, message: `Request sent. ${owner!.name} can grant it from their Task Summary.`, outbox };
  });
  if (outcome.ok && outcome.outbox?.length) {
    const ids = outcome.outbox;
    await afterResponse("summary access request message", () => deliverOutbox(ids));
  }
  return outcome.ok ? { ok: true, message: outcome.message } : outcome;
}

// The owner (only ever the signed-in person) answers a request: grant = a
// read-only share (exactly as Invite, so the person is told and it is
// audited), decline = closed and audited (the person isn't told, chosen).
export async function answerAccessRequest(input: unknown, actor: TaskActor): Promise<ShareResult> {
  const parsed = answerRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Not found." };
  const { requesterId, decision } = parsed.data;
  if (!(await hasOpenRequest(actor.id, requesterId))) return { ok: false, message: "That request was already answered." };
  if (decision === "grant") return changeShare({ op: "add", userId: requesterId }, actor);
  await withTransaction(async (db) => {
    await db.query<ResultSetHeader>("UPDATE task_summary_access_requests SET resolved_at = UTC_TIMESTAMP(), resolved_by = ?, outcome = 'DECLINED' WHERE owner_id = ? AND requester_id = ? AND resolved_at IS NULL", [actor.id, actor.id, requesterId]);
    await recordAudit({ actorUserId: actor.id, action: "TASK_SUMMARY_ACCESS_DECLINED", entityType: "USER", entityId: actor.id, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { requesterId } }, db);
  });
  return { ok: true, message: "Request declined." };
}

// ---- profile Tasks card (spec §3.17) -------------------------------------------------------
export interface ProfileCard {
  ownerId: number;
  own: boolean;
  total: number;
  tasks: { id: number; taskNo: string; title: string; dueAt: string | null }[];
}
// The person's open tasks the viewer may see (soonest due first), when the
// viewer may open their Task Summary (themselves, a manager above, shared); else null.
export async function loadProfileCard(viewer: WorkViewer, ownerId: number, db: Queryable = getDbPool()): Promise<ProfileCard | null> {
  const { access } = await summaryAccess(viewer, ownerId, db);
  if (!access) return null;
  const seen = visibleTaskClause(viewer);
  const [rows] = await db.query<Row[]>(
    `SELECT t.id, t.task_no, t.title, t.due_at FROM tasks t JOIN users a ON a.id = t.assignee_id
     WHERE t.assignee_id = ? AND ${OPEN} AND ${seen.sql} ORDER BY t.due_at IS NULL, t.due_at, t.id LIMIT 500`,
    [ownerId, ...seen.params],
  );
  const tasks = rows.map((row) => ({ id: Number(row.id), taskNo: String(row.task_no), title: String(row.title), dueAt: row.due_at ? iso(row.due_at) : null }));
  return { ownerId, own: access === "OWN", total: tasks.length, tasks: profileCardTasks(tasks, PROFILE_CARD_MAX) };
}
