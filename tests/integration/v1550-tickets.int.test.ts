import { beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import { createModuleType, publishTypeDraft, saveTypeDraft } from "@/server/modules/config";
import { saveTicketFormSetup, findTicket, ticketBoard } from "@/lib/db/repositories/tickets.repository";
import { analyticsTickets } from "@/lib/db/repositories/ticket-analytics.repository";
import { assignTicket, confirmTicket, raiseTicket, reopenTicket, runTicketConfirmations, workOnTicket } from "@/server/tickets/service";
import type { TaskActor } from "@/server/modules/tasks";
import { insertTask } from "@/lib/db/repositories/tasks.repository";
import { generalTypeVersion } from "@/lib/db/repositories/work.repository";
import { linkTaskToTicket } from "@/lib/db/repositories/tickets.repository";
import { loadWorkingCalendar } from "@/lib/db/repositories/calendar.repository";
import { addWorkingDays, indiaDate } from "@/server/workflows/calendar";
import { createUser } from "./helpers";

// v1.55.0 (owner's ticketing brief): the whole lifecycle on real MySQL:
// RAISE → ASSIGN → START → RESOLVE (remarks) → CONFIRM / REOPEN → (v1.59.3, D-362: on the ticket, no task)
// auto-close after 4 working days (reminders on days 2 and 3), exactly once.
let typeId = 0;
const people: Record<string, TaskActor> = {};
const actor = (id: number, name: string, roles: string[] = ["USER"]): TaskActor => ({ id, name, roles });
let key = 0;
const submission = () => `test-key-${Date.now().toString(36)}-${(key += 1)}`;
const today = () => indiaDate(new Date());
const q = async <T,>(sql: string, params: unknown[] = []) => (await getDbPool().query<(RowDataPacket & T)[]>(sql, params))[0];

async function raise(title: string) {
  const result = await raiseTicket({ typeId, title, description: "The accounting software won't install.", priority: "HIGH", requiredOn: new Date(Date.now() + 330 * 60_000 + 86_400_000).toISOString().slice(0, 10), fields: { software: "Tally" }, files: [], submissionKey: submission() }, people.requester!);
  if (!result.ok) throw new Error(result.message);
  return result.value;
}
async function tasksOf(ticketId: number) {
  return q<{ id: number; status: string }>("SELECT id, status FROM tasks WHERE ticket_id = ?", [ticketId]);
}
async function toAwaiting(ticketId: number) {
  const assigned = await assignTicket({ ticketId, assigneeId: people.assignee!.id, targetDate: today(), remarks: "Please install it today", rowVersion: null }, people.coordinator!);
  if (!assigned.ok) throw new Error(assigned.message);
  const done = await workOnTicket({ ticketId, step: "RESOLVE", remarks: "Installed and licensed", rowVersion: null }, people.assignee!);
  if (!done.ok) throw new Error(done.message);
}

beforeAll(async () => {
  const adminId = await createUser({ name: "T Admin", roles: ["USER", "IT_ADMIN"] });
  people.admin = actor(adminId, "T Admin", ["USER", "IT_ADMIN"]);
  people.requester = actor(await createUser({ name: "T Requester" }), "T Requester");
  people.coordinator = actor(await createUser({ name: "T Coordinator" }), "T Coordinator");
  people.assignee = actor(await createUser({ name: "T Assignee" }), "T Assignee");
  people.stranger = actor(await createUser({ name: "T Stranger" }), "T Stranger");
  const created = await createModuleType("TICKET", { code: `TKT_${Date.now().toString(36).toUpperCase()}`, name: "Software installation" }, people.admin);
  if (!created.ok) throw new Error(created.message);
  typeId = created.value.id;
  const saved = await saveTypeDraft("TICKET", typeId, { name: "Software installation", form: [{ key: "software", label: "Software", type: "TEXT", required: true }], settings: { access: { mode: "EVERYONE", departmentIds: [], userIds: [] }, defaultPriority: "NORMAL", requesterPriority: true } }, people.admin);
  if (!saved.ok) throw new Error(saved.message);
  const published = await publishTypeDraft("TICKET", typeId, people.admin);
  if (!published.ok) throw new Error(published.message);
  const [category] = await q<{ id: number }>("SELECT id FROM ticket_categories WHERE code = 'IT_SOFTWARE'");
  const connection = await getDbPool().getConnection();
  try {
    await saveTicketFormSetup(typeId, category!.id, [people.coordinator.id], adminId, connection);
  } finally {
    connection.release();
  }
});

describe("raise and assign", () => {
  it("a raised ticket is numbered by its category, starts NEW and tells the coordinators", async () => {
    const { id, ticketNo } = await raise("Install Tally");
    expect(ticketNo).toMatch(/^IT-SW-\d{4}-\d{5}$/);
    const ticket = await findTicket(id);
    expect(ticket).toMatchObject({ status: "NEW", priority: "HIGH", requesterId: people.requester!.id, formData: { software: "Tally" } });
    const [notice] = await q<{ n: number }>("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND event_type = 'TICKET_NEW'", [people.coordinator!.id]);
    expect(Number(notice!.n)).toBeGreaterThan(0);
  });

  it("the same form sent twice makes one ticket", async () => {
    const keyText = submission();
    const input = { typeId, title: "Twice", description: "Sent twice by a double click", priority: "NORMAL", requiredOn: new Date(Date.now() + 330 * 60_000 + 86_400_000).toISOString().slice(0, 10), fields: { software: "X" }, files: [], submissionKey: keyText };
    expect((await raiseTicket(input, people.requester!)).ok).toBe(true);
    expect((await raiseTicket(input, people.requester!)).ok).toBe(false);
  });

  // v1.55.2 (D-330, owner): the required date is required.
  it("a ticket without a required date is refused", async () => {
    const result = await raiseTicket({ typeId, title: "No date", description: "Missing the date", priority: "NORMAL", requiredOn: "", fields: { software: "X" }, files: [], submissionKey: submission() }, people.requester!);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.fieldErrors?.required_on).toBe("Choose the date you need it by.");
  });

  // v1.59.3 (D-362, owner: "For Ticket assignment i dont want task to be created").
  it("only a coordinator assigns; assigning makes no task", async () => {
    const { id } = await raise("Install SAP GUI");
    expect((await assignTicket({ ticketId: id, assigneeId: people.assignee!.id, targetDate: today(), remarks: "", rowVersion: null }, people.stranger!)).ok).toBe(false);
    const assigned = await assignTicket({ ticketId: id, assigneeId: people.assignee!.id, targetDate: today(), remarks: "Go ahead", rowVersion: null }, people.coordinator!);
    expect(assigned).toMatchObject({ ok: true });
    expect(await findTicket(id)).toMatchObject({ status: "ASSIGNED", assigneeId: people.assignee!.id, taskId: null });
    expect(await tasksOf(id)).toHaveLength(0);
  });

  it("a ticket from before, still linked to an open task: assigning cancels that task and the work continues on the ticket", async () => {
    const { id, ticketNo } = await raise("Old linked task");
    const general = (await generalTypeVersion())!;
    const taskId = await insertTask({ taskNo: `TSK-OLD-${Date.now().toString(36)}`, typeVersionId: general.versionId, title: `${ticketNo} old`, description: "", priority: "NORMAL", createdBy: people.coordinator!.id, assigneeId: people.assignee!.id, dueAt: new Date(Date.now() + 86_400_000), startsOn: null, formData: {}, relatedRequestId: null, submissionKey: null }, getDbPool());
    await linkTaskToTicket(taskId, id, getDbPool());
    await getDbPool().query("UPDATE tickets SET task_id = ? WHERE id = ?", [taskId, id]); // as the old assignment did
    expect((await assignTicket({ ticketId: id, assigneeId: people.stranger!.id, targetDate: today(), remarks: "", rowVersion: null }, people.coordinator!)).ok).toBe(true);
    expect(await tasksOf(id)).toEqual([expect.objectContaining({ id: taskId, status: "CANCELLED" })]);
    const [event] = await q<{ body: string }>("SELECT body FROM task_events WHERE task_id = ? AND event_type = 'CANCEL'", [taskId]);
    expect(event!.body).toContain("updated on the ticket itself");
    expect((await workOnTicket({ ticketId: id, step: "START", remarks: "", rowVersion: null }, people.stranger!)).ok).toBe(true);
    expect((await findTicket(id))!.status).toBe("IN_PROGRESS");
  });

  // v1.57.6 (D-345): reassigning an In-progress ticket to someone else (now on the ticket).
  it("reassigned to a different person while In progress, the ticket goes back to Assigned and they start it", async () => {
    const { id } = await raise("Reassign started");
    expect((await assignTicket({ ticketId: id, assigneeId: people.assignee!.id, targetDate: today(), remarks: "", rowVersion: null }, people.coordinator!)).ok).toBe(true);
    expect((await workOnTicket({ ticketId: id, step: "START", remarks: "", rowVersion: null }, people.assignee!)).ok).toBe(true);
    expect((await findTicket(id))!.status).toBe("IN_PROGRESS");
    expect((await assignTicket({ ticketId: id, assigneeId: people.stranger!.id, targetDate: today(), remarks: "Please take over", rowVersion: null }, people.coordinator!)).ok).toBe(true);
    expect((await findTicket(id))!.status).toBe("ASSIGNED");
    // The earlier assignee can't update it any more; the new one can.
    expect((await workOnTicket({ ticketId: id, step: "START", remarks: "", rowVersion: null }, people.assignee!)).ok).toBe(false);
    expect((await workOnTicket({ ticketId: id, step: "START", remarks: "", rowVersion: null }, people.stranger!)).ok).toBe(true);
    expect((await findTicket(id))!.status).toBe("IN_PROGRESS");
  });
});

describe("work, confirmation and reopening", () => {
  it("on the ticket: only the assignee starts (In progress) and resolves (remarks required → Awaiting confirmation, never Closed)", async () => {
    const { id } = await raise("Install Office");
    await assignTicket({ ticketId: id, assigneeId: people.assignee!.id, targetDate: today(), remarks: "", rowVersion: null }, people.coordinator!);
    expect((await workOnTicket({ ticketId: id, step: "START", remarks: "", rowVersion: null }, people.coordinator!)).ok).toBe(false);
    expect((await workOnTicket({ ticketId: id, step: "START", remarks: "", rowVersion: null }, people.requester!)).ok).toBe(false);
    expect((await workOnTicket({ ticketId: id, step: "START", remarks: "", rowVersion: null }, people.assignee!)).ok).toBe(true);
    expect((await findTicket(id))!.status).toBe("IN_PROGRESS");
    expect((await workOnTicket({ ticketId: id, step: "START", remarks: "", rowVersion: null }, people.assignee!)).ok).toBe(false); // already started
    expect((await workOnTicket({ ticketId: id, step: "RESOLVE", remarks: "", rowVersion: null }, people.assignee!)).ok).toBe(false);
    expect((await workOnTicket({ ticketId: id, step: "RESOLVE", remarks: "Installed Office 2024", rowVersion: null }, people.assignee!)).ok).toBe(true);
    const ticket = await findTicket(id);
    expect(ticket).toMatchObject({ status: "AWAITING_CONFIRMATION", resolutionText: "Installed Office 2024" });
    expect(ticket!.confirmDueOn).toBe(addWorkingDays(today(), 4, await loadWorkingCalendar()));
    expect(await tasksOf(id)).toHaveLength(0);
    const [notice] = await q<{ n: number }>("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND entity_type = 'TICKET' AND entity_id = ?", [people.requester!.id, id]);
    expect(Number(notice!.n)).toBeGreaterThan(0);
  });

  it("only the requester confirms; the assignee can't confirm for them", async () => {
    const { id } = await raise("Install Zoom");
    await toAwaiting(id);
    expect((await confirmTicket({ ticketId: id, rating: 5, feedback: "" }, people.assignee!)).ok).toBe(false);
    expect((await confirmTicket({ ticketId: id, rating: 5, feedback: "" }, people.coordinator!)).ok).toBe(false);
    expect((await confirmTicket({ ticketId: id, rating: 6, feedback: "" }, people.requester!)).ok).toBe(false);
    expect((await confirmTicket({ ticketId: id, rating: 4, feedback: "Quick, thanks" }, people.requester!)).ok).toBe(true);
    expect(await findTicket(id)).toMatchObject({ status: "CLOSED", closeKind: "CONFIRMED" });
    const [feedback] = await q<{ rating: number; comment: string }>("SELECT rating, comment FROM ticket_feedback WHERE ticket_id = ?", [id]);
    expect(feedback).toMatchObject({ rating: 4, comment: "Quick, thanks" });
  });

  it("reopening needs a reason; the same assignee starts it again on the ticket, or the coordinators reassign it", async () => {
    const { id } = await raise("Install VPN");
    await toAwaiting(id);
    expect((await reopenTicket({ ticketId: id, reason: "" }, people.requester!)).ok).toBe(false);
    expect((await reopenTicket({ ticketId: id, reason: "Still can't connect" }, people.requester!)).ok).toBe(true);
    expect(await findTicket(id)).toMatchObject({ status: "REOPENED", reopenCount: 1, assigneeId: people.assignee!.id });
    expect((await workOnTicket({ ticketId: id, step: "START", remarks: "Looking at the certificate", rowVersion: null }, people.assignee!)).ok).toBe(true);
    expect((await findTicket(id))!.status).toBe("IN_PROGRESS");
    expect((await assignTicket({ ticketId: id, assigneeId: people.assignee!.id, targetDate: today(), remarks: "Check the certificate", rowVersion: null }, people.coordinator!)).ok).toBe(true);
    expect(await tasksOf(id)).toHaveLength(0);
    const [events] = await q<{ n: number }>("SELECT COUNT(*) AS n FROM ticket_events WHERE ticket_id = ? AND action IN ('WORK_COMPLETED', 'REOPENED')", [id]);
    expect(Number(events!.n)).toBe(2); // the earlier work stays in the history
  });
});

// v1.56.0 (D-332): the coordinator board shows where each ticket is now.
describe("the coordinator board", () => {
  it("puts each ticket in its current status, for its coordinators and IT only", async () => {
    const { id } = await raise("Board check");
    const asCoordinator = await ticketBoard({ categoryId: null, q: "Board check", overdueOnly: false }, { id: people.coordinator!.id, isAdmin: false });
    expect(asCoordinator.find((item) => item.id === id)).toMatchObject({ status: "NEW", assigneeName: null });
    expect((await ticketBoard({ categoryId: null, q: "Board check", overdueOnly: false }, { id: people.stranger!.id, isAdmin: false })).some((item) => item.id === id)).toBe(false);
    expect((await ticketBoard({ categoryId: null, q: "Board check", overdueOnly: false }, { id: people.stranger!.id, isAdmin: true })).some((item) => item.id === id)).toBe(true);
    expect((await assignTicket({ ticketId: id, assigneeId: people.assignee!.id, targetDate: today(), remarks: "", rowVersion: null }, people.coordinator!)).ok).toBe(true);
    const moved = (await ticketBoard({ categoryId: null, q: "Board check", overdueOnly: false }, { id: people.coordinator!.id, isAdmin: false })).find((item) => item.id === id);
    expect(moved).toMatchObject({ status: "ASSIGNED", assigneeName: expect.any(String) });
    expect(moved!.taskNo).toBeNull(); // v1.59.3: no task
    expect(moved!.statusSince.getTime()).toBeGreaterThan(Date.now() - 5 * 60_000);
  });
});

// v1.56.0 (D-334): Ticket analytics by access.
describe("ticket analytics scope", () => {
  it("counts a ticket for its requester, its coordinators and IT, not for others", async () => {
    const { id } = await raise("Analytics scope");
    const from = new Date(Date.now() - 3_600_000);
    const to = new Date(Date.now() + 3_600_000);
    const has = async (scope: Parameters<typeof analyticsTickets>[0]) => (await analyticsTickets(scope, from, to)).some((row) => row.id === id);
    expect(await has({ all: false, peopleIds: [people.requester!.id], viewerId: people.requester!.id })).toBe(true);
    expect(await has({ all: false, peopleIds: [people.coordinator!.id], viewerId: people.coordinator!.id })).toBe(true);
    expect(await has({ all: false, peopleIds: [people.stranger!.id], viewerId: people.stranger!.id })).toBe(false);
    expect(await has({ all: true })).toBe(true);
    // A manager whose team includes the requester sees it too.
    expect(await has({ all: false, peopleIds: [people.stranger!.id, people.requester!.id], viewerId: people.stranger!.id })).toBe(true);
  });
});

describe("automatic closure after 4 working days", () => {
  const atNoon = (day: string) => new Date(`${day}T06:30:00Z`); // 12:00 India time
  it("reminds on working days 2 and 3 (once each), closes after day 4, even if the job runs twice", async () => {
    const { id } = await raise("Install Chrome");
    await toAwaiting(id);
    const calendar = await loadWorkingCalendar();
    const start = today();
    // Day 1: nothing yet.
    expect(await runTicketConfirmations(atNoon(addWorkingDays(start, 1, calendar)))).toMatchObject({ closed: 0 });
    // Day 2: one reminder, and a second run the same day sends nothing more.
    await runTicketConfirmations(atNoon(addWorkingDays(start, 2, calendar)));
    await runTicketConfirmations(atNoon(addWorkingDays(start, 2, calendar)));
    const steps = async () => (await q<{ stage: string }>("SELECT stage FROM ticket_confirm_steps WHERE ticket_id = ? ORDER BY stage", [id])).map((row) => row.stage);
    expect(await steps()).toEqual(["REMIND_2"]);
    // Day 4 itself: still open (4 complete working days not yet over).
    await runTicketConfirmations(atNoon(addWorkingDays(start, 4, calendar)));
    expect((await findTicket(id))!.status).toBe("AWAITING_CONFIRMATION");
    expect(await steps()).toEqual(["REMIND_2", "REMIND_3"]);
    // The next working day: closed automatically, once.
    const after = atNoon(addWorkingDays(start, 5, calendar));
    await runTicketConfirmations(after);
    await runTicketConfirmations(after);
    const ticket = await findTicket(id);
    expect(ticket).toMatchObject({ status: "CLOSED", closeKind: "AUTO", closeReason: "No answer from the requester in 4 working days" });
    expect(await steps()).toEqual(["REMIND_2", "REMIND_3", "CLOSE"]);
    const [closures] = await q<{ n: number }>("SELECT COUNT(*) AS n FROM ticket_events WHERE ticket_id = ? AND action = 'AUTO_CLOSED'", [id]);
    expect(Number(closures!.n)).toBe(1);
  });

  it("a requester who answers first wins: a confirmed or reopened ticket is never auto-closed", async () => {
    const calendar = await loadWorkingCalendar();
    const late = atNoon(addWorkingDays(today(), 6, calendar));
    const confirmed = await raise("Install Teams");
    await toAwaiting(confirmed.id);
    await confirmTicket({ ticketId: confirmed.id, rating: null, feedback: "" }, people.requester!);
    const reopened = await raise("Install Slack");
    await toAwaiting(reopened.id);
    await reopenTicket({ ticketId: reopened.id, reason: "Not installed" }, people.requester!);
    await runTicketConfirmations(late);
    expect(await findTicket(confirmed.id)).toMatchObject({ status: "CLOSED", closeKind: "CONFIRMED" });
    expect((await findTicket(reopened.id))!.status).toBe("REOPENED");
  });
});
