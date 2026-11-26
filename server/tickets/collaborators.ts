import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { afterResponse } from "@/lib/http/after-response";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import { insertOutbox } from "@/lib/db/repositories/outbox.repository";
import { appendTicketEvent, coordinatorsOf, findTicket } from "@/lib/db/repositories/tickets.repository";
import { deliverOutbox } from "@/server/approvals/service";
import { ticketMessages } from "@/server/modules/messages";
import { canSeeTicket, mayLeaveTicket, mayManageTicketCollaborators } from "@/server/tickets/rules";
import { ticketViewer } from "@/server/tickets/service";
import type { TaskActor } from "@/server/modules/tasks";

// v1.92.0 (D-438, owner 26 Nov 2026, answering Q-036: "tickets get
// collaborators, like requests"). Mirrors request collaborators
// (server/approvals/collaborators.ts, D-127): the ticket's raiser, its
// coordinators, its assignee and IT add people to follow it; they see it,
// comment (and add files with the Ticketing module) and are told how it goes.
// They never assign, work on, confirm or reopen it. Every add and remove is a
// ticket event and an audit entry (append-only); a removal stamps the row
// (removed_at / removed_by), never deletes it.
export const MAX_TICKET_COLLABORATORS = 20;

type Outcome = { ok: true; added: number[]; skipped: string[] } | { ok: false; message: string };
const NOT_FOUND = { ok: false as const, message: "Not found." };

export async function addTicketCollaborators(ticketId: number, userIds: readonly number[], actor: TaskActor, options: { notify?: boolean } = {}): Promise<Outcome> {
  const ticket = await findTicket(ticketId);
  if (!ticket) return NOT_FOUND;
  const viewer = await ticketViewer(ticket, actor);
  if (!mayManageTicketCollaborators(ticket, viewer)) return canSeeTicket(ticket, viewer) ? { ok: false, message: "Only the person who raised the ticket, its coordinators, its assignee and IT add collaborators." } : NOT_FOUND;
  const wanted = [...new Set(userIds.filter((id) => Number.isInteger(id) && id > 0))].slice(0, MAX_TICKET_COLLABORATORS);
  if (!wanted.length) return { ok: false, message: "Choose at least one person." };
  const [people] = await getDbPool().query<(RowDataPacket & { id: number; name: string; active: number; is_break_glass: number })[]>("SELECT id, name, active, is_break_glass FROM users WHERE id IN (?)", [wanted]);
  const coordinators = new Set((await coordinatorsOf(ticket.typeId)).map((person) => person.id));
  const skipped: string[] = [];
  // Inactive people can't be added; the ticket's own people already see it (as "the requester" on a request).
  const valid = wanted.filter((id) => {
    const person = people.find((row) => Number(row.id) === id);
    if (!person || !person.active || person.is_break_glass) {
      skipped.push(person ? `${person.name} (inactive)` : `#${id}`);
      return false;
    }
    const part = id === ticket.requesterId ? "raised it" : id === ticket.assigneeId ? "the assignee" : coordinators.has(id) ? "a coordinator" : null;
    if (part) {
      skipped.push(`${person.name} (${part}, already sees it)`);
      return false;
    }
    return true;
  });
  const result = await withTransaction(async (connection) => {
    // Lock the ticket row: two adds at once can't pass the limit or write the same person twice.
    await connection.query("SELECT id FROM tickets WHERE id = ? FOR UPDATE", [ticketId]);
    const [current] = await connection.query<(RowDataPacket & { user_id: number })[]>("SELECT user_id FROM ticket_collaborators WHERE ticket_id = ? AND removed_at IS NULL", [ticketId]);
    const already = new Set(current.map((row) => Number(row.user_id)));
    const fresh = valid.filter((id) => !already.has(id));
    if (already.size + fresh.length > MAX_TICKET_COLLABORATORS) return { ok: false as const, message: `A ticket can have at most ${MAX_TICKET_COLLABORATORS} collaborators.` };
    for (const id of fresh) {
      await connection.query(
        `INSERT INTO ticket_collaborators (ticket_id, user_id, added_by) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE added_by = VALUES(added_by), added_at = CURRENT_TIMESTAMP, removed_by = NULL, removed_at = NULL`,
        [ticketId, id, actor.id],
      );
    }
    if (!fresh.length) return { ok: true as const, added: [] as number[], outboxIds: [] as number[] };
    const names = fresh.map((id) => String(people.find((row) => Number(row.id) === id)?.name ?? `#${id}`));
    await appendTicketEvent(ticketId, { actorId: actor.id, action: "COLLABORATORS_ADDED", detail: { userIds: fresh, names } }, connection);
    await recordAudit({ actorUserId: actor.id, action: "TICKET_COLLABORATORS_ADDED", entityType: "TICKET", entityId: ticketId, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { ticketNo: ticket.ticketNo, userIds: fresh } }, connection);
    const info = { id: ticket.id, ticketNo: ticket.ticketNo, title: ticket.title };
    const outboxIds = options.notify === false ? [] : await insertOutbox(null, fresh.map((userId) => ticketMessages.collaboratorAdded(info, userId, actor.name)), connection);
    return { ok: true as const, added: fresh, outboxIds };
  });
  if (!result.ok) return result;
  if (result.outboxIds.length) await afterResponse("ticket collaborator messages", () => deliverOutbox(result.outboxIds));
  return { ok: true, added: result.added, skipped };
}

// The raiser, coordinators, assignee and IT remove anyone; a collaborator with
// the Ticketing module may remove themselves (stop following); a Commenter may not (D-434).
export async function removeTicketCollaborator(ticketId: number, userId: number, actor: TaskActor): Promise<{ ok: true } | { ok: false; message: string }> {
  const ticket = await findTicket(ticketId);
  if (!ticket) return NOT_FOUND;
  const viewer = await ticketViewer(ticket, actor);
  const allowed = mayManageTicketCollaborators(ticket, viewer) || (userId === actor.id && mayLeaveTicket(ticket, viewer));
  if (!allowed) return canSeeTicket(ticket, viewer) ? { ok: false, message: "You can't change this ticket's collaborators." } : NOT_FOUND;
  return withTransaction(async (connection) => {
    const [result] = await connection.query<ResultSetHeader>(
      "UPDATE ticket_collaborators SET removed_at = CURRENT_TIMESTAMP, removed_by = ? WHERE ticket_id = ? AND user_id = ? AND removed_at IS NULL",
      [actor.id, ticketId, userId],
    );
    if (result.affectedRows !== 1) return { ok: false as const, message: "That person isn't a collaborator." };
    const [names] = await connection.query<(RowDataPacket & { name: string })[]>("SELECT name FROM users WHERE id = ?", [userId]);
    await appendTicketEvent(ticketId, { actorId: actor.id, action: "COLLABORATOR_REMOVED", detail: { userId, name: names[0]?.name ?? null, self: userId === actor.id } }, connection);
    await recordAudit({ actorUserId: actor.id, action: "TICKET_COLLABORATOR_REMOVED", entityType: "TICKET", entityId: ticketId, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { ticketNo: ticket.ticketNo, userId } }, connection);
    return { ok: true as const };
  });
}
