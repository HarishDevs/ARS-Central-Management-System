import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import { bulkApprove } from "@/server/approvals/bulk";
import { createWorkflow, publishVersion, submitRequest, type Actor } from "@/server/approvals/service";
import type { WorkflowDefinition } from "@/server/engine";
import { createUser, pendingTaskKey } from "./helpers";

// v1.90.0 (D-429; governance addendum D-432 §3 and §4.1): bulk Approve on
// Waiting for me. The server action called directly (no UI) as different
// people, a double submit and two tabs at once, and a stale page.
const session = vi.hoisted(() => ({ user: null as null | { id: number; roles: readonly string[] } }));
vi.mock("@/server/authorization/guards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/authorization/guards")>()),
  requireApiArea: async () => {
    if (!session.user) throw new Error("UNAUTHENTICATED");
    return { user: session.user };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
const { bulkApproveAction } = await import("@/app/users/actions");

let approver: number;
let raiser: number;
let stranger: number;
let itAdmin: Actor;
let counter = 0;
const chain = (...nodes: WorkflowDefinition["nodes"]): WorkflowDefinition => {
  const all = [{ id: "start", kind: "START", label: "Start" } as const, ...nodes, { id: "end", kind: "END", label: "End" } as const];
  return { nodes: all, edges: all.slice(1).map((node, index) => ({ id: `e${index}`, from: all[index]!.id, to: node.id })) };
};
async function raise(): Promise<number> {
  const definition = chain({ id: "a", kind: "APPROVAL", label: "A", approvers: [{ type: "USER", userId: approver }], completion: { type: "ALL" } }, { id: "b", kind: "APPROVAL", label: "B", approvers: [{ type: "USER", userId: approver }], completion: { type: "ALL" } });
  const created = await createWorkflow({ code: `V190A_${Date.now()}_${++counter}`, name: "Bulk action", kind: "PREDEFINED", requestPrefix: "BA", definition }, itAdmin);
  if (!created.ok) throw new Error(created.message);
  await publishVersion(created.value.versionId, itAdmin);
  const submitted = await submitRequest({ workflowId: created.value.workflowId, title: `Bulk action ${counter}`, fields: {}, allowDuplicate: true }, { id: raiser, roles: ["USER"] });
  if (!submitted.ok) throw new Error(submitted.message);
  return submitted.value.requestId;
}
const stateVersion = async (id: number) => Number((await getDbPool().query<RowDataPacket[]>("SELECT state_version FROM approval_requests WHERE id = ?", [id]))[0][0]!.state_version);
const decidedCount = async (id: number) => Number((await getDbPool().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'REQUEST_DECIDED' AND entity_id = ?", [String(id)]))[0][0]!.n);
const key = async (id: number) => `${id}:${await pendingTaskKey(id, approver)}:${await stateVersion(id)}`;

beforeAll(async () => {
  approver = await createUser({ name: "Bulk action approver" });
  raiser = await createUser({ name: "Bulk action raiser" });
  stranger = await createUser({ name: "Bulk action stranger" });
  const admin = await createUser({ roles: ["USER", "IT_ADMIN"] });
  itAdmin = { id: admin, roles: ["USER", "IT_ADMIN"] };
});
afterAll(async () => {
  await getDbPool().end();
});

describe("bulkApproveAction called directly", () => {
  it("refuses without a session", async () => {
    session.user = null;
    expect(await bulkApproveAction(["1:t1"], "")).toEqual({ ok: false, message: "Not found." });
  });

  it("approves nothing for someone who isn't the approver: the requester, a stranger, an IT Admin", async () => {
    const id = await raise();
    const item = await key(id);
    for (const user of [{ id: raiser, roles: ["USER"] }, { id: stranger, roles: ["USER"] }, itAdmin]) {
      session.user = user;
      const result = await bulkApproveAction([item], "");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.outcomes[0]!.result).not.toBe("APPROVED");
    }
    expect(await decidedCount(id)).toBe(0);
  });

  it("the approver approves; the same submit again decides nothing twice", async () => {
    const id = await raise();
    const item = await key(id);
    session.user = { id: approver, roles: ["USER"] };
    const first = await bulkApproveAction([item, item], "Weekly review");
    expect(first.ok && first.outcomes.map((outcome) => outcome.result)).toEqual(["APPROVED"]); // the same item twice counts once
    const again = await bulkApproveAction([item], "Weekly review");
    expect(again.ok && again.outcomes[0]!.result).not.toBe("APPROVED");
    expect(await decidedCount(id)).toBe(1);
  });

  it("two submits at the same moment (two tabs) approve each step once", async () => {
    const ids = [await raise(), await raise(), await raise()];
    const items = await Promise.all(ids.map((id) => key(id)));
    session.user = { id: approver, roles: ["USER"] };
    const [a, b] = await Promise.all([bulkApproveAction(items, ""), bulkApproveAction(items, "")]);
    const approved = [a, b].flatMap((result) => (result.ok ? result.outcomes : [])).filter((outcome) => outcome.result === "APPROVED");
    expect(approved).toHaveLength(3);
    for (const id of ids) expect(await decidedCount(id)).toBe(1);
  });

  it("a request that changed since the page was loaded is skipped as stale, not approved", async () => {
    const id = await raise();
    const taskKey = await pendingTaskKey(id, approver);
    const seen = await stateVersion(id);
    session.user = { id: approver, roles: ["USER"] };
    const result = await bulkApproveAction([`${id}:${taskKey}:${seen - 1}`], "");
    expect(result.ok && result.outcomes[0]).toMatchObject({ result: "SKIPPED", message: expect.stringMatching(/Changed since you loaded/) });
    expect(await decidedCount(id)).toBe(0);
    // The bulk path direct, too.
    const [direct] = await bulkApprove([{ requestId: id, taskKey, seenVersion: seen + 5 }], { id: approver, roles: ["USER"] });
    expect(direct!.result).toBe("SKIPPED");
    expect(await decidedCount(id)).toBe(0);
  });

  it("checks its input: nothing chosen, over 50, a long comment, malformed keys", async () => {
    session.user = { id: approver, roles: ["USER"] };
    expect((await bulkApproveAction([], "")).ok).toBe(false);
    expect(await bulkApproveAction(Array.from({ length: 51 }, (_, index) => `${index + 1}:t1`), "")).toEqual({ ok: false, message: "Approve up to 50 at a time." });
    expect((await bulkApproveAction(["1:t1"], "x".repeat(2001))).ok).toBe(false);
    expect((await bulkApproveAction(["DROP TABLE", "1;t1"], "")).ok).toBe(false);
  });

  it("records the batch in the audit log beside each decision", async () => {
    const [[row]] = await getDbPool().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'APPROVALS_BULK_APPROVED' AND actor_user_id = ?", [approver]);
    expect(Number(row!.n)).toBeGreaterThan(0);
  });
});
