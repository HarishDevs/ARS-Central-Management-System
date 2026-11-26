import "server-only";
import type { Queryable } from "@/lib/db/client";
import { appendTicketEvent, coordinatorsOf, findTicket, updateTicket } from "@/lib/db/repositories/tickets.repository";
import { loadWorkingCalendar } from "@/lib/db/repositories/calendar.repository";
import { addWorkingDays, indiaDate } from "@/server/workflows/calendar";
import { ticketMessages } from "@/server/modules/messages";
import { CONFIRM_STAGES, statusForTask } from "@/server/tickets/rules";
import type { NotifyInput } from "@/server/notifications/notify";
import { forCollaborators } from "@/server/tickets/collaborator-messages";

// v1.55.0 (owner's brief §5-6): the ticket follows its task, in the task's own
// transaction. Started → In progress; completed (with completion remarks) →
// Awaiting confirmation, which starts the 4-working-day clock and tells the
// requester and the coordinators. Completing the task never closes the ticket.
export async function syncTicketWithTask(ticketId: number, taskStatus: string, actor: { id: number; name: string }, remarks: string, db: Queryable): Promise<NotifyInput[]> {
  return (await applyTicketWork(ticketId, taskStatus, actor, remarks, db)) ?? [];
}

// v1.59.3 (D-362): the same step, now done on the ticket by its assignee
// (workOnTicket). null = the ticket changed meanwhile (row version).
export async function applyTicketWork(ticketId: number, taskStatus: string, actor: { id: number; name: string }, remarks: string, db: Queryable): Promise<NotifyInput[] | null> {
  const ticket = await findTicket(ticketId, db, true);
  if (!ticket) return [];
  const next = statusForTask(taskStatus, ticket.status);
  if (!next) return [];
  const now = new Date();
  const changes: Record<string, unknown> = { status: next };
  if (next === "IN_PROGRESS") changes.work_started_at = now;
  let confirmBy: string | null = null;
  if (next === "AWAITING_CONFIRMATION") {
    // The last day the requester can answer: the 4th working day after today (India).
    confirmBy = addWorkingDays(indiaDate(now), CONFIRM_STAGES.at(-1)!.days, await loadWorkingCalendar(db));
    Object.assign(changes, { resolved_at: now, confirmation_requested_at: now, confirm_due_on: confirmBy, resolution_text: remarks.trim().slice(0, 4000) || null });
  }
  if (!(await updateTicket(ticket.id, ticket.rowVersion, changes, db))) return null;
  await appendTicketEvent(ticket.id, { actorId: actor.id, action: next === "IN_PROGRESS" ? "WORK_STARTED" : "WORK_COMPLETED", from: ticket.status, to: next, detail: next === "AWAITING_CONFIRMATION" ? { remarks: remarks.trim().slice(0, 4000), confirmBy } : null }, db);
  const info = { id: ticket.id, ticketNo: ticket.ticketNo, title: ticket.title };
  // v1.92.0 (D-440): the ticket's collaborators hear both steps too.
  if (next === "IN_PROGRESS") return [ticketMessages.updated(info, ticket.requesterId, `${actor.name} started work on it`), ...(await forCollaborators(ticket.id, [ticket.requesterId], actor.id, (id) => ticketMessages.updated(info, id, `${actor.name} started work on it`), db))];
  const coordinators = await coordinatorsOf(ticket.typeId, db);
  const done = `${actor.name} completed the work; waiting for the requester to confirm`;
  return [
    ticketMessages.confirmationRequested(info, ticket.requesterId, actor.name, confirmBy!),
    ...coordinators.filter((person) => person.id !== actor.id).map((person) => ticketMessages.updated(info, person.id, done)),
    ...(await forCollaborators(ticket.id, [ticket.requesterId, ...coordinators.map((person) => person.id)], actor.id, (id) => ticketMessages.updated(info, id, done), db)),
  ];
}
