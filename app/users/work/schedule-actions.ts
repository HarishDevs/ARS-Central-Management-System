"use server";

import { revalidatePath } from "next/cache";
import { requireApiArea } from "@/server/authorization/guards";
import { featureOn } from "@/server/settings/features";
import { getActionContext } from "@/lib/http/request-context";
import { logError } from "@/lib/logging/logger";
import type { ActionResult } from "@/lib/http/action-result";
import type { TaskActor } from "@/server/modules/tasks";
import { hasModule } from "@/server/modules/modules";
import * as schedule from "@/server/work/schedule-service";

// v1.65.0 (D-373, PM phase B part 2): typed dependencies, scheduling
// settings, Undo of a shift, and the fuller status update. Each checks the
// session here; the service checks the switch and the person's rights.
async function actor(projects = false): Promise<TaskActor | null> {
  try {
    const session = await requireApiArea("users");
    if (!(await featureOn("tasks", session.user))) return null;
    if (projects && session.user.modules && !hasModule({ roles: session.user.roles, modules: session.user.modules }, "PROJECT")) return null;
    const { ipAddress } = await getActionContext();
    return { id: session.user.id, name: session.user.name, roles: session.user.roles, modules: session.user.modules, sessionId: session.sessionId, ipAddress };
  } catch {
    return null;
  }
}
const NOT_FOUND: ActionResult = { ok: false, message: "Not found." };
const id = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 && value < 1e10 ? value : typeof value === "string" && /^\d{1,10}$/.test(value) ? Number(value) : null);

async function run<T>(label: string, me: TaskActor | null, work: (me: TaskActor) => Promise<{ ok: true; value: T; message?: string } | { ok: false; message: string; fieldErrors?: Record<string, string> }>, quiet = false): Promise<ActionResult & { value?: T }> {
  if (!me) return NOT_FOUND;
  try {
    const result = await work(me);
    if (!result.ok) return { ok: false, message: result.message, fieldErrors: result.fieldErrors };
    if (!quiet) {
      revalidatePath("/users/work", "layout");
      revalidatePath("/users/tasks", "layout");
    }
    return { ok: true, message: result.message ?? "Saved.", value: result.value };
  } catch (error) {
    logError(`schedule action ${label} failed`, error);
    return { ok: false, message: "Couldn't do that. Please try again." };
  }
}

export async function typedDependencyAction(taskId: number, otherId: number, role: string, type: string, on: boolean): Promise<ActionResult> {
  const task = id(taskId);
  const other = id(otherId);
  if (!task || !other || (role !== "BLOCKED_BY" && role !== "BLOCKING")) return NOT_FOUND;
  return run("dependency", await actor(), (me) => schedule.setTypedDependency({ taskId: task, otherId: other, role, type: String(type), on: on === true }, me));
}

// v1.93.0 (D-449): scoped to the task's project (`wide`: its portfolio); see dependency-scope.ts.
export async function dependencyTargetsAction(q: string, taskId: number | null, wide = false): Promise<ActionResult & { value?: schedule.DependencyTargets }> {
  return run("targets", await actor(), (me) => schedule.dependencyTargets(String(q ?? ""), me, id(taskId), wide === true), true);
}

export async function projectScheduleAction(projectId: number, input: { mode?: string; skipOffDays?: boolean }): Promise<ActionResult> {
  const project = id(projectId);
  if (!project || !input || typeof input !== "object") return NOT_FOUND;
  return run("projectSchedule", await actor(true), (me) => schedule.saveProjectSchedule(project, { mode: input.mode, skipOffDays: input.skipOffDays }, me));
}

export async function undoShiftAction(batchId: number): Promise<ActionResult> {
  const batch = id(batchId);
  return batch ? run("undoShift", await actor(), (me) => schedule.undoShift(batch, me)) : NOT_FOUND;
}

export async function statusHighlightsAction(projectId: number, days: number): Promise<ActionResult & { value?: { days: number; items: schedule.HighlightItem[] } }> {
  const project = id(projectId);
  return project ? run("highlights", await actor(true), (me) => schedule.statusHighlights(project, days, me), true) : NOT_FOUND;
}

export async function statusReminderAction(projectId: number, on: boolean): Promise<ActionResult> {
  const project = id(projectId);
  return project ? run("statusReminder", await actor(true), (me) => schedule.setStatusReminder(project, on === true, me)) : NOT_FOUND;
}

const ids = (raw: string) =>
  raw
    .split(",")
    .map((item) => id(item.trim()))
    .filter((item): item is number => item !== null)
    .slice(0, 100);
export async function statusUpdateAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const project = id(text("projectId"));
  if (!project) return NOT_FOUND;
  return run("statusUpdate", await actor(true), (me) =>
    schedule.postStatusUpdate(
      project,
      {
        status: text("status"),
        title: text("title"),
        summary: text("body"),
        nextSteps: text("next_steps"),
        ownerId: id(text("owner")),
        startOn: text("start_on"),
        dueOn: text("due_on"),
        highlightDays: Number(text("highlight_days")),
        highlightIds: ids(text("highlights")),
        extraRecipients: ids(text("recipients")),
      },
      me,
    ),
  );
}
