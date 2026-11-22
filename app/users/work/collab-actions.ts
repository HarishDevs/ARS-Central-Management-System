"use server";

import { revalidatePath } from "next/cache";
import { requireApiArea } from "@/server/authorization/guards";
import { featureOn } from "@/server/settings/features";
import { getActionContext } from "@/lib/http/request-context";
import { logError } from "@/lib/logging/logger";
import type { ActionResult } from "@/lib/http/action-result";
import type { TaskActor } from "@/server/modules/tasks";
import { hasModule } from "@/server/modules/modules";
import * as collab from "@/server/work/collab";
import * as time from "@/server/work/time-tracking";

// v1.71.0 (D-384, PM phase E part 2): project messages, the project page and
// time tracking. The session and the Tasks switch are checked here (and the
// Projects module for messages and the page); the services check "pm_extras"
// and every right again.
async function actor(needProjects: boolean): Promise<TaskActor | null> {
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
const formId = (value: FormDataEntryValue | null) => (typeof value === "string" && /^\d{1,10}$/.test(value) ? Number(value) : null);

async function run<T>(label: string, me: TaskActor | null, work: (me: TaskActor) => Promise<{ ok: true; value: T; message?: string } | { ok: false; message: string; fieldErrors?: Record<string, string> }>, refresh: string | null = "/users/work"): Promise<ActionResult & { value?: T }> {
  if (!me) return NOT_FOUND;
  try {
    const result = await work(me);
    if (!result.ok) return { ok: false, message: result.message, fieldErrors: "fieldErrors" in result ? result.fieldErrors : undefined };
    if (refresh) revalidatePath(refresh, "layout");
    return { ok: true, message: result.message ?? "Saved.", value: result.value };
  } catch (error) {
    logError(`collab action ${label} failed`, error);
    return { ok: false, message: "Couldn't do that. Please try again." };
  }
}

// ---- messages (a form: subject, body, files; parentId for a reply) ----------------------------
export async function postMessageAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const pid = formId(formData.get("projectId"));
  if (!pid) return NOT_FOUND;
  const result = await run("postMessage", await actor(true), (me) => collab.postMessage(pid, formData, me));
  return result.ok ? { ok: true, message: result.message, data: { threadId: result.value?.threadId ?? null } } : result;
}
export async function changeMessageAction(messageId: number, change: { subject?: string; body?: string; delete?: boolean }): Promise<ActionResult> {
  const mid = id(messageId);
  if (!mid || !change || typeof change !== "object") return NOT_FOUND;
  return run("changeMessage", await actor(true), (me) => collab.changeMessage(mid, change.delete === true ? { delete: true } : { subject: change.subject, body: change.body }, me));
}
export async function reactMessageAction(messageId: number, key: string): Promise<ActionResult> {
  const mid = id(messageId);
  return mid && typeof key === "string" ? run("reactMessage", await actor(true), (me) => collab.reactToMessage(mid, key, me)) : NOT_FOUND;
}
export async function messageVersionsAction(messageId: number): Promise<{ ok: true; versions: { id: number; subject: string | null; body: string; kind: "EDIT" | "DELETE"; by: string; at: string }[] } | { ok: false; message: string }> {
  const mid = id(messageId);
  const me = await actor(true);
  if (!mid || !me) return { ok: false, message: "Not found." };
  try {
    const result = await collab.messageVersions(mid, me);
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, versions: result.value.map((version) => ({ id: version.id, subject: version.subject, body: version.body, kind: version.kind, by: version.changedByName, at: version.changedAt.toISOString() })) };
  } catch (error) {
    logError("messageVersionsAction failed", error);
    return { ok: false, message: "Couldn't load the earlier versions." };
  }
}

// ---- page ---------------------------------------------------------------------------------
export async function savePageAction(projectId: number, input: { title: string; body: string; rowVersion: number }): Promise<ActionResult & { value?: { rowVersion: number } }> {
  const pid = id(projectId);
  if (!pid || !input || typeof input !== "object") return NOT_FOUND;
  return run("savePage", await actor(true), (me) => collab.savePage(pid, { title: input.title, body: input.body, rowVersion: input.rowVersion }, me));
}
export async function restorePageAction(projectId: number, versionNo: number, rowVersion: number): Promise<ActionResult & { value?: { rowVersion: number } }> {
  const pid = id(projectId);
  const vno = id(versionNo);
  if (!pid || !vno) return NOT_FOUND;
  return run("restorePage", await actor(true), (me) => collab.savePage(pid, { title: undefined, body: undefined, rowVersion, restore: vno }, me));
}
export async function pageVersionAction(projectId: number, versionNo: number): Promise<ActionResult & { value?: { title: string; body: string } }> {
  const pid = id(projectId);
  const vno = id(versionNo);
  if (!pid || !vno) return NOT_FOUND;
  return run("pageVersion", await actor(true), (me) => collab.pageVersion(pid, vno, me), null);
}

// ---- time tracking ------------------------------------------------------------------------
export async function logTimeAction(taskId: number, input: { workDay: string; duration: string; note: string }): Promise<ActionResult> {
  const tid = id(taskId);
  if (!tid || !input || typeof input !== "object") return NOT_FOUND;
  return run("logTime", await actor(false), (me) => time.logTime(tid, input, me), "/users");
}
export async function timeTimerAction(taskId: number, command: "start" | "stop"): Promise<ActionResult> {
  const tid = id(taskId);
  if (!tid || (command !== "start" && command !== "stop")) return NOT_FOUND;
  return run("timeTimer", await actor(false), (me) => time.timeTimer(tid, command, me), "/users");
}
export async function changeTimeEntryAction(entryId: number, change: { workDay?: string; duration?: string; note?: string; delete?: boolean }): Promise<ActionResult> {
  const eid = id(entryId);
  if (!eid || !change || typeof change !== "object") return NOT_FOUND;
  return run("changeTimeEntry", await actor(false), (me) => time.changeEntry(eid, change.delete === true ? { delete: true } : { workDay: change.workDay, duration: change.duration, note: change.note }, me), "/users");
}
export async function setEstimateAction(taskId: number, estimate: string): Promise<ActionResult> {
  const tid = id(taskId);
  if (!tid || typeof estimate !== "string") return NOT_FOUND;
  return run("setEstimate", await actor(false), (me) => time.setEstimate(tid, estimate, me), "/users");
}
