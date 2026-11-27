"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireApiArea } from "@/server/authorization/guards";
import { hasModule } from "@/server/modules/modules";
import { getActionContext } from "@/lib/http/request-context";
import { readFiles } from "@/server/modules/upload";
import { findLiveType } from "@/lib/db/repositories/module-types.repository";
import { assignTicket, commentOnTicket, confirmTicket, raiseTicket, reopenTicket, workOnTicket } from "@/server/tickets/service";
import type { TaskActor } from "@/server/modules/tasks";
import { LIMITS, overLimit } from "@/server/security/limits";
import { logError } from "@/lib/logging/logger";
import { addTicketCollaborators, removeTicketCollaborator } from "@/server/tickets/collaborators";
import { collaboratorIdsFrom } from "@/server/approvals/collaborators";
import type { ActionResult } from "@/lib/http/action-result";
import { ON_BEHALF_FIELD, parseOnBehalfId, resolveOnBehalf } from "@/server/superadmin/control/on-behalf";

// v1.55.0 (owner's ticketing brief): the Ticketing System's actions. The
// session and the feature switch are checked here; the service re-checks who
// may do what, under a lock, against the ticket's latest state.
// v1.55.1 (D-329): raising needs the Ticketing module; acting on a ticket
// you're on (assignee, requester, coordinator) is decided by the service.
async function actor(needModule = false): Promise<TaskActor | null> {
  try {
    const session = await requireApiArea("users");
    if (needModule && !hasModule(session.user, "TICKET")) return null;
    const { ipAddress } = await getActionContext();
    return { id: session.user.id, name: session.user.name, roles: session.user.roles, sessionId: session.sessionId, ipAddress };
  } catch {
    return null;
  }
}
const NOT_FOUND: ActionResult = { ok: false, message: "Not found." };
const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};
const idOf = (value: string) => (/^\d{1,10}$/.test(value) ? Number(value) : null);

export async function raiseTicketAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const signedIn = await actor(true);
  if (!signedIn) return NOT_FOUND;
  // v1.94.0 (D-458): Super Admin raising it on someone's behalf: the ticket is
  // theirs (requester, their rules), checked on the server.
  let me: TaskActor = signedIn;
  let onBehalfBy: number | null = null;
  const behalfId = parseOnBehalfId(formData.get(ON_BEHALF_FIELD));
  if (behalfId !== null) {
    const resolved = await resolveOnBehalf(signedIn, behalfId, "TICKET");
    if (!resolved.ok) return { ok: false, message: resolved.message };
    me = { id: resolved.person.id, name: resolved.person.name, roles: resolved.person.roles, sessionId: signedIn.sessionId, ipAddress: signedIn.ipAddress };
    onBehalfBy = signedIn.id;
  }
  // Abuse guard: at most 5 tickets a minute per person.
  if (await overLimit(`ticket-raise:${me.id}`, LIMITS.ticketRaise)) return { ok: false, message: "That's a lot of tickets in a short time. Please wait a little and try again." };
  const typeId = idOf(text(formData, "type"));
  const type = typeId ? await findLiveType("TICKET", typeId) : null;
  if (!type || !typeId) return { ok: false, message: "That ticket form isn't available." };
  const files = await readFiles(
    formData,
    type.form.filter((field) => field.type === "ATTACHMENT").map((field) => field.key),
  );
  if (!files.ok) return { ok: false, message: files.message };
  const fields: Record<string, string | undefined> = {};
  for (const field of type.form) fields[field.key] = formData.has(field.key) ? text(formData, field.key) : undefined;
  let saved: { id: number; ticketNo: string };
  try {
    const result = await raiseTicket(
      { typeId, title: text(formData, "title"), description: text(formData, "description"), priority: text(formData, "priority"), requiredOn: text(formData, "required_on"), fields, files: files.staged, submissionKey: text(formData, "submission_key"), onBehalfBy },
      me,
    );
    if (!result.ok) return { ok: false, message: result.message, fieldErrors: result.fieldErrors };
    saved = result.value;
  } catch (error) {
    logError("raiseTicketAction failed", error);
    return { ok: false, message: "Couldn't raise the ticket. Please try again." };
  }
  revalidatePath("/users/tickets");
  redirect(`/users/tickets/${saved.id}?raised=1`);
}

export async function assignTicketAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  const ticketId = idOf(text(formData, "ticketId"));
  const assigneeId = idOf(text(formData, "assignee"));
  if (!me || !ticketId) return NOT_FOUND;
  if (!assigneeId) return { ok: false, message: "Choose who should do it.", fieldErrors: { assignee: "Choose who should do it." } };
  try {
    const result = await assignTicket({ ticketId, assigneeId, targetDate: text(formData, "target"), remarks: text(formData, "remarks"), rowVersion: idOf(text(formData, "rowVersion")) }, me);
    revalidatePath(`/users/tickets/${ticketId}`);
    return result.ok ? { ok: true, message: result.value.message } : { ok: false, message: result.message, fieldErrors: result.fieldErrors };
  } catch (error) {
    logError("assignTicketAction failed", error);
    return { ok: false, message: "Couldn't assign it. Please try again." };
  }
}

// v1.59.3 (D-362, owner): the assignee starts and resolves the work on the ticket (no task).
export async function ticketWorkAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  const ticketId = idOf(text(formData, "ticketId"));
  const step = text(formData, "step");
  if (!me || !ticketId || (step !== "START" && step !== "RESOLVE")) return NOT_FOUND;
  try {
    const result = await workOnTicket({ ticketId, step, remarks: text(formData, "remarks"), rowVersion: idOf(text(formData, "rowVersion")) }, me);
    revalidatePath(`/users/tickets/${ticketId}`);
    revalidatePath("/users/tickets");
    return result.ok ? { ok: true, message: result.value.message } : { ok: false, message: result.message, fieldErrors: result.fieldErrors };
  } catch (error) {
    logError("ticketWorkAction failed", error);
    return { ok: false, message: "Couldn't update it. Please try again." };
  }
}

export async function acceptResolutionAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  const ticketId = idOf(text(formData, "ticketId"));
  if (!me || !ticketId) return NOT_FOUND;
  const ratingText = text(formData, "rating");
  try {
    const result = await confirmTicket({ ticketId, rating: ratingText ? Number(ratingText) : null, feedback: text(formData, "feedback") }, me);
    revalidatePath(`/users/tickets/${ticketId}`);
    return result.ok ? { ok: true, message: result.value.message } : { ok: false, message: result.message, fieldErrors: result.fieldErrors };
  } catch (error) {
    logError("acceptResolutionAction failed", error);
    return { ok: false, message: "Couldn't confirm it. Please try again." };
  }
}

export async function reopenTicketAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  const ticketId = idOf(text(formData, "ticketId"));
  if (!me || !ticketId) return NOT_FOUND;
  try {
    const result = await reopenTicket({ ticketId, reason: text(formData, "reason") }, me);
    revalidatePath(`/users/tickets/${ticketId}`);
    return result.ok ? { ok: true, message: result.value.message } : { ok: false, message: result.message, fieldErrors: result.fieldErrors };
  } catch (error) {
    logError("reopenTicketAction failed", error);
    return { ok: false, message: "Couldn't reopen it. Please try again." };
  }
}

export async function commentTicketAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  const ticketId = idOf(text(formData, "ticketId"));
  if (!me || !ticketId) return NOT_FOUND;
  const files = await readFiles(formData, []);
  if (!files.ok) return { ok: false, message: files.message };
  try {
    const result = await commentOnTicket({ ticketId, body: text(formData, "body"), internal: text(formData, "internal") === "yes", files: files.staged }, me);
    revalidatePath(`/users/tickets/${ticketId}`);
    return result.ok ? { ok: true, message: result.value.message } : { ok: false, message: result.message, fieldErrors: result.fieldErrors };
  } catch (error) {
    logError("commentTicketAction failed", error);
    return { ok: false, message: "Couldn't add the remark. Please try again." };
  }
}

// v1.92.0 (D-438): collaborators on a ticket, like a request's. The service
// decides who may (raiser, coordinators, assignee, IT add and remove; a
// collaborator with the Ticketing module only removes themselves).
export async function addTicketCollaboratorsAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  const ticketId = idOf(text(formData, "ticketId"));
  if (!me || !ticketId) return NOT_FOUND;
  try {
    const result = await addTicketCollaborators(ticketId, collaboratorIdsFrom(formData), me);
    if (!result.ok) return { ok: false, message: result.message, fieldErrors: { collaborator: result.message } };
    revalidatePath(`/users/tickets/${ticketId}`);
    const skipped = result.skipped.length ? ` Not added: ${result.skipped.join(", ")}.` : "";
    return result.added.length ? { ok: true, message: `Added ${result.added.length} collaborator${result.added.length === 1 ? "" : "s"}; they have been told.${skipped}` } : { ok: false, message: `Nobody new to add.${skipped}` };
  } catch (error) {
    logError("addTicketCollaboratorsAction failed", error);
    return { ok: false, message: "Couldn't add. Please try again." };
  }
}

export async function removeTicketCollaboratorAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  const ticketId = idOf(text(formData, "ticketId"));
  const userId = idOf(text(formData, "userId"));
  if (!me || !ticketId || !userId) return NOT_FOUND;
  try {
    const result = await removeTicketCollaborator(ticketId, userId, me);
    if (!result.ok) return { ok: false, message: result.message };
  } catch (error) {
    logError("removeTicketCollaboratorAction failed", error);
    return { ok: false, message: "Couldn't remove. Please try again." };
  }
  revalidatePath(`/users/tickets/${ticketId}`);
  return { ok: true, message: userId === me.id ? "You no longer follow this ticket." : "Removed." };
}
