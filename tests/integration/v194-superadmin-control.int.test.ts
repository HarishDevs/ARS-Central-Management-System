import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import { findRequest, listMyRequests, listPendingTasksFor, listTimeline } from "@/lib/db/repositories/approvals.repository";
import { findTicket, listTickets, saveTicketFormSetup } from "@/lib/db/repositories/tickets.repository";
import { purgeTaskCandidates } from "@/lib/db/repositories/pm.repository";
import { listBin } from "@/lib/db/repositories/superadmin-bin.repository";
import { createWorkflow, decideTask, publishVersion, submitCustomRequest, submitRequest, type Actor } from "@/server/approvals/service";
import { addComment } from "@/server/approvals/collab";
import { addCollaborators } from "@/server/approvals/collaborators";
import { createModuleType, publishTypeDraft, saveTypeDraft } from "@/server/modules/config";
import { loadTaskFor, type TaskActor } from "@/server/modules/tasks";
import { loadTicketFor, raiseTicket, commentOnTicket } from "@/server/tickets/service";
import { quickAddTask, restoreTask, setTaskFields } from "@/server/work/service";
import { resolveOnBehalf } from "@/server/superadmin/control/on-behalf";
import {
  archiveItem,
  binItem,
  loadControlItem,
  overrideRequestItem,
  overrideTask,
  overrideTicket,
  purgeFromBin,
  restoreFromBin,
  searchControl,
  type ControlActor,
} from "@/server/superadmin/control/service";
import type { BuilderSpec } from "@/server/workflows/builder";
import { createDepartment, createUser, pendingTaskKey, workingDayFrom } from "./helpers";

// v1.94.0 (D-451..D-462): Super Admin full control, called directly as Super
// Admin, Admin (IT) and an ordinary user (governance §4.1: never through the
// UI). Approval invariants (§3): no self-approval, append-only events, row
// locks with version checks, stale submissions refused. Binned items must
// leave every query path; the permanent delete only after 30 days.
const tag = Date.now().toString(36).toUpperCase();
const q = async <T>(sql: string, params: unknown[] = []) => (await getDbPool().query<(RowDataPacket & T)[]>(sql, params))[0];
const count = async (sql: string, params: unknown[]) => Number((await q<{ n: number }>(sql, params))[0]!.n);
const oneStep = (userIds: number[]): BuilderSpec => ({
  stages: [
    {
      kind: "STEP",
      step: {
        id: "a",
        label: "Approval",
        approvers: { kind: "PEOPLE", userIds },
        rule: "ALL",
      },
    },
  ],
});
const twoSteps = (first: number[], second: number[]): BuilderSpec => ({
  stages: [
    {
      kind: "STEP",
      step: {
        id: "a",
        label: "First",
        approvers: { kind: "PEOPLE", userIds: first },
        rule: "ALL",
      },
    },
    {
      kind: "STEP",
      step: {
        id: "b",
        label: "Second",
        approvers: { kind: "PEOPLE", userIds: second },
        rule: "ALL",
      },
    },
  ],
});
let n = 0;
const code = () => `V194_${tag}_${++n}`;

const who = {} as Record<"sa" | "sa2" | "it" | "raiser" | "approver" | "approver2" | "approver3" | "other" | "coordinator", ControlActor & TaskActor & Actor>;
let department = 0;
let ticketTypeId = 0;

// Back-dates a bin entry (and the item's deleted_at) so the 30 days have passed.
async function age(module: "REQUEST" | "TASK" | "TICKET", id: number, days = 31) {
  await getDbPool().query(
    "UPDATE superadmin_bin SET binned_at = DATE_SUB(binned_at, INTERVAL ? DAY), purge_after = DATE_SUB(purge_after, INTERVAL ? DAY) WHERE active_key IS NOT NULL AND ((entity_type = ? AND entity_id = ?) OR parent_bin_id = (SELECT x.id FROM (SELECT id FROM superadmin_bin WHERE active_key = CONCAT(?, ':', ?)) x))",
    [days, days, module, id, module, id],
  );
  const ids = await q<{ entity_type: string; entity_id: number }>(
    "SELECT entity_type, entity_id FROM superadmin_bin WHERE active_key IS NOT NULL AND binned_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)",
  );
  for (const row of ids) {
    const table = row.entity_type === "REQUEST" ? "approval_requests" : row.entity_type === "TASK" ? "tasks" : "tickets";
    await getDbPool().query(`UPDATE ${table} SET deleted_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY) WHERE id = ? AND deleted_at IS NOT NULL`, [days, row.entity_id]);
  }
}

async function publishedWorkflow(builder: BuilderSpec): Promise<number> {
  const created = await createWorkflow(
    {
      code: code(),
      name: `V194 ${n}`,
      kind: "PREDEFINED",
      requestPrefix: "SAC",
      builder,
      form: [],
    },
    who.it,
  );
  if (!created.ok) throw new Error(created.message);
  const published = await publishVersion(created.value.versionId, who.it);
  if (!published.ok) throw new Error(published.message);
  return created.value.workflowId;
}

async function raiseRequest(workflowId: number, title: string, by: Actor = who.raiser): Promise<number> {
  const raised = await submitRequest({ workflowId, title, fields: {}, allowDuplicate: true }, by);
  if (!raised.ok) throw new Error(raised.message);
  return raised.value.requestId;
}

async function task(title: string, parentId: number | null = null, by: TaskActor = who.raiser): Promise<number> {
  const created = await quickAddTask(
    {
      title,
      projectId: null,
      sectionId: null,
      parentId,
      assigneeId: who.other.id,
      dueDay: await workingDayFrom(3),
      mySectionId: null,
    },
    by,
  );
  if (!created.ok) throw new Error(created.message);
  return created.value.id;
}

let ticketKey = 0;
async function ticket(title: string): Promise<number> {
  const raised = await raiseTicket(
    {
      typeId: ticketTypeId,
      title,
      description: "The laptop doesn't start.",
      priority: "HIGH",
      requiredOn: await workingDayFrom(2),
      fields: {},
      files: [],
      submissionKey: `v194-${tag}-${(ticketKey += 1)}`,
    },
    who.raiser,
  );
  if (!raised.ok) throw new Error(raised.message);
  return raised.value.id;
}

beforeAll(async () => {
  department = await createDepartment(null);
  const make = async (key: keyof typeof who, roles: string[], approver = true) => {
    const name = `V194 ${key} ${tag}`;
    const id = await createUser({
      name,
      roles: roles as never,
      departmentId: department,
      approver,
    });
    who[key] = {
      id,
      name,
      roles: roles as never,
      sessionId: "v194",
      ipAddress: null,
    };
  };
  await make("sa", ["USER", "IT_ADMIN", "SUPER_ADMIN"]);
  await make("sa2", ["USER", "IT_ADMIN", "SUPER_ADMIN"]);
  await make("it", ["USER", "IT_ADMIN"]);
  await make("raiser", ["USER"], false);
  await make("approver", ["USER"]);
  await make("approver2", ["USER"]);
  await make("approver3", ["USER"]);
  await make("other", ["USER"]);
  await make("coordinator", ["USER"]);
  const created = await createModuleType("TICKET", { code: `V194_${tag}`, name: "V194 Laptop" }, who.it);
  if (!created.ok) throw new Error(created.message);
  ticketTypeId = created.value.id;
  const saved = await saveTypeDraft(
    "TICKET",
    ticketTypeId,
    {
      name: "V194 Laptop",
      form: [],
      settings: {
        access: { mode: "EVERYONE", departmentIds: [], userIds: [] },
        defaultPriority: "NORMAL",
        requesterPriority: true,
      },
    },
    who.it,
  );
  if (!saved.ok) throw new Error(saved.message);
  const published = await publishTypeDraft("TICKET", ticketTypeId, who.it);
  if (!published.ok) throw new Error(published.message);
  const [category] = await q<{ id: number }>("SELECT id FROM ticket_categories WHERE code = 'IT_HARDWARE'");
  const connection = await getDbPool().getConnection();
  try {
    await saveTicketFormSetup(ticketTypeId, category!.id, [who.coordinator.id], who.it.id, connection);
  } finally {
    connection.release();
  }
});

afterAll(async () => {
  await getDbPool().end();
});

describe("the migration (D-454, governance §2)", () => {
  it("adds the bin table and the archive / on-behalf / ticket soft-delete columns", async () => {
    const columns = async (table: string) =>
      (await q<{ COLUMN_NAME: string }>("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [table])).map((row) => row.COLUMN_NAME);
    expect(await columns("superadmin_bin")).toEqual(
      expect.arrayContaining(["entity_type", "entity_id", "parent_bin_id", "reason", "binned_by", "binned_at", "purge_after", "restored_at", "purged_at", "active_key"]),
    );
    for (const table of ["approval_requests", "tasks", "tickets"]) expect(await columns(table)).toEqual(expect.arrayContaining(["archived_at", "archived_by", "created_on_behalf_by"]));
    expect(await columns("tickets")).toEqual(expect.arrayContaining(["deleted_at", "deleted_by"]));
  });
});

describe("only the Super Admin (governance §4.1, direct calls)", () => {
  it("refuses Admin (IT) and an ordinary user on every action", async () => {
    const workflowId = await publishedWorkflow(oneStep([who.approver.id]));
    const requestId = await raiseRequest(workflowId, "Refusals");
    const taskId = await task("Refusals task");
    const ticketId = await ticket("Refusals ticket");
    for (const actor of [who.it, who.raiser]) {
      expect(await searchControl({ q: "Refusals" }, actor)).toEqual([]);
      expect(await loadControlItem("REQUEST", requestId, actor)).toBeNull();
      for (const [module, id] of [
        ["REQUEST", requestId],
        ["TASK", taskId],
        ["TICKET", ticketId],
      ] as const) {
        expect(await archiveItem(module, id, "Because I can", actor)).toMatchObject({ ok: false, message: "Not found." });
        expect(await binItem(module, id, "Because I can", actor)).toMatchObject({ ok: false, message: "Not found." });
      }
      expect(
        await overrideRequestItem(
          requestId,
          {
            action: "FORCE_STATUS",
            status: "APPROVED",
            reason: "Because I can",
          },
          actor,
        ),
      ).toMatchObject({ ok: false });
      expect(
        await overrideTask(
          taskId,
          {
            action: "FORCE_STATUS",
            status: "COMPLETED",
            reason: "Because I can",
          },
          actor,
        ),
      ).toMatchObject({ ok: false, message: "Not found." });
      expect(await overrideTicket(ticketId, { action: "FORCE_STATUS", status: "CLOSED", reason: "Because I can" }, actor)).toMatchObject({ ok: false, message: "Not found." });
      expect(await restoreFromBin(1, "Because I can", actor)).toMatchObject({
        ok: false,
        message: "Not found.",
      });
      expect(await purgeFromBin(1, "X", actor)).toMatchObject({
        ok: false,
        message: "Not found.",
      });
      expect(await resolveOnBehalf(actor, who.other.id, "APPROVAL")).toMatchObject({ ok: false });
    }
    // Nothing changed.
    expect((await findRequest(requestId))?.status).toBe("IN_PROGRESS");
    expect(await count("SELECT COUNT(*) AS n FROM superadmin_bin WHERE entity_id IN (?, ?, ?)", [requestId, taskId, ticketId])).toBe(0);
  });

  it("needs a reason of at least 5 characters", async () => {
    const taskId = await task("Reason task");
    expect(await archiveItem("TASK", taskId, "no", who.sa)).toMatchObject({
      ok: false,
      fieldErrors: { reason: expect.any(String) },
    });
    expect(await binItem("TASK", taskId, "   ", who.sa)).toMatchObject({
      ok: false,
    });
    expect(await overrideTask(taskId, { action: "FORCE_STATUS", status: "COMPLETED", reason: "x" }, who.sa)).toMatchObject({ ok: false });
  });
});

describe("Modify: logged override of an approval (D-457)", () => {
  it("changes, adds and skips approvers, forces the status; each step is an append-only event with the reason", async () => {
    const workflowId = await publishedWorkflow(twoSteps([who.approver.id], [who.approver2.id]));
    const requestId = await raiseRequest(workflowId, "Override me");
    const first = await pendingTaskKey(requestId, who.approver.id);
    const before = await count("SELECT COUNT(*) AS n FROM approval_events WHERE request_id = ?", [requestId]);
    expect(
      await overrideRequestItem(
        requestId,
        {
          action: "CHANGE_APPROVER",
          taskKey: first,
          toUserId: who.approver3.id,
          reason: "Approver on leave",
        },
        who.sa,
      ),
    ).toMatchObject({ ok: true });
    await pendingTaskKey(requestId, who.approver3.id);
    expect(
      await overrideRequestItem(
        requestId,
        {
          action: "ADD_APPROVER",
          nodeId: (await nodeOf(requestId, who.approver3.id))!,
          userId: who.other.id,
          reason: "Needs finance too",
        },
        who.sa,
      ),
    ).toMatchObject({ ok: true });
    await pendingTaskKey(requestId, who.other.id);
    // The requester can never be added as an approver.
    expect(
      await overrideRequestItem(
        requestId,
        {
          action: "ADD_APPROVER",
          nodeId: (await nodeOf(requestId, who.approver3.id))!,
          userId: who.raiser.id,
          reason: "Self approval attempt",
        },
        who.sa,
      ),
    ).toMatchObject({ ok: false });
    expect(
      await overrideRequestItem(
        requestId,
        {
          action: "SKIP_STEP",
          nodeId: (await nodeOf(requestId, who.approver3.id))!,
          reason: "Not needed this time",
        },
        who.sa,
      ),
    ).toMatchObject({ ok: true });
    await pendingTaskKey(requestId, who.approver2.id);
    expect(
      await overrideRequestItem(
        requestId,
        {
          action: "FORCE_STATUS",
          status: "APPROVED",
          reason: "Board approved offline",
        },
        who.sa,
      ),
    ).toMatchObject({ ok: true });
    expect((await findRequest(requestId))?.status).toBe("APPROVED");
    const overrides = await q<{
      payload_json: string | Record<string, unknown>;
    }>("SELECT payload_json FROM approval_events WHERE request_id = ? AND event_type = 'SUPER_ADMIN_OVERRIDE' ORDER BY id", [requestId]);
    expect(overrides.map((row) => (typeof row.payload_json === "string" ? JSON.parse(row.payload_json) : row.payload_json).action)).toEqual([
      "CHANGE_APPROVER",
      "ADD_APPROVER",
      "SKIP_STEP",
      "FORCE_STATUS",
    ]);
    expect(await count("SELECT COUNT(*) AS n FROM approval_events WHERE request_id = ?", [requestId])).toBeGreaterThan(before + 4);
    const timeline = await listTimeline(requestId);
    expect(JSON.stringify(timeline)).toContain("SUPER_ADMIN_OVERRIDE");
    // The people involved were told.
    expect(await count("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND title = 'Changed by Super Admin'", [who.raiser.id])).toBeGreaterThanOrEqual(4);
    expect(await count("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'REQUEST_SUPER_ADMIN_OVERRIDE' AND entity_id = ?", [String(requestId)])).toBe(4);
    // Reopen a finished request: a new round from the first step; earlier decisions stay.
    expect(await overrideRequestItem(requestId, { action: "REOPEN", reason: "Board asked again" }, who.sa)).toMatchObject({ ok: true });
    expect((await findRequest(requestId))?.status).toBe("IN_PROGRESS");
    expect(await count("SELECT COUNT(*) AS n FROM approval_events WHERE request_id = ? AND event_type = 'TASK_REASSIGNED'", [requestId])).toBe(1);
  });

  it("never on the Super Admin's own request, and a stale page is refused", async () => {
    const workflowId = await publishedWorkflow(oneStep([who.approver.id]));
    const own = await raiseRequest(workflowId, "Super Admin's own", who.sa);
    expect(
      await overrideRequestItem(
        own,
        {
          action: "FORCE_STATUS",
          status: "APPROVED",
          reason: "Approve my own",
        },
        who.sa,
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("yourself"),
    });
    expect(
      await overrideRequestItem(
        own,
        {
          action: "EDIT_FIELDS",
          title: "Renamed by me",
          fields: {},
          reason: "Rename my own",
        },
        who.sa,
      ),
    ).toMatchObject({ ok: false });
    expect((await findRequest(own))?.status).toBe("IN_PROGRESS");
    // Another Super Admin may.
    const other = await raiseRequest(workflowId, "Stale page");
    const version = (await findRequest(other))!.stateVersion;
    await decideTask(
      {
        requestId: other,
        taskKey: await pendingTaskKey(other, who.approver.id),
        decision: "APPROVE",
      },
      who.approver,
    );
    expect(
      await overrideRequestItem(
        other,
        {
          action: "REOPEN",
          reason: "From an old page",
          expectedStateVersion: version,
        },
        who.sa,
      ),
    ).toMatchObject({ ok: false, message: expect.stringContaining("Reload") });
  });

  it("edits the title and keeps the old value in the event", async () => {
    const workflowId = await publishedWorkflow(oneStep([who.approver.id]));
    const requestId = await raiseRequest(workflowId, "Old title");
    expect(
      await overrideRequestItem(
        requestId,
        {
          action: "EDIT_FIELDS",
          title: "New title",
          fields: {},
          reason: "Typo in the title",
        },
        who.sa,
      ),
    ).toMatchObject({ ok: true });
    expect((await findRequest(requestId))?.title).toBe("New title");
    const [event] = await q<{ payload_json: string | Record<string, unknown> }>("SELECT payload_json FROM approval_events WHERE request_id = ? AND event_type = 'SUPER_ADMIN_OVERRIDE'", [requestId]);
    const payload = typeof event!.payload_json === "string" ? JSON.parse(event!.payload_json) : event!.payload_json;
    expect(payload).toMatchObject({
      before: { title: "Old title" },
      after: { title: "New title" },
    });
  });
});

async function nodeOf(requestId: number, approverId: number): Promise<string | null> {
  const rows = await q<{ node_id: string }>("SELECT node_id FROM approval_tasks WHERE request_id = ? AND approver_id = ? AND status = 'PENDING' LIMIT 1", [requestId, approverId]);
  return rows[0]?.node_id ?? null;
}

describe("Create on behalf (D-458)", () => {
  it("raises a request as the person: they are the requester, the Super Admin is recorded, normal rules apply", async () => {
    const workflowId = await publishedWorkflow(oneStep([who.approver.id]));
    const resolved = await resolveOnBehalf(who.sa, who.raiser.id, "APPROVAL");
    expect(resolved.ok).toBe(true);
    const raised = await submitRequest(
      {
        workflowId,
        title: "For the raiser",
        fields: {},
        allowDuplicate: true,
        onBehalfBy: who.sa.id,
      },
      who.raiser,
    );
    if (!raised.ok) throw new Error(raised.message);
    const [row] = await q<{
      requester_id: number;
      created_on_behalf_by: number;
    }>("SELECT requester_id, created_on_behalf_by FROM approval_requests WHERE id = ?", [raised.value.requestId]);
    expect(row).toMatchObject({
      requester_id: who.raiser.id,
      created_on_behalf_by: who.sa.id,
    });
    expect(await count("SELECT COUNT(*) AS n FROM approval_events WHERE request_id = ? AND event_type = 'CREATED_ON_BEHALF' AND actor_id = ?", [raised.value.requestId, who.sa.id])).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'REQUEST_CREATED_ON_BEHALF' AND entity_id = ?", [String(raised.value.requestId)])).toBe(1);
    // The person it is for never approves it, even when named on a level (the usual rule).
    const custom = await submitCustomRequest(
      {
        title: "Self approver on behalf",
        builder: oneStep([who.approver.id, who.approver2.id]),
        fields: { details: "x" },
        onBehalfBy: who.sa.id,
      },
      who.approver,
    );
    if (!custom.ok) throw new Error(custom.message);
    expect(await count("SELECT COUNT(*) AS n FROM approval_tasks WHERE request_id = ? AND approver_id = ?", [custom.value.requestId, who.approver.id])).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM approval_tasks WHERE request_id = ? AND approver_id = ?", [custom.value.requestId, who.approver2.id])).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM approval_requests WHERE id = ? AND requester_id = ? AND created_on_behalf_by = ?", [custom.value.requestId, who.approver.id, who.sa.id])).toBe(1);
    // Never for oneself, nor an inactive person.
    expect(await resolveOnBehalf(who.sa, who.sa.id, "APPROVAL")).toMatchObject({
      ok: false,
    });
  });
});

describe("Archive (D-456): read-only, still visible, un-archivable", () => {
  it("archives only a finished item and then refuses every change", async () => {
    const workflowId = await publishedWorkflow(oneStep([who.approver.id]));
    const requestId = await raiseRequest(workflowId, "Archive me");
    expect(await archiveItem("REQUEST", requestId, "Year-end clean up", who.sa)).toMatchObject({
      ok: false,
      message: expect.stringContaining("finished"),
    });
    await decideTask(
      {
        requestId,
        taskKey: await pendingTaskKey(requestId, who.approver.id),
        decision: "APPROVE",
      },
      who.approver,
    );
    expect(await archiveItem("REQUEST", requestId, "Year-end clean up", who.sa)).toMatchObject({ ok: true });
    expect(await findRequest(requestId)).not.toBeNull(); // still visible
    expect((await listMyRequests(who.raiser.id)).some((item) => item.id === requestId)).toBe(true);
    expect(await addComment(requestId, "A late note", who.raiser)).toMatchObject({ ok: false, code: "ARCHIVED" });
    expect(await addCollaborators(requestId, [who.other.id], who.raiser)).toMatchObject({ ok: false });
    expect(await overrideRequestItem(requestId, { action: "REOPEN", reason: "Reopen archived" }, who.sa)).toMatchObject({ ok: false });
    expect((await searchControl({ q: "Archive me", state: "ARCHIVED" }, who.sa)).map((item) => item.id)).toContain(requestId);
    expect(await archiveItem("REQUEST", requestId, "Needs a change", who.sa, false)).toMatchObject({ ok: true });
    expect(await addComment(requestId, "Now it works", who.raiser)).toMatchObject({ ok: true });
  });

  it("an archived task and ticket are read-only for everyone", async () => {
    const taskId = await task("Archive task");
    expect(await overrideTask(taskId, { action: "FORCE_STATUS", status: "COMPLETED", reason: "Done offline" }, who.sa)).toMatchObject({ ok: true });
    expect(await archiveItem("TASK", taskId, "Year-end clean up", who.sa)).toMatchObject({ ok: true });
    const loaded = await loadTaskFor(taskId, who.raiser);
    expect(loaded).not.toBeNull();
    expect(loaded!.actions.size).toBe(0);
    expect(await setTaskFields(taskId, { title: "Changed while archived" }, who.raiser)).toMatchObject({ ok: false });
    const ticketId = await ticket("Archive ticket");
    expect(await overrideTicket(ticketId, { action: "FORCE_STATUS", status: "CLOSED", reason: "Solved by phone" }, who.sa)).toMatchObject({ ok: true });
    expect(await archiveItem("TICKET", ticketId, "Year-end clean up", who.sa)).toMatchObject({ ok: true });
    const view = await loadTicketFor(ticketId, who.raiser);
    expect(view?.actions.size).toBe(0);
    expect(await commentOnTicket({ ticketId, body: "Late remark", internal: false, files: [] }, who.raiser)).toMatchObject({ ok: false });
  });
});

describe("Delete = bin, then purge (D-454, D-455)", () => {
  it("a binned request leaves every list, queue, search and the bell; restore brings it back", async () => {
    const workflowId = await publishedWorkflow(oneStep([who.approver.id]));
    const requestId = await raiseRequest(workflowId, `Bin request ${tag}`);
    expect(await binItem("REQUEST", requestId, "Raised by mistake", who.sa)).toMatchObject({ ok: true });
    expect(await findRequest(requestId)).toBeNull();
    expect((await listMyRequests(who.raiser.id)).some((item) => item.id === requestId)).toBe(false);
    expect((await listPendingTasksFor(who.approver.id)).some((item) => item.requestId === requestId)).toBe(false);
    expect((await searchControl({ q: `Bin request ${tag}` }, who.sa)).length).toBe(0);
    const { searchRequests } = await import("@/lib/db/repositories/search.repository");
    const { parseSearchFilters } = await import("@/server/search/filters");
    expect((await searchRequests({ id: who.it.id, isAdmin: true }, parseSearchFilters({ q: `Bin request ${tag}` }))).items.some((item) => item.id === requestId)).toBe(false);
    expect((await listBin({ module: "REQUEST", q: `Bin request ${tag}` })).items.map((item) => item.entityId)).toEqual([requestId]);
    // Notifications about it are hidden from the bell.
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM notifications n WHERE n.user_id = ? AND n.entity_type = 'REQUEST' AND n.entity_id = ? AND ${(await import("@/server/notifications/categories")).VISIBLE_TO_MODULES_SQL}`,
        [who.approver.id, requestId],
      ),
    ).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM notifications n WHERE n.user_id = ? AND n.entity_type = 'REQUEST' AND n.entity_id = ?", [who.approver.id, requestId])).toBeGreaterThan(0);
    // Not purgeable yet.
    const entry = (await listBin({ module: "REQUEST", q: `Bin request ${tag}` })).items[0]!;
    expect(await purgeFromBin(entry.id, entry.entityNo!, who.sa)).toMatchObject({ ok: false, message: expect.stringContaining("30 days") });
    expect(await restoreFromBin(entry.id, "Wrong one binned", who.sa)).toMatchObject({ ok: true });
    expect(await findRequest(requestId)).not.toBeNull();
    expect((await listMyRequests(who.raiser.id)).some((item) => item.id === requestId)).toBe(true);
    expect(await count("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'SUPERADMIN_RESTORED' AND entity_id = ?", [String(requestId)])).toBe(1);
  });

  it("purges a request after 30 days with the typed number; the audit log keeps the record", async () => {
    const workflowId = await publishedWorkflow(oneStep([who.approver.id]));
    const requestId = await raiseRequest(workflowId, `Purge request ${tag}`);
    await addComment(requestId, "A comment that goes too", who.raiser);
    expect(await binItem("REQUEST", requestId, "Test data", who.sa)).toMatchObject({ ok: true });
    await age("REQUEST", requestId);
    const entry = (await listBin({ module: "REQUEST", q: `Purge request ${tag}` })).items[0]!;
    expect(await purgeFromBin(entry.id, "WRONG", who.sa)).toMatchObject({
      ok: false,
      fieldErrors: { confirmText: expect.any(String) },
    });
    expect(await purgeFromBin(entry.id, entry.entityNo!, who.sa)).toMatchObject({ ok: true });
    expect(await count("SELECT COUNT(*) AS n FROM approval_requests WHERE id = ?", [requestId])).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM approval_events WHERE request_id = ?", [requestId])).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM request_comments WHERE request_id = ?", [requestId])).toBe(0);
    expect(
      await count("SELECT COUNT(*) AS n FROM audit_logs WHERE entity_type = 'REQUEST' AND entity_id = ? AND action IN ('REQUEST_SUBMITTED', 'REQUEST_DELETED', 'SUPERADMIN_PURGED')", [
        String(requestId),
      ]),
    ).toBe(3);
    expect(await count("SELECT COUNT(*) AS n FROM superadmin_bin WHERE id = ? AND purged_at IS NOT NULL AND active_key IS NULL", [entry.id])).toBe(1);
    expect(await purgeFromBin(entry.id, entry.entityNo!, who.sa)).toMatchObject({ ok: false });
  });

  it("the append-only guard still refuses deleting the history of a request that isn't 30 days in the bin", async () => {
    const triggers = await count("SELECT COUNT(*) AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = 'trg_approval_events_no_delete'", []);
    if (triggers === 0) return; // hosted MySQL without triggers: the app's own checks above apply
    const workflowId = await publishedWorkflow(oneStep([who.approver.id]));
    const requestId = await raiseRequest(workflowId, "Guarded history");
    await expect(getDbPool().query("DELETE FROM approval_events WHERE request_id = ?", [requestId])).rejects.toThrow(/append-only/);
    await binItem("REQUEST", requestId, "Binned, not old", who.sa);
    await expect(getDbPool().query("DELETE FROM approval_events WHERE request_id = ?", [requestId])).rejects.toThrow(/append-only/);
  });

  it("a task and its subtasks: hidden from their creator and IT, not restorable by them, not auto-purged; restore puts the status back", async () => {
    const parent = await task(`Bin task ${tag}`);
    const child = await task(`Bin subtask ${tag}`, parent);
    expect(await binItem("TASK", parent, "Duplicate task", who.sa)).toMatchObject({ ok: true });
    expect(await loadTaskFor(parent, who.raiser)).toBeNull();
    expect(await loadTaskFor(child, who.it)).toBeNull();
    expect(await restoreTask(parent, who.raiser)).toMatchObject({ ok: false });
    // Not in their own Deleted list either (TD-026 closed).
    const { listDeletedTasks } = await import("@/lib/db/repositories/work.repository");
    expect((await listDeletedTasks(who.raiser.id)).some((item) => item.id === parent)).toBe(false);
    await age("TASK", parent);
    const candidates = (await purgeTaskCandidates(5000)).map((row) => row.id);
    expect(candidates).not.toContain(parent);
    expect(candidates).not.toContain(child);
    const entry = (await listBin({ module: "TASK", q: `Bin task ${tag}` })).items[0]!;
    expect(entry.childCount).toBe(1);
    expect(await restoreFromBin(entry.id, "Needed after all", who.sa)).toMatchObject({ ok: true });
    expect((await loadTaskFor(parent, who.raiser))?.task.status).toBe("OPEN");
    expect((await loadTaskFor(child, who.raiser))?.task.status).toBe("OPEN");
  });

  it("purges a task with its subtask after 30 days", async () => {
    const parent = await task(`Purge task ${tag}`);
    const child = await task(`Purge subtask ${tag}`, parent);
    await binItem("TASK", parent, "Test data", who.sa);
    await age("TASK", parent);
    const entry = (await listBin({ module: "TASK", q: `Purge task ${tag}` })).items[0]!;
    expect(await purgeFromBin(entry.id, entry.entityNo!, who.sa)).toMatchObject({ ok: true });
    expect(await count("SELECT COUNT(*) AS n FROM tasks WHERE id IN (?, ?)", [parent, child])).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'SUPERADMIN_PURGED' AND entity_id = ?", [String(parent)])).toBe(1);
  });

  it("a binned ticket leaves the lists and its page; restore and purge work", async () => {
    const ticketId = await ticket(`Bin ticket ${tag}`);
    expect(await binItem("TICKET", ticketId, "Raised twice", who.sa)).toMatchObject({ ok: true });
    expect(await findTicket(ticketId)).toBeNull();
    expect(await loadTicketFor(ticketId, who.raiser)).toBeNull();
    expect(await loadTicketFor(ticketId, who.coordinator)).toBeNull();
    const listed = await listTickets(
      {
        scope: "mine",
        categoryId: null,
        status: null,
        q: `Bin ticket ${tag}`,
        page: 1,
      },
      { id: who.raiser.id, isAdmin: false },
    );
    expect(listed.items.some((item) => item.id === ticketId)).toBe(false);
    const asIt = await listTickets(
      {
        scope: "all",
        categoryId: null,
        status: null,
        q: `Bin ticket ${tag}`,
        page: 1,
      } as never,
      { id: who.it.id, isAdmin: true },
    );
    expect(asIt.items.some((item) => item.id === ticketId)).toBe(false);
    // Ctrl K quick search, ticket analytics (open tickets and the period's tickets) leave it out too.
    const { quickTickets } = await import("@/server/search/quick-more");
    expect((await quickTickets(who.raiser, `Bin ticket ${tag}`)).some((item) => item.id === ticketId)).toBe(false);
    const { analyticsTickets, openTicketsInScope } = await import("@/lib/db/repositories/ticket-analytics.repository");
    expect((await openTicketsInScope({ all: true })).some((item) => item.id === ticketId)).toBe(false);
    expect((await analyticsTickets({ all: true }, new Date(Date.now() - 86_400_000), new Date(Date.now() + 86_400_000))).some((item) => item.id === ticketId)).toBe(false);
    let entry = (await listBin({ module: "TICKET", q: `Bin ticket ${tag}` })).items[0]!;
    expect(await restoreFromBin(entry.id, "It was a different laptop", who.sa)).toMatchObject({ ok: true });
    expect(await findTicket(ticketId)).not.toBeNull();
    await binItem("TICKET", ticketId, "Raised twice", who.sa);
    await age("TICKET", ticketId);
    entry = (await listBin({ module: "TICKET", q: `Bin ticket ${tag}` })).items[0]!;
    expect(await purgeFromBin(entry.id, entry.entityNo!, who.sa)).toMatchObject({ ok: true });
    expect(await count("SELECT COUNT(*) AS n FROM tickets WHERE id = ?", [ticketId])).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM ticket_events WHERE ticket_id = ?", [ticketId])).toBe(0);
  });
});

describe("Modify a task and a ticket (D-457)", () => {
  it("task: edits, reassigns and forces the status, with the reason in its history; stale pages refused", async () => {
    const taskId = await task("Override task");
    const before = (await loadTaskFor(taskId, who.raiser))!.task.rowVersion;
    expect(
      await overrideTask(
        taskId,
        {
          action: "EDIT",
          title: "Override task renamed",
          assigneeId: who.approver.id,
          reason: "Owner moved teams",
        },
        who.sa,
      ),
    ).toMatchObject({ ok: true });
    const loaded = (await loadTaskFor(taskId, who.raiser))!.task;
    expect(loaded).toMatchObject({
      title: "Override task renamed",
      assigneeId: who.approver.id,
    });
    expect(
      await overrideTask(
        taskId,
        {
          action: "FORCE_STATUS",
          status: "COMPLETED",
          reason: "Stale page",
          expectedRowVersion: before,
        },
        who.sa,
      ),
    ).toMatchObject({ ok: false, message: expect.stringContaining("Reload") });
    expect(
      await overrideTask(
        taskId,
        {
          action: "FORCE_STATUS",
          status: "COMPLETED",
          reason: "Finished offline",
        },
        who.sa,
      ),
    ).toMatchObject({ ok: true });
    expect(await overrideTask(taskId, { action: "REOPEN", reason: "More to do here" }, who.sa)).toMatchObject({ ok: true });
    expect(await count("SELECT COUNT(*) AS n FROM task_events WHERE task_id = ? AND event_type = 'SUPER_ADMIN_OVERRIDE'", [taskId])).toBe(3);
    expect(
      await count("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND entity_type = 'TASK' AND entity_id = ? AND message LIKE '%Super Admin%'", [who.raiser.id, taskId]),
    ).toBeGreaterThanOrEqual(3);
  });

  it("ticket: reassigns, closes and reopens; the requester and coordinators are told", async () => {
    const ticketId = await ticket("Override ticket");
    expect(
      await overrideTicket(
        ticketId,
        {
          action: "REASSIGN",
          assigneeId: who.other.id,
          targetDay: await workingDayFrom(2),
          reason: "Coordinator away",
        },
        who.sa,
      ),
    ).toMatchObject({ ok: true });
    expect(await findTicket(ticketId)).toMatchObject({
      status: "ASSIGNED",
      assigneeId: who.other.id,
    });
    expect(await overrideTicket(ticketId, { action: "FORCE_STATUS", status: "CLOSED", reason: "Solved by phone" }, who.sa)).toMatchObject({ ok: true });
    expect(await overrideTicket(ticketId, { action: "REOPEN", reason: "It broke again" }, who.sa)).toMatchObject({ ok: true });
    expect((await findTicket(ticketId))?.status).toBe("REOPENED");
    expect(await count("SELECT COUNT(*) AS n FROM ticket_events WHERE ticket_id = ? AND action = 'SUPER_ADMIN_OVERRIDE'", [ticketId])).toBe(3);
    expect(await count("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND entity_type = 'TICKET' AND entity_id = ?", [who.coordinator.id, ticketId])).toBeGreaterThan(0);
  });

  it("on behalf: a task created as someone else and a ticket raised for them", async () => {
    const created = await quickAddTask(
      {
        title: "Placeholder",
        projectId: null,
        sectionId: null,
        parentId: null,
        assigneeId: null,
        dueDay: await workingDayFrom(3),
        mySectionId: null,
      },
      who.raiser,
    );
    expect(created.ok).toBe(true);
    const { createTask } = await import("@/server/modules/tasks");
    const [general] = await q<{ id: number }>("SELECT id FROM module_types WHERE module = 'TASK' AND code = 'GENERAL'");
    const made = await createTask(
      {
        typeId: general!.id,
        title: "Made for the raiser",
        description: "",
        priority: "NORMAL",
        assigneeId: who.other.id,
        due: `${await workingDayFrom(3)}T18:00`,
        startsOn: "",
        related: "",
        fields: {},
        submissionKey: null,
        files: [],
        onBehalfBy: who.sa.id,
      },
      who.raiser,
    );
    if (!made.ok) throw new Error(made.message);
    expect(await q<{ created_by: number; created_on_behalf_by: number }>("SELECT created_by, created_on_behalf_by FROM tasks WHERE id = ?", [made.value.id])).toEqual([
      expect.objectContaining({
        created_by: who.raiser.id,
        created_on_behalf_by: who.sa.id,
      }),
    ]);
    expect(await count("SELECT COUNT(*) AS n FROM task_events WHERE task_id = ? AND event_type = 'CREATED_ON_BEHALF'", [made.value.id])).toBe(1);
    const raised = await raiseTicket(
      {
        typeId: ticketTypeId,
        title: "Raised for the raiser",
        description: "Monitor flickers",
        priority: "HIGH",
        requiredOn: await workingDayFrom(2),
        fields: {},
        files: [],
        submissionKey: `v194-behalf-${tag}`,
        onBehalfBy: who.sa.id,
      },
      who.raiser,
    );
    if (!raised.ok) throw new Error(raised.message);
    expect((await findTicket(raised.value.id))?.onBehalfByName).toBe(who.sa.name);
  });
});
