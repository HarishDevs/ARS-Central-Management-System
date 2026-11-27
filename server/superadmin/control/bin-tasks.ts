import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import type { Queryable } from "@/lib/db/client";
import { appendTaskEvent, findTask, updateTask } from "@/lib/db/repositories/tasks.repository";
import { insertBinEntry } from "@/lib/db/repositories/superadmin-bin.repository";
import { OPEN_STATUSES } from "@/server/modules/task-rules";

// v1.94.0 (D-454): tasks moved to the Super Admin bin, on their own (with
// their subtasks) or with the request / ticket they belong to. Like a task
// deleted by its creator (v1.62.0): deleted_at hides it everywhere and an open
// task is closed as cancelled (so counts, reminders, calendars and analytics
// leave it out); Restore puts its status back. Each task gets its own bin row
// (parent_bin_id = the entry it went in with), so restore and purge take them
// together and notifications about each are hidden.
export async function binTaskRows(ids: readonly number[], input: { actorId: number; reason: string; parentBinId: number | null }, db: Queryable): Promise<number[]> {
  const binIds: number[] = [];
  let parentBinId = input.parentBinId;
  for (const id of ids) {
    const task = await findTask(id, db, true);
    if (!task || task.deletedAt) continue;
    await db.query("UPDATE tasks SET deleted_at = UTC_TIMESTAMP(), deleted_by = ? WHERE id = ?", [input.actorId, id]);
    const open = OPEN_STATUSES.includes(task.status);
    if (open)
      await updateTask(
        id,
        task.rowVersion,
        {
          status: "CANCELLED",
          cancelled_by: input.actorId,
          cancelled_at: new Date(),
        },
        db,
      );
    await appendTaskEvent(
      id,
      {
        actorId: input.actorId,
        type: "DELETED",
        from: task.status,
        to: open ? "CANCELLED" : task.status,
        body: `Moved to the Deleted items bin by Super Admin: ${input.reason}`.slice(0, 2000),
        payload: { status: task.status, bin: true },
      },
      db,
    );
    const binId = await insertBinEntry(
      {
        entityType: "TASK",
        entityId: id,
        parentBinId,
        entityNo: task.taskNo,
        title: task.title,
        detail: { status: task.status },
        reason: input.reason,
        binnedBy: input.actorId,
      },
      db,
    );
    binIds.push(binId);
    // The first task binned on its own is the parent of the rest (its subtasks).
    if (parentBinId === null) parentBinId = binId;
  }
  return binIds;
}

export async function restoreTaskRows(ids: readonly number[], input: { actorId: number; reason: string }, db: Queryable): Promise<void> {
  for (const id of ids) {
    const current = await findTask(id, db, true);
    if (!current?.deletedAt) continue;
    await db.query("UPDATE tasks SET deleted_at = NULL, deleted_by = NULL WHERE id = ?", [id]);
    const [rows] = await db.query<RowDataPacket[]>(
      "SELECT JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.status')) AS status FROM task_events WHERE task_id = ? AND event_type = 'DELETED' ORDER BY id DESC LIMIT 1",
      [id],
    );
    const before = String(rows[0]?.status ?? "");
    const reopen = current.status === "CANCELLED" && (OPEN_STATUSES as readonly string[]).includes(before);
    if (reopen) await updateTask(id, current.rowVersion, { status: before, cancelled_by: null, cancelled_at: null }, db);
    await appendTaskEvent(
      id,
      {
        actorId: input.actorId,
        type: "RESTORED",
        from: current.status,
        to: reopen ? before : current.status,
        body: `Restored from the Deleted items bin by Super Admin: ${input.reason}`.slice(0, 2000),
      },
      db,
    );
  }
}

// Every task under these (any depth), deepest first: the order a purge deletes them in.
export async function treeDeepestFirst(rootIds: readonly number[], db: Queryable): Promise<number[]> {
  const levels: number[][] = [[...rootIds]];
  for (let guard = 0; guard < 12; guard += 1) {
    const frontier = levels[levels.length - 1]!;
    if (!frontier.length) break;
    const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM tasks WHERE parent_task_id IN (?)", [frontier]);
    levels.push(rows.map((row) => Number(row.id)));
  }
  return [...new Set(levels.reverse().flat())];
}
