"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireApiArea } from "@/server/authorization/guards";
import { featureOn } from "@/server/settings/features";
import { getActionContext } from "@/lib/http/request-context";
import { logError } from "@/lib/logging/logger";
import type { ActionResult } from "@/lib/http/action-result";
import type { TaskActor } from "@/server/modules/tasks";
import { hasModule } from "@/server/modules/modules";
import * as reporting from "@/server/work/reporting-service";
import type { ChartData } from "@/server/work/reporting";

// v1.67.0 (D-375, PM phase D part 1): project dashboards (widgets, chart
// preview) and Workload capacity. The session and the Tasks + Projects
// modules are checked here; the service checks the "pm_reporting" switch,
// the person's sight of the project and their role (deny by default).
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

async function run<T>(label: string, work: (me: TaskActor) => Promise<{ ok: true; value: T; message?: string } | { ok: false; message: string }>, quiet = false): Promise<ActionResult & { value?: T }> {
  const me = await actor();
  if (!me) return NOT_FOUND;
  try {
    const result = await work(me);
    if (!result.ok) return { ok: false, message: result.message };
    if (!quiet) revalidatePath("/users/work", "layout");
    return { ok: true, message: result.message ?? "Saved.", value: result.value };
  } catch (error) {
    logError(`reporting action ${label} failed`, error);
    return { ok: false, message: "Couldn't do that. Please try again." };
  }
}

const widgetInput = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("save"),
    id: z.number().int().positive().nullable().optional(),
    kind: z.enum(["CHART", "TEXT"]),
    title: z.string().max(200),
    config: z.unknown().optional(),
    body: z.string().max(5000).nullable().optional(),
    size: z.enum(["HALF", "FULL"]).optional(),
    rowVersion: z.number().int().nonnegative().nullable().optional(),
  }),
  z.object({ op: z.literal("remove"), id: z.number().int().positive() }),
  z.object({ op: z.literal("move"), ids: z.array(z.number().int().positive()).max(40) }),
]);
export async function dashboardAction(projectId: number, input: unknown): Promise<ActionResult & { value?: { id: number } | undefined }> {
  const project = id(projectId);
  const parsed = widgetInput.safeParse(input);
  if (!project) return NOT_FOUND;
  if (!parsed.success) return { ok: false, message: "That change isn't valid." };
  const change = parsed.data;
  if (change.op === "save") return run("save", (me) => reporting.saveWidget(project, change, me));
  if (change.op === "remove") return run("remove", (me) => reporting.removeWidget(project, change.id, me));
  return run("move", (me) => reporting.moveWidgets(project, change.ids, me));
}

export async function chartPreviewAction(projectId: number, config: unknown): Promise<ActionResult & { value?: ChartData }> {
  const project = id(projectId);
  if (!project) return NOT_FOUND;
  return run("preview", (me) => reporting.previewChart(project, config, me), true);
}

const capacityInput = z.object({ userId: z.number().int().positive().nullable(), metric: z.string().max(24), perDay: z.number().finite().nullable() });
export async function capacityAction(projectId: number, input: unknown): Promise<ActionResult> {
  const project = id(projectId);
  const parsed = capacityInput.safeParse(input);
  if (!project) return NOT_FOUND;
  if (!parsed.success) return { ok: false, message: "That capacity isn't valid." };
  return run("capacity", (me) => reporting.saveCapacity(project, parsed.data, me));
}
