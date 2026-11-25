import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import * as work from "@/server/work/service";
import * as more from "@/server/work/service-more";
import { findTask } from "@/lib/db/repositories/tasks.repository";
import { bulkApprove, BULK_MAX } from "@/server/approvals/bulk";
import { createWorkflow, publishVersion, submitRequest, type Actor } from "@/server/approvals/service";
import type { WorkflowDefinition } from "@/server/engine";
import { indiaDate } from "@/server/workflows/calendar";
import { createUser, pendingTaskKey } from "./helpers";

// v1.90.0: the owner's requests of 25 Nov 2026.
const tag = Date.now().toString(36);
const who = (id: number) => ({ id, name: `P${id}`, roles: ["USER"] });
let owner: number;

async function sql<T = RowDataPacket>(query: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await getDbPool().query<RowDataPacket[]>(query, params);
  return rows as T[];
}
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);
// The live (not deleted) tasks of a series other than `id`.
const liveNext = (id: number) => sql<{ id: number; recurrence_json: unknown; status: string }>("SELECT id, recurrence_json, status FROM tasks WHERE series_id = ? AND id <> ? AND deleted_at IS NULL ORDER BY id", [id, id]);

beforeAll(async () => {
  owner = await createUser({ name: `Periodic owner ${tag}` });
});
afterAll(async () => {
  await getDbPool().end();
});

// D-428, owner: "after completing a task, if we click on Undo and then complete
// the same task again, the task for the next day is not being created".
describe("repeating task: Complete → Undo → Complete (D-428)", () => {
  async function dailyTask(title: string): Promise<number> {
    const added = await work.quickAddTask({ title: `${title} ${tag}`, projectId: null, sectionId: null, parentId: null, assigneeId: null, dueDay: day(2), mySectionId: null }, who(owner));
    expect(added.ok).toBe(true);
    const id = added.ok ? added.value.id : 0;
    expect((await more.setRecurrence(id, { kind: "DAILY", every: 1 }, who(owner))).ok).toBe(true);
    return id;
  }

  it("Undo takes back the untouched next task and the repeat; completing again makes the next day's task, once", async () => {
    const id = await dailyTask("Daily report");
    expect((await work.toggleComplete(id, who(owner))).ok).toBe(true);
    const first = await liveNext(id);
    expect(first).toHaveLength(1);
    const firstNext = Number(first[0]!.id);

    // Undo (the toast's Undo reopens the task).
    expect((await work.toggleComplete(id, who(owner))).ok).toBe(true);
    expect((await findTask(id))!.status).toBe("OPEN");
    expect(await more.recurrenceOf(id)).toMatchObject({ kind: "DAILY" }); // it repeats again (before the fix: null)
    expect(await liveNext(id)).toHaveLength(0); // the untouched next task went
    const removed = (await findTask(firstNext))!;
    expect(removed.deletedAt).not.toBeNull();
    const [audit] = await sql<{ n: number }>("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'TASK_RECURRENCE_UNDONE' AND entity_id = ?", [String(id)]);
    expect(Number(audit!.n)).toBe(1);

    // Complete again: the next day's task is made (before the fix: none).
    expect((await work.toggleComplete(id, who(owner))).ok).toBe(true);
    const second = await liveNext(id);
    expect(second).toHaveLength(1);
    expect(Number(second[0]!.id)).not.toBe(firstNext);
    expect(second[0]!.status).toBe("OPEN");
    expect(indiaDate((await findTask(Number(second[0]!.id)))!.dueAt!)).toBe(day(3)); // the same next day as the first time, not the day after
    expect(await more.recurrenceOf(Number(second[0]!.id))).toMatchObject({ kind: "DAILY" });
    expect(await more.recurrenceOf(id)).toBeNull();
  });

  it("a next task someone touched stays; completing again makes no second one (never a duplicate)", async () => {
    const id = await dailyTask("Daily check");
    await work.toggleComplete(id, who(owner));
    const [next] = await liveNext(id);
    expect((await work.addComment(Number(next!.id), "Started on this", null, who(owner))).ok).toBe(true);

    await work.toggleComplete(id, who(owner)); // Undo
    expect(await liveNext(id)).toHaveLength(1); // kept: it has a comment
    expect(await more.recurrenceOf(id)).toBeNull(); // the repeat stays with it
    await work.toggleComplete(id, who(owner)); // complete again
    const after = await liveNext(id);
    expect(after.map((row) => Number(row.id))).toEqual([Number(next!.id)]);
    expect(await more.recurrenceOf(Number(next!.id))).toMatchObject({ kind: "DAILY" });
  });

  it("Undo twice in a row and a task that doesn't repeat behave as before", async () => {
    const id = await dailyTask("Daily twice");
    for (let round = 0; round < 3; round += 1) {
      await work.toggleComplete(id, who(owner)); // complete
      await work.toggleComplete(id, who(owner)); // undo
    }
    expect(await liveNext(id)).toHaveLength(0);
    expect(await more.recurrenceOf(id)).toMatchObject({ kind: "DAILY" });
    await work.toggleComplete(id, who(owner));
    expect(await liveNext(id)).toHaveLength(1);

    const plain = await work.quickAddTask({ title: `One-off ${tag}`, projectId: null, sectionId: null, parentId: null, assigneeId: null, dueDay: day(2), mySectionId: null }, who(owner));
    const plainId = plain.ok ? plain.value.id : 0;
    await work.toggleComplete(plainId, who(owner));
    expect((await work.toggleComplete(plainId, who(owner))).ok).toBe(true);
    expect((await findTask(plainId))!.status).toBe("OPEN");
  });
});

// D-429, owner: "In Waiting for me page in the table itself I want select and bulk approval option".
describe("bulk approve from Waiting for me (D-429)", () => {
  let approver: number;
  let raiser: number;
  let itAdmin: Actor;
  let counter = 0;
  const chain = (...nodes: WorkflowDefinition["nodes"]): WorkflowDefinition => {
    const all = [{ id: "start", kind: "START", label: "Start" } as const, ...nodes, { id: "end", kind: "END", label: "End" } as const];
    return { nodes: all, edges: all.slice(1).map((node, index) => ({ id: `e${index}`, from: all[index]!.id, to: node.id })) };
  };
  const simple = (userId: number) => chain({ id: "a", kind: "APPROVAL", label: "A", approvers: [{ type: "USER", userId }], completion: { type: "ALL" } });
  async function raise(definition: WorkflowDefinition, by: number): Promise<number> {
    const created = await createWorkflow({ code: `V190_${Date.now()}_${++counter}`, name: "Bulk v1.90", kind: "PREDEFINED", requestPrefix: "BV", definition }, itAdmin);
    if (!created.ok) throw new Error(created.message);
    await publishVersion(created.value.versionId, itAdmin);
    const submitted = await submitRequest({ workflowId: created.value.workflowId, title: `Bulk v1.90 ${counter}`, fields: {}, allowDuplicate: true }, { id: by, roles: ["USER"] });
    if (!submitted.ok) throw new Error(submitted.message);
    return submitted.value.requestId;
  }
  beforeAll(async () => {
    approver = await createUser({ name: `Bulk190 Approver ${tag}` });
    raiser = await createUser({ name: `Bulk190 Raiser ${tag}` });
    const admin = await createUser({ roles: ["USER", "IT_ADMIN"] });
    itAdmin = { id: admin, roles: ["USER", "IT_ADMIN"] };
  });

  it("approves each through the engine with the shared comment, audited one by one", async () => {
    const ids = [await raise(simple(approver), raiser), await raise(simple(approver), raiser)];
    const items = await Promise.all(ids.map(async (requestId) => ({ requestId, taskKey: await pendingTaskKey(requestId, approver) })));
    const outcomes = await bulkApprove(items, { id: approver, roles: ["USER"] }, "Checked in the weekly review");
    expect(outcomes.map((outcome) => outcome.result)).toEqual(["APPROVED", "APPROVED"]);
    const decided = await sql<{ n: number }>("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'REQUEST_DECIDED' AND entity_id IN (?)", [ids.map(String)]);
    expect(Number(decided[0]!.n)).toBe(2);
    const comments = await sql<{ state_json: unknown }>("SELECT state_json FROM approval_requests WHERE id IN (?)", [ids]);
    for (const row of comments) expect(JSON.stringify(row.state_json)).toContain("Checked in the weekly review");
  });

  it("skips the person's own request with a reason (approve never decides it)", async () => {
    // The approver raised it and is (wrongly) also its approver: the engine never lets it be approved.
    const own = await raise(simple(approver), approver);
    const [row] = await sql<{ task_key: string }>("SELECT task_key FROM approval_tasks WHERE request_id = ? ORDER BY id DESC LIMIT 1", [own]);
    const [outcome] = await bulkApprove([{ requestId: own, taskKey: row?.task_key ?? "t1" }], { id: approver, roles: ["USER"] });
    expect(outcome!.result).not.toBe("APPROVED");
    const [request] = await sql<{ status: string }>("SELECT status FROM approval_requests WHERE id = ?", [own]);
    expect(request!.status).not.toBe("APPROVED");
  });

  it("takes at most 50 at a time", () => {
    expect(BULK_MAX).toBe(50);
  });
});
