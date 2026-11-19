import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import { createWorkflow, decideTask, publishVersion, submitRequest, withdrawRequest, type Actor } from "@/server/approvals/service";
import { answerConsultation, consult } from "@/server/approvals/consult";
import { deleteRequest } from "@/server/approvals/delete";
import type { WorkflowDefinition } from "@/server/engine";
import { createUser, pendingTaskKey } from "./helpers";

// v1.57.6 (D-347, owner): approval state gaps on real MySQL.
// Risk 9 "withdraw on close": open advice questions end with the request.
// Risk 4 "lock and check": the work-step task is written under its row lock with its row_version.
const user = (id: number): Actor => ({ id, roles: ["USER"] });
const itAdmin = (id: number): Actor => ({ id, roles: ["USER", "IT_ADMIN"] });
const superAdmin = (id: number): Actor => ({ id, roles: ["USER", "IT_ADMIN", "SUPER_ADMIN"] });

let adminId: number;
let mgr: number;
let worker: number;
let raiser: number;
let colleague: number;
let counter = 0;

beforeAll(async () => {
  adminId = await createUser({ name: "V1576 Admin", roles: ["USER", "IT_ADMIN", "SUPER_ADMIN"] });
  mgr = await createUser({ name: "V1576 Manager" });
  worker = await createUser({ name: "V1576 Worker" });
  raiser = await createUser({ name: "V1576 Raiser" });
  colleague = await createUser({ name: "V1576 Colleague" });
});

afterAll(async () => {
  await getDbPool().end();
});

function definition(withWork: boolean): WorkflowDefinition {
  const nodes: WorkflowDefinition["nodes"] = [
    { id: "start", kind: "START", label: "Start" },
    { id: "mgr", kind: "APPROVAL", label: "Manager", approvers: [{ type: "USER", userId: mgr }], completion: { type: "ALL" } },
    ...(withWork ? [{ id: "work", kind: "APPROVAL" as const, label: "Fit the part", approvers: [{ type: "USER" as const, userId: worker }], completion: { type: "ALL" as const }, mode: "WORK" as const }] : []),
    { id: "end", kind: "END", label: "End" },
  ];
  const ids = nodes.map((node) => node.id);
  return { nodes, edges: ids.slice(1).map((to, index) => ({ id: `e${index}`, from: ids[index]!, to })) };
}

async function raise(withWork = false): Promise<number> {
  counter += 1;
  const created = await createWorkflow({ code: `V1576_${Date.now().toString(36)}_${counter}`.toUpperCase(), name: "V1576", kind: "PREDEFINED", requestPrefix: "VS", definition: definition(withWork) }, itAdmin(adminId));
  if (!created.ok) throw new Error(created.message);
  const published = await publishVersion(created.value.versionId, itAdmin(adminId));
  if (!published.ok) throw new Error(published.message);
  const submitted = await submitRequest({ workflowId: created.value.workflowId, title: `States ${counter}`, fields: {}, allowDuplicate: true }, user(raiser));
  if (!submitted.ok) throw new Error(submitted.message);
  return submitted.value.requestId;
}

async function askAdvice(requestId: number): Promise<number> {
  const asked = await consult({ requestId, consulteeId: colleague, question: "Is this a fair price?" }, user(mgr));
  if (!asked.ok) throw new Error(asked.message);
  return asked.value.id;
}

const consultationStatus = async (id: number) => {
  const [[row]] = await getDbPool().query<RowDataPacket[]>("SELECT status FROM consultations WHERE id = ?", [id]);
  return String(row!.status);
};

describe("withdraw on close (Risk 9)", () => {
  it("an open consultation becomes WITHDRAWN when its request is approved, and answering it is refused", async () => {
    const id = await raise();
    const asked = await askAdvice(id);
    expect(await consultationStatus(asked)).toBe("OPEN");
    expect((await decideTask({ requestId: id, taskKey: await pendingTaskKey(id, mgr), decision: "APPROVE" }, user(mgr))).ok).toBe(true);
    expect(await consultationStatus(asked)).toBe("WITHDRAWN");
    const answered = await answerConsultation({ consultationId: asked, answer: "Yes" }, user(colleague));
    expect(answered).toMatchObject({ ok: false, code: "WITHDRAWN" });
    expect(await consultationStatus(asked)).toBe("WITHDRAWN");
  });

  it("an open consultation becomes WITHDRAWN when the requester withdraws; an answered one stays answered", async () => {
    const id = await raise();
    const first = await askAdvice(id);
    expect((await answerConsultation({ consultationId: first, answer: "Market rate" }, user(colleague))).ok).toBe(true);
    const second = await askAdvice(id);
    expect((await withdrawRequest({ requestId: id, reason: "Not needed" }, user(raiser))).ok).toBe(true);
    expect(await consultationStatus(first)).toBe("ANSWERED");
    expect(await consultationStatus(second)).toBe("WITHDRAWN");
    expect(await answerConsultation({ consultationId: second, answer: "Late" }, user(colleague))).toMatchObject({ ok: false, code: "WITHDRAWN" });
  });

  it("an open consultation becomes WITHDRAWN when the request is deleted", async () => {
    const id = await raise();
    const asked = await askAdvice(id);
    expect((await deleteRequest({ requestId: id, reason: "Raised by mistake" }, superAdmin(adminId))).ok).toBe(true);
    expect(await consultationStatus(asked)).toBe("WITHDRAWN");
  });
});

describe("lock and check on the work-step task (Risk 4)", () => {
  it("completes the work-step task with row_version bumped and a COMPLETE task event", async () => {
    const id = await raise(true);
    expect((await decideTask({ requestId: id, taskKey: await pendingTaskKey(id, mgr), decision: "APPROVE" }, user(mgr))).ok).toBe(true);
    const [[before]] = await getDbPool().query<RowDataPacket[]>(
      "SELECT id, status, row_version, assignee_id FROM tasks WHERE related_request_id = ? AND JSON_EXTRACT(form_data_json, '$.__approvalWork') IS NOT NULL",
      [id],
    );
    expect(before).toMatchObject({ status: "OPEN", assignee_id: worker });
    const done = await decideTask({ requestId: id, taskKey: await pendingTaskKey(id, worker), decision: "APPROVE", comment: "Fitted" }, user(worker));
    expect(done).toEqual({ ok: true, value: { status: "APPROVED" } });
    const [[after]] = await getDbPool().query<RowDataPacket[]>("SELECT status, row_version, completed_by, completed_at FROM tasks WHERE id = ?", [before!.id]);
    expect(after).toMatchObject({ status: "COMPLETED", completed_by: worker, row_version: Number(before!.row_version) + 1 });
    expect(after!.completed_at).not.toBeNull();
    const [events] = await getDbPool().query<RowDataPacket[]>("SELECT event_type, from_status, to_status, actor_id FROM task_events WHERE task_id = ? AND event_type = 'COMPLETE'", [before!.id]);
    expect(events).toEqual([expect.objectContaining({ from_status: "OPEN", to_status: "COMPLETED", actor_id: worker })]);
  });
});
