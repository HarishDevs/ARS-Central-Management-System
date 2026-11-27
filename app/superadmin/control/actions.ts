"use server";

import { revalidatePath } from "next/cache";
import { requireApiArea } from "@/server/authorization/guards";
import { getActionContext } from "@/lib/http/request-context";
import { logError } from "@/lib/logging/logger";
import type { ActionResult } from "@/lib/http/action-result";
import {
  archiveItem,
  binItem,
  overrideRequestItem,
  overrideTask,
  overrideTicket,
  purgeFromBin,
  restoreFromBin,
  type ControlActor,
  type ControlModule,
  type ControlResult,
  type RequestOverride,
  type TaskOverride,
  type TicketOverride,
} from "@/server/superadmin/control/service";

// v1.94.0 (D-451..D-458): the Super Admin control panel's actions. Each checks
// the session and the /superadmin area here; the service checks the Super
// Admin role again, the reason, the item's state (under its row lock) and the
// version the page showed. Anyone else gets "Not found."
const NOT_FOUND: ActionResult = { ok: false, message: "Not found." };
const MODULES: readonly ControlModule[] = ["REQUEST", "TASK", "TICKET"];

async function actor(): Promise<ControlActor | null> {
  try {
    const session = await requireApiArea("superadmin");
    if (!session.user.roles.includes("SUPER_ADMIN")) return null;
    const { ipAddress } = await getActionContext();
    return {
      id: session.user.id,
      name: session.user.name,
      roles: session.user.roles,
      sessionId: session.sessionId,
      ipAddress,
    };
  } catch {
    return null;
  }
}

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};
const idOf = (value: string) => (/^\d{1,12}$/.test(value) ? Number(value) : null);
const moduleOf = (value: string) => ((MODULES as readonly string[]).includes(value) ? (value as ControlModule) : null);

function done(result: ControlResult<unknown>): ActionResult {
  if (!result.ok)
    return {
      ok: false,
      message: result.message,
      fieldErrors: result.fieldErrors,
    };
  revalidatePath("/superadmin/control");
  return { ok: true, message: result.message };
}

async function run(label: string, work: () => Promise<ControlResult<unknown>>): Promise<ActionResult> {
  try {
    return done(await work());
  } catch (error) {
    logError(`super admin control: ${label} failed`, error);
    return { ok: false, message: "Couldn't do that. Please try again." };
  }
}

export async function archiveAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  const kind = moduleOf(text(formData, "module"));
  const id = idOf(text(formData, "id"));
  if (!me || !kind || !id) return NOT_FOUND;
  const archive = text(formData, "mode") !== "unarchive";
  return run("archive", () => archiveItem(kind, id, text(formData, "reason"), me, archive));
}

export async function binAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  const kind = moduleOf(text(formData, "module"));
  const id = idOf(text(formData, "id"));
  if (!me || !kind || !id) return NOT_FOUND;
  return run("bin", () => binItem(kind, id, text(formData, "reason"), me));
}

export async function restoreAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  const id = idOf(text(formData, "entryId"));
  if (!me || !id) return NOT_FOUND;
  return run("restore", () => restoreFromBin(id, text(formData, "reason"), me));
}

export async function purgeAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  const id = idOf(text(formData, "entryId"));
  if (!me || !id) return NOT_FOUND;
  return run("purge", () => purgeFromBin(id, text(formData, "confirmText"), me));
}

function fieldsFrom(formData: FormData): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of formData.entries()) if (key.startsWith("field:") && typeof value === "string") fields[key.slice(6)] = value;
  return fields;
}

export async function overrideAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  const kind = moduleOf(text(formData, "module"));
  const id = idOf(text(formData, "id"));
  if (!me || !kind || !id) return NOT_FOUND;
  const action = text(formData, "action");
  const reason = text(formData, "reason");
  const version = idOf(text(formData, "version"));
  const has = (name: string) => formData.has(name);
  if (kind === "REQUEST") {
    let input: RequestOverride;
    if (action === "EDIT_FIELDS")
      input = {
        action,
        ...(has("title") ? { title: text(formData, "title") } : {}),
        fields: fieldsFrom(formData),
      };
    else if (action === "CHANGE_APPROVER")
      input = {
        action,
        taskKey: text(formData, "taskKey"),
        toUserId: idOf(text(formData, "userId")) ?? 0,
      };
    else if (action === "ADD_APPROVER")
      input = {
        action,
        nodeId: text(formData, "nodeId"),
        userId: idOf(text(formData, "userId")) ?? 0,
      };
    else if (action === "SKIP_STEP") input = { action, nodeId: text(formData, "nodeId") };
    else if (action === "FORCE_STATUS" && ["APPROVED", "REJECTED", "CANCELLED"].includes(text(formData, "status")))
      input = {
        action,
        status: text(formData, "status") as "APPROVED" | "REJECTED" | "CANCELLED",
      };
    else if (action === "REOPEN") input = { action };
    else return { ok: false, message: "Choose what to change." };
    return run("request override", () => overrideRequestItem(id, { ...input, reason, expectedStateVersion: version }, me));
  }
  if (kind === "TASK") {
    let input: TaskOverride;
    if (action === "EDIT") {
      input = {
        action,
        ...(has("title") ? { title: text(formData, "title") } : {}),
        ...(has("description") ? { description: text(formData, "description") } : {}),
        ...(has("priority") ? { priority: text(formData, "priority") } : {}),
        ...(has("dueDay") && text(formData, "dueDay") ? { dueDay: text(formData, "dueDay") } : {}),
        ...(idOf(text(formData, "userId")) ? { assigneeId: idOf(text(formData, "userId")) } : {}),
      };
    } else if (action === "FORCE_STATUS" && ["OPEN", "IN_PROGRESS", "BLOCKED", "COMPLETED", "CANCELLED"].includes(text(formData, "status")))
      input = { action, status: text(formData, "status") as "OPEN" };
    else if (action === "REOPEN") input = { action };
    else return { ok: false, message: "Choose what to change." };
    return run("task override", () => overrideTask(id, { ...input, reason, expectedRowVersion: version }, me));
  }
  let input: TicketOverride;
  if (action === "EDIT") {
    input = {
      action,
      ...(has("title") ? { title: text(formData, "title") } : {}),
      ...(has("description") ? { description: text(formData, "description") } : {}),
      ...(has("priority") ? { priority: text(formData, "priority") } : {}),
      ...(has("requiredOn") && text(formData, "requiredOn") ? { requiredOn: text(formData, "requiredOn") } : {}),
    };
  } else if (action === "REASSIGN")
    input = {
      action,
      assigneeId: idOf(text(formData, "userId")) ?? 0,
      targetDay: text(formData, "targetDay"),
    };
  else if (action === "FORCE_STATUS" && ["IN_PROGRESS", "CLOSED"].includes(text(formData, "status"))) input = { action, status: text(formData, "status") as "CLOSED" };
  else if (action === "REOPEN") input = { action };
  else return { ok: false, message: "Choose what to change." };
  return run("ticket override", () => overrideTicket(id, { ...input, reason, expectedRowVersion: version }, me));
}
