import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";

// v1.60.0 (D-365, owner: "i want edit option in all the comments"; keep every
// version): the text a comment had before each edit or delete. Append-only.
export type CommentTarget = "REQUEST" | "TICKET" | "TASK";
export interface CommentVersion {
  id: number;
  body: string;
  kind: "EDIT" | "DELETE";
  changedByName: string;
  changedAt: Date;
}

export async function saveCommentVersion(target: CommentTarget, commentId: number, body: string, kind: "EDIT" | "DELETE", changedBy: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("INSERT INTO comment_versions (target, comment_id, body, change_kind, changed_by) VALUES (?, ?, ?, ?, ?)", [target, commentId, body, kind, changedBy]);
}

export async function listCommentVersions(target: CommentTarget, commentId: number, db: Queryable = getDbPool()): Promise<CommentVersion[]> {
  const [rows] = await db.query<(RowDataPacket & { id: number; body: string; change_kind: "EDIT" | "DELETE"; name: string | null; changed_at: Date | string })[]>(
    "SELECT v.id, v.body, v.change_kind, u.name, v.changed_at FROM comment_versions v LEFT JOIN users u ON u.id = v.changed_by WHERE v.target = ? AND v.comment_id = ? ORDER BY v.id",
    [target, commentId],
  );
  return rows.map((row) => ({ id: Number(row.id), body: String(row.body), kind: row.change_kind, changedByName: row.name ?? "Someone", changedAt: new Date(row.changed_at) }));
}

// The comment's current text, locked for the change (null: no such comment).
export async function lockCommentBody(target: CommentTarget, commentId: number, db: Queryable): Promise<{ body: string; authorId: number; parentId: number; deleted: boolean; internal: boolean } | null> {
  const sql =
    target === "REQUEST"
      ? "SELECT body, author_id, request_id AS parent_id, deleted_at, FALSE AS internal FROM request_comments WHERE id = ? FOR UPDATE"
      : target === "TICKET"
        ? "SELECT body, author_id, ticket_id AS parent_id, deleted_at, internal FROM ticket_comments WHERE id = ? FOR UPDATE"
        : "SELECT body, author_id, task_id AS parent_id, deleted_at, FALSE AS internal FROM task_comments WHERE id = ? FOR UPDATE";
  const [rows] = await db.query<RowDataPacket[]>(sql, [commentId]);
  const row = rows[0];
  return row ? { body: String(row.body), authorId: Number(row.author_id), parentId: Number(row.parent_id), deleted: row.deleted_at !== null, internal: Boolean(row.internal) } : null;
}

const TABLE: Record<CommentTarget, string> = { REQUEST: "request_comments", TICKET: "ticket_comments", TASK: "task_comments" };

// Saves the old text as a version, then changes the comment.
export async function applyCommentChange(target: CommentTarget, commentId: number, oldBody: string, change: { body: string } | { delete: true }, actorId: number, db: Queryable): Promise<void> {
  const table = TABLE[target];
  if ("body" in change) {
    await saveCommentVersion(target, commentId, oldBody, "EDIT", actorId, db);
    await db.query<ResultSetHeader>(`UPDATE ${table} SET body = ?, edited_at = UTC_TIMESTAMP(), edited_by = ? WHERE id = ?`, [change.body, actorId, commentId]);
  } else {
    await saveCommentVersion(target, commentId, oldBody, "DELETE", actorId, db);
    const extra = target === "TASK" ? ", is_pinned = FALSE" : "";
    await db.query<ResultSetHeader>(`UPDATE ${table} SET deleted_at = UTC_TIMESTAMP(), deleted_by = ?${extra} WHERE id = ?`, [actorId, commentId]);
  }
}
