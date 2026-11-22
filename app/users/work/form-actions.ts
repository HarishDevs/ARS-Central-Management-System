"use server";

import { revalidatePath } from "next/cache";
import { requireApiArea } from "@/server/authorization/guards";
import { getActionContext } from "@/lib/http/request-context";
import { logError } from "@/lib/logging/logger";
import type { ActionResult } from "@/lib/http/action-result";
import type { TaskActor } from "@/server/modules/tasks";
import { hasModule } from "@/server/modules/modules";
import { featureOn } from "@/server/settings/features";
import type { FormProblem } from "@/server/work/intake-rules";
import * as intake from "@/server/work/intake-forms";

// v1.66.0 (D-374, PM phase C): project intake forms. Building needs the
// Tasks switch and the Projects module; submitting needs only a session (who
// may submit is the form's setting). The service checks the "pm_forms"
// switch and every right again.
async function actorBuild(): Promise<TaskActor | null> {
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
async function actorSubmit(): Promise<TaskActor | null> {
  try {
    const session = await requireApiArea("users");
    const { ipAddress } = await getActionContext();
    return { id: session.user.id, name: session.user.name, roles: session.user.roles, modules: session.user.modules, sessionId: session.sessionId, ipAddress };
  } catch {
    return null;
  }
}
const NOT_FOUND = { ok: false as const, message: "Not found." };
const id = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 && value < 1e10 ? value : typeof value === "string" && /^\d{1,10}$/.test(value) ? Number(value) : null);
type Out<T> = ActionResult & { value?: T; problems?: FormProblem[] };

async function run<T>(label: string, me: TaskActor | null, work: (me: TaskActor) => Promise<{ ok: true; value: T; message?: string } | { ok: false; message: string; fieldErrors?: Record<string, string>; problems?: FormProblem[] }>, revalidate = true): Promise<Out<T>> {
  if (!me) return NOT_FOUND;
  try {
    const result = await work(me);
    if (!result.ok) return { ok: false, message: result.message, fieldErrors: result.fieldErrors, problems: result.problems };
    if (revalidate) revalidatePath("/users/work", "layout");
    return { ok: true, message: result.message ?? "Saved.", value: result.value };
  } catch (error) {
    logError(`form action ${label} failed`, error);
    return { ok: false, message: "Couldn't do that. Please try again." };
  }
}

export async function createFormAction(projectId: number): Promise<Out<{ id: number }>> {
  const project = id(projectId);
  if (!project) return NOT_FOUND;
  return run("create", await actorBuild(), (me) => intake.createForm(project, me));
}
export async function saveFormAction(formId: number, input: unknown): Promise<Out<{ rowVersion: number; problems: FormProblem[] }>> {
  const form = id(formId);
  if (!form) return NOT_FOUND;
  return run("save", await actorBuild(), (me) => intake.saveForm(form, input, me), false);
}
export async function publishFormAction(formId: number): Promise<Out<{ versionNo: number; link: string }>> {
  const form = id(formId);
  if (!form) return NOT_FOUND;
  return run("publish", await actorBuild(), (me) => intake.publishForm(form, me));
}
export async function unpublishFormAction(formId: number): Promise<Out<undefined>> {
  const form = id(formId);
  if (!form) return NOT_FOUND;
  return run("unpublish", await actorBuild(), (me) => intake.unpublishForm(form, me));
}
export async function deleteFormAction(formId: number): Promise<Out<undefined>> {
  const form = id(formId);
  if (!form) return NOT_FOUND;
  return run("delete", await actorBuild(), (me) => intake.deleteForm(form, me));
}
export async function duplicateFormAction(formId: number): Promise<Out<{ id: number }>> {
  const form = id(formId);
  if (!form) return NOT_FOUND;
  return run("duplicate", await actorBuild(), (me) => intake.duplicateForm(form, me));
}
export async function formCoverAction(formId: number, formData: FormData): Promise<Out<undefined>> {
  const form = id(formId);
  if (!form || !(formData instanceof FormData)) return NOT_FOUND;
  const file = formData.get("cover");
  const picked = typeof file === "object" && file !== null && "arrayBuffer" in file && (file as File).size > 0 ? (file as File) : null;
  return run("cover", await actorBuild(), (me) => intake.setFormCover(form, picked, me));
}
export async function submitFormAction(token: string, formData: FormData): Promise<Out<intake.SubmitOutcome>> {
  if (typeof token !== "string" || !(formData instanceof FormData)) return NOT_FOUND;
  return run("submit", await actorSubmit(), (me) => intake.submitForm(token, formData, me));
}
