"use server";

import { revalidatePath } from "next/cache";
import { requireApiArea } from "@/server/authorization/guards";
import { featureOn } from "@/server/settings/features";
import { getActionContext } from "@/lib/http/request-context";
import { logError } from "@/lib/logging/logger";
import type { ActionResult } from "@/lib/http/action-result";
import type { TaskActor } from "@/server/modules/tasks";
import { hasModule } from "@/server/modules/modules";
import * as templates from "@/server/work/templates";
import * as io from "@/server/work/project-io";
import * as feeds from "@/server/work/calendar-feeds";

// v1.70.0 (D-383, PM phase E part 1): the template gallery (rename, delete,
// organisation templates), import and calendar feeds. The session and the
// Tasks switch are checked here (and the Projects module, except for the My
// Tasks feed); the services check "pm_extras" and the person's rights.
async function actor(needProjects = true): Promise<TaskActor | null> {
  try {
    const session = await requireApiArea("users");
    if (!(await featureOn("tasks", session.user))) return null;
    if (needProjects && session.user.modules && !hasModule({ roles: session.user.roles, modules: session.user.modules }, "PROJECT")) return null;
    const { ipAddress } = await getActionContext();
    return { id: session.user.id, name: session.user.name, roles: session.user.roles, modules: session.user.modules, sessionId: session.sessionId, ipAddress };
  } catch {
    return null;
  }
}
const NOT_FOUND: ActionResult = { ok: false, message: "Not found." };
const id = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 && value < 1e10 ? value : null);

async function run<T>(label: string, me: TaskActor | null, work: (me: TaskActor) => Promise<{ ok: true; value: T; message?: string } | { ok: false; message: string; fieldErrors?: Record<string, string> }>, refresh = true): Promise<ActionResult & { value?: T }> {
  if (!me) return NOT_FOUND;
  try {
    const result = await work(me);
    if (!result.ok) return { ok: false, message: result.message, fieldErrors: "fieldErrors" in result ? result.fieldErrors : undefined };
    if (refresh) revalidatePath("/users/work", "layout");
    return { ok: true, message: result.message ?? "Saved.", value: result.value };
  } catch (error) {
    logError(`extras action ${label} failed`, error);
    return { ok: false, message: "Couldn't do that. Please try again." };
  }
}

// ---- templates ------------------------------------------------------------------------------
export async function renameTemplateAction(templateId: number, name: string): Promise<ActionResult> {
  const tid = id(templateId);
  return tid && typeof name === "string" ? run("renameTemplate", await actor(), (me) => templates.renameTemplate(tid, name, me)) : NOT_FOUND;
}
export async function deleteTemplateAction(templateId: number): Promise<ActionResult> {
  const tid = id(templateId);
  return tid ? run("deleteTemplate", await actor(), (me) => templates.deleteTemplate(tid, me)) : NOT_FOUND;
}
export async function shareTemplateAction(templateId: number, shared: boolean): Promise<ActionResult> {
  const tid = id(templateId);
  return tid ? run("shareTemplate", await actor(), (me) => templates.shareTemplate(tid, shared === true, me)) : NOT_FOUND;
}

// ---- import ---------------------------------------------------------------------------------
export async function importPreviewAction(projectId: number, formData: FormData): Promise<ActionResult & { value?: io.ImportPreview }> {
  const pid = id(projectId);
  return pid && formData instanceof FormData ? run("importPreview", await actor(), (me) => io.previewImport(pid, formData, me), false) : NOT_FOUND;
}
export async function importRunAction(projectId: number, formData: FormData): Promise<ActionResult & { value?: io.ImportOutcome }> {
  const pid = id(projectId);
  return pid && formData instanceof FormData ? run("importRun", await actor(), (me) => io.runImport(pid, formData, me)) : NOT_FOUND;
}

// ---- calendar feeds -------------------------------------------------------------------------
export async function calendarFeedAction(scope: string, projectId: number | null, command: string): Promise<ActionResult & { value?: { url: string } }> {
  if (scope !== "MY_TASKS" && scope !== "PROJECT") return NOT_FOUND;
  const pid = scope === "PROJECT" ? id(projectId) : null;
  if (scope === "PROJECT" && !pid) return NOT_FOUND;
  const me = await actor(scope === "PROJECT");
  if (command === "MAKE") return run("feedMake", me, (who) => feeds.makeFeed(scope, pid, who), false);
  if (command === "REVOKE") return run("feedRevoke", me, (who) => feeds.revokeFeed(scope, pid, who), false);
  return NOT_FOUND;
}
