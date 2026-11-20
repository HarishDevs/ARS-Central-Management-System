import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import { findRequest, findWorkflowVersion, listPendingTasksFor, listSentBackFor } from "@/lib/db/repositories/approvals.repository";
import { changeDetailsAsApprover, decideTask, resubmitRequest, submitCustomRequest, type Actor } from "@/server/approvals/service";
import type { BuilderSpec } from "@/server/workflows/builder";
import { createUser, pendingTaskKey } from "./helpers";

// v1.59.0 against MySQL: an approver changes the details from Waiting for me
// (D-357), and what they sent back for changes stays on their list (D-356).
const person = (id: number): Actor => ({ id, roles: ["USER"] });
const step = (id: string, label: string, userIds: number[]) => ({ kind: "STEP" as const, step: { id, label, approvers: { kind: "PEOPLE" as const, userIds }, rule: "ALL" as const } });

let requester: number;
let first: number;
let second: number;
let third: number;
let junior: number;

beforeAll(async () => {
  requester = await createUser({ name: "Raiser 1590", approver: false });
  first = await createUser({ name: "First 1590" });
  second = await createUser({ name: "Second 1590" });
  third = await createUser({ name: "Third 1590" });
  junior = await createUser({ name: "Junior 1590", approver: false });
});

afterAll(async () => {
  await getDbPool().end();
});

async function raised(): Promise<number> {
  const builder: BuilderSpec = { stages: [step("l1", "Manager", [first]), step("l2", "HOD", [second])] };
  const submitted = await submitCustomRequest({ title: `Laptops ${Date.now().toString(36)}`, builder, fields: { details: "Two laptops", amount: "100" } }, person(requester));
  if (!submitted.ok) throw new Error(submitted.message);
  const requestId = submitted.value.requestId;
  expect((await decideTask({ requestId, taskKey: await pendingTaskKey(requestId, first), decision: "APPROVE" }, person(first))).ok).toBe(true);
  return requestId;
}

describe("the approver it waits on changes the details (D-357)", () => {
  it("new values and a new level: a new round, earlier approval kept, the level after theirs follows the new route", async () => {
    const requestId = await raised();
    const taskKey = await pendingTaskKey(requestId, second);
    const changed = await changeDetailsAsApprover(
      { requestId, taskKey, reason: "Price confirmed by stores", fields: { details: "Two laptops", amount: "250" }, levels: [{ key: "new", label: "Finance", userIds: [third], rule: "ALL" }] },
      person(second),
    );
    expect(changed).toMatchObject({ ok: true });
    const request = (await findRequest(requestId))!;
    expect(request.round).toBe(2);
    expect(request.formData.amount).toBe(250);
    expect(request.state.nodes.step_l1!.status).toBe("APPROVED");
    const version = (await findWorkflowVersion(request.workflowVersionId))!;
    expect(version.builder!.stages.map((stage) => (stage.kind === "STEP" ? stage.step.label : stage.label))).toEqual(["Manager", "HOD", "Finance"]);
    // Their approval starts again on the new values, then the new level follows.
    const again = await pendingTaskKey(requestId, second);
    expect(again).not.toBe(taskKey);
    expect((await decideTask({ requestId, taskKey: again, decision: "APPROVE" }, person(second))).ok).toBe(true);
    expect((await listPendingTasksFor(third)).some((item) => item.requestId === requestId)).toBe(true);
    // The history, the audit log and the revisions say so.
    const [events] = await getDbPool().query<(RowDataPacket & { payload_json: unknown })[]>("SELECT payload_json FROM approval_events WHERE request_id = ? AND event_type = 'DETAILS_CHANGED'", [requestId]);
    const payload = typeof events[0]!.payload_json === "string" ? JSON.parse(events[0]!.payload_json) : events[0]!.payload_json;
    expect(payload).toMatchObject({ fieldKeys: ["amount"], levelsChanged: true, reason: "Price confirmed by stores", earlierApproverIds: [first] });
    const [audit] = await getDbPool().query<RowDataPacket[]>("SELECT 1 FROM audit_logs WHERE action = 'REQUEST_DETAILS_CHANGED' AND entity_id = ?", [requestId]);
    expect(audit).toHaveLength(1);
    const [revisions] = await getDbPool().query<RowDataPacket[]>("SELECT round FROM request_revisions WHERE request_id = ? ORDER BY round", [requestId]);
    expect(revisions.map((row) => row.round)).toEqual([1, 2]);
  });

  it("levels only: nothing restarts", async () => {
    const requestId = await raised();
    const taskKey = await pendingTaskKey(requestId, second);
    expect(await changeDetailsAsApprover({ requestId, taskKey, reason: "Add finance", levels: [{ key: "new", label: "Finance", userIds: [third], rule: "ALL" }] }, person(second))).toMatchObject({ ok: true });
    const request = (await findRequest(requestId))!;
    expect(request.round).toBe(1);
    expect(await pendingTaskKey(requestId, second)).toBe(taskKey);
  });

  it("refuses: someone else, the requester or a non-approver as a new approver, no reason, nothing changed", async () => {
    const requestId = await raised();
    const taskKey = await pendingTaskKey(requestId, second);
    const base = { requestId, taskKey, reason: "Because" };
    expect(await changeDetailsAsApprover({ ...base, fields: { details: "x", amount: "1" } }, person(first))).toMatchObject({ ok: false, code: "NOT_AUTHORISED" });
    expect(await changeDetailsAsApprover({ ...base, levels: [{ key: "new", label: "Back to me", userIds: [requester], rule: "ALL" }] }, person(second))).toMatchObject({ ok: false });
    expect(await changeDetailsAsApprover({ ...base, levels: [{ key: "new", label: "Junior", userIds: [junior], rule: "ALL" }] }, person(second))).toMatchObject({ ok: false });
    expect(await changeDetailsAsApprover({ ...base, reason: " ", fields: { details: "x", amount: "1" } }, person(second))).toMatchObject({ ok: false, code: "COMMENT_REQUIRED" });
    expect(await changeDetailsAsApprover({ ...base, fields: { details: "Two laptops", amount: "100" } }, person(second))).toMatchObject({ ok: false, code: "INVALID_ACTION" });
    expect((await findRequest(requestId))!.round).toBe(1);
  });
});

describe("sent back for changes stays on the approver's list (D-356)", () => {
  it("shows while the requester has it, and goes once it is resubmitted", async () => {
    const requestId = await raised();
    expect((await decideTask({ requestId, taskKey: await pendingTaskKey(requestId, second), decision: "REQUEST_CHANGES", comment: "Attach the quote" }, person(second))).ok).toBe(true);
    const mine = (await listSentBackFor(second)).find((item) => item.requestId === requestId);
    expect(mine).toMatchObject({ nodeLabel: "HOD", reason: "Attach the quote", requesterName: "Raiser 1590" });
    expect((await listSentBackFor(first)).some((item) => item.requestId === requestId)).toBe(false);
    expect((await resubmitRequest({ requestId }, person(requester))).ok).toBe(true);
    expect((await listSentBackFor(second)).some((item) => item.requestId === requestId)).toBe(false);
    expect((await listPendingTasksFor(second)).some((item) => item.requestId === requestId)).toBe(true);
  });
});
