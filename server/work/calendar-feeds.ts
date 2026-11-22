import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import { findUserById } from "@/lib/db/repositories/users.repository";
import * as repo from "@/lib/db/repositories/work.repository";
import { appBaseUrl } from "@/lib/http/app-url";
import { hasModule } from "@/server/modules/modules";
import { PRIORITY_LABEL } from "@/server/modules/settings";
import type { TaskActor } from "@/server/modules/tasks";
import { featureOn } from "@/server/settings/features";
import { indiaDate } from "@/server/workflows/calendar";
import { buildCalendar, type FeedEvent } from "@/server/work/ical";
import { workViewer } from "@/server/work/task-access";
import { extrasOn } from "@/server/work/templates";

// v1.70.0 (D-383, PM phase E part 1): a person's secret calendar address for
// My Tasks or one project (read-only; open tasks with a due date, as all-day
// events). Only a SHA-256 hash of the secret is kept; the address is shown
// once when made. Rotate: the old address stops and a new one is made.
// Revoke: it stops. What a feed holds is decided each time the calendar
// asks: the person must still be active, have Tasks (and Projects for a
// project feed), the "pm_extras" switch must be on, and the project must
// still be visible to them; only tasks they may see are listed.
type Result<T = undefined> = { ok: true; value: T; message?: string } | { ok: false; message: string };
type Row = RowDataPacket & Record<string, unknown>;
const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });
const db = () => getDbPool();
export const FEED_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const FEED_EVENT_LIMIT = 1000;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export const feedUrl = (token: string) => `${appBaseUrl()}/api/calendar/${token}.ics`;
export type FeedScope = "MY_TASKS" | "PROJECT";

export interface FeedInfo {
  hint: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}
async function scopeAllowed(scope: FeedScope, projectId: number | null, actor: TaskActor): Promise<string | null> {
  if (!(await extrasOn(actor))) return "This isn't switched on yet (Super Admin → Features → Projects E).";
  if (scope === "PROJECT") {
    if (!projectId) return "Not found.";
    const found = await repo.projectFor(projectId, await workViewer(actor));
    if (!found || found.project.isTemplate) return "Not found.";
  }
  return null;
}
export async function currentFeed(scope: FeedScope, projectId: number | null, actor: TaskActor): Promise<FeedInfo | null> {
  if (await scopeAllowed(scope, projectId, actor)) return null;
  const [rows] = await db().query<Row[]>("SELECT token_hint, created_at, last_used_at FROM calendar_feeds WHERE user_id = ? AND scope = ? AND project_id <=> ? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1", [actor.id, scope, projectId]);
  const row = rows[0];
  return row ? { hint: String(row.token_hint), createdAt: row.created_at as Date, lastUsedAt: (row.last_used_at as Date | null) ?? null } : null;
}

// Make (or rotate): any earlier address for the same calendar stops working.
export async function makeFeed(scope: FeedScope, projectId: number | null, actor: TaskActor): Promise<Result<{ url: string }>> {
  const refused = await scopeAllowed(scope, projectId, actor);
  if (refused) return fail(refused);
  const token = randomBytes(32).toString("base64url");
  await withTransaction(async (connection) => {
    const [revoked] = await connection.query<ResultSetHeader>("UPDATE calendar_feeds SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND scope = ? AND project_id <=> ? AND revoked_at IS NULL", [actor.id, scope, projectId]);
    await connection.query("INSERT INTO calendar_feeds (user_id, scope, project_id, token_hash, token_hint) VALUES (?, ?, ?, ?, ?)", [actor.id, scope, projectId, hash(token), token.slice(-4)]);
    await recordAudit({ actorUserId: actor.id, action: revoked.affectedRows ? "CALENDAR_FEED_ROTATED" : "CALENDAR_FEED_CREATED", entityType: scope === "PROJECT" ? "PROJECT" : "USER", entityId: projectId ?? actor.id, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { scope } }, connection);
  });
  return { ok: true, value: { url: feedUrl(token) }, message: "Calendar address made. Copy it now: for safety it isn't shown again." };
}
export async function revokeFeed(scope: FeedScope, projectId: number | null, actor: TaskActor): Promise<Result> {
  const [result] = await db().query<ResultSetHeader>("UPDATE calendar_feeds SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND scope = ? AND project_id <=> ? AND revoked_at IS NULL", [actor.id, scope, projectId]);
  if (!result.affectedRows) return fail("There is no calendar address to stop.");
  await recordAudit({ actorUserId: actor.id, action: "CALENDAR_FEED_REVOKED", entityType: scope === "PROJECT" ? "PROJECT" : "USER", entityId: projectId ?? actor.id, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { scope } });
  return { ok: true, value: undefined, message: "The calendar address no longer works." };
}

// The calendar for an address; null: unknown, stopped, or no longer allowed.
export async function feedCalendar(token: string, now = new Date()): Promise<string | null> {
  if (!FEED_TOKEN.test(token)) return null;
  const [rows] = await db().query<Row[]>("SELECT id, user_id, scope, project_id FROM calendar_feeds WHERE token_hash = ? AND revoked_at IS NULL", [hash(token)]);
  const feed = rows[0];
  if (!feed) return null;
  const user = await findUserById(Number(feed.user_id));
  if (!user || !user.active || user.isSystem) return null;
  if (!(await featureOn("tasks", user)) || !(await featureOn("pm_extras", user).catch(() => false))) return null;
  if (user.modules && !hasModule({ roles: user.roles, modules: user.modules }, "TASK")) return null;
  const viewer = await workViewer({ id: user.id, roles: user.roles, modules: user.modules });
  let name: string;
  let taskRows: Row[];
  const base = `SELECT t.id, t.task_no, t.title, t.due_at, t.priority, t.status, t.updated_at, a.name AS assignee_name FROM tasks t JOIN users a ON a.id = t.assignee_id`;
  const open = "t.deleted_at IS NULL AND t.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED') AND t.due_at IS NOT NULL";
  if (feed.scope === "PROJECT") {
    const found = await repo.projectFor(Number(feed.project_id), viewer);
    if (!found || found.project.isTemplate) return null;
    name = `${found.project.name} (ARS-CMS)`;
    // The project's tasks and their subtasks, among those the person may see.
    const visible = repo.visibleTaskClause(viewer);
    [taskRows] = await db().query<Row[]>(
      `${base} WHERE ${open} AND EXISTS (SELECT 1 FROM task_projects tp WHERE tp.project_id = ? AND tp.task_id IN (t.id, COALESCE(t.root_task_id, t.id))) AND ${visible.sql} ORDER BY t.due_at LIMIT ${FEED_EVENT_LIMIT}`,
      [Number(feed.project_id), ...visible.params],
    );
  } else {
    name = "My Tasks (ARS-CMS)";
    [taskRows] = await db().query<Row[]>(`${base} WHERE ${open} AND t.assignee_id = ? ORDER BY t.due_at LIMIT ${FEED_EVENT_LIMIT}`, [user.id]);
  }
  await db().query("UPDATE calendar_feeds SET last_used_at = UTC_TIMESTAMP() WHERE id = ?", [Number(feed.id)]);
  const site = appBaseUrl();
  const events: FeedEvent[] = taskRows.map((row) => ({
    uid: `task-${Number(row.id)}@ars-cms`,
    day: indiaDate(row.due_at as Date),
    title: `${String(row.task_no)} ${String(row.title)}`,
    description: `Assignee: ${String(row.assignee_name)}\nPriority: ${PRIORITY_LABEL[row.priority as keyof typeof PRIORITY_LABEL] ?? String(row.priority)}\nOpen: ${site}/users/tasks/${Number(row.id)}`,
    url: `${site}/users/tasks/${Number(row.id)}`,
    updatedAt: (row.updated_at as Date | null) ?? now,
  }));
  return buildCalendar({ name, events, now });
}
