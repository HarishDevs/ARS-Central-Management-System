import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";

// v1.94.0 (D-456, owner: "Archive = read-only, kept visible under an Archived
// filter, un-archivable"). One check for the write paths that don't go
// through a module's own rights (comments, files, collaborators, item ticks).
export type ArchivableType = "REQUEST" | "TASK" | "TICKET";
const TABLE: Record<ArchivableType, string> = {
  REQUEST: "approval_requests",
  TASK: "tasks",
  TICKET: "tickets",
};
export const ARCHIVED_MESSAGE = "This item is archived, so it is read-only. Only Super Admin can un-archive it.";

export async function isArchived(type: ArchivableType, id: number, db: Queryable = getDbPool()): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT 1 FROM ${TABLE[type]} WHERE id = ? AND archived_at IS NOT NULL LIMIT 1`, [id]);
  return rows.length > 0;
}

// v1.94.0 (D-456, D-458): what an item page shows beside its title: Archived,
// and "Created by Super Admin on behalf of" its requester.
export async function itemFlags(type: ArchivableType, id: number, db: Queryable = getDbPool()): Promise<{ archivedAt: Date | null; onBehalfByName: string | null }> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT x.archived_at, u.name AS on_behalf_name FROM ${TABLE[type]} x LEFT JOIN users u ON u.id = x.created_on_behalf_by WHERE x.id = ?`, [id]);
  return { archivedAt: (rows[0]?.archived_at as Date | null) ?? null, onBehalfByName: rows[0]?.on_behalf_name ? String(rows[0].on_behalf_name) : null };
}
