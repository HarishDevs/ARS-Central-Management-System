import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";
import { sqlDir, type ColumnSort } from "@/server/lists/sorting";
import type { TaskStatus } from "@/server/modules/task-rules";
import { COLLAB_PAGE_SIZE, type CollabTaskSort } from "@/server/collaborating/tabs";

// v1.91.0 (D-433, owner: one common Collaborating screen). The Tasks tab:
// tasks the person was added to as a collaborator (task_followers, any
// source: added by hand, mentioned, commented, a form submitter, a former
// assignee) and is NOT a party to now: not the assignee, not the creator, not
// the assigner. Deleted tasks never appear. A removed collaborator's row is
// deleted by the app (removeFollower), so it drops out by itself. Being a
// follower always lets the person see the task (server/work/access.ts
// taskRights: isFollower → view), so this list never shows a task its page
// would refuse. The base condition comes first; search and sort only narrow
// or order it. One query for the page, one for the count (no N+1).
const TASK_BASE = `FROM task_followers f
     JOIN tasks t ON t.id = f.task_id
     JOIN users a ON a.id = t.assignee_id
     JOIN users c ON c.id = t.created_by
    WHERE f.user_id = ? AND t.deleted_at IS NULL
      AND t.assignee_id <> ? AND t.created_by <> ? AND t.assigned_by <> ?`;

const TASK_SORT_SQL: Record<CollabTaskSort, { expr: string; nullable?: boolean }> = {
  task: { expr: "t.title" },
  assignee: { expr: "a.name" },
  status: { expr: "FIELD(t.status, 'OPEN', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED')" },
  due: { expr: "t.due_at", nullable: true },
  updated: { expr: "t.updated_at" },
  added: { expr: "f.created_at" },
};

export interface CollabTaskRow {
  id: number;
  taskNo: string;
  title: string;
  status: TaskStatus;
  dueAt: Date | null;
  updatedAt: Date;
  addedAt: Date;
  assigneeName: string;
  createdByName: string;
}

const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

function search(q: string): { sql: string; params: unknown[] } {
  if (!q) return { sql: "", params: [] };
  return { sql: " AND (t.task_no = ? OR t.title LIKE ?)", params: [q.toUpperCase(), likeOf(q)] };
}

export function collabTaskOrder(sort: ColumnSort<CollabTaskSort>): string {
  const column = sort.sortBy ? TASK_SORT_SQL[sort.sortBy] : undefined;
  // Default: open work first, then the most recently changed.
  if (!column) return "ORDER BY t.status IN ('COMPLETED', 'CANCELLED'), t.updated_at DESC, t.id DESC";
  return `ORDER BY ${column.nullable ? `${column.expr} IS NULL, ` : ""}${column.expr} ${sqlDir(sort.dir)}, t.id DESC`;
}

export async function countCollabTasks(userId: number, q = "", db: Queryable = getDbPool()): Promise<number> {
  const where = search(q);
  const [[row]] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS n ${TASK_BASE}${where.sql}`, [userId, userId, userId, userId, ...where.params]);
  return Number(row?.n ?? 0);
}

export async function listCollabTasks(userId: number, options: { q: string; sort: ColumnSort<CollabTaskSort>; page: number }, db: Queryable = getDbPool()): Promise<{ items: CollabTaskRow[]; total: number }> {
  const where = search(options.q);
  const params = [userId, userId, userId, userId, ...where.params];
  const total = await countCollabTasks(userId, options.q, db);
  const page = Math.max(1, Math.floor(options.page) || 1);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT t.id, t.task_no, t.title, t.status, t.due_at, t.updated_at, f.created_at AS added_at, a.name AS assignee_name, c.name AS created_by_name
       ${TASK_BASE}${where.sql} ${collabTaskOrder(options.sort)} LIMIT ? OFFSET ?`,
    [...params, COLLAB_PAGE_SIZE, (page - 1) * COLLAB_PAGE_SIZE],
  );
  return {
    total,
    items: rows.map((row) => ({
      id: Number(row.id),
      taskNo: String(row.task_no),
      title: String(row.title),
      status: String(row.status) as TaskStatus,
      dueAt: row.due_at ? new Date(row.due_at as string) : null,
      updatedAt: new Date(row.updated_at as string),
      addedAt: new Date(row.added_at as string),
      assigneeName: String(row.assignee_name),
      createdByName: String(row.created_by_name),
    })),
  };
}

// v1.91.0 (D-434, owner: "if I am not having any access for the approvals
// module, if I am added as a collaborator I should be able to open and access
// that approval"): is the person an active collaborator on this request (not
// removed, the request not deleted)? Read on every page view and action, so a
// removal or a delete takes effect at once.
export async function isActiveRequestCollaborator(requestId: number, userId: number, db: Queryable = getDbPool()): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT 1 FROM request_collaborators k JOIN approval_requests r ON r.id = k.request_id
      WHERE k.request_id = ? AND k.user_id = ? AND k.removed_at IS NULL AND r.deleted_at IS NULL LIMIT 1`,
    [requestId, userId],
  );
  return rows.length > 0;
}

// The same for a request attachment (the download route is keyed by the file).
export async function collaboratesOnAttachment(attachmentId: number, userId: number, db: Queryable = getDbPool()): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT 1 FROM request_attachments a JOIN request_collaborators k ON k.request_id = a.request_id JOIN approval_requests r ON r.id = a.request_id
      WHERE a.id = ? AND k.user_id = ? AND k.removed_at IS NULL AND r.deleted_at IS NULL LIMIT 1`,
    [attachmentId, userId],
  );
  return rows.length > 0;
}

// The same for a request comment (editing one's own comment).
export async function collaboratesOnRequestComment(commentId: number, userId: number, db: Queryable = getDbPool()): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT 1 FROM request_comments c JOIN request_collaborators k ON k.request_id = c.request_id JOIN approval_requests r ON r.id = c.request_id
      WHERE c.id = ? AND k.user_id = ? AND k.removed_at IS NULL AND r.deleted_at IS NULL LIMIT 1`,
    [commentId, userId],
  );
  return rows.length > 0;
}
