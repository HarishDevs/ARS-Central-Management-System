import "server-only";
import { withTransaction } from "@/lib/db/transaction";
import { afterResponse } from "@/lib/http/after-response";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import { insertOutbox } from "@/lib/db/repositories/outbox.repository";
import { nextRequestNumber } from "@/lib/db/repositories/approvals.repository";
import { loadFieldLookups } from "@/lib/db/repositories/lookups.repository";
import { findLiveType, versionWithType } from "@/lib/db/repositories/module-types.repository";
import { appendTaskEvent, findTask, insertTask, listPeopleFacts, personFacts, updateTask } from "@/lib/db/repositories/tasks.repository";
import { addFollower, generalTypeVersion } from "@/lib/db/repositories/work.repository";
import { loadWorkingCalendar } from "@/lib/db/repositories/calendar.repository";
import {
  appendTicketEvent,
  awaitingTickets,
  claimConfirmStep,
  coordinatorsOf,
  findTicket,
  findTicketCategory,
  insertTicket,
  insertTicketComment,
  insertTicketFeedback,
  isCoordinatorOf,
  linkTaskToTicket,
  updateTicket,
  viewerCategories,
  type TicketRecord,
} from "@/lib/db/repositories/tickets.repository";
import { discardStaged, insertRecordFiles, RecordFileError, type StagedFile } from "@/server/modules/files";
import { ticketMessages } from "@/server/modules/messages";
import { mayCreate, parseTicketSettings, TICKET_PRIORITIES, type TicketPriority } from "@/server/modules/settings";
import { parseFormSubmission } from "@/server/forms/fields";
import { isAdminActor, withFileCounts, type TaskActor } from "@/server/modules/tasks";
import { dueFromDay } from "@/server/work/service";
import { deliverOutbox } from "@/server/approvals/service";
import { addWorkingDays, indiaDate } from "@/server/workflows/calendar";
import { allowedTicketActions, canSeeTicket, CONFIRM_STAGES, seesInternal, type TicketAction, type TicketViewer } from "@/server/tickets/rules";
import { logError } from "@/lib/logging/logger";
import type { NotifyInput } from "@/server/notifications/notify";

// v1.55.0 (D-326, D-327; owner's simple brief): the Ticketing System.
// RAISE → coordinator ASSIGNS (a linked task) → assignee works in Tasks →
// completing the task asks the requester → CONFIRM closes / REOPEN returns it
// to the coordinators / no answer in 4 working days closes it automatically.
export type TicketResult<T = undefined> = { ok: true; value: T } | { ok: false; message: string; fieldErrors?: Record<string, string> };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const fail = <T,>(message: string, fieldErrors?: Record<string, string>): TicketResult<T> => ({ ok: false, message, fieldErrors });
const info = (ticket: Pick<TicketRecord, "id" | "ticketNo" | "title">) => ({ id: ticket.id, ticketNo: ticket.ticketNo, title: ticket.title });

async function send(ids: number[]) {
  if (ids.length) await afterResponse("ticket messages", () => deliverOutbox(ids));
}

export async function ticketViewer(ticket: TicketRecord, actor: { id: number; roles: readonly string[] }): Promise<TicketViewer> {
  const [isCoordinator, named] = await Promise.all([isCoordinatorOf(ticket.typeId, actor.id), viewerCategories(actor.id)]);
  // v1.57.1 (D-338): named for every category, or for this ticket's category.
  return { id: actor.id, isAdmin: isAdminActor(actor), isCoordinator, seesAll: named === "ALL" || named.includes(ticket.categoryId) };
}

// The ticket, if this person may see it (else null: a 404).
export async function loadTicketFor(id: number, actor: { id: number; roles: readonly string[] }) {
  const ticket = await findTicket(id);
  if (!ticket) return null;
  const viewer = await ticketViewer(ticket, actor);
  if (!canSeeTicket(ticket, viewer)) return null;
  const ctx = await versionWithType(ticket.typeVersionId);
  if (!ctx) return null;
  return { ticket, viewer, form: ctx.version.form, actions: allowedTicketActions(ticket, viewer), internal: seesInternal(ticket, viewer) };
}

// ---- raise --------------------------------------------------------------------------------------
export interface RaiseTicketInput {
  typeId: number;
  title: string;
  description: string;
  priority: string;
  requiredOn: string;
  fields: Record<string, string | undefined>;
  files: StagedFile[]; // form attachment fields (fieldKey) and general attachments (no fieldKey)
  submissionKey: string;
}

export async function raiseTicket(input: RaiseTicketInput, actor: TaskActor): Promise<TicketResult<{ id: number; ticketNo: string }>> {
  try {
    const type = await findLiveType("TICKET", input.typeId);
    if (!type) {
      await discardStaged(input.files);
      return fail("That ticket form isn't available.");
    }
    const settings = parseTicketSettings(type.settings);
    const me = await personFacts(actor.id);
    if (!me || !mayCreate(settings.access, { id: actor.id, departmentId: me.departmentId })) {
      await discardStaged(input.files);
      return fail("You can't raise this kind of ticket.");
    }
    const errors: Record<string, string> = {};
    const title = input.title.trim();
    if (title.length < 3 || title.length > 200) errors.title = "Write a subject of 3 to 200 characters.";
    const description = input.description.trim();
    if (description.length < 3) errors.description = "Describe what you need (3 characters or more).";
    else if (description.length > 20000) errors.description = "Use 20,000 characters or fewer.";
    const priority: TicketPriority = settings.requesterPriority && (TICKET_PRIORITIES as readonly string[]).includes(input.priority) ? (input.priority as TicketPriority) : settings.defaultPriority;
    let requiredOn: string | null = null;
    // v1.55.2 (D-330, owner): the required date is required.
    if (!input.requiredOn) errors.required_on = "Choose the date you need it by.";
    else {
      if (!ISO.test(input.requiredOn)) errors.required_on = "Choose a valid date.";
      else if (input.requiredOn < indiaDate(new Date())) errors.required_on = "The required date can't be in the past.";
      else requiredOn = input.requiredOn;
    }
    const people = await listPeopleFacts();
    const parsed = parseFormSubmission(type.form, withFileCounts(type.form, input.fields, input.files), new Set(people.map((person) => person.id)), await loadFieldLookups());
    if (!parsed.ok) Object.assign(errors, parsed.errors);
    const submissionKey = /^[A-Za-z0-9-]{8,64}$/.test(input.submissionKey) ? input.submissionKey : "";
    if (!submissionKey) errors.form = "Reload the page and try again.";
    if (Object.keys(errors).length) {
      await discardStaged(input.files);
      return fail("Check the highlighted fields.", errors);
    }
    const coordinators = await coordinatorsOf(input.typeId);
    if (coordinators.length === 0) {
      await discardStaged(input.files);
      return fail("This form has no coordinator yet, so nobody would receive the ticket. Ask IT to add one.");
    }
    const outcome = await withTransaction(async (connection) => {
      const [category] = await connection.query<import("mysql2/promise").RowDataPacket[]>("SELECT category_id FROM ticket_request_types WHERE type_id = ?", [input.typeId]);
      const categoryId = category[0] ? Number(category[0].category_id) : null;
      const found = categoryId ? await findTicketCategory(categoryId, connection) : null;
      if (!found || !found.active) return { error: "That ticket form isn't available." } as const;
      const ticketNo = await nextRequestNumber(found.numberPrefix, connection, found.numberDigits);
      const id = await insertTicket({ ticketNo, categoryId: found.id, typeVersionId: type.versionId, title, description, formData: parsed.data, requesterId: actor.id, departmentId: me.departmentId, priority, requiredOn, submissionKey }, connection);
      if (id === "DUPLICATE") return { duplicate: true } as const;
      await appendTicketEvent(id, { actorId: actor.id, action: "RAISED", to: "NEW", detail: { priority, requiredOn } }, connection);
      await insertRecordFiles("TICKET", id, input.files, actor.id, "GENERAL", connection);
      await recordAudit({ actorUserId: actor.id, action: "TICKET_RAISED", entityType: "TICKET", entityId: id, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { ticketNo, typeVersionId: type.versionId, files: input.files.length } }, connection);
      const summary = { id, ticketNo, title };
      const outbox = await insertOutbox(null, [ticketMessages.submitted(summary, actor.id), ...coordinators.filter((person) => person.id !== actor.id).map((person) => ticketMessages.forCoordinator(summary, person.id, actor.name, type.name))], connection);
      return { id, ticketNo, outbox } as const;
    });
    if ("error" in outcome) {
      await discardStaged(input.files);
      return fail(outcome.error!);
    }
    if ("duplicate" in outcome) {
      await discardStaged(input.files);
      return fail("This ticket was already raised (the form was sent twice). Open My tickets to see it.");
    }
    await send(outcome.outbox);
    return { ok: true, value: { id: outcome.id, ticketNo: outcome.ticketNo } };
  } catch (error) {
    await discardStaged(input.files);
    if (error instanceof RecordFileError) return fail(error.message);
    throw error;
  }
}

// ---- coordinator: assign (makes the linked task) or reassign ------------------------------------

export interface AssignInput {
  ticketId: number;
  assigneeId: number;
  targetDate: string; // YYYY-MM-DD (11:59 pm India time, as tasks)
  remarks: string;
  rowVersion: number | null;
}
export async function assignTicket(input: AssignInput, actor: TaskActor): Promise<TicketResult<{ message: string }>> {
  if (!ISO.test(input.targetDate)) return fail("Choose a target date.", { target: "Choose a target date." });
  if (input.targetDate < indiaDate(new Date())) return fail("The target date can't be in the past.", { target: "The target date can't be in the past." });
  const remarks = input.remarks.trim();
  if (remarks.length > 4000) return fail("Use 4000 characters or fewer.", { remarks: "Use 4000 characters or fewer." });
  const assignee = await personFacts(input.assigneeId);
  if (!assignee?.active) return fail("Choose an active employee.", { assignee: "Choose an active employee." });
  const general = await generalTypeVersion();
  if (!general) return fail("The General task type is switched off. Ask IT to switch it on in Admin → Task types.");
  const dueAt = dueFromDay(input.targetDate);
  if (!dueAt) return fail("Choose a valid target date.", { target: "Choose a valid target date." });
  const outcome = await withTransaction(async (connection) => {
    const ticket = await findTicket(input.ticketId, connection, true);
    if (!ticket) return { error: "Not found." } as const;
    const viewer = await ticketViewer(ticket, actor);
    if (!allowedTicketActions(ticket, viewer).has("ASSIGN")) return { error: canSeeTicket(ticket, viewer) ? "It can't be assigned now. Reload to see its latest state." : "Not found." } as const;
    if (input.rowVersion !== null && input.rowVersion !== ticket.rowVersion) return { error: "Someone changed this ticket while you were looking. Reload and try again." } as const;
    const messages: NotifyInput[] = [];
    const reopened = ticket.status === "REOPENED";
    let taskId = ticket.taskId;
    let taskNo = ticket.taskNo ?? "";
    const taskTitle = `${ticket.ticketNo} ${ticket.title}`.slice(0, 200);
    if (!taskId) {
      // The first assignment: one task, in the assignee's Tasks, linked for good.
      taskNo = await nextRequestNumber("TSK", connection);
      const description = [`Ticket ${ticket.ticketNo} (${ticket.categoryName}: ${ticket.typeName}), raised by ${ticket.requesterName}${ticket.departmentName ? ` (${ticket.departmentName})` : ""}.`, ticket.requiredOn ? `Required by ${ticket.requiredOn}.` : "", "", ticket.description ?? "", remarks ? `\nCoordinator's remarks: ${remarks}` : ""].join("\n").slice(0, 4000);
      taskId = await insertTask({ taskNo, typeVersionId: general.versionId, title: taskTitle, description, priority: ticket.priority /* v1.55.1: one scale; the task keeps the ticket's priority */, createdBy: actor.id, assigneeId: assignee.id, dueAt, startsOn: null, formData: {}, relatedRequestId: null, submissionKey: null }, connection);
      await linkTaskToTicket(taskId, ticket.id, connection);
      await appendTaskEvent(taskId, { actorId: actor.id, type: "CREATED", to: "OPEN", payload: { assigneeId: assignee.id, dueAt: dueAt.toISOString(), ticketId: ticket.id, ticketNo: ticket.ticketNo } }, connection);
      await addFollower(taskId, actor.id, "CREATOR", actor.id, connection);
      await addFollower(taskId, assignee.id, "ASSIGNEE", actor.id, connection);
    } else {
      // Reassign (new person or date) or, after reopening, the same task back to Open.
      const task = await findTask(taskId, connection, true);
      if (!task) return { error: "The ticket's task is missing. Ask IT." } as const;
      const changes: Record<string, unknown> = { assignee_id: assignee.id, assigned_by: actor.id, assigned_at: new Date(), due_at: dueAt };
      if (reopened || task.status === "COMPLETED" || task.status === "CANCELLED") Object.assign(changes, { status: "OPEN", completed_by: null, completed_at: null, cancelled_by: null, cancelled_at: null });
      if (!(await updateTask(task.id, task.rowVersion, changes, connection))) return { error: "The task changed while you were looking. Reload and try again." } as const;
      await appendTaskEvent(task.id, { actorId: actor.id, type: reopened ? "REOPEN" : "REASSIGN", from: task.status, to: (changes.status as string | undefined) ?? task.status, body: remarks || null, payload: { from: task.assigneeId, to: assignee.id, ticketId: ticket.id } }, connection);
      await addFollower(task.id, assignee.id, "ASSIGNEE", actor.id, connection);
    }
    const nextStatus = ticket.status === "IN_PROGRESS" && !reopened && ticket.assigneeId === assignee.id ? "IN_PROGRESS" : "ASSIGNED";
    const changes: Record<string, unknown> = { status: nextStatus, assignee_id: assignee.id, coordinator_id: actor.id, task_id: taskId, due_at: dueAt, assigned_at: new Date() };
    if (!ticket.firstResponseAt) changes.first_response_at = new Date();
    if (!(await updateTicket(ticket.id, ticket.rowVersion, changes, connection))) return { error: "Someone changed this ticket while you were looking. Reload and try again." } as const;
    const action = ticket.assigneeId ? (reopened ? "REASSIGNED_AFTER_REOPEN" : "REASSIGNED") : "ASSIGNED";
    await appendTicketEvent(ticket.id, { actorId: actor.id, action, from: ticket.status, to: nextStatus, detail: { assigneeId: assignee.id, assigneeName: assignee.name, targetDate: input.targetDate, taskNo } }, connection);
    if (remarks) {
      await insertTicketComment(ticket.id, actor.id, remarks, true, connection);
    }
    await recordAudit({ actorUserId: actor.id, action: `TICKET_${action}`, entityType: "TICKET", entityId: ticket.id, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { ticketNo: ticket.ticketNo, assigneeId: assignee.id, targetDate: input.targetDate, taskId } }, connection);
    if (assignee.id !== actor.id) messages.push(ticketMessages.assigned(info(ticket), assignee.id, actor.name, taskNo));
    if (ticket.requesterId !== actor.id) messages.push(ticketMessages.updated(info(ticket), ticket.requesterId, `assigned to ${assignee.name}, target ${input.targetDate}`));
    return { outbox: await insertOutbox(null, messages, connection), taskNo } as const;
  });
  if ("error" in outcome) return fail(outcome.error!);
  await send(outcome.outbox);
  return { ok: true, value: { message: `Assigned to ${assignee.name}. Task ${outcome.taskNo} is in their Tasks.` } };
}

// ---- requester: confirm or reopen ------------------------------------------------------------
export async function confirmTicket(input: { ticketId: number; rating: number | null; feedback: string }, actor: TaskActor): Promise<TicketResult<{ message: string }>> {
  if (input.rating !== null && !(Number.isInteger(input.rating) && input.rating >= 1 && input.rating <= 5)) return fail("Rate it from 1 to 5, or leave the rating out.", { rating: "Rate it from 1 to 5." });
  const feedback = input.feedback.trim();
  if (feedback.length > 1000) return fail("Use 1000 characters or fewer.", { feedback: "Use 1000 characters or fewer." });
  return closeOrReopen(input.ticketId, "CONFIRM", actor, async (ticket, connection) => {
    // Conditional on the status: if auto-close got there first, nothing changes.
    if (!(await updateTicket(ticket.id, ticket.rowVersion, { status: "CLOSED", close_kind: "CONFIRMED", closed_at: new Date(), close_reason: "Confirmed by the requester" }, connection))) return null;
    await insertTicketFeedback(ticket.id, ticket.reopenCount, input.rating, feedback || null, actor.id, connection);
    await appendTicketEvent(ticket.id, { actorId: actor.id, action: "CONFIRMED", from: ticket.status, to: "CLOSED", detail: { rating: input.rating, feedback: feedback || null } }, connection);
    const to = [ticket.assigneeId, ...(await coordinatorsOf(ticket.typeId, connection)).map((person) => person.id)].filter((id): id is number => id !== null && id !== actor.id);
    return { messages: [...new Set(to)].map((id) => ticketMessages.closed(info(ticket), id, `confirmed by ${actor.name}${input.rating ? `, rated ${input.rating}/5` : ""}`)), message: "Thank you. The ticket is closed." };
  });
}

export async function reopenTicket(input: { ticketId: number; reason: string }, actor: TaskActor): Promise<TicketResult<{ message: string }>> {
  const reason = input.reason.trim();
  if (reason.length < 3) return fail("Say why it isn't solved (3 characters or more).", { reason: "Say why it isn't solved (3 characters or more)." });
  if (reason.length > 2000) return fail("Use 2000 characters or fewer.", { reason: "Use 2000 characters or fewer." });
  return closeOrReopen(input.ticketId, "REOPEN", actor, async (ticket, connection) => {
    if (!(await updateTicket(ticket.id, ticket.rowVersion, { status: "REOPENED", reopen_count: ticket.reopenCount + 1, confirmation_requested_at: null, confirm_due_on: null }, connection))) return null;
    // v1.55.3 (D-331, owner: "after reopen the ticket the Ticket is not reopening in the task"):
    // the same task goes straight back to Open for the same assignee, in their Tasks.
    // Earlier work stays in the history; the coordinators can still reassign it.
    if (ticket.taskId) {
      const task = await findTask(ticket.taskId, connection, true);
      if (task && (task.status === "COMPLETED" || task.status === "CANCELLED")) {
        if (!(await updateTask(task.id, task.rowVersion, { status: "OPEN", completed_by: null, completed_at: null, cancelled_by: null, cancelled_at: null }, connection))) return null;
        await appendTaskEvent(task.id, { actorId: actor.id, type: "REOPEN", from: task.status, to: "OPEN", body: `Ticket ${ticket.ticketNo} reopened: ${reason}`.slice(0, 2000), payload: { ticketId: ticket.id } }, connection);
      }
    }
    await appendTicketEvent(ticket.id, { actorId: actor.id, action: "REOPENED", from: ticket.status, to: "REOPENED", detail: { reason, previousResolution: ticket.resolutionText } }, connection);
    await insertTicketComment(ticket.id, actor.id, `Reopened: ${reason}`, false, connection);
    const to = [ticket.assigneeId, ...(await coordinatorsOf(ticket.typeId, connection)).map((person) => person.id)].filter((id): id is number => id !== null && id !== actor.id);
    return { messages: [...new Set(to)].map((id) => ticketMessages.reopened(info(ticket), id, actor.name, reason)), message: "Reopened. The task is open again for the assignee, and the coordinators have been told." };
  });
}

async function closeOrReopen(
  ticketId: number,
  action: TicketAction,
  actor: TaskActor,
  apply: (ticket: TicketRecord, connection: Parameters<typeof insertOutbox>[2]) => Promise<{ messages: NotifyInput[]; message: string } | null>,
): Promise<TicketResult<{ message: string }>> {
  const outcome = await withTransaction(async (connection) => {
    const ticket = await findTicket(ticketId, connection, true);
    if (!ticket) return { error: "Not found." } as const;
    const viewer = await ticketViewer(ticket, actor);
    if (!allowedTicketActions(ticket, viewer).has(action)) return { error: canSeeTicket(ticket, viewer) ? (ticket.status === "CLOSED" ? "This ticket is already closed." : "Only the person who raised the ticket can do that, while it waits for confirmation.") : "Not found." } as const;
    const done = await apply(ticket, connection);
    if (!done) return { error: "It changed a moment ago. Reload to see its latest state." } as const;
    await recordAudit({ actorUserId: actor.id, action: `TICKET_${action === "CONFIRM" ? "CONFIRMED" : "REOPENED"}`, entityType: "TICKET", entityId: ticket.id, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { ticketNo: ticket.ticketNo } }, connection);
    return { outbox: await insertOutbox(null, done.messages, connection), message: done.message } as const;
  });
  if ("error" in outcome) return fail(outcome.error!);
  await send(outcome.outbox);
  return { ok: true, value: { message: outcome.message } };
}

// ---- comments / remarks ---------------------------------------------------------------------------
export async function commentOnTicket(input: { ticketId: number; body: string; internal: boolean; files: StagedFile[] }, actor: TaskActor): Promise<TicketResult<{ message: string }>> {
  const body = input.body.trim();
  if (body.length < 1 && input.files.length === 0) return fail("Write a remark or attach a file.", { body: "Write a remark or attach a file." });
  if (body.length > 4000) return fail("Use 4000 characters or fewer.", { body: "Use 4000 characters or fewer." });
  try {
    const outcome = await withTransaction(async (connection) => {
      const ticket = await findTicket(input.ticketId, connection, true);
      if (!ticket) return { error: "Not found." } as const;
      const viewer = await ticketViewer(ticket, actor);
      if (!allowedTicketActions(ticket, viewer).has("COMMENT")) return { error: canSeeTicket(ticket, viewer) ? "This ticket is closed." : "Not found." } as const;
      // Only coordinators and the assignee may keep a remark internal.
      const internal = input.internal && seesInternal(ticket, viewer) && ticket.requesterId !== actor.id;
      if (body) await insertTicketComment(ticket.id, actor.id, body, internal, connection);
      await insertRecordFiles("TICKET", ticket.id, input.files, actor.id, "GENERAL", connection);
      await appendTicketEvent(ticket.id, { actorId: actor.id, action: input.files.length && !body ? "FILES_ADDED" : "REMARK", internal, detail: input.files.length ? { files: input.files.length } : null }, connection);
      const people = new Set<number>([...(await coordinatorsOf(ticket.typeId, connection)).map((person) => person.id), ...(ticket.assigneeId ? [ticket.assigneeId] : []), ...(internal ? [] : [ticket.requesterId])]);
      people.delete(actor.id);
      return { outbox: await insertOutbox(null, [...people].map((id) => ticketMessages.comment(info(ticket), id, actor.name)), connection) } as const;
    });
    if ("error" in outcome) {
      await discardStaged(input.files);
      return fail(outcome.error!);
    }
    await send(outcome.outbox);
    return { ok: true, value: { message: input.internal ? "Remark added (coordinators and the assignee see it)." : "Remark added." } };
  } catch (error) {
    await discardStaged(input.files);
    if (error instanceof RecordFileError) return fail(error.message);
    throw error;
  }
}

// ---- the confirmation clock (job runner, every call) ---------------------------------------------
// Reminders on working days 2 and 3 after the work was completed; closed after 4 complete working days
// (the day after the 4th working day). Each stage is claimed once per confirmation cycle, and the
// closure is conditional on the ticket still waiting (a last-minute confirm or reopen wins).
export async function runTicketConfirmations(now = new Date()): Promise<{ reminded: number; closed: number }> {
  const calendar = await loadWorkingCalendar();
  const today = indiaDate(now);
  let reminded = 0;
  let closed = 0;
  for (const item of await awaitingTickets()) {
    const requestedDay = indiaDate(item.requestedAt);
    for (const { stage, days } of CONFIRM_STAGES) {
      const dueDay = addWorkingDays(requestedDay, days, calendar);
      // Reminders on the working day itself; closing only once the 4th working day is over.
      const due = stage === "CLOSE" ? today > dueDay : today >= dueDay;
      if (!due) continue;
      try {
        const outcome = await withTransaction(async (connection) => {
          const ticket = await findTicket(item.id, connection, true);
          if (!ticket || ticket.status !== "AWAITING_CONFIRMATION" || ticket.reopenCount !== item.reopenCount) return null;
          if (!(await claimConfirmStep(ticket.id, ticket.reopenCount, stage, connection))) return null;
          const lastDay = addWorkingDays(requestedDay, CONFIRM_STAGES.at(-1)!.days, calendar);
          if (stage !== "CLOSE") {
            await appendTicketEvent(ticket.id, { actorId: null, action: "CONFIRM_REMINDER", detail: { workingDay: days } }, connection);
            return { kind: "reminder", outbox: await insertOutbox(null, [ticketMessages.confirmReminder(info(ticket), ticket.requesterId, lastDay)], connection) } as const;
          }
          const reason = "No answer from the requester in 4 working days";
          if (!(await updateTicket(ticket.id, ticket.rowVersion, { status: "CLOSED", close_kind: "AUTO", closed_at: new Date(), close_reason: reason }, connection))) return null;
          await appendTicketEvent(ticket.id, { actorId: null, action: "AUTO_CLOSED", from: ticket.status, to: "CLOSED", detail: { reason, lastDay } }, connection);
          await recordAudit({ actorUserId: null, action: "TICKET_AUTO_CLOSED", entityType: "TICKET", entityId: ticket.id, metadata: { ticketNo: ticket.ticketNo, lastDay } }, connection);
          const to = [ticket.requesterId, ticket.assigneeId, ...(await coordinatorsOf(ticket.typeId, connection)).map((person) => person.id)].filter((id): id is number => id !== null);
          return { kind: "closed", outbox: await insertOutbox(null, [...new Set(to)].map((id) => ticketMessages.closed(info(ticket), id, "closed automatically: no answer in 4 working days")), connection) } as const;
        });
        if (!outcome) continue;
        if (outcome.kind === "closed") closed += 1;
        else reminded += 1;
        await deliverOutbox(outcome.outbox).catch((error: unknown) => logError("ticket confirmations: delivery", error));
        if (outcome.kind === "closed") break;
      } catch (error) {
        logError("ticket confirmations failed", error, { ticketId: item.id, stage });
      }
    }
  }
  return { reminded, closed };
}
