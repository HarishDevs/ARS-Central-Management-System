import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import { decideTask, type Actor } from "@/server/approvals/service";

// Bulk approval (#7, D-111). Each chosen item is approved on its own through
// decideTask: the same lock, version check, engine rules (who may decide,
// no self-approval, DoA levels), timeline, audit and messages as a single
// approval. One failure never affects the others. At most 25 at a time.
// v1.90.0 (D-429, owner: "In Waiting for me page in the table itself I want
// select and bulk approval option"): back on Waiting for me, at most 50 at a
// time; the person's own request is skipped up front (the engine refuses it
// too). Approving in ARS-CMS needs nothing besides the decision (the comment
// is optional, there are no approver-entered fields and no step-up OTP), so
// the skip reasons are: a work task, on hold (or a question waiting), already
// decided or no longer waiting, your own request; anything the engine refuses
// (not yours to decide, already decided this step) comes back as not approved
// with its message.
export const BULK_MAX = 50;
export const BULK_COMMENT_MAX = 2000;

export interface BulkItem {
  requestId: number;
  taskKey: string;
  seenVersion?: number; // v1.90.0 (D-429): the request's state version the page showed
}

export type BulkOutcome = { requestId: number; taskKey: string; requestNo: string | null; result: "APPROVED" | "SKIPPED" | "FAILED"; message: string };

// Only plain approval tasks of open requests qualify: work tasks, requests on
// hold or sent back, and anything not pending are left for one-by-one action.
async function eligibility(item: BulkItem, actorId: number): Promise<{ ok: true; requestNo: string } | { ok: false; requestNo: string | null; message: string }> {
  const [rows] = await getDbPool().query<(RowDataPacket & { request_no: string; status: string; task_status: string; task_type: string; requester_id: number })[]>(
    `SELECT r.request_no, r.status, r.requester_id, t.status AS task_status, t.task_type FROM approval_tasks t JOIN approval_requests r ON r.id = t.request_id
     WHERE t.request_id = ? AND t.task_key = ? AND r.deleted_at IS NULL ORDER BY t.id DESC LIMIT 1`,
    [item.requestId, item.taskKey],
  );
  const row = rows[0];
  if (!row) return { ok: false, requestNo: null, message: "Not found." };
  if (row.task_status !== "PENDING") return { ok: false, requestNo: row.request_no, message: "Already decided." };
  if (row.task_type !== "APPROVAL") return { ok: false, requestNo: row.request_no, message: "A work task: open it and mark it done." };
  if (row.status !== "IN_PROGRESS") return { ok: false, requestNo: row.request_no, message: row.status === "ON_HOLD" ? "On hold: resume it first." : "No longer waiting for approval." };
  if (Number(row.requester_id) === actorId) return { ok: false, requestNo: row.request_no, message: "Your own request: someone else approves it." };
  return { ok: true, requestNo: row.request_no };
}

export async function bulkApprove(items: readonly BulkItem[], actor: Actor, comment?: string): Promise<BulkOutcome[]> {
  // One per request and step (a double submit can't approve twice: each runs under the request's lock and the engine refuses a decided step).
  const unique = [...new Map(items.map((item) => [`${item.requestId}:${item.taskKey}`, item])).values()].slice(0, BULK_MAX);
  const outcomes: BulkOutcome[] = [];
  for (const item of unique) {
    const check = await eligibility(item, actor.id);
    if (!check.ok) {
      outcomes.push({ requestId: item.requestId, taskKey: item.taskKey, requestNo: check.requestNo, result: "SKIPPED", message: check.message });
      continue;
    }
    try {
      const result = await decideTask({ requestId: item.requestId, taskKey: item.taskKey, decision: "APPROVE", comment, expectedStateVersion: item.seenVersion }, actor);
      // A request that changed since the page was loaded is skipped (stale), not failed.
      outcomes.push({ requestId: item.requestId, taskKey: item.taskKey, requestNo: check.requestNo, result: result.ok ? "APPROVED" : !result.ok && result.code === "STALE" ? "SKIPPED" : "FAILED", message: result.ok ? "Approved." : result.message });
    } catch {
      outcomes.push({ requestId: item.requestId, taskKey: item.taskKey, requestNo: check.requestNo, result: "FAILED", message: "Something went wrong with this one. Try it on its own." });
    }
  }
  return outcomes;
}
