import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { afterResponse } from "@/lib/http/after-response";
import { withTransaction } from "@/lib/db/transaction";
import { appendEvents, findWorkflowVersion, lockRequest, saveRequestState, syncTasks } from "@/lib/db/repositories/approvals.repository";
import { markRequestDeleted } from "@/lib/db/repositories/request-admin.repository";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import { loadWorkingCalendar } from "@/lib/db/repositories/calendar.repository";
import { cancelForDeletion } from "@/server/engine";
import { deliverOutbox, queueMessages, type Actor, type Result } from "@/server/approvals/service";
import { isHeld } from "@/server/ops/governance";
import { mirrorWorkTasks, WORK_MIRROR_KEY } from "@/server/approvals/work-mirror";
import { withdrawOpenConsultations } from "@/lib/db/repositories/consult.repository";
import { insertBinEntry } from "@/lib/db/repositories/superadmin-bin.repository";
import { binTaskRows } from "@/server/superadmin/control/bin-tasks";

// Super Admin deletes a request (S11-08, D-086, F-73). Soft delete: hidden
// from every screen, queue, job and report; the row, timeline and audit log
// stay. An open request is first closed through the engine (audit R-04), so
// its saved state and its task rows agree, and the approvers waiting on it
// and the requester are told. v1.94.0 (D-454): it goes into the Super Admin
// bin, so it can be restored (as cancelled) or deleted permanently after 30 days.
export async function deleteRequest(
  input: { requestId: number; reason: string },
  actor: Actor & { sessionId?: string | null; ipAddress?: string | null },
): Promise<Result<{ requestNo: string; cancelledTasks: number }>> {
  if (!actor.roles.includes("SUPER_ADMIN")) return { ok: false, code: "NOT_FOUND", message: "Not found." };
  const reason = input.reason.trim();
  if (reason.length < 5) return { ok: false, code: "REASON_REQUIRED", message: "Give a reason of at least 5 characters.", fieldErrors: { reason: "Give a reason of at least 5 characters." } };
  const done = await withTransaction(async (db) => {
    const request = await lockRequest(input.requestId, db);
    if (!request) return { ok: false, code: "NOT_FOUND", message: "This request doesn't exist or was already deleted." } as const;
    // FN10: a legal hold blocks deletion, for everyone.
    if (await isHeld(request.id, db)) return { ok: false, code: "LEGAL_HOLD", message: "This request is under a legal hold and can't be deleted. Release the hold first (Super Admin → Retention & holds)." } as const;
    const version = await findWorkflowVersion(request.workflowVersionId, db);
    const result = cancelForDeletion(request.state, { actorId: actor.id, reason: reason.slice(0, 500) });
    if (result.state !== request.state) {
      await saveRequestState(request.id, request.stateVersion, result.state, null, db);
      await syncTasks(request.id, result.state, version?.definition.nodes ?? [], db, await loadWorkingCalendar(db));
      await mirrorWorkTasks(request.id, db);
    }
    await appendEvents(request.id, result.events, actor.id, db);
    await markRequestDeleted(request.id, actor.id, reason.slice(0, 500), db);
    // v1.94.0 (D-454, owner: "Bin, then purge"): the request goes into the
    // Super Admin "Deleted items" bin (restorable; Delete permanently after
    // 30 days), with the work-step tasks that belong to it.
    const binId = await insertBinEntry({ entityType: "REQUEST", entityId: request.id, entityNo: request.requestNo, title: request.title, detail: { status: request.status, wasOpen: result.state !== request.state }, reason, binnedBy: actor.id }, db);
    const [steps] = await db.query<RowDataPacket[]>(`SELECT id FROM tasks WHERE related_request_id = ? AND deleted_at IS NULL AND JSON_EXTRACT(form_data_json, '$.${WORK_MIRROR_KEY}') IS NOT NULL ORDER BY depth DESC, id`, [request.id]);
    await binTaskRows(steps.map((row) => Number(row.id)), { actorId: actor.id, reason, parentBinId: binId }, db);
    // v1.57.6 (D-347, owner): "withdraw on close": a deleted request's open advice questions are withdrawn, in this transaction.
    await withdrawOpenConsultations(request.id, db);
    const event = result.events[0] as { closedTaskIds: string[] };
    const [names] = await db.query<(RowDataPacket & { name: string })[]>("SELECT name FROM users WHERE id = ?", [request.requesterId]);
    const outboxIds = await queueMessages(
      { request: { ...request, state: result.state, status: result.state.status }, events: result.events, requesterName: names[0]?.name ?? "Someone", nodes: version?.definition.nodes ?? [] },
      db,
    );
    await recordAudit(
      {
        actorUserId: actor.id,
        action: "REQUEST_DELETED",
        entityType: "REQUEST",
        entityId: request.id,
        sessionId: actor.sessionId ?? null,
        ipAddress: actor.ipAddress ?? null,
        metadata: { requestNo: request.requestNo, title: request.title, status: request.status, requesterId: request.requesterId, reason, cancelledTasks: event.closedTaskIds.length },
      },
      db,
    );
    return { ok: true, value: { requestNo: request.requestNo, cancelledTasks: event.closedTaskIds.length }, outboxIds } as const;
  });
  if (!done.ok) return done;
  await afterResponse("request deleted messages", () => deliverOutbox(done.outboxIds));
  return { ok: true, value: done.value };
}
