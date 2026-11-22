"use server";

import { revalidatePath } from "next/cache";
import { requireApiArea } from "@/server/authorization/guards";
import { featureOn } from "@/server/settings/features";
import { getActionContext } from "@/lib/http/request-context";
import { logError } from "@/lib/logging/logger";
import type { ActionResult } from "@/lib/http/action-result";
import type { TaskActor } from "@/server/modules/tasks";
import { hasModule } from "@/server/modules/modules";
import * as portfolios from "@/server/work/portfolios";

// v1.69.0 (D-382, PM phase D part 3): portfolios. The session, the Tasks
// switch and the Projects module are checked here; the service checks the
// "pm_portfolios" switch and the person's role in the portfolio (deny by
// default: anything they can't see is "Not found.").
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
const NOT_FOUND: ActionResult = { ok: false, message: "Not found." };
const id = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 && value < 1e10 ? value : null);

// Each action names its caller first (await actor()), then runs here.
async function run<T>(label: string, me: TaskActor | null, work: (me: TaskActor) => Promise<{ ok: true; value: T; message?: string } | { ok: false; message: string; fieldErrors?: Record<string, string> }>): Promise<ActionResult & { value?: T }> {
  if (!me) return NOT_FOUND;
  try {
    const result = await work(me);
    if (!result.ok) return { ok: false, message: result.message, fieldErrors: result.fieldErrors };
    revalidatePath("/users/work", "layout");
    return { ok: true, message: result.message ?? "Saved.", value: result.value };
  } catch (error) {
    logError(`portfolio action ${label} failed`, error);
    return { ok: false, message: "Couldn't do that. Please try again." };
  }
}

export async function createPortfolioAction(input: unknown): Promise<ActionResult & { value?: { id: number } }> {
  return run("create", await actor(), (me) => portfolios.createPortfolio(input, me));
}
export async function updatePortfolioAction(portfolioId: number, input: unknown): Promise<ActionResult> {
  const pid = id(portfolioId);
  return pid ? run("update", await actor(), (me) => portfolios.updatePortfolio(pid, input, me)) : NOT_FOUND;
}
const COMMANDS = ["ARCHIVE", "UNARCHIVE", "DELETE", "RESTORE", "JOIN", "LEAVE", "STAR"] as const;
export async function portfolioCommandAction(portfolioId: number, command: string): Promise<ActionResult> {
  const pid = id(portfolioId);
  if (!pid || !(COMMANDS as readonly string[]).includes(command)) return NOT_FOUND;
  return run(command, await actor(), (me) => portfolios.portfolioCommand(pid, command as portfolios.PortfolioCommand, me));
}
export async function portfolioMemberAction(portfolioId: number, userId: number, role: string | null): Promise<ActionResult> {
  const pid = id(portfolioId);
  const uid = id(userId);
  if (!pid || !uid || (role !== null && typeof role !== "string")) return NOT_FOUND;
  return run("member", await actor(), (me) => portfolios.setPortfolioMember(pid, uid, role, me));
}
export async function addWorkAction(portfolioId: number, item: { projectId?: number | null; portfolioId?: number | null }): Promise<ActionResult & { value?: { itemId: number } }> {
  const pid = id(portfolioId);
  if (!pid || !item || typeof item !== "object") return NOT_FOUND;
  return run("addWork", await actor(), (me) => portfolios.addWork(pid, { projectId: item.projectId == null ? null : id(item.projectId), portfolioId: item.portfolioId == null ? null : id(item.portfolioId) }, me));
}
export async function removeWorkAction(portfolioId: number, itemId: number): Promise<ActionResult> {
  const pid = id(portfolioId);
  const iid = id(itemId);
  return pid && iid ? run("removeWork", await actor(), (me) => portfolios.removeWork(pid, iid, me)) : NOT_FOUND;
}
export async function priorityAction(portfolioId: number, itemId: number, priority: string | null): Promise<ActionResult> {
  const pid = id(portfolioId);
  const iid = id(itemId);
  return pid && iid ? run("priority", await actor(), (me) => portfolios.setPriority(pid, iid, typeof priority === "string" && priority ? priority : null, me)) : NOT_FOUND;
}
export async function addPortfolioFieldAction(portfolioId: number, input: unknown): Promise<ActionResult> {
  const pid = id(portfolioId);
  return pid ? run("addField", await actor(), (me) => portfolios.addField(pid, input, me)) : NOT_FOUND;
}
export async function removePortfolioFieldAction(portfolioId: number, fieldId: number): Promise<ActionResult> {
  const pid = id(portfolioId);
  const fid = id(fieldId);
  return pid && fid ? run("removeField", await actor(), (me) => portfolios.removeField(pid, fid, me)) : NOT_FOUND;
}
export async function portfolioValueAction(portfolioId: number, itemId: number, fieldId: number, value: unknown): Promise<ActionResult> {
  const pid = id(portfolioId);
  const iid = id(itemId);
  const fid = id(fieldId);
  return pid && iid && fid ? run("value", await actor(), (me) => portfolios.setFieldValue(pid, iid, fid, value, me)) : NOT_FOUND;
}
export async function portfolioStatusAction(portfolioId: number, input: unknown): Promise<ActionResult> {
  const pid = id(portfolioId);
  return pid ? run("status", await actor(), (me) => portfolios.postStatus(pid, input, me)) : NOT_FOUND;
}
export async function removePortfolioStatusAction(statusId: number): Promise<ActionResult> {
  const sid = id(statusId);
  return sid ? run("removeStatus", await actor(), (me) => portfolios.removeStatus(sid, me)) : NOT_FOUND;
}
