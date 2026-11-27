import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";

// v1.94.0 (D-454, owner: "Bin, then purge"): the one Super Admin "Deleted
// items" bin for every module (superadmin_bin). The item is hidden by its own
// module's soft-delete columns; this table says who binned it, why, and when
// Delete permanently is allowed (30 days later).
export const BIN_DAYS = 30;
export type BinEntityType = "REQUEST" | "TASK" | "TICKET";
export const BIN_ENTITY_TYPES: readonly BinEntityType[] = ["REQUEST", "TASK", "TICKET"];

// SQL: true while the record `alias` of this type is in the bin (indexed by
// the unique active_key). For queries that read a module's rows directly.
export const binnedSql = (type: BinEntityType, idColumn: string) => `EXISTS (SELECT 1 FROM superadmin_bin sb WHERE sb.active_key = CONCAT('${type}:', ${idColumn}))`;
// A notification row `n` about an item in the bin (hidden from the bell and the inbox).
export const NOTICE_NOT_BINNED_SQL = "NOT EXISTS (SELECT 1 FROM superadmin_bin sb WHERE sb.active_key = CONCAT(n.entity_type, ':', n.entity_id))";

export interface BinEntry {
  id: number;
  entityType: BinEntityType;
  entityId: number;
  parentBinId: number | null;
  entityNo: string | null;
  title: string;
  detail: Record<string, unknown>;
  reason: string;
  binnedBy: number | null;
  binnedByName: string | null;
  binnedAt: Date;
  purgeAfter: Date;
  restoredAt: Date | null;
  purgedAt: Date | null;
  childCount: number;
}

type Row = RowDataPacket & Record<string, unknown>;
const parse = (value: unknown): Record<string, unknown> => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return value as Record<string, unknown>;
};

function toEntry(row: Row): BinEntry {
  return {
    id: Number(row.id),
    entityType: String(row.entity_type) as BinEntityType,
    entityId: Number(row.entity_id),
    parentBinId: row.parent_bin_id === null ? null : Number(row.parent_bin_id),
    entityNo: row.entity_no === null ? null : String(row.entity_no),
    title: String(row.title),
    detail: parse(row.detail_json),
    reason: String(row.reason),
    binnedBy: row.binned_by === null ? null : Number(row.binned_by),
    binnedByName: row.binned_by_name === null || row.binned_by_name === undefined ? null : String(row.binned_by_name),
    binnedAt: row.binned_at as Date,
    purgeAfter: row.purge_after as Date,
    restoredAt: (row.restored_at as Date | null) ?? null,
    purgedAt: (row.purged_at as Date | null) ?? null,
    childCount: Number(row.child_count ?? 0),
  };
}

const SELECT = `SELECT b.*, u.name AS binned_by_name, (SELECT COUNT(*) FROM superadmin_bin c WHERE c.parent_bin_id = b.id) AS child_count
  FROM superadmin_bin b LEFT JOIN users u ON u.id = b.binned_by`;

export async function insertBinEntry(
  input: {
    entityType: BinEntityType;
    entityId: number;
    parentBinId?: number | null;
    entityNo: string | null;
    title: string;
    detail?: Record<string, unknown>;
    reason: string;
    binnedBy: number;
  },
  db: Queryable,
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO superadmin_bin (entity_type, entity_id, parent_bin_id, entity_no, title, detail_json, reason, binned_by, binned_at, purge_after)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${BIN_DAYS} DAY))`,
    [input.entityType, input.entityId, input.parentBinId ?? null, input.entityNo, input.title.slice(0, 200), JSON.stringify(input.detail ?? {}), input.reason.slice(0, 500), input.binnedBy],
  );
  return result.insertId;
}

// The item's entry while it is in the bin (locked when asked).
export async function findActiveBinEntry(entityType: BinEntityType, entityId: number, db: Queryable = getDbPool(), lock = false): Promise<BinEntry | null> {
  const [rows] = await db.query<Row[]>(`${SELECT} WHERE b.active_key = ?${lock ? " FOR UPDATE" : ""}`, [`${entityType}:${entityId}`]);
  return rows[0] ? toEntry(rows[0]) : null;
}

export async function findBinEntry(id: number, db: Queryable = getDbPool(), lock = false): Promise<BinEntry | null> {
  const [rows] = await db.query<Row[]>(`${SELECT} WHERE b.id = ?${lock ? " FOR UPDATE" : ""}`, [id]);
  return rows[0] ? toEntry(rows[0]) : null;
}

export async function childBinEntries(parentId: number, db: Queryable = getDbPool()): Promise<BinEntry[]> {
  const [rows] = await db.query<Row[]>(`${SELECT} WHERE b.parent_bin_id = ? AND b.active_key IS NOT NULL ORDER BY b.id`, [parentId]);
  return rows.map(toEntry);
}

export async function isBinned(entityType: BinEntityType, entityId: number, db: Queryable = getDbPool()): Promise<boolean> {
  const [rows] = await db.query<Row[]>("SELECT 1 FROM superadmin_bin WHERE active_key = ? LIMIT 1", [`${entityType}:${entityId}`]);
  return rows.length > 0;
}

export async function markBinRestored(ids: readonly number[], by: number, reason: string, db: Queryable): Promise<void> {
  if (!ids.length) return;
  await db.query<ResultSetHeader>("UPDATE superadmin_bin SET restored_at = UTC_TIMESTAMP(), restored_by = ?, restore_reason = ? WHERE id IN (?) AND active_key IS NOT NULL", [
    by,
    reason.slice(0, 500),
    ids,
  ]);
}

export async function markBinPurged(ids: readonly number[], by: number, db: Queryable): Promise<void> {
  if (!ids.length) return;
  // The title stays as the record of what was deleted; the detail (what it took to put it back) goes.
  await db.query<ResultSetHeader>("UPDATE superadmin_bin SET purged_at = UTC_TIMESTAMP(), purged_by = ?, detail_json = NULL WHERE id IN (?) AND active_key IS NOT NULL", [by, ids]);
}

export const BIN_PAGE_SIZE = 25;
// The bin page: top-level entries still in the bin (what was moved with them is counted).
export async function listBin(
  filter: { module?: BinEntityType | null; q?: string; page?: number },
  db: Queryable = getDbPool(),
): Promise<{ items: BinEntry[]; total: number; page: number; pages: number }> {
  const where = ["b.active_key IS NOT NULL", "b.parent_bin_id IS NULL"];
  const params: unknown[] = [];
  if (filter.module) {
    where.push("b.entity_type = ?");
    params.push(filter.module);
  }
  const q = (filter.q ?? "").trim().slice(0, 100);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
    where.push("(b.entity_no LIKE ? OR b.title LIKE ? OR b.reason LIKE ?)");
    params.push(like, like, like);
  }
  const [count] = await db.query<Row[]>(`SELECT COUNT(*) AS total FROM superadmin_bin b WHERE ${where.join(" AND ")}`, params);
  const total = Number(count[0]?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / BIN_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(filter.page ?? 1)), pages);
  const [rows] = await db.query<Row[]>(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY b.binned_at DESC, b.id DESC LIMIT ? OFFSET ?`, [...params, BIN_PAGE_SIZE, (page - 1) * BIN_PAGE_SIZE]);
  return { items: rows.map(toEntry), total, page, pages };
}

// Whole days until Delete permanently is allowed (0 = allowed now).
export function daysUntilPurge(entry: Pick<BinEntry, "purgeAfter">, now = new Date()): number {
  const ms = entry.purgeAfter.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

export async function purgeAllowed(entryId: number, db: Queryable): Promise<boolean> {
  const [rows] = await db.query<Row[]>(
    "SELECT 1 FROM superadmin_bin WHERE id = ? AND active_key IS NOT NULL AND purge_after < UTC_TIMESTAMP() AND binned_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)",
    [entryId, BIN_DAYS],
  );
  return rows.length > 0;
}
