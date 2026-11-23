"use server";

import { revalidatePath } from "next/cache";
import { getAdminActor } from "@/server/admin/actor";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import { logError } from "@/lib/logging/logger";
import type { ActionResult } from "@/lib/http/action-result";
import { holidaySettingsSchema, HOLIDAY_MODES } from "@/server/work/holidays";
import { addDepartmentHoliday, loadHolidaySettings, loadSetting, removeDepartmentHoliday, saveHolidaySettings, saveJsonSetting } from "@/server/work/holiday-store";
import { DIGEST_SETTINGS_KEY, digestSettingsSchema, parseDigestSettings, parseRecurrenceSettings, RECURRENCE_SETTINGS_KEY, recurrenceSettingsSchema } from "@/server/work/more-rules";
import { personFacts } from "@/lib/db/repositories/tasks.repository";
import { moveHolidayTasks, tellHolidayTasks } from "@/server/work/service";
import { parseCelebration, parsePmExtras, PM_EXTRAS_KEY, pmExtrasSchema } from "@/server/work/pm-rules";
import { FIELD_LIMITS_KEY, fieldLimitsSchema, parseFieldLimits } from "@/server/work/custom-fields";
import { AUTOMATION_LIMITS_KEY, automationLimitsSchema, parseAutomationLimits } from "@/server/work/automation-rules";
import { parsePlanningSettings, PLANNING_SETTINGS_KEY, planningSettingsSchema } from "@/server/work/working-days";

// D-217: Admin → Task holidays. IT (with access to the page) sets what tasks
// do on holidays, and moves or tells about tasks due on a holiday.
const NOT_FOUND: ActionResult = { ok: false, message: "Not found." };
const day = (value: FormDataEntryValue | null) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);

export async function saveTaskHolidaySettingsAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await getAdminActor("admin.task_holidays");
  if (!actor) return NOT_FOUND;
  const mode = String(formData.get("mode") ?? "");
  const parsed = holidaySettingsSchema.safeParse({
    mode: (HOLIDAY_MODES as readonly string[]).includes(mode) ? mode : "WARN",
    weeklyOff: formData.get("weeklyOff") === "on",
    suggest: formData.get("suggest") === "PREVIOUS" ? "PREVIOUS" : "NEXT",
    checkStart: formData.get("checkStart") === "on",
    holdReminders: formData.get("holdReminders") === "on",
    showOnCalendars: formData.get("showOnCalendars") === "on",
    notifyNewHoliday: formData.get("notifyNewHoliday") === "on",
  });
  if (!parsed.success) return { ok: false, message: "Check the choices." };
  try {
    const before = await loadHolidaySettings();
    await saveHolidaySettings(parsed.data, actor.id);
    await recordAudit({ actorUserId: actor.id, action: "TASK_HOLIDAY_SETTINGS", entityType: "SETTING", entityId: "tasks.holidays", sessionId: actor.sessionId, ipAddress: actor.ipAddress, metadata: { before, after: parsed.data } });
  } catch (error) {
    logError("saveTaskHolidaySettingsAction failed", error);
    return { ok: false, message: "Couldn't save. Please try again." };
  }
  revalidatePath("/admin/setup/task-settings");
  return { ok: true, message: "Saved. Task dates are checked this way from now on." };
}

export async function holidayTasksAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await getAdminActor("admin.task_holidays");
  if (!actor) return NOT_FOUND;
  const date = day(formData.get("date"));
  const command = String(formData.get("command") ?? "");
  if (!date) return NOT_FOUND;
  try {
    const who = { id: actor.id, name: (await personFacts(actor.id))?.name ?? "IT", roles: actor.roles, sessionId: actor.sessionId, ipAddress: actor.ipAddress };
    const result = command === "TELL" ? await tellHolidayTasks(date, who) : await moveHolidayTasks(date, command === "PREVIOUS" ? "PREVIOUS" : "NEXT", who);
    if (!result.ok) return { ok: false, message: result.message };
    revalidatePath("/admin/setup/task-settings");
    return { ok: true, message: result.message ?? "Done." };
  } catch (error) {
    logError("holidayTasksAction failed", error);
    return { ok: false, message: "Couldn't do that. Please try again." };
  }
}

// D-218: the morning summary and repeating tasks.
export async function saveTaskExtrasAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await getAdminActor("admin.task_holidays");
  if (!actor) return NOT_FOUND;
  const hour = Number(formData.get("digestHour"));
  const digest = digestSettingsSchema.safeParse({ enabled: formData.get("digestEnabled") === "on", hour: Number.isInteger(hour) ? hour : 9, workingDaysOnly: formData.get("digestWorkingDays") === "on" });
  const recurrence = recurrenceSettingsSchema.safeParse({ enabled: formData.get("recurrenceEnabled") === "on", skipHolidays: formData.get("recurrenceSkipHolidays") === "on" });
  if (!digest.success || !recurrence.success) return { ok: false, message: "Check the choices (the summary hour is 5 to 12)." };
  try {
    const before = { digest: parseDigestSettings(await loadSetting(DIGEST_SETTINGS_KEY)), recurrence: parseRecurrenceSettings(await loadSetting(RECURRENCE_SETTINGS_KEY)) };
    await saveJsonSetting(DIGEST_SETTINGS_KEY, digest.data, actor.id);
    await saveJsonSetting(RECURRENCE_SETTINGS_KEY, recurrence.data, actor.id);
    await recordAudit({ actorUserId: actor.id, action: "TASK_SETTINGS", entityType: "SETTING", entityId: "tasks.digest+recurrence", sessionId: actor.sessionId, ipAddress: actor.ipAddress, metadata: { before, after: { digest: digest.data, recurrence: recurrence.data } } });
  } catch (error) {
    logError("saveTaskExtrasAction failed", error);
    return { ok: false, message: "Couldn't save. Please try again." };
  }
  revalidatePath("/admin/setup/task-settings");
  return { ok: true, message: "Saved." };
}

// D-218: holidays of one department (on top of the organisation's).
export async function departmentHolidayAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await getAdminActor("admin.task_holidays");
  if (!actor) return NOT_FOUND;
  const date = day(formData.get("date"));
  const department = Number(formData.get("department"));
  const command = String(formData.get("command") ?? "add");
  if (!date) return { ok: false, message: "Choose a date.", fieldErrors: { date: "Choose a date." } };
  if (!Number.isInteger(department) || department <= 0) return { ok: false, message: "Choose a department.", fieldErrors: { department: "Choose a department." } };
  try {
    if (command === "remove") {
      if (!(await removeDepartmentHoliday(department, date))) return { ok: false, message: "That holiday isn't in the list." };
      await recordAudit({ actorUserId: actor.id, action: "DEPARTMENT_HOLIDAY_REMOVED", entityType: "CALENDAR", entityId: `${department}:${date}`, sessionId: actor.sessionId, ipAddress: actor.ipAddress });
    } else {
      const name = String(formData.get("name") ?? "").trim();
      if (name.length < 2 || name.length > 100) return { ok: false, message: "Give the holiday a name.", fieldErrors: { name: "Enter a name." } };
      if (!(await addDepartmentHoliday(department, date, name, actor.id))) return { ok: false, message: "That department already has a holiday that day.", fieldErrors: { date: "Already a holiday." } };
      await recordAudit({ actorUserId: actor.id, action: "DEPARTMENT_HOLIDAY_ADDED", entityType: "CALENDAR", entityId: `${department}:${date}`, sessionId: actor.sessionId, ipAddress: actor.ipAddress, metadata: { name } });
    }
  } catch (error) {
    logError("departmentHolidayAction failed", error);
    return { ok: false, message: "Couldn't save. Please try again." };
  }
  revalidatePath("/admin/setup/task-settings");
  return { ok: true, message: command === "remove" ? "Removed." : "Added." };
}

// v1.62.0 (D-368): the celebration default for everyone (people can choose
// their own in Profile) and the purge of Deleted after 30 days (default on).
export async function savePmExtrasAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await getAdminActor("admin.task_holidays");
  if (!actor) return NOT_FOUND;
  const parsed = pmExtrasSchema.safeParse({ celebrations: parseCelebration(formData.get("celebrations")) ?? undefined, purge: formData.get("purge") === "on" });
  if (!parsed.success || !parseCelebration(formData.get("celebrations"))) return { ok: false, message: "Check the choices." };
  try {
    const before = parsePmExtras(await loadSetting(PM_EXTRAS_KEY));
    await saveJsonSetting(PM_EXTRAS_KEY, parsed.data, actor.id);
    await recordAudit({ actorUserId: actor.id, action: "TASK_SETTINGS", entityType: "SETTING", entityId: PM_EXTRAS_KEY, sessionId: actor.sessionId, ipAddress: actor.ipAddress, metadata: { before, after: parsed.data } });
  } catch (error) {
    logError("savePmExtrasAction failed", error);
    return { ok: false, message: "Couldn't save. Please try again." };
  }
  revalidatePath("/admin/setup/task-settings");
  return { ok: true, message: "Saved." };
}

// v1.64.0 (D-371, C-8): the custom field limits (defaults 150 fields per
// project, 60 per task, 500 options per field), enforced on the server.
export async function saveFieldLimitsAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await getAdminActor("admin.task_holidays");
  if (!actor) return NOT_FOUND;
  const parsed = fieldLimitsSchema.safeParse({ perProject: Number(formData.get("perProject")), perTask: Number(formData.get("perTask")), options: Number(formData.get("options")) });
  if (!parsed.success) return { ok: false, message: "Use whole numbers: fields per project 1 to 500, per task 1 to 200, options 2 to 1,000." };
  try {
    const before = parseFieldLimits(await loadSetting(FIELD_LIMITS_KEY));
    await saveJsonSetting(FIELD_LIMITS_KEY, parsed.data, actor.id);
    await recordAudit({ actorUserId: actor.id, action: "TASK_SETTINGS", entityType: "SETTING", entityId: FIELD_LIMITS_KEY, sessionId: actor.sessionId, ipAddress: actor.ipAddress, metadata: { before, after: parsed.data } });
  } catch (error) {
    logError("saveFieldLimitsAction failed", error);
    return { ok: false, message: "Couldn't save. Please try again." };
  }
  revalidatePath("/admin/setup/task-settings");
  return { ok: true, message: "Saved." };
}

// v1.74.0 (D-398): hours per working day, for "estimated hours" from From/To
// dates (projects and tasks). 1 to 24 in half hours; default 8.
export async function savePlanningSettingsAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await getAdminActor("admin.task_holidays");
  if (!actor) return NOT_FOUND;
  const raw = String(formData.get("hoursPerDay") ?? "").trim();
  const parsed = planningSettingsSchema.safeParse({ hoursPerDay: raw === "" ? Number.NaN : Number(raw) });
  if (!parsed.success) return { ok: false, message: "Hours per working day: a number from 1 to 24 (half hours allowed).", fieldErrors: { hoursPerDay: "A number from 1 to 24, e.g. 8 or 7.5." } };
  try {
    const before = parsePlanningSettings(await loadSetting(PLANNING_SETTINGS_KEY));
    await saveJsonSetting(PLANNING_SETTINGS_KEY, parsed.data, actor.id);
    await recordAudit({ actorUserId: actor.id, action: "TASK_SETTINGS", entityType: "SETTING", entityId: PLANNING_SETTINGS_KEY, sessionId: actor.sessionId, ipAddress: actor.ipAddress, metadata: { before, after: parsed.data } });
  } catch (error) {
    logError("savePlanningSettingsAction failed", error);
    return { ok: false, message: "Couldn't save. Please try again." };
  }
  revalidatePath("/admin/setup/task-settings");
  return { ok: true, message: "Saved." };
}

// v1.68.0 (D-380, C-8): the project automation limits (defaults 50 automations
// per project, 20 steps per automation), enforced on the server.
export async function saveAutomationLimitsAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await getAdminActor("admin.task_holidays");
  if (!actor) return NOT_FOUND;
  const parsed = automationLimitsSchema.safeParse({ perProject: Number(formData.get("perProject")), stepsPerRule: Number(formData.get("stepsPerRule")) });
  if (!parsed.success) return { ok: false, message: "Use whole numbers: automations per project 1 to 200, steps per automation 1 to 50." };
  try {
    const before = parseAutomationLimits(await loadSetting(AUTOMATION_LIMITS_KEY));
    await saveJsonSetting(AUTOMATION_LIMITS_KEY, parsed.data, actor.id);
    await recordAudit({ actorUserId: actor.id, action: "TASK_SETTINGS", entityType: "SETTING", entityId: AUTOMATION_LIMITS_KEY, sessionId: actor.sessionId, ipAddress: actor.ipAddress, metadata: { before, after: parsed.data } });
  } catch (error) {
    logError("saveAutomationLimitsAction failed", error);
    return { ok: false, message: "Couldn't save. Please try again." };
  }
  revalidatePath("/admin/setup/task-settings");
  return { ok: true, message: "Saved." };
}
