import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";

// v1.63.0 (D-369, PM-A12): a person's Home layout and private notepad. Every
// read and write is keyed by the person's own id (from the session), so
// nobody can read or change anyone else's (BR-HOME-001, BR-HOME-007).
type Row = RowDataPacket & Record<string, unknown>;

export async function getHomeLayout(userId: number, db: Queryable = getDbPool()): Promise<{ widgets: unknown; version: number } | null> {
  const [rows] = await db.query<Row[]>("SELECT widgets_json, version FROM home_layouts WHERE user_id = ?", [userId]);
  const row = rows[0];
  if (!row) return null;
  return { widgets: typeof row.widgets_json === "string" ? JSON.parse(row.widgets_json) : row.widgets_json, version: Number(row.version) };
}

// Saves when `version` is the stored one (0: nothing stored yet); "CONFLICT"
// when the layout changed meanwhile (another window).
export async function saveHomeLayout(userId: number, widgets: unknown, version: number, db: Queryable = getDbPool()): Promise<number | "CONFLICT"> {
  if (version === 0) {
    const [result] = await db.query<ResultSetHeader>("INSERT IGNORE INTO home_layouts (user_id, widgets_json, version) VALUES (?, ?, 1)", [userId, JSON.stringify(widgets)]);
    return result.affectedRows === 1 ? 1 : "CONFLICT";
  }
  const [result] = await db.query<ResultSetHeader>("UPDATE home_layouts SET widgets_json = ?, version = version + 1 WHERE user_id = ? AND version = ?", [JSON.stringify(widgets), userId, version]);
  return result.affectedRows === 1 ? version + 1 : "CONFLICT";
}

export async function resetHomeLayout(userId: number, db: Queryable = getDbPool()): Promise<void> {
  await db.query<ResultSetHeader>("DELETE FROM home_layouts WHERE user_id = ?", [userId]);
}

export async function getHomeNote(userId: number, db: Queryable = getDbPool()): Promise<{ body: string; version: number }> {
  const [rows] = await db.query<Row[]>("SELECT body, version FROM home_notes WHERE user_id = ?", [userId]);
  return rows[0] ? { body: String(rows[0].body), version: Number(rows[0].version) } : { body: "", version: 0 };
}

export async function saveHomeNote(userId: number, body: string, version: number, db: Queryable = getDbPool()): Promise<number | "CONFLICT"> {
  if (version === 0) {
    const [result] = await db.query<ResultSetHeader>("INSERT IGNORE INTO home_notes (user_id, body, version) VALUES (?, ?, 1)", [userId, body]);
    return result.affectedRows === 1 ? 1 : "CONFLICT";
  }
  const [result] = await db.query<ResultSetHeader>("UPDATE home_notes SET body = ?, version = version + 1 WHERE user_id = ? AND version = ?", [body, userId, version]);
  return result.affectedRows === 1 ? version + 1 : "CONFLICT";
}
