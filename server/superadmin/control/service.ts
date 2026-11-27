import "server-only";
import { unlink } from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { afterResponse } from "@/lib/http/after-response";
import { logError } from "@/lib/logging/logger";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import { appendEvents, deleteUnusedWorkflow } from "@/lib/db/repositories/approvals.repository";
import { appendTaskEvent, findTask, updateTask } from "@/lib/db/repositories/tasks.repository";
import { appendTicketEvent, coordinatorsOf, findTicket, updateTicket } from "@/lib/db/repositories/tickets.repository";
import { insertOutbox } from "@/lib/db/repositories/outbox.repository";
import { meetingOfTask } from "@/lib/db/repositories/meetings.repository";
import { purgeTasks, storedFileInUse } from "@/lib/db/repositories/pm.repository";
import { addFollower } from "@/lib/db/repositories/work.repository";
import {
  BIN_ENTITY_TYPES,
  childBinEntries,
  findActiveBinEntry,
  findBinEntry,
  insertBinEntry,
  markBinPurged,
  markBinRestored,
  purgeAllowed,
  type BinEntityType,
  type BinEntry,
} from "@/lib/db/repositories/superadmin-bin.repository";
import { deleteRequest } from "@/server/approvals/delete";
import { deliverOutbox, overrideRequest, type RequestOverride } from "@/server/approvals/service";
import { workMirrorLink } from "@/server/approvals/work-mirror";
import { isHeld } from "@/server/ops/governance";
import { uploadRoot } from "@/server/attachments/service";
import { taskMessages, ticketMessages } from "@/server/modules/messages";
import { ALL_TASK_PRIORITIES, TICKET_PRIORITIES } from "@/server/modules/settings";
import { TICKET_STATUS_LABEL, type TicketStatus } from "@/server/tickets/rules";
import { forCollaborators } from "@/server/tickets/collaborator-messages";
import { dueFromDay } from "@/server/work/service";
import type { NotifyInput } from "@/server/notifications/notify";
import type { RoleCode } from "@/types/auth";
import { binTaskRows, restoreTaskRows, treeDeepestFirst } from "@/server/superadmin/control/bin-tasks";

// v1.94.0 (D-451..D-458): Super Admin full control (owner, 27 Nov 2026:
// "From Super admin should be able to create, Modify, Delete, archive anything
// like approval, task, Ticket at any level"). One control panel and one bin
// for every module. Every function here checks the Super Admin role itself
// (the pages and actions check the /superadmin area too), needs a reason,
// runs in one transaction with the item's row locked, writes an append-only
// event on the item's own timeline and an audit log entry.
//
// Modules in v1.94.0: approvals (requests), tasks (incl. repeating ones),
// tickets. Projects, portfolios, meetings and forms follow (TD-025).
export type ControlModule = BinEntityType;
export const CONTROL_MODULES: readonly ControlModule[] = BIN_ENTITY_TYPES;
export const MODULE_LABEL: Record<ControlModule, string> = {
  REQUEST: "Approval",
  TASK: "Task",
  TICKET: "Ticket",
};

export interface ControlActor {
  id: number;
  name: string;
  roles: readonly string[];
  sessionId?: string | null;
  ipAddress?: string | null;
}
export type ControlResult<T = undefined> = { ok: true; value: T; message: string } | { ok: false; message: string; fieldErrors?: Record<string, string> };

const NOT_FOUND = "Not found.";
const REASON_MIN = 5;
const isSuper = (actor: { roles: readonly string[] }) => actor.roles.includes("SUPER_ADMIN");
const fail = <T>(message: string, fieldErrors?: Record<string, string>): ControlResult<T> => ({ ok: false, message, fieldErrors });

export function checkReason(raw: string): { ok: true; reason: string } | { ok: false; message: string } {
  const reason = raw.trim();
  if (reason.length < REASON_MIN)
    return {
      ok: false,
      message: `Give a reason of at least ${REASON_MIN} characters.`,
    };
  if (reason.length > 500) return { ok: false, message: "Keep the reason under 500 characters." };
  return { ok: true, reason };
}

// ---- finding items ------------------------------------------------------------------------
export type ControlState = "ANY" | "OPEN" | "FINISHED" | "ARCHIVED";
export interface ControlItem {
  module: ControlModule;
  id: number;
  number: string;
  title: string;
  status: string;
  statusLabel: string;
  ownerName: string;
  assigneeName: string | null;
  createdAt: Date;
  archivedAt: Date | null;
  onBehalfByName: string | null;
  href: string;
}

const REQUEST_OPEN = ["IN_PROGRESS", "ON_HOLD", "CHANGES_REQUIRED"];
const REQUEST_FINAL = ["APPROVED", "REJECTED", "CANCELLED"];
const TASK_FINAL = ["COMPLETED", "CANCELLED"];
const REQUEST_LABEL: Record<string, string> = {
  IN_PROGRESS: "In progress",
  ON_HOLD: "On hold",
  CHANGES_REQUIRED: "Sent back for changes",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};
const TASK_LABEL: Record<string, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};
export const HREF: Record<ControlModule, (id: number) => string> = {
  REQUEST: (id) => `/users/requests/${id}`,
  TASK: (id) => `/users/tasks/${id}`,
  TICKET: (id) => `/users/tickets/${id}`,
};
export const SEARCH_LIMIT = 50;

const like = (q: string) => `%${q.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;

export async function searchControl(
  filter: { q?: string; module?: ControlModule | null; state?: ControlState },
  actor: { roles: readonly string[] },
  db: Queryable = getDbPool(),
): Promise<ControlItem[]> {
  if (!isSuper(actor)) return [];
  const q = (filter.q ?? "").trim().slice(0, 100);
  const state = filter.state ?? "ANY";
  const modules = filter.module ? [filter.module] : CONTROL_MODULES;
  const out: ControlItem[] = [];
  for (const kind of modules) {
    const where: string[] = [];
    const params: unknown[] = [];
    let sql: string;
    if (kind === "REQUEST") {
      where.push("r.deleted_at IS NULL");
      if (q) {
        where.push("(r.request_no LIKE ? OR r.title LIKE ? OR u.name LIKE ? OR u.login_id LIKE ?)");
        params.push(like(q), like(q), like(q), like(q));
      }
      if (state === "OPEN") where.push(`r.status IN ('${REQUEST_OPEN.join("','")}') AND r.archived_at IS NULL`);
      if (state === "FINISHED") where.push(`r.status IN ('${REQUEST_FINAL.join("','")}') AND r.archived_at IS NULL`);
      if (state === "ARCHIVED") where.push("r.archived_at IS NOT NULL");
      sql = `SELECT r.id, r.request_no AS no, r.title, r.status, r.submitted_at AS created_at, r.archived_at, u.name AS owner_name, NULL AS assignee_name, ob.name AS on_behalf_name
             FROM approval_requests r JOIN users u ON u.id = r.requester_id LEFT JOIN users ob ON ob.id = r.created_on_behalf_by
             WHERE ${where.join(" AND ")} ORDER BY r.id DESC LIMIT ${SEARCH_LIMIT}`;
    } else if (kind === "TASK") {
      where.push("t.deleted_at IS NULL");
      if (q) {
        where.push("(t.task_no LIKE ? OR t.title LIKE ? OR c.name LIKE ? OR a.name LIKE ?)");
        params.push(like(q), like(q), like(q), like(q));
      }
      if (state === "OPEN") where.push("t.status IN ('OPEN','IN_PROGRESS','BLOCKED') AND t.archived_at IS NULL");
      if (state === "FINISHED") where.push("t.status IN ('COMPLETED','CANCELLED') AND t.archived_at IS NULL");
      if (state === "ARCHIVED") where.push("t.archived_at IS NOT NULL");
      sql = `SELECT t.id, t.task_no AS no, t.title, t.status, t.created_at, t.archived_at, c.name AS owner_name, a.name AS assignee_name, ob.name AS on_behalf_name
             FROM tasks t JOIN users c ON c.id = t.created_by JOIN users a ON a.id = t.assignee_id LEFT JOIN users ob ON ob.id = t.created_on_behalf_by
             WHERE ${where.join(" AND ")} ORDER BY t.id DESC LIMIT ${SEARCH_LIMIT}`;
    } else {
      where.push("k.deleted_at IS NULL");
      if (q) {
        where.push("(k.ticket_no LIKE ? OR k.title LIKE ? OR r.name LIKE ? OR a.name LIKE ?)");
        params.push(like(q), like(q), like(q), like(q));
      }
      if (state === "OPEN") where.push("k.status <> 'CLOSED' AND k.archived_at IS NULL");
      if (state === "FINISHED") where.push("k.status = 'CLOSED' AND k.archived_at IS NULL");
      if (state === "ARCHIVED") where.push("k.archived_at IS NOT NULL");
      sql = `SELECT k.id, k.ticket_no AS no, k.title, k.status, k.submitted_at AS created_at, k.archived_at, r.name AS owner_name, a.name AS assignee_name, ob.name AS on_behalf_name
             FROM tickets k JOIN users r ON r.id = k.requester_id LEFT JOIN users a ON a.id = k.assignee_id LEFT JOIN users ob ON ob.id = k.created_on_behalf_by
             WHERE ${where.join(" AND ")} ORDER BY k.id DESC LIMIT ${SEARCH_LIMIT}`;
    }
    const [rows] = await db.query<RowDataPacket[]>(sql, params);
    for (const row of rows) {
      const status = String(row.status);
      out.push({
        module: kind,
        id: Number(row.id),
        number: String(row.no),
        title: String(row.title),
        status,
        statusLabel: kind === "REQUEST" ? (REQUEST_LABEL[status] ?? status) : kind === "TASK" ? (TASK_LABEL[status] ?? status) : (TICKET_STATUS_LABEL[status as TicketStatus] ?? status),
        ownerName: String(row.owner_name),
        assigneeName: row.assignee_name ? String(row.assignee_name) : null,
        createdAt: row.created_at as Date,
        archivedAt: (row.archived_at as Date | null) ?? null,
        onBehalfByName: row.on_behalf_name ? String(row.on_behalf_name) : null,
        href: HREF[kind](Number(row.id)),
      });
    }
  }
  return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, SEARCH_LIMIT);
}

// ---- one item ------------------------------------------------------------------------------
export interface ControlDetail extends ControlItem {
  binned: BinEntry | null;
  deleted: boolean; // hidden in some other way (e.g. a task its creator deleted)
  final: boolean;
  ownerId: number;
  assigneeId: number | null;
  rowVersion: number;
  description: string | null;
  priority: string | null;
  dueDay: string | null;
  linkedTo: string | null; // why some changes belong to another item (a request's work step, a ticket's or a meeting's task)
}

export async function loadControlItem(module: ControlModule, id: number, actor: { roles: readonly string[] }, db: Queryable = getDbPool()): Promise<ControlDetail | null> {
  if (!isSuper(actor) || !Number.isInteger(id) || id <= 0) return null;
  const binned = await findActiveBinEntry(module, id, db);
  if (module === "REQUEST") {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT r.*, u.name AS owner_name, ob.name AS on_behalf_name FROM approval_requests r JOIN users u ON u.id = r.requester_id LEFT JOIN users ob ON ob.id = r.created_on_behalf_by WHERE r.id = ?`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    const status = String(row.status);
    return {
      module,
      id,
      number: String(row.request_no),
      title: String(row.title),
      status,
      statusLabel: REQUEST_LABEL[status] ?? status,
      ownerName: String(row.owner_name),
      ownerId: Number(row.requester_id),
      assigneeName: null,
      assigneeId: null,
      createdAt: row.submitted_at as Date,
      archivedAt: (row.archived_at as Date | null) ?? null,
      onBehalfByName: row.on_behalf_name ? String(row.on_behalf_name) : null,
      href: HREF.REQUEST(id),
      binned,
      deleted: Boolean(row.deleted_at),
      final: REQUEST_FINAL.includes(status),
      rowVersion: Number(row.state_version),
      description: null,
      priority: null,
      dueDay: null,
      linkedTo: null,
    };
  }
  if (module === "TASK") {
    const task = await findTask(id, db);
    if (!task) return null;
    const meeting = await meetingOfTask(id, db).catch(() => null);
    const mirror = workMirrorLink(task.formData);
    return {
      module,
      id,
      number: task.taskNo,
      title: task.title,
      status: task.status,
      statusLabel: TASK_LABEL[task.status] ?? task.status,
      ownerName: task.createdByName,
      ownerId: task.createdBy,
      assigneeName: task.assigneeName,
      assigneeId: task.assigneeId,
      createdAt: task.createdAt,
      archivedAt: task.archivedAt ?? null,
      onBehalfByName: task.onBehalfByName ?? null,
      href: HREF.TASK(id),
      binned,
      deleted: Boolean(task.deletedAt),
      final: TASK_FINAL.includes(task.status),
      rowVersion: task.rowVersion,
      description: task.description,
      priority: task.priority,
      dueDay: task.dueAt ? indiaDayOf(task.dueAt) : null,
      linkedTo: mirror ? `a work step of request ${task.relatedRequestNo ?? ""}`.trim() : task.ticketId ? "a ticket's task" : meeting ? `an action item of meeting ${meeting.meetingNo}` : null,
    };
  }
  const ticket = await findTicket(id, db, false, true);
  if (!ticket) return null;
  return {
    module,
    id,
    number: ticket.ticketNo,
    title: ticket.title,
    status: ticket.status,
    statusLabel: TICKET_STATUS_LABEL[ticket.status] ?? ticket.status,
    ownerName: ticket.requesterName,
    ownerId: ticket.requesterId,
    assigneeName: ticket.assigneeName,
    assigneeId: ticket.assigneeId,
    createdAt: ticket.submittedAt,
    archivedAt: ticket.archivedAt ?? null,
    onBehalfByName: ticket.onBehalfByName ?? null,
    href: HREF.TICKET(id),
    binned,
    deleted: Boolean(ticket.deletedAt),
    final: ticket.status === "CLOSED",
    rowVersion: ticket.rowVersion,
    description: ticket.description,
    priority: ticket.priority,
    dueDay: ticket.requiredOn,
    linkedTo: null,
  };
}

const indiaDayOf = (value: Date) => new Date(value.getTime() + 330 * 60_000).toISOString().slice(0, 10);

async function send(ids: number[]) {
  if (ids.length) await afterResponse("super admin control messages", () => deliverOutbox(ids));
}

// ---- archive -------------------------------------------------------------------------------
// D-456: only a finished item is archived (an open one would leave people
// with work they can't do: close it first with a logged override).
export async function archiveItem(module: ControlModule, id: number, rawReason: string, actor: ControlActor, archive = true): Promise<ControlResult> {
  if (!isSuper(actor)) return fail(NOT_FOUND);
  const checked = checkReason(rawReason);
  if (!checked.ok) return fail(checked.message, { reason: checked.message });
  const reason = checked.reason;
  const table = module === "REQUEST" ? "approval_requests" : module === "TASK" ? "tasks" : "tickets";
  const outcome = await withTransaction(async (db) => {
    const [rows] = await db.query<RowDataPacket[]>(`SELECT id, status, archived_at, deleted_at FROM ${table} WHERE id = ? FOR UPDATE`, [id]);
    const row = rows[0];
    if (!row) return { error: NOT_FOUND };
    if (row.deleted_at)
      return {
        error: "This item is in the Deleted items bin (or deleted). Restore it first.",
      };
    const status = String(row.status);
    if (archive) {
      if (row.archived_at) return { error: "It is already archived." };
      const final = module === "REQUEST" ? REQUEST_FINAL.includes(status) : module === "TASK" ? TASK_FINAL.includes(status) : status === "CLOSED";
      if (!final)
        return {
          error: "Only a finished item can be archived. Close it first (Modify → force the status), then archive it.",
        };
      await db.query(`UPDATE ${table} SET archived_at = UTC_TIMESTAMP(), archived_by = ? WHERE id = ?`, [actor.id, id]);
    } else {
      if (!row.archived_at) return { error: "It isn't archived." };
      await db.query(`UPDATE ${table} SET archived_at = NULL, archived_by = NULL WHERE id = ?`, [id]);
    }
    const word = archive ? "ARCHIVED" : "UNARCHIVED";
    const summary = archive ? "archived it (read-only, still visible under Archived)" : "un-archived it (it can be changed again)";
    if (module === "REQUEST")
      await appendEvents(
        id,
        [
          {
            type: "SUPER_ADMIN_OVERRIDE",
            actorId: actor.id,
            action: archive ? "ARCHIVE" : "UNARCHIVE",
            reason,
            summary,
            notifyIds: [],
          },
        ],
        actor.id,
        db,
      );
    else if (module === "TASK")
      await appendTaskEvent(
        id,
        {
          actorId: actor.id,
          type: word,
          body: `Reason: ${reason}`.slice(0, 2000),
          payload: { reason },
        },
        db,
      );
    else await appendTicketEvent(id, { actorId: actor.id, action: word, detail: { reason } }, db);
    await recordAudit(
      {
        actorUserId: actor.id,
        action: `SUPERADMIN_${word}`,
        entityType: module,
        entityId: id,
        sessionId: actor.sessionId ?? null,
        ipAddress: actor.ipAddress ?? null,
        metadata: { reason },
      },
      db,
    );
    return { error: null };
  });
  if (outcome.error) return fail(outcome.error);
  return {
    ok: true,
    value: undefined,
    message: archive ? "Archived. It is read-only now." : "Un-archived.",
  };
}

// ---- move to the bin -----------------------------------------------------------------------
export async function binItem(module: ControlModule, id: number, rawReason: string, actor: ControlActor): Promise<ControlResult<{ binId: number }>> {
  if (!isSuper(actor)) return fail(NOT_FOUND);
  const checked = checkReason(rawReason);
  if (!checked.ok) return fail(checked.message, { reason: checked.message });
  const reason = checked.reason;
  if (module === "REQUEST") {
    const [rows] = await getDbPool().query<RowDataPacket[]>("SELECT archived_at, deleted_at FROM approval_requests WHERE id = ?", [id]);
    if (!rows[0] || rows[0].deleted_at) return fail("This request doesn't exist or is already in the bin.");
    if (rows[0].archived_at) return fail("Un-archive it first, then move it to the bin.");
    // D-086's delete, now into the bin (an open request is closed first, and the people waiting on it are told).
    const done = await deleteRequest(
      { requestId: id, reason },
      {
        id: actor.id,
        roles: actor.roles as RoleCode[],
        sessionId: actor.sessionId ?? null,
        ipAddress: actor.ipAddress ?? null,
      },
    );
    if (!done.ok) return fail(done.message);
    const entry = await findActiveBinEntry("REQUEST", id);
    return {
      ok: true,
      value: { binId: entry?.id ?? 0 },
      message: `${done.value.requestNo} moved to Deleted items.`,
    };
  }
  const outcome = await withTransaction(async (db) => {
    if (module === "TASK") {
      const task = await findTask(id, db, true);
      if (!task || task.deletedAt)
        return {
          error: "This task doesn't exist or is already deleted.",
        } as const;
      if (task.archivedAt)
        return {
          error: "Un-archive it first, then move it to the bin.",
        } as const;
      const tree = await treeDeepestFirst([id], db);
      for (const taskId of tree) {
        const item = taskId === id ? task : await findTask(taskId, db);
        if (!item) continue;
        // A task that belongs to another item goes (and comes back) with it.
        if (workMirrorLink(item.formData))
          return {
            error: `${item.taskNo} is a work step of request ${item.relatedRequestNo ?? ""}: move the request to the bin instead.`,
          } as const;
        if (item.ticketId)
          return {
            error: `${item.taskNo} carries out a ticket: move the ticket to the bin instead.`,
          } as const;
        const [carried] = await db.query<RowDataPacket[]>("SELECT 1 FROM tickets WHERE task_id = ? LIMIT 1", [taskId]);
        if (carried.length)
          return {
            error: `${item.taskNo} carries out a ticket: move the ticket to the bin instead.`,
          } as const;
        const meeting = await meetingOfTask(taskId, db);
        if (meeting)
          return {
            error: `${item.taskNo} is an action item of meeting ${meeting.meetingNo}, which isn't in the bin's modules yet.`,
          } as const;
        if (task.relatedRequestId && (await isHeld(task.relatedRequestId, db)))
          return {
            error: "Its linked request is under a legal hold.",
          } as const;
      }
      // The task first, then its subtasks (top-down), so the subtasks' entries hang on it.
      const order = [id, ...tree.filter((taskId) => taskId !== id).reverse()];
      const binIds = await binTaskRows(order, { actorId: actor.id, reason, parentBinId: null }, db);
      await recordAudit(
        {
          actorUserId: actor.id,
          action: "SUPERADMIN_BINNED",
          entityType: "TASK",
          entityId: id,
          sessionId: actor.sessionId ?? null,
          ipAddress: actor.ipAddress ?? null,
          metadata: {
            taskNo: task.taskNo,
            title: task.title,
            reason,
            withSubtasks: binIds.length - 1,
          },
        },
        db,
      );
      return { binId: binIds[0] ?? 0, label: task.taskNo } as const;
    }
    const ticket = await findTicket(id, db, true, true);
    if (!ticket || ticket.deletedAt)
      return {
        error: "This ticket doesn't exist or is already in the bin.",
      } as const;
    if (ticket.archivedAt)
      return {
        error: "Un-archive it first, then move it to the bin.",
      } as const;
    await db.query("UPDATE tickets SET deleted_at = UTC_TIMESTAMP(), deleted_by = ?, row_version = row_version + 1 WHERE id = ?", [actor.id, id]);
    await appendTicketEvent(
      id,
      {
        actorId: actor.id,
        action: "BINNED",
        from: ticket.status,
        to: ticket.status,
        detail: { reason },
      },
      db,
    );
    const binId = await insertBinEntry(
      {
        entityType: "TICKET",
        entityId: id,
        entityNo: ticket.ticketNo,
        title: ticket.title,
        detail: { status: ticket.status },
        reason,
        binnedBy: actor.id,
      },
      db,
    );
    // A ticket from before v1.59.3 may have its task: it goes with it.
    const [tasks] = await db.query<RowDataPacket[]>("SELECT id FROM tasks WHERE (ticket_id = ? OR id = ?) AND deleted_at IS NULL ORDER BY depth DESC, id", [id, ticket.taskId ?? 0]);
    await binTaskRows(
      tasks.map((row) => Number(row.id)),
      { actorId: actor.id, reason, parentBinId: binId },
      db,
    );
    await recordAudit(
      {
        actorUserId: actor.id,
        action: "SUPERADMIN_BINNED",
        entityType: "TICKET",
        entityId: id,
        sessionId: actor.sessionId ?? null,
        ipAddress: actor.ipAddress ?? null,
        metadata: { ticketNo: ticket.ticketNo, title: ticket.title, reason },
      },
      db,
    );
    return { binId, label: ticket.ticketNo } as const;
  });
  if ("error" in outcome) return fail(outcome.error!);
  return {
    ok: true,
    value: { binId: outcome.binId },
    message: `${outcome.label} moved to Deleted items.`,
  };
}

// ---- restore -------------------------------------------------------------------------------
export async function restoreFromBin(entryId: number, rawReason: string, actor: ControlActor): Promise<ControlResult> {
  if (!isSuper(actor)) return fail(NOT_FOUND);
  const checked = checkReason(rawReason);
  if (!checked.ok) return fail(checked.message, { reason: checked.message });
  const reason = checked.reason;
  const outcome = await withTransaction(async (db) => {
    const entry = await findBinEntry(entryId, db, true);
    if (!entry || entry.restoredAt || entry.purgedAt) return { error: "This item is no longer in the bin. Reload the page." };
    if (entry.parentBinId !== null)
      return {
        error: "This item went into the bin with another one; restore that one.",
      };
    const children = await childBinEntries(entry.id, db);
    const childTasks = children.filter((child) => child.entityType === "TASK").map((child) => child.entityId);
    if (entry.entityType === "REQUEST") {
      await db.query("UPDATE approval_requests SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL WHERE id = ?", [entry.entityId]);
      await appendEvents(
        entry.entityId,
        [
          {
            type: "SUPER_ADMIN_OVERRIDE",
            actorId: actor.id,
            action: "RESTORE",
            reason,
            summary: "restored it from the Deleted items bin",
            notifyIds: [],
          },
        ],
        actor.id,
        db,
      );
      await restoreTaskRows(childTasks, { actorId: actor.id, reason }, db);
    } else if (entry.entityType === "TASK") {
      await restoreTaskRows([entry.entityId, ...childTasks], { actorId: actor.id, reason }, db);
    } else {
      await db.query("UPDATE tickets SET deleted_at = NULL, deleted_by = NULL, row_version = row_version + 1 WHERE id = ?", [entry.entityId]);
      await appendTicketEvent(entry.entityId, { actorId: actor.id, action: "RESTORED", detail: { reason } }, db);
      await restoreTaskRows(childTasks, { actorId: actor.id, reason }, db);
    }
    await markBinRestored([entry.id, ...children.map((child) => child.id)], actor.id, reason, db);
    await recordAudit(
      {
        actorUserId: actor.id,
        action: "SUPERADMIN_RESTORED",
        entityType: entry.entityType,
        entityId: entry.entityId,
        sessionId: actor.sessionId ?? null,
        ipAddress: actor.ipAddress ?? null,
        metadata: {
          number: entry.entityNo,
          title: entry.title,
          reason,
          binnedAt: entry.binnedAt.toISOString(),
        },
      },
      db,
    );
    return { error: null, label: entry.entityNo ?? entry.title };
  });
  if (outcome.error) return fail(outcome.error);
  return { ok: true, value: undefined, message: `${outcome.label} restored.` };
}

// ---- delete permanently -------------------------------------------------------------------
// D-455: only after 30 days in the bin, with the item's number typed to
// confirm. The item's rows and every row that hangs on it (files on disk too)
// go in one transaction; the bin keeps its number, title and who / when / why,
// and the audit log keeps the record that it existed (never erased).
export function confirmWordFor(entry: Pick<BinEntry, "entityNo" | "title">): string {
  return (entry.entityNo ?? entry.title).trim();
}

export async function purgeFromBin(entryId: number, confirmText: string, actor: ControlActor): Promise<ControlResult> {
  if (!isSuper(actor)) return fail(NOT_FOUND);
  const files: string[] = [];
  const outcome = await withTransaction(async (db) => {
    const entry = await findBinEntry(entryId, db, true);
    if (!entry || entry.restoredAt || entry.purgedAt) return { error: "This item is no longer in the bin. Reload the page." };
    if (entry.parentBinId !== null)
      return {
        error: "This item went into the bin with another one; delete that one.",
      };
    if (confirmText.trim() !== confirmWordFor(entry))
      return {
        error: `Type ${confirmWordFor(entry)} to confirm.`,
        field: "confirmText",
      };
    if (!(await purgeAllowed(entry.id, db)))
      return {
        error: "It can be deleted permanently only after 30 days in the bin.",
      };
    const children = await childBinEntries(entry.id, db);
    const childTasks = children.filter((child) => child.entityType === "TASK").map((child) => child.entityId);
    if (entry.entityType === "REQUEST") {
      if (await isHeld(entry.entityId, db))
        return {
          error: "This request is under a legal hold, so it can't be deleted. Release the hold first.",
        };
      files.push(...(await purgeRequestRows(entry.entityId, childTasks, db)));
    } else if (entry.entityType === "TASK") {
      const order = await treeDeepestFirst([entry.entityId], db);
      const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM tasks WHERE id IN (?) AND deleted_at IS NULL", [order]);
      if (rows.length)
        return {
          error: "A subtask of it is no longer deleted; move it out from under this task first.",
        };
      await purgeNotifications("TASK", order, db);
      files.push(...(await purgeTasks(order, db)).files);
    } else {
      files.push(...(await purgeTicketRows(entry.entityId, childTasks, db)));
    }
    await markBinPurged([entry.id, ...children.map((child) => child.id)], actor.id, db);
    await recordAudit(
      {
        actorUserId: actor.id,
        action: "SUPERADMIN_PURGED",
        entityType: entry.entityType,
        entityId: entry.entityId,
        sessionId: actor.sessionId ?? null,
        ipAddress: actor.ipAddress ?? null,
        metadata: {
          number: entry.entityNo,
          title: entry.title,
          binnedAt: entry.binnedAt.toISOString(),
          binnedBy: entry.binnedBy,
          binReason: entry.reason,
          withItems: children.length,
          files: files.length,
        },
      },
      db,
    );
    return { error: null, label: entry.entityNo ?? entry.title };
  });
  if (outcome.error) return fail(outcome.error, "field" in outcome && outcome.field ? { [outcome.field]: outcome.error } : undefined);
  await removeFiles(files);
  return {
    ok: true,
    value: undefined,
    message: `${outcome.label} deleted permanently. The audit log keeps the record that it existed.`,
  };
}

async function removeFiles(stored: readonly string[]): Promise<void> {
  const root = uploadRoot();
  for (const file of stored) {
    const absolute = path.resolve(root, file);
    if (!absolute.startsWith(root + path.sep)) continue;
    try {
      if (await storedFileInUse(file)) continue;
      const [rows] = await getDbPool().query<RowDataPacket[]>("SELECT 1 FROM request_attachments WHERE stored_path = ? LIMIT 1", [file]);
      if (rows.length) continue;
      await unlink(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") logError("super admin purge: couldn't remove a file", error);
    }
  }
}

// Every row of a request and what hangs on it. The optional append-only
// triggers allow these deletes only for a request 30+ days in the bin (D-455).
async function purgeRequestRows(requestId: number, childTasks: readonly number[], db: Queryable): Promise<string[]> {
  const files: string[] = [];
  const [request] = await db.query<RowDataPacket[]>(
    "SELECT r.id, v.workflow_id, w.kind FROM approval_requests r JOIN workflow_versions v ON v.id = r.workflow_version_id JOIN workflow_definitions w ON w.id = v.workflow_id WHERE r.id = ? FOR UPDATE",
    [requestId],
  );
  if (!request[0]) return files;
  const [attachments] = await db.query<RowDataPacket[]>("SELECT stored_path FROM request_attachments WHERE request_id = ?", [requestId]);
  files.push(...attachments.map((row) => String(row.stored_path)));
  const [recordFiles] = await db.query<RowDataPacket[]>("SELECT stored_path FROM record_files WHERE entity_type = 'REQUEST' AND entity_id = ?", [requestId]);
  files.push(...recordFiles.map((row) => String(row.stored_path)));
  await db.query("DELETE FROM comment_versions WHERE target = 'REQUEST' AND comment_id IN (SELECT id FROM request_comments WHERE request_id = ?)", [requestId]);
  await db.query("DELETE FROM request_comments WHERE request_id = ?", [requestId]);
  await db.query("DELETE FROM approval_events WHERE request_id = ?", [requestId]);
  await db.query("DELETE FROM task_reminders WHERE task_id IN (SELECT id FROM approval_tasks WHERE request_id = ?)", [requestId]);
  await db.query("DELETE FROM approval_tasks WHERE request_id = ?", [requestId]);
  for (const table of [
    "consultations",
    "recent_views",
    "request_revisions",
    "request_submission_checks",
    "stuck_snoozes",
    "workflow_migration_items",
    "request_collaborators",
    "request_attachments",
    "notification_outbox",
  ]) {
    await db.query(`DELETE FROM ${table} WHERE request_id = ?`, [requestId]);
  }
  await db.query("DELETE FROM request_links WHERE from_request_id = ? OR to_request_id = ?", [requestId, requestId]);
  await db.query("DELETE FROM request_amendments WHERE original_id = ? OR amendment_id = ?", [requestId, requestId]);
  await db.query("DELETE FROM record_files WHERE entity_type = 'REQUEST' AND entity_id = ?", [requestId]);
  await db.query("DELETE FROM record_item_checks WHERE entity_type = 'REQUEST' AND entity_id = ?", [requestId]);
  await purgeNotifications("REQUEST", [requestId], db);
  await db.query("DELETE FROM gcal_links WHERE entity_type = 'REQUEST' AND entity_id = ?", [requestId]);
  await db.query("DELETE FROM notification_rule_sends WHERE record_kind = 'REQUEST' AND record_id = ?", [requestId]);
  // Its work-step tasks went into the bin with it and go now; other tasks only lose the link.
  if (childTasks.length) {
    const order = await treeDeepestFirst(childTasks, db);
    await purgeNotifications("TASK", order, db);
    files.push(...(await purgeTasks(order, db)).files);
  }
  await db.query("UPDATE tasks SET related_request_id = NULL WHERE related_request_id = ?", [requestId]);
  await db.query("DELETE FROM approval_requests WHERE id = ? AND deleted_at IS NOT NULL", [requestId]);
  // A custom request's own one-off approval type (named after it) goes too, when nothing else uses it.
  if (request[0].kind === "CUSTOM") {
    await db.query("SAVEPOINT purge_workflow");
    try {
      await deleteUnusedWorkflow(Number(request[0].workflow_id), db);
      await db.query("RELEASE SAVEPOINT purge_workflow");
    } catch (error) {
      await db.query("ROLLBACK TO SAVEPOINT purge_workflow");
      logError("super admin purge: the custom approval type stays (still referenced)", error);
    }
  }
  return files;
}

// The in-app notifications about the item (with their delivery log) carry its
// title, so they go too; the audit log keeps the record that it existed.
async function purgeNotifications(entityType: "REQUEST" | "TASK" | "TICKET", ids: readonly number[], db: Queryable): Promise<void> {
  if (!ids.length) return;
  await db.query("DELETE d FROM notification_deliveries d JOIN notifications n ON n.id = d.notification_id WHERE n.entity_type = ? AND n.entity_id IN (?)", [entityType, ids]);
  await db.query("DELETE FROM notifications WHERE entity_type = ? AND entity_id IN (?)", [entityType, ids]);
}

async function purgeTicketRows(ticketId: number, childTasks: readonly number[], db: Queryable): Promise<string[]> {
  const files: string[] = [];
  const [recordFiles] = await db.query<RowDataPacket[]>("SELECT stored_path FROM record_files WHERE entity_type = 'TICKET' AND entity_id = ?", [ticketId]);
  files.push(...recordFiles.map((row) => String(row.stored_path)));
  await db.query("DELETE FROM comment_versions WHERE target = 'TICKET' AND comment_id IN (SELECT id FROM ticket_comments WHERE ticket_id = ?)", [ticketId]);
  for (const table of ["ticket_comments", "ticket_events", "ticket_feedback", "ticket_confirm_steps", "ticket_collaborators"]) {
    await db.query(`DELETE FROM ${table} WHERE ticket_id = ?`, [ticketId]);
  }
  await db.query("DELETE FROM record_files WHERE entity_type = 'TICKET' AND entity_id = ?", [ticketId]);
  await db.query("DELETE FROM record_item_checks WHERE entity_type = 'TICKET' AND entity_id = ?", [ticketId]);
  await purgeNotifications("TICKET", [ticketId], db);
  await db.query("DELETE FROM gcal_links WHERE entity_type = 'TICKET' AND entity_id = ?", [ticketId]);
  await db.query("DELETE FROM notification_rule_sends WHERE record_kind = 'TICKET' AND record_id = ?", [ticketId]);
  await db.query("UPDATE tickets SET task_id = NULL WHERE id = ?", [ticketId]);
  if (childTasks.length) {
    const order = await treeDeepestFirst(childTasks, db);
    await purgeNotifications("TASK", order, db);
    files.push(...(await purgeTasks(order, db)).files);
  }
  await db.query("UPDATE tasks SET ticket_id = NULL WHERE ticket_id = ?", [ticketId]);
  await db.query("DELETE FROM tickets WHERE id = ? AND deleted_at IS NOT NULL", [ticketId]);
  return files;
}

// ---- Modify: logged override -------------------------------------------------------------
export { type RequestOverride };
export async function overrideRequestItem(
  requestId: number,
  input: RequestOverride & {
    reason: string;
    expectedStateVersion?: number | null;
  },
  actor: ControlActor,
): Promise<ControlResult> {
  if (!isSuper(actor)) return fail(NOT_FOUND);
  const result = await overrideRequest(requestId, input, {
    id: actor.id,
    roles: actor.roles as RoleCode[],
  });
  return result.ok
    ? {
        ok: true,
        value: undefined,
        message: "Changed. The timeline shows it as changed by Super Admin.",
      }
    : fail(result.message, result.fieldErrors);
}

export type TaskOverride =
  | {
      action: "EDIT";
      title?: string;
      description?: string;
      priority?: string;
      dueDay?: string;
      assigneeId?: number | null;
    }
  | {
      action: "FORCE_STATUS";
      status: "OPEN" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "CANCELLED";
    }
  | { action: "REOPEN" };

export async function overrideTask(taskId: number, input: TaskOverride & { reason: string; expectedRowVersion?: number | null }, actor: ControlActor): Promise<ControlResult> {
  if (!isSuper(actor)) return fail(NOT_FOUND);
  const checked = checkReason(input.reason);
  if (!checked.ok) return fail(checked.message, { reason: checked.message });
  const reason = checked.reason;
  const outcome = await withTransaction(async (db) => {
    const task = await findTask(taskId, db, true);
    if (!task || task.deletedAt) return { error: NOT_FOUND } as const;
    if (task.archivedAt)
      return {
        error: "It is archived (read-only). Un-archive it first.",
      } as const;
    if (input.expectedRowVersion != null && input.expectedRowVersion !== task.rowVersion)
      return {
        error: "Someone changed this task while you were looking. Reload and try again.",
      } as const;
    const mirror = workMirrorLink(task.formData);
    const meeting = await meetingOfTask(taskId, db);
    const linked = mirror
      ? `a work step of request ${task.relatedRequestNo ?? ""}: change it on the request`
      : task.ticketId
        ? "a ticket's task: change it on the ticket"
        : meeting
          ? `an action item of meeting ${meeting.meetingNo}: it closes through the meeting`
          : null;
    const changes: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const words: string[] = [];
    let newAssignee: number | null = null;
    if (input.action === "EDIT") {
      if (input.title !== undefined && input.title.trim() !== task.title) {
        const title = input.title.trim();
        if (title.length < 3 || title.length > 200)
          return {
            error: "Give a title of 3 to 200 characters.",
            field: "title",
          } as const;
        changes.title = title;
        words.push("the title");
      }
      if (input.description !== undefined && (input.description.trim() || null) !== (task.description ?? null)) {
        if (input.description.length > 4000)
          return {
            error: "Use 4000 characters or fewer.",
            field: "description",
          } as const;
        changes.description = input.description.trim() || null;
        words.push("the description");
      }
      if (input.priority !== undefined && input.priority !== task.priority) {
        if (!(ALL_TASK_PRIORITIES as readonly string[]).includes(input.priority)) return { error: "Choose a priority.", field: "priority" } as const;
        changes.priority = input.priority;
        words.push("the priority");
      }
      if (input.dueDay !== undefined && input.dueDay !== (task.dueAt ? indiaDayOf(task.dueAt) : "")) {
        const due = dueFromDay(input.dueDay);
        if (!due)
          return {
            error: "Choose a valid due date.",
            field: "dueDay",
          } as const;
        changes.due_at = due;
        words.push("the due date");
      }
      if (input.assigneeId != null && input.assigneeId !== task.assigneeId) {
        if (linked) return { error: `This task is ${linked}.` } as const;
        const [people] = await db.query<RowDataPacket[]>("SELECT id FROM users WHERE id = ? AND active = TRUE AND is_break_glass = FALSE", [input.assigneeId]);
        if (!people[0])
          return {
            error: "Choose an active person.",
            field: "assigneeId",
          } as const;
        changes.assignee_id = input.assigneeId;
        changes.assigned_at = new Date();
        newAssignee = input.assigneeId;
        words.push("the assignee");
      }
      if (!words.length) return { error: "Nothing was changed." } as const;
    } else {
      if (linked) return { error: `This task is ${linked}.` } as const;
      const status = input.action === "REOPEN" ? "OPEN" : input.status;
      if (input.action === "REOPEN" && !TASK_FINAL.includes(task.status))
        return {
          error: "Only a completed or cancelled task is reopened.",
        } as const;
      if (status === task.status) return { error: "It already has that status." } as const;
      changes.status = status;
      if (status === "COMPLETED")
        Object.assign(changes, {
          completed_by: actor.id,
          completed_at: new Date(),
          cancelled_by: null,
          cancelled_at: null,
        });
      else if (status === "CANCELLED")
        Object.assign(changes, {
          cancelled_by: actor.id,
          cancelled_at: new Date(),
        });
      else
        Object.assign(changes, {
          completed_by: null,
          completed_at: null,
          cancelled_by: null,
          cancelled_at: null,
        });
      words.push(input.action === "REOPEN" ? "reopened it" : `the status (${TASK_LABEL[task.status]} → ${TASK_LABEL[status]})`);
    }
    for (const key of Object.keys(changes)) {
      before[key] = (task as unknown as Record<string, unknown>)[key.replace(/_(\w)/g, (_, letter: string) => letter.toUpperCase())] ?? null;
      after[key] = changes[key];
    }
    if (!(await updateTask(task.id, task.rowVersion, changes, db)))
      return {
        error: "Someone changed this task while you were looking. Reload and try again.",
      } as const;
    const summary = input.action === "EDIT" ? `changed ${words.join(", ")}` : words[0]!;
    await appendTaskEvent(
      task.id,
      {
        actorId: actor.id,
        type: "SUPER_ADMIN_OVERRIDE",
        from: task.status,
        to: (changes.status as string | undefined) ?? task.status,
        body: `${summary}. Reason: ${reason}`.slice(0, 2000),
        payload: { action: input.action, reason, before, after },
      },
      db,
    );
    if (newAssignee) await addFollower(task.id, newAssignee, "ASSIGNEE", actor.id, db);
    await recordAudit(
      {
        actorUserId: actor.id,
        action: "TASK_SUPER_ADMIN_OVERRIDE",
        entityType: "TASK",
        entityId: task.id,
        sessionId: actor.sessionId ?? null,
        ipAddress: actor.ipAddress ?? null,
        metadata: {
          taskNo: task.taskNo,
          override: input.action,
          reason,
          fields: Object.keys(changes),
        },
      },
      db,
    );
    const info = {
      id: task.id,
      taskNo: task.taskNo,
      title: (changes.title as string | undefined) ?? task.title,
    };
    const to = new Set([task.createdBy, task.assigneeId, ...(newAssignee ? [newAssignee] : [])].filter((userId) => userId !== actor.id));
    const messages: NotifyInput[] = [...to].map((userId) => taskMessages.updated(info, userId, `changed by Super Admin: ${summary} (reason: ${reason})`));
    return { outbox: await insertOutbox(null, messages, db) } as const;
  });
  if ("error" in outcome) return fail(outcome.error!, "field" in outcome && outcome.field ? { [outcome.field]: outcome.error! } : undefined);
  await send(outcome.outbox);
  return {
    ok: true,
    value: undefined,
    message: "Changed. The task's history shows it as changed by Super Admin.",
  };
}

export type TicketOverride =
  | {
      action: "EDIT";
      title?: string;
      description?: string;
      priority?: string;
      requiredOn?: string;
    }
  | { action: "REASSIGN"; assigneeId: number; targetDay: string }
  | { action: "FORCE_STATUS"; status: "IN_PROGRESS" | "CLOSED" }
  | { action: "REOPEN" };

export async function overrideTicket(
  ticketId: number,
  input: TicketOverride & {
    reason: string;
    expectedRowVersion?: number | null;
  },
  actor: ControlActor,
): Promise<ControlResult> {
  if (!isSuper(actor)) return fail(NOT_FOUND);
  const checked = checkReason(input.reason);
  if (!checked.ok) return fail(checked.message, { reason: checked.message });
  const reason = checked.reason;
  const outcome = await withTransaction(async (db) => {
    const ticket = await findTicket(ticketId, db, true);
    if (!ticket) return { error: NOT_FOUND } as const;
    if (ticket.archivedAt)
      return {
        error: "It is archived (read-only). Un-archive it first.",
      } as const;
    if (input.expectedRowVersion != null && input.expectedRowVersion !== ticket.rowVersion)
      return {
        error: "Someone changed this ticket while you were looking. Reload and try again.",
      } as const;
    const changes: Record<string, unknown> = {};
    const words: string[] = [];
    let newAssignee: number | null = null;
    if (input.action === "EDIT") {
      if (input.title !== undefined && input.title.trim() !== ticket.title) {
        const title = input.title.trim();
        if (title.length < 3 || title.length > 200)
          return {
            error: "Write a subject of 3 to 200 characters.",
            field: "title",
          } as const;
        changes.title = title;
        words.push("the subject");
      }
      if (input.description !== undefined && input.description.trim() !== (ticket.description ?? "")) {
        const description = input.description.trim();
        if (description.length < 3 || description.length > 20000)
          return {
            error: "Describe it in 3 to 20,000 characters.",
            field: "description",
          } as const;
        changes.description = description;
        words.push("the description");
      }
      if (input.priority !== undefined && input.priority !== ticket.priority) {
        if (!(TICKET_PRIORITIES as readonly string[]).includes(input.priority)) return { error: "Choose a priority.", field: "priority" } as const;
        changes.priority = input.priority;
        words.push("the priority");
      }
      if (input.requiredOn !== undefined && input.requiredOn !== (ticket.requiredOn ?? "")) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(input.requiredOn))
          return {
            error: "Choose a valid date.",
            field: "requiredOn",
          } as const;
        changes.required_on = input.requiredOn;
        words.push("the required date");
      }
      if (!words.length) return { error: "Nothing was changed." } as const;
    } else if (input.action === "REASSIGN") {
      if (ticket.status === "CLOSED") return { error: "Reopen the ticket first." } as const;
      const [people] = await db.query<RowDataPacket[]>("SELECT id, name FROM users WHERE id = ? AND active = TRUE AND is_break_glass = FALSE", [input.assigneeId]);
      if (!people[0])
        return {
          error: "Choose an active person.",
          field: "assigneeId",
        } as const;
      const due = dueFromDay(input.targetDay);
      if (!due) return { error: "Choose a target date.", field: "targetDay" } as const;
      Object.assign(changes, {
        assignee_id: input.assigneeId,
        due_at: due,
        assigned_at: new Date(),
        status: ticket.status === "NEW" || ticket.status === "REOPENED" ? "ASSIGNED" : ticket.status,
      });
      if (!ticket.firstResponseAt) changes.first_response_at = new Date();
      newAssignee = input.assigneeId;
      words.push(`assigned it to ${String(people[0].name)}, target ${input.targetDay}`);
    } else if (input.action === "REOPEN") {
      if (ticket.status !== "CLOSED") return { error: "Only a closed ticket is reopened." } as const;
      Object.assign(changes, {
        status: "REOPENED",
        reopen_count: ticket.reopenCount + 1,
        closed_at: null,
        close_kind: null,
        close_reason: null,
        confirmation_requested_at: null,
        confirm_due_on: null,
      });
      words.push("reopened it");
    } else {
      if (input.status === ticket.status) return { error: "It already has that status." } as const;
      if (input.status === "IN_PROGRESS") {
        if (!ticket.assigneeId) return { error: "Assign it first." } as const;
        Object.assign(changes, {
          status: "IN_PROGRESS",
          closed_at: null,
          close_kind: null,
          close_reason: null,
          confirmation_requested_at: null,
          confirm_due_on: null,
        });
      } else {
        Object.assign(changes, {
          status: "CLOSED",
          closed_at: new Date(),
          close_kind: null,
          close_reason: "Closed by Super Admin",
          confirmation_requested_at: null,
          confirm_due_on: null,
        });
      }
      words.push(`the status (${TICKET_STATUS_LABEL[ticket.status]} → ${TICKET_STATUS_LABEL[input.status]})`);
    }
    if (!(await updateTicket(ticket.id, ticket.rowVersion, changes, db)))
      return {
        error: "Someone changed this ticket while you were looking. Reload and try again.",
      } as const;
    const summary = input.action === "EDIT" ? `changed ${words.join(", ")}` : words[0]!;
    await appendTicketEvent(
      ticket.id,
      {
        actorId: actor.id,
        action: "SUPER_ADMIN_OVERRIDE",
        from: ticket.status,
        to: (changes.status as string | undefined) ?? ticket.status,
        detail: {
          reason: `${summary}. Reason: ${reason}`,
          override: input.action,
          why: reason,
        },
      },
      db,
    );
    await recordAudit(
      {
        actorUserId: actor.id,
        action: "TICKET_SUPER_ADMIN_OVERRIDE",
        entityType: "TICKET",
        entityId: ticket.id,
        sessionId: actor.sessionId ?? null,
        ipAddress: actor.ipAddress ?? null,
        metadata: {
          ticketNo: ticket.ticketNo,
          override: input.action,
          reason,
          fields: Object.keys(changes),
        },
      },
      db,
    );
    const info = {
      id: ticket.id,
      ticketNo: ticket.ticketNo,
      title: (changes.title as string | undefined) ?? ticket.title,
    };
    const what = `changed by Super Admin: ${summary} (reason: ${reason})`;
    const people = new Set(
      [ticket.requesterId, ticket.assigneeId, newAssignee, ...(await coordinatorsOf(ticket.typeId, db)).map((person) => person.id)].filter(
        (userId): userId is number => userId !== null && userId !== actor.id,
      ),
    );
    const messages: NotifyInput[] = [...people].map((userId) => (userId === newAssignee ? ticketMessages.assigned(info, userId, "Super Admin") : ticketMessages.updated(info, userId, what)));
    messages.push(...(await forCollaborators(ticket.id, people, actor.id, (userId) => ticketMessages.updated(info, userId, what), db)));
    return { outbox: await insertOutbox(null, messages, db) } as const;
  });
  if ("error" in outcome) return fail(outcome.error!, "field" in outcome && outcome.field ? { [outcome.field]: outcome.error! } : undefined);
  await send(outcome.outbox);
  return {
    ok: true,
    value: undefined,
    message: "Changed. The ticket's timeline shows it as changed by Super Admin.",
  };
}
