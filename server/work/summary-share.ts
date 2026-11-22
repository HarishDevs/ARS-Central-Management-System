import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import { insertOutbox } from "@/lib/db/repositories/outbox.repository";
import { getUserSetting, setUserSetting } from "@/lib/db/repositories/user-settings.repository";
import { afterResponse } from "@/lib/http/after-response";
import { personLabel } from "@/lib/people/label";
import { deliverOutbox } from "@/server/approvals/service";
import { summaryMessages } from "@/server/modules/messages";
import type { TaskActor } from "@/server/modules/tasks";
import type { WorkViewer } from "@/server/work/access";
import { getManagerMap } from "@/lib/db/repositories/admin-users.repository";
import { chainAbove } from "@/server/work/hierarchy";
import { parseGridConfig } from "@/server/work/grid";
import { FIELDS_SETTING, parseSummaryFields, shareInputSchema, shareProblem, summaryAccessOf, summaryFieldsSchema, withFields, type SummaryAccess, type SummaryFields } from "@/server/work/summary-views";

// v1.77.0 (D-404, owner's Task Summary decision 3): who may open whose Task
// Summary (read-only for everyone but its owner), the owner's grants
// (Share → Manage privacy), and Customise › Fields. Every check is here, on
// the server; the page and the actions only call these.
type Row = RowDataPacket & Record<string, unknown>;
export interface SummaryPerson {
  id: number;
  name: string;
  label: string;
}

async function personRow(id: number, db: Queryable): Promise<{ id: number; name: string; active: boolean; label: string } | null> {
  const [rows] = await db.query<Row[]>("SELECT id, name, login_id, active FROM users WHERE id = ?", [id]);
  const row = rows[0];
  return row ? { id: Number(row.id), name: String(row.name), active: Boolean(row.active), label: personLabel({ name: String(row.name), loginId: String(row.login_id) }) } : null;
}

export async function hasActiveShare(ownerId: number, viewerId: number, db: Queryable = getDbPool()): Promise<boolean> {
  const [rows] = await db.query<Row[]>("SELECT 1 FROM task_summary_shares WHERE owner_id = ? AND viewer_id = ? AND revoked_at IS NULL", [ownerId, viewerId]);
  return rows.length > 0;
}

// How the viewer may open the owner's Task Summary, or null (deny by default).
export async function summaryAccess(viewer: WorkViewer, ownerId: number, db: Queryable = getDbPool()): Promise<{ access: SummaryAccess; owner: { id: number; name: string } | null }> {
  if (ownerId === viewer.id) return { access: "OWN", owner: null };
  const owner = await personRow(ownerId, db);
  if (!owner) return { access: null, owner: null };
  const granted = await hasActiveShare(ownerId, viewer.id, db);
  const access = summaryAccessOf({ viewerId: viewer.id, ownerId, ownerActive: owner.active, viewerTeamIds: viewer.teamIds, granted });
  return { access, owner: access ? { id: owner.id, name: owner.name } : null };
}

// The people the owner shared with (active grants), newest first.
export async function listShares(ownerId: number, db: Queryable = getDbPool()): Promise<(SummaryPerson & { grantedAt: Date; grantedByName: string })[]> {
  const [rows] = await db.query<Row[]>(
    `SELECT u.id, u.name, u.login_id, s.granted_at, g.name AS granted_by_name FROM task_summary_shares s JOIN users u ON u.id = s.viewer_id JOIN users g ON g.id = s.granted_by
     WHERE s.owner_id = ? AND s.revoked_at IS NULL AND u.active = TRUE ORDER BY s.granted_at DESC, s.id DESC`,
    [ownerId],
  );
  return rows.map((row) => ({ id: Number(row.id), name: String(row.name), label: personLabel({ name: String(row.name), loginId: String(row.login_id) }), grantedAt: row.granted_at as Date, grantedByName: String(row.granted_by_name) }));
}

// The managers above the owner (they can always open it, D-216), nearest first.
export async function managersAbove(ownerId: number, db: Queryable = getDbPool()): Promise<SummaryPerson[]> {
  const ids = chainAbove(await getManagerMap(db), ownerId);
  if (!ids.length) return [];
  const [rows] = await db.query<Row[]>("SELECT id, name, login_id FROM users WHERE id IN (?) AND active = TRUE", [ids]);
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [{ id, name: String(row.name), label: personLabel({ name: String(row.name), loginId: String(row.login_id) }) }] : [];
  });
}

// The other Task Summaries the viewer may open: shared with them, and their team (every level).
export async function openableSummaries(viewer: WorkViewer, db: Queryable = getDbPool()): Promise<{ shared: SummaryPerson[]; team: SummaryPerson[] }> {
  const [sharedRows] = await db.query<Row[]>(
    "SELECT u.id, u.name, u.login_id FROM task_summary_shares s JOIN users u ON u.id = s.owner_id WHERE s.viewer_id = ? AND s.revoked_at IS NULL AND u.active = TRUE ORDER BY u.name LIMIT 200",
    [viewer.id],
  );
  const team = viewer.teamIds.length ? (await db.query<Row[]>("SELECT id, name, login_id FROM users WHERE id IN (?) AND active = TRUE ORDER BY name LIMIT 200", [[...viewer.teamIds]]))[0] : [];
  const person = (row: Row): SummaryPerson => ({ id: Number(row.id), name: String(row.name), label: personLabel({ name: String(row.name), loginId: String(row.login_id) }) });
  const teamIds = new Set(team.map((row) => Number(row.id)));
  return { shared: sharedRows.filter((row) => !teamIds.has(Number(row.id))).map(person), team: team.map(person) };
}

export type ShareResult = { ok: true; message: string } | { ok: false; message: string };
// The owner (only ever the signed-in person) adds or removes a viewer.
// Audited both ways; the person added is told (in-app and email).
export async function changeShare(input: unknown, actor: TaskActor): Promise<ShareResult> {
  const parsed = shareInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a person from the list." };
  const { op, userId } = parsed.data;
  const outcome = await withTransaction(async (db): Promise<ShareResult & { outbox?: number[] }> => {
    // One change at a time per owner (the count check below).
    await db.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [actor.id]);
    const [[existing]] = await db.query<Row[]>("SELECT id, revoked_at FROM task_summary_shares WHERE owner_id = ? AND viewer_id = ?", [actor.id, userId]);
    const active = Boolean(existing && existing.revoked_at === null);
    if (op === "remove") {
      if (!active) return { ok: true, message: "They don't have access." };
      await db.query<ResultSetHeader>("UPDATE task_summary_shares SET revoked_at = UTC_TIMESTAMP(), revoked_by = ? WHERE id = ?", [actor.id, Number(existing!.id)]);
      const target = await personRow(userId, db);
      await recordAudit({ actorUserId: actor.id, action: "TASK_SUMMARY_UNSHARED", entityType: "USER", entityId: actor.id, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { viewerId: userId } }, db);
      return { ok: true, message: `${target?.name ?? "They"} can no longer open your Task Summary.` };
    }
    const target = await personRow(userId, db);
    const [[count]] = await db.query<Row[]>("SELECT COUNT(*) AS n FROM task_summary_shares WHERE owner_id = ? AND revoked_at IS NULL", [actor.id]);
    const problem = shareProblem({ ownerId: actor.id, targetId: userId, targetActive: target ? target.active : null, activeShares: Number(count?.n ?? 0), alreadyShared: active });
    if (problem) return { ok: false, message: problem };
    if (active) return { ok: true, message: `${target!.name} can already open it.` };
    if (existing) await db.query<ResultSetHeader>("UPDATE task_summary_shares SET revoked_at = NULL, revoked_by = NULL, granted_by = ?, granted_at = UTC_TIMESTAMP() WHERE id = ?", [actor.id, Number(existing.id)]);
    else await db.query<ResultSetHeader>("INSERT INTO task_summary_shares (owner_id, viewer_id, granted_by) VALUES (?, ?, ?)", [actor.id, userId, actor.id]);
    await recordAudit({ actorUserId: actor.id, action: "TASK_SUMMARY_SHARED", entityType: "USER", entityId: actor.id, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { viewerId: userId } }, db);
    const outbox = await insertOutbox(null, [summaryMessages.shared({ id: actor.id, name: actor.name }, userId)], db);
    return { ok: true, message: `Shared with ${target!.name}. They can open it, read-only.`, outbox };
  });
  if (outcome.ok && outcome.outbox?.length) {
    const ids = outcome.outbox;
    await afterResponse("summary share message", () => deliverOutbox(ids));
  }
  return outcome.ok ? { ok: true, message: outcome.message } : { ok: false, message: outcome.message };
}

// ---- Customise › Fields ---------------------------------------------------------------------
export async function summaryFields(userId: number, db: Queryable = getDbPool()): Promise<SummaryFields> {
  return parseSummaryFields(await getUserSetting(userId, FIELDS_SETTING, db));
}

// Saves the person's default columns; with `applyToTabs`, their stored List
// tabs show the same columns too (their filters, sort and groups stay).
export async function saveSummaryFields(input: unknown, actor: TaskActor): Promise<ShareResult> {
  const parsed = summaryFieldsSchema.safeParse(input);
  const apply = Boolean(input && typeof input === "object" && (input as Record<string, unknown>).applyToTabs === true);
  if (!parsed.success) return { ok: false, message: "Those columns can't be saved." };
  const fields: SummaryFields = { hidden: [...new Set(parsed.data.hidden)], hiddenFields: [...new Set(parsed.data.hiddenFields)] };
  const changed = await withTransaction(async (db) => {
    await setUserSetting(actor.id, FIELDS_SETTING, JSON.stringify(fields), db);
    let tabs = 0;
    if (apply) {
      const [rows] = await db.query<Row[]>("SELECT id, config_json FROM work_views WHERE scope = 'MY_TASKS' AND scope_id = ? AND view_type = 'LIST'", [actor.id]);
      for (const row of rows) {
        const raw = typeof row.config_json === "string" ? safeJson(row.config_json) : row.config_json;
        const extra = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
        const next = { ...extra, ...withFields(parseGridConfig(extra), fields) };
        await db.query<ResultSetHeader>("UPDATE work_views SET config_json = ? WHERE id = ?", [JSON.stringify(next), Number(row.id)]);
        tabs += 1;
      }
    }
    await recordAudit({ actorUserId: actor.id, action: "MY_TASKS_FIELDS_CHANGED", entityType: "USER", entityId: actor.id, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { hidden: fields.hidden, hiddenFields: fields.hiddenFields.length, tabs } }, db);
    return tabs;
  });
  return { ok: true, message: apply && changed ? `Columns saved, and used in your ${changed} List tab${changed === 1 ? "" : "s"}.` : "Columns saved for new List tabs and Reset." };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
