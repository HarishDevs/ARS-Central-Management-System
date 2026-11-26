import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import { bulkReassign, createWorkflow, delegateTask, handOverPendingTasks, holdTask, publishVersion, submitRequest, type Actor } from "@/server/approvals/service";
import { createModuleType, publishTypeDraft, saveTypeDraft } from "@/server/modules/config";
import { saveTicketFormSetup, findTicket } from "@/lib/db/repositories/tickets.repository";
import { assignTicket, commentOnTicket, loadTicketFor, raiseTicket, runTicketConfirmations, workOnTicket } from "@/server/tickets/service";
import { listRecordFiles, recordFileVisible, stageFiles } from "@/server/modules/files";
import { loadWorkingCalendar } from "@/lib/db/repositories/calendar.repository";
import { addWorkingDays, indiaDate } from "@/server/workflows/calendar";
import * as work from "@/server/work/service";
import * as automations from "@/server/work/automations";
import { findRule } from "@/lib/db/repositories/automations.repository";
import type { ModuleCode } from "@/server/modules/modules";
import type { TaskActor } from "@/server/modules/tasks";
import type { WorkflowDefinition } from "@/server/engine";
import { createUser, pendingTaskKey, workingDayFrom } from "./helpers";

// v1.71.2 QA fixes (D-388 to D-393) on real MySQL.
const tag = Date.now().toString(36);
const db = () => getDbPool();
const q = async <T,>(sql: string, params: unknown[] = []) => (await db().query<(RowDataPacket & T)[]>(sql, params))[0];
const ALL: ModuleCode[] = ["APPROVAL", "TASK", "PROJECT"];
const who = (id: number, name = `Q${id}`): TaskActor => ({ id, name, roles: ["USER"], modules: ALL, sessionId: "v1712", ipAddress: null });
const setting = (key: string, value: string) =>
  db().query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES (?, 'FEATURES', 'STRING', FALSE, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, value]);

afterAll(async () => {
  await db().query("DELETE FROM system_settings WHERE setting_key IN ('features.pm_automations')");
  await db().end();
});

describe("the database session runs in UTC (D-391, V181-A4, Q-020)", () => {
  it("every pooled connection has time_zone +00:00, so CURRENT_TIMESTAMP equals UTC_TIMESTAMP", async () => {
    const connections = await Promise.all([db().getConnection(), db().getConnection(), db().getConnection()]);
    try {
      for (const connection of connections) {
        const [[row]] = await connection.query<RowDataPacket[]>("SELECT @@session.time_zone AS tz, TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), NOW()) AS offset_minutes");
        expect(row).toMatchObject({ tz: "+00:00" });
        expect(Number(row!.offset_minutes)).toBe(0);
      }
    } finally {
      connections.forEach((connection) => connection.release());
    }
  });
});

describe("nobody acts on approvals of their own request (D-388)", () => {
  let manager: number;
  let raiser: number;
  let colleague: number;
  let other: number;
  let itRaiser: Actor;
  let itOther: Actor;
  const person = (id: number): Actor => ({ id, roles: ["USER"] });
  const raise = async (by: Actor) => {
    const definition: WorkflowDefinition = {
      nodes: [
        { id: "start", kind: "START", label: "Start" },
        { id: "mgr", kind: "APPROVAL", label: "Manager", approvers: [{ type: "USER", userId: manager }], completion: { type: "ALL" } },
        { id: "end", kind: "END", label: "End" },
      ],
      edges: [
        { id: "e1", from: "start", to: "mgr" },
        { id: "e2", from: "mgr", to: "end" },
      ],
    };
    const created = await createWorkflow({ code: `QA1712_${tag}_${Math.random().toString(36).slice(2, 8)}`.toUpperCase(), name: "QA", kind: "PREDEFINED", requestPrefix: "QA", definition }, itOther);
    if (!created.ok) throw new Error(created.message);
    await publishVersion(created.value.versionId, itOther);
    const submitted = await submitRequest({ workflowId: created.value.workflowId, title: `QA ${tag}`, fields: {}, allowDuplicate: true }, by);
    if (!submitted.ok) throw new Error(submitted.message);
    return submitted.value.requestId;
  };

  beforeAll(async () => {
    manager = await createUser({ name: `QA Manager ${tag}` });
    raiser = await createUser({ name: `QA Raiser ${tag}` });
    colleague = await createUser({ name: `QA Colleague ${tag}` });
    other = await createUser({ name: `QA Other ${tag}` });
    itRaiser = { id: await createUser({ name: `QA IT raiser ${tag}`, roles: ["USER", "IT_ADMIN"] }), roles: ["USER", "IT_ADMIN"] };
    itOther = { id: await createUser({ name: `QA IT other ${tag}`, roles: ["USER", "IT_ADMIN"] }), roles: ["USER", "IT_ADMIN"] };
    // The manager is away; the raiser covers for them (logic #1).
    await db().query<ResultSetHeader>(
      `INSERT INTO delegations (user_id, delegate_id, starts_on, ends_on, created_by)
       VALUES (?, ?, DATE_SUB(DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 330 MINUTE)), INTERVAL 1 DAY), DATE_ADD(DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 330 MINUTE)), INTERVAL 5 DAY), ?)`,
      [manager, raiser, manager],
    );
  });

  it("a requester covering as the approver's delegate can't pass on or hold their own request", async () => {
    const id = await raise(person(raiser));
    const key = await pendingTaskKey(id, manager);
    expect(await delegateTask({ requestId: id, taskKey: key, toUserId: colleague, reason: "Busy" }, person(raiser))).toMatchObject({ ok: false, message: expect.stringMatching(/own request/) });
    expect((await holdTask({ requestId: id, taskKey: key, reason: "Wait" }, person(raiser))).ok).toBe(false);
    // The approver themself still can.
    expect((await delegateTask({ requestId: id, taskKey: key, toUserId: colleague, reason: "On site" }, person(manager))).ok).toBe(true);
  });

  it("an IT person can't bulk-move or hand over their own request's approvals; another IT person can", async () => {
    const id = await raise(itRaiser);
    const key = await pendingTaskKey(id, manager);
    const mine = await bulkReassign([{ requestId: id, taskKey: key }], other, "Moving them", itRaiser);
    expect(mine.ok && mine.value[0]).toMatchObject({ ok: false, message: expect.stringMatching(/own request/) });
    const handed = await handOverPendingTasks(manager, other, itRaiser);
    expect(handed.ok && handed.value.skipped.some((item) => /own request/.test(item.reason))).toBe(true);
    const [still] = await q<{ approver_id: number }>("SELECT approver_id FROM approval_tasks WHERE request_id = ? AND status = 'PENDING'", [id]);
    expect(Number(still!.approver_id)).toBe(manager);
    const theirs = await bulkReassign([{ requestId: id, taskKey: key }], other, "Moving them", itOther);
    expect(theirs.ok && theirs.value[0]).toMatchObject({ ok: true });
  });
});

describe("tickets: an internal remark's files are internal (D-388, QA security M-1)", () => {
  let typeId = 0;
  let requester: TaskActor;
  let coordinator: TaskActor;
  let assignee: TaskActor;
  const day = () => indiaDate(new Date());
  const raise = async (title: string) => {
    const result = await raiseTicket({ typeId, title, description: "Printer jams on every page.", priority: "NORMAL", requiredOn: new Date(Date.now() + 330 * 60_000 + 86_400_000).toISOString().slice(0, 10), fields: { item: "Printer" }, files: [], submissionKey: `test-key-${tag}-${Math.random().toString(36).slice(2, 10)}` }, requester);
    if (!result.ok) throw new Error(`${result.message} ${JSON.stringify(result)}`);
    return result.value.id;
  };
  const pdf = (name: string) => ({ name, contentType: "application/pdf", bytes: Buffer.from(`%PDF-1.4\n% ${name}\n%%EOF\n`) });

  beforeAll(async () => {
    const admin: TaskActor = { ...who(await createUser({ name: `QA T Admin ${tag}`, roles: ["USER", "IT_ADMIN"] })), roles: ["USER", "IT_ADMIN"] };
    requester = who(await createUser({ name: `QA T Requester ${tag}` }));
    coordinator = who(await createUser({ name: `QA T Coordinator ${tag}` }));
    assignee = who(await createUser({ name: `QA T Assignee ${tag}` }));
    const created = await createModuleType("TICKET", { code: `QTK_${tag.toUpperCase()}`, name: "QA printer" }, admin);
    if (!created.ok) throw new Error(created.message);
    typeId = created.value.id;
    const saved = await saveTypeDraft("TICKET", typeId, { name: "QA printer", form: [{ key: "item", label: "Item", type: "TEXT", required: true }], settings: { access: { mode: "EVERYONE", departmentIds: [], userIds: [] }, defaultPriority: "NORMAL", requesterPriority: true } }, admin);
    if (!saved.ok) throw new Error(saved.message);
    const published = await publishTypeDraft("TICKET", typeId, admin);
    if (!published.ok) throw new Error(published.message);
    const [category] = await q<{ id: number }>("SELECT id FROM ticket_categories WHERE code = 'IT_SOFTWARE'");
    const connection = await db().getConnection();
    try {
      await saveTicketFormSetup(typeId, category!.id, [coordinator.id], admin.id, connection);
    } finally {
      connection.release();
    }
  });

  it("the requester neither sees nor may open them; the coordinator does", async () => {
    const id = await raise(`Internal file ${tag}`);
    const internalFiles = await stageFiles([pdf("vendor-quote.pdf")]);
    expect((await commentOnTicket({ ticketId: id, body: "Vendor quote attached", internal: true, files: internalFiles }, coordinator)).ok).toBe(true);
    const publicFiles = await stageFiles([pdf("steps.pdf")]);
    expect((await commentOnTicket({ ticketId: id, body: "Try these steps", internal: false, files: publicFiles }, coordinator)).ok).toBe(true);

    const asRequester = (await loadTicketFor(id, { id: requester.id, roles: requester.roles }))!;
    const asCoordinator = (await loadTicketFor(id, { id: coordinator.id, roles: coordinator.roles }))!;
    expect(asRequester.internal).toBe(false);
    expect(asCoordinator.internal).toBe(true);
    expect((await listRecordFiles("TICKET", id, { internal: asRequester.internal })).map((file) => file.name)).toEqual(["steps.pdf"]);
    const all = await listRecordFiles("TICKET", id, { internal: asCoordinator.internal });
    expect(all.map((file) => [file.name, file.purpose])).toEqual([
      ["vendor-quote.pdf", "INTERNAL"],
      ["steps.pdf", "GENERAL"],
    ]);
    // /api/files/:id uses the same rule for the TICKET branch.
    expect(recordFileVisible(all[0]!, asRequester.internal)).toBe(false);
    expect(recordFileVisible(all[0]!, asCoordinator.internal)).toBe(true);
    expect(recordFileVisible(all[1]!, asRequester.internal)).toBe(true);
  });

  it("after a runner outage only the closure is sent, not reminders 2 and 3 with it (QA logic #9)", async () => {
    const id = await raise(`Outage ${tag}`);
    const assigned = await assignTicket({ ticketId: id, assigneeId: assignee.id, targetDate: day(), remarks: "Please look", rowVersion: null }, coordinator);
    if (!assigned.ok) throw new Error(assigned.message);
    const done = await workOnTicket({ ticketId: id, step: "RESOLVE", remarks: "Replaced the roller", rowVersion: null }, assignee);
    if (!done.ok) throw new Error(done.message);
    const calendar = await loadWorkingCalendar();
    const result = await runTicketConfirmations(new Date(`${addWorkingDays(day(), 6, calendar)}T06:30:00Z`));
    expect(result.reminded).toBe(0);
    expect((await findTicket(id))!.status).toBe("CLOSED");
    const steps = (await q<{ stage: string }>("SELECT stage FROM ticket_confirm_steps WHERE ticket_id = ? ORDER BY stage", [id])).map((row) => row.stage);
    expect(steps).toEqual(["REMIND_2", "REMIND_3", "CLOSE"]); // claimed silently
    const [reminders] = await q<{ n: number }>("SELECT COUNT(*) AS n FROM ticket_events WHERE ticket_id = ? AND action = 'CONFIRM_REMINDER'", [id]);
    expect(Number(reminders!.n)).toBe(0);
  });
});

describe("tasks: a start date must be a real day (D-393, QA logic #8)", () => {
  it("2026-02-31 is refused with a message, not a database error", async () => {
    const me = await createUser({ name: `QA Start ${tag}` });
    const created = await work.createProject({ name: `QA start ${tag}`, description: "", color: "blue", privacy: "PRIVATE", departmentId: null, defaultAccessRole: "EDITOR", defaultView: "LIST", startOn: "", dueOn: "" }, who(me));
    if (!created.ok) throw new Error(created.message);
    const added = await work.quickAddTask({ title: `QA start ${tag}`, projectId: created.value.id, sectionId: null, parentId: null, assigneeId: null, dueDay: await workingDayFrom(10), mySectionId: null }, who(me));
    if (!added.ok) throw new Error(added.message);
    expect(await work.setTaskFields(added.value.id, { startDay: "2026-02-31" }, who(me))).toMatchObject({ ok: false, message: "Choose a valid start date." });
    expect((await work.setTaskFields(added.value.id, { startDay: await workingDayFrom(2) }, who(me))).ok).toBe(true);
  });
});

describe("automations: editing someone else's rule makes you its owner (D-392, QA security L-1)", () => {
  it("an editor who saves the owner's rule becomes its owner; the old owner is told", async () => {
    await setting("features.pm_automations", "ON");
    const owner = await createUser({ name: `QA Auto owner ${tag}` });
    const editor = await createUser({ name: `QA Auto editor ${tag}` });
    const created = await work.createProject({ name: `QA auto ${tag}`, description: "", color: "blue", privacy: "PRIVATE", departmentId: null, defaultAccessRole: "EDITOR", defaultView: "LIST", startOn: "", dueOn: "" }, who(owner));
    if (!created.ok) throw new Error(created.message);
    expect((await work.setMember(created.value.id, { type: "USER", id: editor }, "EDITOR", who(owner))).ok).toBe(true);
    const rule = await automations.createRule(created.value.id, who(owner));
    if (!rule.ok) throw new Error(rule.message);
    const before = (await findRule(rule.value.id))!;
    expect(before.ownerId).toBe(owner);
    const draft = { trigger: { type: "COMMENT_ADDED" }, steps: [{ key: "a", type: "ADD_COMMENT", text: "Thanks!" }], paths: [], otherwise: [] };
    const saved = await automations.saveRule(rule.value.id, { name: `QA rule ${tag}`, draft, rowVersion: before.rowVersion }, who(editor, "QA Editor"));
    expect(saved).toMatchObject({ ok: true, message: expect.stringMatching(/You own this automation now/) });
    expect((await findRule(rule.value.id))!.ownerId).toBe(editor);
    const [told] = await q<{ n: number }>(
      "SELECT COUNT(*) AS n FROM notification_outbox WHERE JSON_EXTRACT(payload_json, '$.userId') = ? AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.title')) = ?",
      [owner, `Automation taken over: QA rule ${tag}`],
    );
    expect(Number(told!.n)).toBe(1);
    // The owner publishing it takes it back, and the editor is told.
    const published = await automations.publishRule(rule.value.id, who(owner, "QA Owner"));
    expect(published.ok).toBe(true);
    expect((await findRule(rule.value.id))!.ownerId).toBe(owner);
    const [toldEditor] = await q<{ n: number }>("SELECT COUNT(*) AS n FROM notification_outbox WHERE JSON_EXTRACT(payload_json, '$.userId') = ? AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.title')) LIKE 'Automation taken over:%'", [editor]);
    expect(Number(toldEditor!.n)).toBe(1);
    await automations.setRuleEnabled(rule.value.id, false, who(owner));
  });
});
