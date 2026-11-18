"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAdminActor } from "@/server/admin/actor";
import { withTransaction } from "@/lib/db/transaction";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import { findModuleType } from "@/lib/db/repositories/module-types.repository";
import { findTicketCategory, insertTicketCategory, replaceTicketViewers, saveTicketFormSetup, updateTicketCategory } from "@/lib/db/repositories/tickets.repository";
import { PREFIX_PATTERN } from "@/server/tickets/rules";
import { logError } from "@/lib/logging/logger";
import type { ActionResult } from "@/lib/http/action-result";

// v1.55.0 (owner's ticketing brief §11): ticket set-up. IT Admin / Super Admin
// with the page access; every change is checked again here and audited.
const NOT_FOUND: ActionResult = { ok: false, message: "Not found." };
const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

// A ticket form's category and its coordinators (any one of them assigns the tickets).
export async function saveTicketFormSetupAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await getAdminActor("admin.ticket_forms");
  if (!actor) return NOT_FOUND;
  const typeId = Number(text(formData, "typeId"));
  const categoryId = Number(text(formData, "category"));
  const userIds = [...new Set(formData.getAll("coordinators").filter((value): value is string => typeof value === "string" && /^\d{1,10}$/.test(value)).map(Number))].slice(0, 50);
  if (!Number.isInteger(typeId) || typeId <= 0) return NOT_FOUND;
  const type = await findModuleType(typeId);
  if (!type || type.module !== "TICKET") return NOT_FOUND;
  const category = Number.isInteger(categoryId) && categoryId > 0 ? await findTicketCategory(categoryId) : null;
  if (!category) return { ok: false, message: "Choose the category.", fieldErrors: { category: "Choose the category." } };
  if (userIds.length === 0) return { ok: false, message: "Choose at least one coordinator.", fieldErrors: { coordinators: "Choose at least one coordinator." } };
  try {
    await withTransaction(async (connection) => {
      await saveTicketFormSetup(typeId, category.id, userIds, actor.id, connection);
      await recordAudit({ actorUserId: actor.id, action: "TICKET_FORM_SETUP_SAVED", entityType: "TICKET_FORM", entityId: typeId, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { categoryId: category.id, coordinators: userIds } }, connection);
    });
  } catch (error) {
    logError("saveTicketFormSetupAction failed", error);
    return { ok: false, message: "Couldn't save. Please try again." };
  }
  revalidatePath(`/admin/ticket-forms/${typeId}`);
  return { ok: true, message: `Saved: ${category.name}, ${userIds.length} coordinator${userIds.length === 1 ? "" : "s"}.` };
}

const categorySchema = z.object({
  name: z.string().trim().min(2, "Give it a name.").max(80),
  numberPrefix: z.string().trim().toUpperCase().regex(PREFIX_PATTERN, "Use 2 to 10 capital letters, numbers or hyphens, e.g. IT-SW."),
  numberDigits: z.coerce.number().int().min(3, "3 to 8 digits.").max(8, "3 to 8 digits."),
  position: z.coerce.number().int().min(0).max(999),
});

export async function saveTicketCategoryAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await getAdminActor("admin.ticket_forms");
  if (!actor) return NOT_FOUND;
  const parsed = categorySchema.safeParse({ name: text(formData, "name"), numberPrefix: text(formData, "prefix"), numberDigits: text(formData, "digits") || "5", position: text(formData, "position") || "0" });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[{ numberPrefix: "prefix", numberDigits: "digits" }[String(issue.path[0])] ?? String(issue.path[0])] = issue.message;
    return { ok: false, message: "Check the highlighted fields.", fieldErrors };
  }
  const id = Number(text(formData, "id"));
  try {
    if (Number.isInteger(id) && id > 0) {
      if (!(await findTicketCategory(id))) return NOT_FOUND;
      await withTransaction(async (connection) => {
        await updateTicketCategory(id, { ...parsed.data, active: text(formData, "active") === "yes" }, connection);
        await recordAudit({ actorUserId: actor.id, action: "TICKET_CATEGORY_UPDATED", entityType: "TICKET_CATEGORY", entityId: id, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { ...parsed.data, active: text(formData, "active") === "yes" } }, connection);
      });
    } else {
      const code = parsed.data.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "CATEGORY";
      const created = await withTransaction(async (connection) => {
        const newId = await insertTicketCategory({ code, ...parsed.data }, actor.id, connection);
        if (newId !== "DUPLICATE") await recordAudit({ actorUserId: actor.id, action: "TICKET_CATEGORY_CREATED", entityType: "TICKET_CATEGORY", entityId: newId, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { code, ...parsed.data } }, connection);
        return newId;
      });
      if (created === "DUPLICATE") return { ok: false, message: "A category with that name exists.", fieldErrors: { name: "A category with that name exists." } };
    }
  } catch (error) {
    logError("saveTicketCategoryAction failed", error);
    return { ok: false, message: "Couldn't save. Please try again." };
  }
  revalidatePath("/admin/ticket-categories");
  return { ok: true, message: "Saved." };
}

// v1.57.0 (D-336, owner: "ticket dashboards should also be visible to IT team"):
// the departments and people who see every ticket (read-only unless they coordinate it).
export async function saveTicketViewersAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await getAdminActor("admin.ticket_forms");
  if (!actor) return NOT_FOUND;
  const ids = (name: string) => [...new Set(formData.getAll(name).filter((value): value is string => typeof value === "string" && /^\d{1,10}$/.test(value)).map(Number))].slice(0, 200);
  const departmentIds = ids("viewerDepartments");
  const userIds = ids("viewerPeople");
  try {
    await withTransaction(async (connection) => {
      await replaceTicketViewers(departmentIds, userIds, actor.id, connection);
      await recordAudit({ actorUserId: actor.id, action: "TICKET_VIEWERS_SAVED", entityType: "TICKET_SETTINGS", entityId: "viewers", sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { departmentIds, userIds } }, connection);
    });
  } catch (error) {
    logError("saveTicketViewersAction failed", error);
    return { ok: false, message: "Couldn't save. Please try again." };
  }
  revalidatePath("/admin/ticket-categories");
  return { ok: true, message: `Saved: ${departmentIds.length} department${departmentIds.length === 1 ? "" : "s"} and ${userIds.length} ${userIds.length === 1 ? "person" : "people"} see every ticket.` };
}
