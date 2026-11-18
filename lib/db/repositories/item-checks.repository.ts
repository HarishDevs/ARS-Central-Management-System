import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";

// v1.57.0 (D-335): the "provided" ticks of Item list fields.
export type ItemCheckEntity = "REQUEST" | "TICKET";
export interface ItemCheck {
  fieldKey: string;
  lineNo: number;
  provided: boolean;
  checkedByName: string;
  checkedAt: Date;
}
type Row = RowDataPacket & Record<string, unknown>;

export async function listItemChecks(entityType: ItemCheckEntity, entityId: number, db: Queryable = getDbPool()): Promise<ItemCheck[]> {
  const [rows] = await db.query<Row[]>(
    `SELECT c.field_key, c.line_no, c.provided, u.name AS checked_by_name, c.checked_at
       FROM record_item_checks c JOIN users u ON u.id = c.checked_by
      WHERE c.entity_type = ? AND c.entity_id = ? ORDER BY c.field_key, c.line_no`,
    [entityType, entityId],
  );
  return rows.map((row) => ({ fieldKey: String(row.field_key), lineNo: Number(row.line_no), provided: Boolean(row.provided), checkedByName: String(row.checked_by_name), checkedAt: new Date(row.checked_at as string) }));
}

export async function saveItemCheck(entityType: ItemCheckEntity, entityId: number, fieldKey: string, lineNo: number, provided: boolean, by: number, db: Queryable = getDbPool()): Promise<void> {
  await db.query(
    `INSERT INTO record_item_checks (entity_type, entity_id, field_key, line_no, provided, checked_by, checked_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE provided = VALUES(provided), checked_by = VALUES(checked_by), checked_at = VALUES(checked_at)`,
    [entityType, entityId, fieldKey, lineNo, provided, by],
  );
}

// May this person tick a request's items? IT, anyone with an approval step on it,
// or the assignee of a work task raised from it.
export async function handlesRequest(requestId: number, userId: number, db: Queryable = getDbPool()): Promise<boolean> {
  const [rows] = await db.query<Row[]>(
    `SELECT EXISTS(SELECT 1 FROM approval_tasks WHERE request_id = ? AND (approver_id = ? OR decided_by = ? OR on_behalf_of = ?))
         OR EXISTS(SELECT 1 FROM tasks WHERE related_request_id = ? AND assignee_id = ? AND deleted_at IS NULL) AS yes`,
    [requestId, userId, userId, userId, requestId, userId],
  );
  return Boolean(Number(rows[0]?.yes));
}
