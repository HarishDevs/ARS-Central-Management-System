"use server";

import { revalidatePath } from "next/cache";
import { requireApiArea } from "@/server/authorization/guards";
import { changeDetailsAsApprover, type Actor } from "@/server/approvals/service";
import { loadRequestView } from "@/server/approvals/view";
import { findRequest, findWorkflowVersion } from "@/lib/db/repositories/approvals.repository";
import { laterLevels, type LevelEdit, type LevelView } from "@/server/approvals/approver-edit";
import { listApproverOptions } from "@/lib/db/repositories/approvers.repository";
import { listActiveUserOptions } from "@/lib/db/repositories/admin-users.repository";
import { loadFieldLookups } from "@/lib/db/repositories/lookups.repository";
import { personLabel } from "@/lib/people/label";
import { logError } from "@/lib/logging/logger";
import type { ActionResult } from "@/lib/http/action-result";
import type { FieldLookups, FormField } from "@/server/forms/fields";

// v1.59.0 (D-357, owner: "approver can change the approval details", "can be
// done from the table itself"): the Waiting for me row's Change details
// window loads what it needs only when opened, then saves through the service,
// which checks everything again (who, values, levels, people).

async function actor(): Promise<Actor | null> {
  try {
    const session = await requireApiArea("users");
    return { id: session.user.id, roles: session.user.roles };
  } catch {
    return null;
  }
}

export interface ChangeDetailsData {
  requestId: number;
  taskKey: string;
  requestNo: string;
  title: string;
  stepLabel: string;
  form: FormField[];
  initial: Record<string, string>;
  existingFiles: Record<string, number>;
  people: { id: number; label: string; detail?: string }[];
  lookups: FieldLookups | null;
  levels: LevelView[] | null; // null: this request's levels can't be changed here
  approvers: { id: number; label: string; detail?: string }[];
}

export async function loadChangeDetailsAction(requestId: number, taskKey: string): Promise<{ ok: true; data: ChangeDetailsData } | { ok: false; message: string }> {
  const me = await actor();
  if (!me || !Number.isInteger(requestId) || typeof taskKey !== "string") return { ok: false, message: "Not found." };
  try {
    const view = await loadRequestView(requestId, me);
    const mine = view?.myTasks.find((task) => task.taskKey === taskKey && !task.work);
    if (!view || !mine || view.status !== "IN_PROGRESS") return { ok: false, message: "This approval is no longer waiting for you." };
    const request = await findRequest(requestId);
    const version = request ? await findWorkflowVersion(request.workflowVersionId) : null;
    const task = request?.state.tasks.find((candidate) => candidate.id === taskKey);
    const levels = view.isCustom && version?.builder && task ? laterLevels(version.builder, task.nodeId) : null;
    const needsPeople = view.form.some((field) => field.type === "PERSON");
    const [people, approvers, lookups] = await Promise.all([
      needsPeople ? listActiveUserOptions() : Promise.resolve([]),
      levels ? listApproverOptions() : Promise.resolve([]),
      view.form.some((field) => field.type === "LOOKUP") ? loadFieldLookups() : Promise.resolve(null),
    ]);
    const holder = task?.approverId;
    return {
      ok: true,
      data: {
        requestId,
        taskKey,
        requestNo: view.requestNo,
        title: view.title,
        stepLabel: mine.label,
        form: view.form,
        initial: view.rawFields,
        existingFiles: Object.fromEntries(view.fields.filter((field) => field.files).map((field) => [field.key, field.files!.length])),
        people: people.map((person) => ({ id: person.id, label: personLabel(person), detail: person.departmentName ?? undefined })),
        lookups,
        levels,
        approvers: approvers
          .filter((person) => person.id !== me.id && person.id !== view.requesterId && person.id !== holder)
          .map((person) => ({ id: person.id, label: personLabel(person), detail: person.departmentName ?? undefined })),
      },
    };
  } catch (error) {
    logError("loadChangeDetailsAction failed", error, { requestId });
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

const RESERVED = new Set(["requestId", "taskKey", "reason", "levels", "changeValues"]);

function parseLevels(raw: FormDataEntryValue | null): LevelEdit[] | null | "invalid" {
  if (typeof raw !== "string" || raw === "") return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value) || value.length > 30) return "invalid";
    const edits: LevelEdit[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") return "invalid";
      const { key, label, userIds, rule } = item as Record<string, unknown>;
      if (typeof key !== "string" || !/^(new|[a-z0-9_]{1,30})$/.test(key)) return "invalid";
      if (label !== undefined && typeof label !== "string") return "invalid";
      if (userIds !== undefined && !(Array.isArray(userIds) && userIds.length <= 50 && userIds.every((id) => Number.isInteger(id) && (id as number) > 0))) return "invalid";
      if (rule !== undefined && rule !== "ALL" && rule !== "ANY_ONE") return "invalid";
      if (key === "new" && (typeof label !== "string" || !Array.isArray(userIds))) return "invalid";
      edits.push({ key, ...(label !== undefined ? { label: label as string } : {}), ...(userIds !== undefined ? { userIds: userIds as number[] } : {}), ...(rule !== undefined ? { rule: rule as "ALL" | "ANY_ONE" } : {}) } as LevelEdit);
    }
    return edits;
  } catch {
    return "invalid";
  }
}

export async function changeDetailsAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  const requestId = Number(formData.get("requestId"));
  const taskKey = formData.get("taskKey");
  if (!me || !Number.isInteger(requestId) || typeof taskKey !== "string") return { ok: false, message: "Not found." };
  const levels = parseLevels(formData.get("levels"));
  if (levels === "invalid") return { ok: false, message: "The levels couldn't be read. Reload and try again." };
  const fields: Record<string, string> = {};
  for (const [key, value] of formData.entries()) if (!RESERVED.has(key) && !key.startsWith("$") && !key.startsWith("file:") && !key.startsWith("fileCount:") && typeof value === "string") fields[key] = value;
  try {
    const result = await changeDetailsAsApprover(
      { requestId, taskKey, reason: String(formData.get("reason") ?? ""), fields: formData.get("changeValues") === "1" ? fields : undefined, levels: levels ?? undefined },
      me,
    );
    if (!result.ok) return { ok: false, message: result.message, fieldErrors: result.fieldErrors };
  } catch (error) {
    logError("changeDetailsAction failed", error, { requestId });
    return { ok: false, message: "Something went wrong. Please try again." };
  }
  revalidatePath("/users/queue");
  revalidatePath(`/users/requests/${requestId}`);
  revalidatePath("/users");
  return { ok: true, message: "Details changed. The requester and earlier approvers have been told." };
}
