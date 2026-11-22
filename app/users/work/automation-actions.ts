"use server";

import { revalidatePath } from "next/cache";
import { requireApiArea } from "@/server/authorization/guards";
import { getActionContext } from "@/lib/http/request-context";
import { logError } from "@/lib/logging/logger";
import type { ActionResult } from "@/lib/http/action-result";
import type { TaskActor } from "@/server/modules/tasks";
import { hasModule } from "@/server/modules/modules";
import { featureOn } from "@/server/settings/features";
import type { RuleProblem } from "@/server/work/automation-rules";
import * as automations from "@/server/work/automations";

// v1.68.0 (D-380, PM phase D part 2): project automations. Needs the Tasks
// switch and the Projects module; the service checks the "pm_automations"
// switch and every right again (deny by default).
async function actor(): Promise<TaskActor | null> {
  try {
    const session = await requireApiArea("users");
    if (!(await featureOn("tasks", session.user))) return null;
    if (session.user.modules && !hasModule({ roles: session.user.roles, modules: session.user.modules }, "PROJECT")) return null;
    const { ipAddress } = await getActionContext();
    return { id: session.user.id, name: session.user.name, roles: session.user.roles, modules: session.user.modules, sessionId: session.sessionId, ipAddress };
  } catch {
    return null;
  }
}
const NOT_FOUND = { ok: false as const, message: "Not found." };
const id = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 && value < 1e10 ? value : typeof value === "string" && /^\d{1,10}$/.test(value) ? Number(value) : null);
type Out<T> = ActionResult & { value?: T; problems?: RuleProblem[] };

async function run<T>(label: string, me: TaskActor | null, work: (me: TaskActor) => Promise<{ ok: true; value: T; message?: string } | { ok: false; message: string; problems?: RuleProblem[] }>, revalidate = true): Promise<Out<T>> {
  if (!me) return NOT_FOUND;
  try {
    const result = await work(me);
    if (!result.ok) return { ok: false, message: result.message, problems: result.problems };
    if (revalidate) revalidatePath("/users/work", "layout");
    return { ok: true, message: result.message ?? "Saved.", value: result.value };
  } catch (error) {
    logError(`automation action ${label} failed`, error);
    return { ok: false, message: "Couldn't do that. Please try again." };
  }
}

export async function createAutomationAction(projectId: number): Promise<Out<{ id: number }>> {
  const project = id(projectId);
  return project ? run("create", await actor(), (me) => automations.createRule(project, me)) : NOT_FOUND;
}
export async function saveAutomationAction(ruleId: number, input: unknown): Promise<Out<{ rowVersion: number; problems: RuleProblem[] }>> {
  const rule = id(ruleId);
  return rule ? run("save", await actor(), (me) => automations.saveRule(rule, input, me), false) : NOT_FOUND;
}
export async function publishAutomationAction(ruleId: number): Promise<Out<{ version: number; secret: string | null }>> {
  const rule = id(ruleId);
  return rule ? run("publish", await actor(), (me) => automations.publishRule(rule, me)) : NOT_FOUND;
}
export async function discardAutomationDraftAction(ruleId: number): Promise<Out<undefined>> {
  const rule = id(ruleId);
  return rule ? run("discard", await actor(), (me) => automations.discardDraft(rule, me)) : NOT_FOUND;
}
export async function setAutomationEnabledAction(ruleId: number, on: boolean): Promise<Out<undefined>> {
  const rule = id(ruleId);
  return rule ? run("enable", await actor(), (me) => automations.setRuleEnabled(rule, on === true, me)) : NOT_FOUND;
}
export async function becomeAutomationOwnerAction(ruleId: number): Promise<Out<undefined>> {
  const rule = id(ruleId);
  return rule ? run("owner", await actor(), (me) => automations.becomeOwner(rule, me)) : NOT_FOUND;
}
export async function duplicateAutomationAction(ruleId: number): Promise<Out<{ id: number }>> {
  const rule = id(ruleId);
  return rule ? run("duplicate", await actor(), (me) => automations.duplicateRule(rule, me)) : NOT_FOUND;
}
export async function deleteAutomationAction(ruleId: number): Promise<Out<undefined>> {
  const rule = id(ruleId);
  return rule ? run("delete", await actor(), (me) => automations.deleteRule(rule, me)) : NOT_FOUND;
}
export async function newAutomationSecretAction(ruleId: number): Promise<Out<{ secret: string; url: string }>> {
  const rule = id(ruleId);
  return rule ? run("secret", await actor(), (me) => automations.newSecret(rule, me), false) : NOT_FOUND;
}
export async function manualAutomationsAction(taskId: number): Promise<Out<{ id: number; name: string; projectName: string }[]>> {
  const task = id(taskId);
  return task ? run("manual list", await actor(), async (me) => ({ ok: true as const, value: await automations.manualRulesFor(task, me) }), false) : NOT_FOUND;
}
export async function runAutomationOnTaskAction(ruleId: number, taskId: number): Promise<Out<undefined>> {
  const rule = id(ruleId);
  const task = id(taskId);
  if (!rule || !task) return NOT_FOUND;
  return run("manual run", await actor(), async (me) => {
    const result = await automations.runOnTask(rule, task, me);
    return result.ok ? { ok: true as const, value: undefined, message: result.message } : result;
  });
}
