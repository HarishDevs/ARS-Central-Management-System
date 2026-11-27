import { isArchived } from "@/lib/db/repositories/archive.repository";
import "server-only";
import { findRequest, findWorkflowVersion } from "@/lib/db/repositories/approvals.repository";
import { handlesRequest, listItemChecks, saveItemCheck, type ItemCheckEntity } from "@/lib/db/repositories/item-checks.repository";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import { storedItems, type FormField } from "@/server/forms/fields";
import { isAdminActor } from "@/server/modules/tasks";
import { loadTicketFor } from "@/server/tickets/service";
import { roleOf } from "@/server/tickets/rules";
import { indiaDateTimeText } from "@/server/modules/settings";

// v1.57.0 (D-335, owner: "a stationary items list with qty request box so that
// the admin can confirm what are all provided"). The items of an Item list field
// are in the record's form data; each line's "provided" tick is kept here, with
// who ticked it and when.
//  - Approval request: IT, anyone with an approval step on it, or the assignee
//    of a work task raised from it may tick.
//  - Ticket: its coordinators (and IT) and its assignee may tick, until it closes.
// Everyone who can see the record sees the ticks.
export interface ChecklistLine {
  lineNo: number;
  description: string;
  quantity: number;
  provided: boolean;
  checkedBy: string | null;
  checkedAt: string | null;
}
export interface Checklist {
  fieldKey: string;
  label: string;
  lines: ChecklistLine[];
}

export async function checklistsFor(entityType: ItemCheckEntity, entityId: number, form: readonly FormField[], data: Record<string, unknown>, hidden: ReadonlySet<string> = new Set()): Promise<Checklist[]> {
  const fields = form.filter((field) => field.type === "ITEM_LIST" && !hidden.has(field.key) && storedItems(data[field.key]).length);
  if (!fields.length) return [];
  const checks = await listItemChecks(entityType, entityId);
  return fields.map((field) => ({
    fieldKey: field.key,
    label: field.label,
    lines: storedItems(data[field.key]).map((item, lineNo) => {
      const check = checks.find((row) => row.fieldKey === field.key && row.lineNo === lineNo);
      return {
        lineNo,
        description: item.description,
        quantity: item.quantity,
        provided: Boolean(check?.provided),
        checkedBy: check ? check.checkedByName : null,
        checkedAt: check ? indiaDateTimeText(check.checkedAt) : null,
      };
    }),
  }));
}

type Actor = { id: number; roles: readonly string[]; sessionId?: string | null; ipAddress?: string | null };

export async function mayTickRequest(requestId: number, actor: Actor): Promise<boolean> {
  if (await isArchived("REQUEST", requestId)) return false; // v1.94.0 (D-456)
  return isAdminActor(actor) || (await handlesRequest(requestId, actor.id));
}

export async function mayTickTicket(ticketId: number, actor: Actor): Promise<boolean> {
  const loaded = await loadTicketFor(ticketId, actor);
  if (!loaded || loaded.ticket.status === "CLOSED") return false;
  const role = roleOf(loaded.ticket, loaded.viewer);
  return role.coordinator || role.assignee;
}

export type TickResult = { ok: true; checkedBy: string; checkedAt: string } | { ok: false; message: string };

export async function setItemProvided(input: { entityType: ItemCheckEntity; entityId: number; fieldKey: string; lineNo: number; provided: boolean }, actor: Actor & { name: string }): Promise<TickResult> {
  const notFound: TickResult = { ok: false, message: "Not found." };
  if (!Number.isInteger(input.entityId) || input.entityId <= 0 || !Number.isInteger(input.lineNo) || input.lineNo < 0 || !/^[a-z][a-z0-9_]{0,79}$/.test(input.fieldKey)) return notFound;
  let form: readonly FormField[];
  let data: Record<string, unknown>;
  if (input.entityType === "REQUEST") {
    const request = await findRequest(input.entityId);
    if (!request) return notFound;
    if (!(await mayTickRequest(request.id, actor))) return { ok: false, message: "Only the request's approvers, its work-task assignees and IT can tick items." };
    const version = await findWorkflowVersion(request.workflowVersionId);
    if (!version) return notFound;
    form = version.form;
    data = request.formData;
  } else {
    const loaded = await loadTicketFor(input.entityId, actor);
    if (!loaded) return notFound;
    if (!(await mayTickTicket(input.entityId, actor))) return { ok: false, message: loaded.ticket.status === "CLOSED" ? "This ticket is closed." : "Only the ticket's coordinators, its assignee and IT can tick items." };
    form = loaded.form;
    data = loaded.ticket.formData;
  }
  const field = form.find((item) => item.key === input.fieldKey && item.type === "ITEM_LIST");
  const items = field ? storedItems(data[field.key]) : [];
  if (!field || input.lineNo >= items.length) return notFound;
  await saveItemCheck(input.entityType, input.entityId, field.key, input.lineNo, input.provided, actor.id);
  await recordAudit({
    actorUserId: actor.id,
    action: input.provided ? "ITEM_PROVIDED" : "ITEM_NOT_PROVIDED",
    entityType: input.entityType,
    entityId: input.entityId,
    sessionId: actor.sessionId ?? null,
    ipAddress: actor.ipAddress ?? null,
    metadata: { field: field.key, line: input.lineNo + 1, item: items[input.lineNo]!.description, quantity: items[input.lineNo]!.quantity },
  });
  return { ok: true, checkedBy: actor.name, checkedAt: indiaDateTimeText(new Date()) };
}
