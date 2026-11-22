"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireApiArea } from "@/server/authorization/guards";
import { featureOn } from "@/server/settings/features";
import { getActionContext } from "@/lib/http/request-context";
import { logError } from "@/lib/logging/logger";
import type { ActionResult } from "@/lib/http/action-result";
import type { TaskActor } from "@/server/modules/tasks";
import * as work from "@/server/work/service";
import * as repo from "@/lib/db/repositories/work.repository";
import { parseWorkSearch, workSearchQuery } from "@/server/work/rules";
import { workViewer } from "@/server/work/task-access";
import * as more from "@/server/work/service-more";
import * as templates from "@/server/work/templates";
import { DUPLICATE_PARTS, readDuplicateChoice } from "@/server/work/template-rules";
import * as fieldsService from "@/server/work/fields-service";
import { parseGridConfig } from "@/server/work/grid";
import { projectAbilities } from "@/server/work/access";
import { hasModule } from "@/server/modules/modules";
import { getDbPool } from "@/lib/db/client";
import type { RowDataPacket } from "mysql2/promise";
import type { HolidayHit } from "@/server/work/holidays";
import { z } from "zod";
import { changeMyTabs, changeTabs } from "@/server/work/view-tabs-service";
import { saveRules, startMySections } from "@/server/work/my-rules";
import { changeShare, saveSummaryFields } from "@/server/work/summary-share";
import { setUserSetting } from "@/lib/db/repositories/user-settings.repository";
import { CELEBRATION_LABEL, CELEBRATION_SETTING, clampPaneWidth, PANE_SETTING, parseCelebration, SIDEBAR_LISTS, SIDEBAR_SORT_LABEL, SIDEBAR_SORTS, type SidebarList, type SidebarSort } from "@/server/work/pm-rules";
import { moveSidebarProject, setSidebarSort } from "@/server/work/sidebar";

// D-215: Task & Project Management actions. Each checks the session and the
// page's access (requireApiArea), then the service checks the person's
// rights on the project or task. Answers are plain ActionResults.
async function actor(): Promise<TaskActor | null> {
  try {
    const session = await requireApiArea("users");
    if (!(await featureOn("tasks", session.user))) return null;
    const { ipAddress } = await getActionContext();
    return { id: session.user.id, name: session.user.name, roles: session.user.roles, modules: session.user.modules, sessionId: session.sessionId, ipAddress };
  } catch {
    return null;
  }
}

// D-307 (owner): Projects is its own module. Every project change (the
// project, its members, sections, status, fields, templates, views, and
// putting a task in or out of a project) needs it, wherever it is posted from.
const PROJECTS_OFF = { ok: false as const, message: "Projects isn't available to you yet." };
const projectsAllowed = (me: TaskActor) => !me.modules || hasModule({ roles: me.roles, modules: me.modules }, "PROJECT");
async function actorForProjects(): Promise<TaskActor | null | "OFF"> {
  const me = await actor();
  return me && !projectsAllowed(me) ? "OFF" : me;
}
// run() for project changes: refused with a clear message without the module.
async function runProject<T>(label: string, me: TaskActor | null | "OFF", work: Parameters<typeof run<T>>[2]): Promise<ActionResult & { value?: T; holiday?: HolidayHit }> {
  return me === "OFF" ? { ok: false, message: PROJECTS_OFF.message ?? "" } : run<T>(label, me, work);
}

const id = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 && value < 1e10 ? value : typeof value === "string" && /^\d{1,10}$/.test(value) ? Number(value) : null);
const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};
const NOT_FOUND: ActionResult = { ok: false, message: "Not found." };

function refresh() {
  revalidatePath("/users/work", "layout");
  revalidatePath("/users/tasks", "layout");
}

// Each action names its caller first (await actor()), then runs here.
async function run<T>(label: string, me: TaskActor | null, work: (me: TaskActor) => Promise<{ ok: true; value: T; message?: string } | { ok: false; message: string; fieldErrors?: Record<string, string>; holiday?: HolidayHit }>): Promise<ActionResult & { value?: T; holiday?: HolidayHit }> {
  if (!me) return NOT_FOUND;
  try {
    const result = await work(me);
    // D-217: a date on a holiday goes back to the person to keep or move.
    if (!result.ok) return { ok: false, message: result.message, fieldErrors: result.fieldErrors, ...(result.holiday ? { holiday: result.holiday } : {}) };
    refresh();
    return { ok: true, message: result.message ?? "Saved.", value: result.value };
  } catch (error) {
    logError(`work action ${label} failed`, error);
    return { ok: false, message: "Couldn't do that. Please try again." };
  }
}

// ---- projects ------------------------------------------------------------------------
function projectInput(formData: FormData): work.ProjectInput {
  return {
    name: text(formData, "name"),
    description: text(formData, "description"),
    color: text(formData, "color"),
    privacy: text(formData, "privacy"),
    departmentId: id(text(formData, "department")),
    defaultAccessRole: text(formData, "default_access_role"),
    defaultView: text(formData, "default_view"),
    startOn: text(formData, "start_on"),
    dueOn: text(formData, "due_on"),
    sections: text(formData, "sections"),
  };
}

export async function createProjectAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await runProject("createProject", await actorForProjects(), (me) => work.createProject(projectInput(formData), me));
  if (!result.ok || !result.value) return result;
  redirect(`/users/work/projects/${(result.value as { id: number }).id}?created=1`);
}

export async function updateProjectAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const projectId = id(text(formData, "projectId"));
  if (!projectId) return NOT_FOUND;
  const version = text(formData, "rowVersion");
  return runProject("updateProject", await actorForProjects(), (me) => work.updateProjectDetails(projectId, { ...projectInput(formData), rowVersion: /^\d+$/.test(version) ? Number(version) : undefined }, me));
}

// v1.73.0 (D-396): the header's inline title (owners).
export async function renameProjectAction(projectId: number, name: string): Promise<ActionResult> {
  const project = id(projectId);
  if (!project) return NOT_FOUND;
  return runProject("renameProject", await actorForProjects(), (me) => work.renameProject(project, typeof name === "string" ? name : "", me));
}

export async function memberAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const projectId = id(text(formData, "projectId"));
  const [type, raw] = text(formData, "member").split(":");
  const memberId = id(raw);
  if (!projectId || !memberId || (type !== "USER" && type !== "DEPARTMENT")) return { ok: false, message: "Choose a person or department.", fieldErrors: { member: "Choose a person or department." } };
  const role = text(formData, "role");
  return runProject("member", await actorForProjects(), (me) => work.setMember(projectId, { type, id: memberId }, role === "REMOVE" ? null : role, me));
}

export async function projectCommand(projectId: number, command: "JOIN" | "LEAVE" | "ARCHIVE" | "UNARCHIVE" | "DELETE" | "RESTORE" | "STAR"): Promise<ActionResult> {
  const project = id(projectId);
  if (!project) return NOT_FOUND;
  if (command === "STAR") {
    const me = await actorForProjects();
    if (me === "OFF") return PROJECTS_OFF;
    if (!me) return NOT_FOUND;
    const found = await repo.projectFor(project, await workViewer(me));
    if (!found) return NOT_FOUND;
    const on = await repo.toggleFavourite(me.id, "PROJECT", project);
    refresh();
    return { ok: true, message: on ? "Starred." : "Unstarred." };
  }
  return runProject(command, await actorForProjects(), (me) => (command === "JOIN" ? work.joinProject(project, me) : command === "LEAVE" ? work.leaveProject(project, me) : work.setProjectLifecycle(project, command, me)));
}

export async function statusAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const projectId = id(text(formData, "projectId"));
  if (!projectId) return NOT_FOUND;
  return runProject("status", await actorForProjects(), (me) => work.postStatus(projectId, { status: text(formData, "status"), title: text(formData, "title"), body: text(formData, "body") }, me));
}

export async function removeStatusAction(statusId: number): Promise<ActionResult> {
  const update = id(statusId);
  return update ? runProject("removeStatus", await actorForProjects(), (me) => work.removeStatus(update, me)) : NOT_FOUND;
}

// ---- sections --------------------------------------------------------------------------
export async function addSectionAction(projectId: number, name: string, afterSectionId: number | null): Promise<ActionResult> {
  const project = id(projectId);
  return project ? runProject("addSection", await actorForProjects(), (me) => work.addSection(project, String(name ?? ""), id(afterSectionId), me)) : NOT_FOUND;
}

export async function sectionAction(sectionId: number, change: { name?: string; beforeId?: number | null; afterId?: number | null; deleteMoveTo?: number }): Promise<ActionResult> {
  const section = id(sectionId);
  if (!section) return NOT_FOUND;
  const moveTo = change.deleteMoveTo === undefined ? undefined : id(change.deleteMoveTo);
  return runProject("section", await actorForProjects(), (me) =>
    work.changeSection(
      section,
      {
        ...(typeof change.name === "string" ? { name: change.name } : {}),
        ...(change.beforeId !== undefined ? { beforeId: id(change.beforeId) } : {}),
        ...(change.afterId !== undefined ? { afterId: id(change.afterId) } : {}),
        ...(moveTo ? { delete: { moveTo } } : {}),
      },
      me,
    ),
  );
}

// ---- tasks -----------------------------------------------------------------------------
export async function quickAddAction(input: { title: string; projectId?: number | null; sectionId?: number | null; parentId?: number | null; assigneeId?: number | null; assigneeIds?: number[]; dueDay?: string; startDay?: string; mySectionId?: number | null; holidayOk?: boolean; description?: string }): Promise<ActionResult & { value?: { id: number; taskNo: string }; holiday?: HolidayHit }> {
  // D-222: an ad hoc task for several people (one copy each).
  const many = (Array.isArray(input.assigneeIds) ? input.assigneeIds : []).map((item) => id(item)).filter((item): item is number => item !== null);
  if (id(input.projectId) !== null && (await actorForProjects()) === "OFF") return PROJECTS_OFF;
  if (many.length > 1)
    return run("quickAddMany", await actor(), (me) =>
      work.quickAddForMany(
        { title: String(input.title ?? ""), projectId: id(input.projectId), sectionId: id(input.sectionId), parentId: id(input.parentId), assigneeId: null, dueDay: typeof input.dueDay === "string" ? input.dueDay : "", startDay: typeof input.startDay === "string" ? input.startDay : undefined, mySectionId: null, holidayOk: input.holidayOk === true, description: typeof input.description === "string" ? input.description : undefined },
        many,
        me,
      ),
    );
  return run("quickAdd", await actor(), (me) =>
    work.quickAddTask(
      {
        title: String(input.title ?? ""),
        projectId: id(input.projectId),
        sectionId: id(input.sectionId),
        parentId: id(input.parentId),
        assigneeId: id(input.assigneeId),
        dueDay: typeof input.dueDay === "string" ? input.dueDay : "",
        startDay: typeof input.startDay === "string" ? input.startDay : undefined,
        mySectionId: id(input.mySectionId),
        holidayOk: input.holidayOk === true,
        description: typeof input.description === "string" ? input.description : undefined,
      },
      me,
    ),
  );
}

// v1.50.3 (owner: "follow-up management from the linked tasks"): a follow-up
// task from a request page, linked to the request (Task module required).
export async function requestTaskAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if (!me || !(me.modules ?? []).includes("TASK") && !me.roles.includes("SUPER_ADMIN")) return { ok: false, message: "Not found." };
  const requestId = id(text(formData, "requestId"));
  if (requestId === null) return { ok: false, message: "Not found." };
  const result = await run("requestTask", me, (who) =>
    work.quickAddTask(
      {
        title: text(formData, "title"),
        projectId: null,
        sectionId: null,
        parentId: null,
        assigneeId: id(text(formData, "assigneeId")),
        dueDay: text(formData, "dueDay"),
        mySectionId: null,
        priority: text(formData, "priority"),
        holidayOk: formData.get("holidayOk") === "on",
        relatedRequestId: requestId,
      },
      who,
    ),
  );
  if (result.ok) {
    revalidatePath(`/users/requests/${requestId}`);
    return { ok: true, message: "Follow-up task added." };
  }
  return result;
}

// Several lines pasted at once: one task per line (at most 50).
export async function quickAddManyAction(input: { titles: string[]; projectId?: number | null; sectionId?: number | null; parentId?: number | null; mySectionId?: number | null }): Promise<ActionResult> {
  if (!(await actor())) return NOT_FOUND;
  const titles = (Array.isArray(input.titles) ? input.titles : []).map((title) => String(title).trim()).filter(Boolean).slice(0, 50);
  if (!titles.length) return { ok: false, message: "Nothing to add." };
  let added = 0;
  for (const title of titles) {
    const result = await quickAddAction({ title, projectId: input.projectId, sectionId: input.sectionId, parentId: input.parentId, mySectionId: input.mySectionId });
    if (!result.ok) return { ok: false, message: added ? `Added ${added}; then: ${result.message}` : result.message };
    added += 1;
  }
  return { ok: true, message: `Added ${added} tasks.` };
}

export async function moveTaskAction(input: { taskId: number; projectId: number; sectionId: number; beforeId: number | null; afterId: number | null }): Promise<ActionResult> {
  const taskId = id(input.taskId);
  const projectId = id(input.projectId);
  const sectionId = id(input.sectionId);
  if (!taskId || !projectId || !sectionId) return NOT_FOUND;
  return runProject("move", await actorForProjects(), (me) => work.moveInProject({ taskId, projectId, sectionId, beforeId: id(input.beforeId), afterId: id(input.afterId) }, me));
}

export async function completeAction(taskId: number): Promise<ActionResult> {
  const task = id(taskId);
  return task ? run("complete", await actor(), (me) => work.toggleComplete(task, me)) : NOT_FOUND;
}

export async function taskFieldsAction(taskId: number, change: { dueDay?: string; startDay?: string; assigneeId?: number; priority?: string; title?: string; milestone?: boolean; holidayOk?: boolean }): Promise<ActionResult & { holiday?: HolidayHit }> {
  const task = id(taskId);
  if (!task) return NOT_FOUND;
  const clean: Parameters<typeof work.setTaskFields>[1] = {};
  if (typeof change.dueDay === "string") clean.dueDay = change.dueDay;
  if (typeof change.startDay === "string") clean.startDay = change.startDay;
  if (change.assigneeId !== undefined) {
    const person = id(change.assigneeId);
    if (!person) return { ok: false, message: "Choose a person." };
    clean.assigneeId = person;
  }
  if (typeof change.priority === "string") clean.priority = change.priority;
  if (typeof change.title === "string") clean.title = change.title;
  if (typeof change.milestone === "boolean") clean.milestone = change.milestone;
  if (change.holidayOk === true) clean.holidayOk = true;
  return run("fields", await actor(), (me) => work.setTaskFields(task, clean, me));
}

export async function taskProjectAction(taskId: number, projectId: number, on: boolean, sectionId: number | null = null): Promise<ActionResult> {
  const task = id(taskId);
  const project = id(projectId);
  if (!task || !project) return NOT_FOUND;
  return runProject("taskProject", await actorForProjects(), (me) => (on ? work.addToProject(task, project, id(sectionId), me) : work.removeFromProject(task, project, me)));
}

export async function parentAction(taskId: number, parentRef: string | null): Promise<ActionResult> {
  const task = id(taskId);
  if (!task) return NOT_FOUND;
  const me = await actor();
  if (!me) return NOT_FOUND;
  let parentId: number | null = null;
  if (parentRef) {
    const ref = parentRef.trim().toUpperCase();
    const [rows] = await getDbPool().query<RowDataPacket[]>("SELECT id FROM tasks WHERE task_no = ? AND deleted_at IS NULL", [ref]);
    parentId = rows[0] ? Number(rows[0].id) : null;
    if (!parentId) return { ok: false, message: "No task with that number that you can see.", fieldErrors: { parent: "No task with that number that you can see." } };
  }
  return run("parent", me, (who) => work.setParent(task, parentId, who));
}

export async function subtaskOrderAction(taskId: number, beforeId: number | null, afterId: number | null): Promise<ActionResult> {
  const task = id(taskId);
  return task ? run("subtaskOrder", await actor(), (me) => work.moveSubtask(task, id(beforeId), id(afterId), me)) : NOT_FOUND;
}

export async function deleteTaskAction(taskId: number, restore = false): Promise<ActionResult> {
  const task = id(taskId);
  return task ? run(restore ? "restore" : "delete", await actor(), (me) => (restore ? work.restoreTask(task, me) : work.deleteTask(task, me))) : NOT_FOUND;
}

// ---- collaboration -----------------------------------------------------------------------
export async function followAction(taskId: number, userId: number, on: boolean): Promise<ActionResult> {
  const task = id(taskId);
  const person = id(userId);
  return task && person ? run("follow", await actor(), (me) => work.setFollower(task, person, on, me)) : NOT_FOUND;
}

export async function likeAction(target: "TASK" | "COMMENT", targetId: number): Promise<ActionResult & { liked?: boolean }> {
  const item = id(targetId);
  if (!item) return NOT_FOUND;
  const result = await run("like", await actor(), (me) => (target === "COMMENT" ? work.likeComment(item, me) : work.likeTask(item, me)));
  return { ...result, liked: (result.value as { liked: boolean } | undefined)?.liked };
}

export async function commentAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const taskId = id(text(formData, "taskId"));
  if (!taskId) return NOT_FOUND;
  const result = await run("comment", await actor(), (me) => work.addComment(taskId, text(formData, "body"), id(text(formData, "parentId")), me, { addMentionedAsFollowers: text(formData, "mentionAccess") === "yes" }));
  const notSeeing = (result.value as { notSeeing: string[] } | undefined)?.notSeeing ?? [];
  return result.ok ? { ok: true, message: notSeeing.length ? `Posted. ${notSeeing.join(", ")} can't see this task, so they weren't told.` : "Posted." } : result;
}

export async function commentChangeAction(commentId: number, change: { body?: string; pinned?: boolean; delete?: boolean }): Promise<ActionResult> {
  const comment = id(commentId);
  if (!comment) return NOT_FOUND;
  const clean: { body?: string; pinned?: boolean; delete?: boolean } = {};
  if (typeof change.body === "string") clean.body = change.body;
  if (typeof change.pinned === "boolean") clean.pinned = change.pinned;
  if (change.delete === true) clean.delete = true;
  return run("commentChange", await actor(), (me) => work.changeComment(comment, clean, me));
}

export async function dependencyAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const taskId = id(text(formData, "taskId"));
  if (!taskId) return NOT_FOUND;
  return run("dependency", await actor(), (me) => work.setDependency(taskId, text(formData, "blocker"), text(formData, "on") !== "0", me));
}

export async function tagAction(taskId: number, name: string, on: boolean): Promise<ActionResult> {
  const task = id(taskId);
  return task ? run("tag", await actor(), (me) => work.setTag(task, String(name ?? ""), on, me)) : NOT_FOUND;
}

// ---- My Tasks --------------------------------------------------------------------------
export async function myPlaceAction(taskId: number, sectionId: number, position: number): Promise<ActionResult> {
  const task = id(taskId);
  const section = id(sectionId);
  if (!task || !section || typeof position !== "number") return NOT_FOUND;
  return run("myPlace", await actor(), async (me) => {
    // v1.76.0 (D-401): the first move by hand starts My sections (rules and all).
    await startMySections(me.id);
    return work.placeMine(task, section, position, me);
  });
}

// v1.76.0 (D-401, owner): the person's Task Summary section rules (Customise ▸ Rules).
export async function myRulesAction(input: unknown): Promise<ActionResult> {
  const me = await actor();
  if (!me || (me.modules && !hasModule({ roles: me.roles, modules: me.modules }, "TASK"))) return NOT_FOUND;
  if (!(await featureOn("pm_foundations", me))) return { ok: false, message: "My sections aren't switched on yet." };
  try {
    const result = await saveRules(input, me);
    if (result.ok) revalidatePath("/users/work/my-tasks");
    return { ok: result.ok, message: result.message };
  } catch (error) {
    logError("myRulesAction failed", error);
    return { ok: false, message: "Couldn't save the rules. Please try again." };
  }
}

export async function mySectionAction(command: "ADD" | "RENAME" | "DELETE", sectionId: number | null, name: string): Promise<ActionResult> {
  const me = await actor();
  if (!me) return NOT_FOUND;
  const title = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  try {
    const sections = await repo.ensureMySections(me.id);
    if (command === "ADD") {
      if (!title) return { ok: false, message: "Give the section a name." };
      if (sections.length >= 30) return { ok: false, message: "You have 30 sections already." };
      await repo.insertMySection(me.id, title, (sections.at(-1)?.position ?? 0) + 1024);
    } else if (command === "RENAME") {
      if (!title || !id(sectionId) || !(await repo.updateMySection(me.id, id(sectionId)!, { name: title }))) return { ok: false, message: "Give the section a name." };
    } else if (!id(sectionId) || !(await repo.deleteMySection(me.id, id(sectionId)!))) return { ok: false, message: "Built-in sections can't be deleted." };
    // v1.76.0 (D-401): adding a section starts My sections (rules and all).
    if (command === "ADD") await startMySections(me.id);
    revalidatePath("/users/work/my-tasks");
    // v1.76.0 (D-401, BR-MYT-006): a deleted section's tasks go to Recently assigned.
    return { ok: true, message: command === "DELETE" ? "Section deleted. Its tasks are in Recently assigned now." : command === "ADD" ? "Section added." : "Saved." };
  } catch (error) {
    logError("mySectionAction failed", error);
    return { ok: false, message: "Couldn't do that. Please try again." };
  }
}

// ---- saved searches ----------------------------------------------------------------------
export async function saveSearchAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if (!me) return NOT_FOUND;
  const name = text(formData, "name").replace(/\s+/g, " ").trim().slice(0, 80);
  if (name.length < 2) return { ok: false, message: "Give the search a name.", fieldErrors: { name: "Use 2 to 80 characters." } };
  const { page: _page, ...query } = workSearchQuery(parseWorkSearch(Object.fromEntries(new URLSearchParams(text(formData, "query")))));
  void _page;
  const result = await repo.insertSavedSearch(me.id, name, new URLSearchParams(query).toString());
  if (result === "DUPLICATE") return { ok: false, message: "You have a search with that name.", fieldErrors: { name: "Choose another name." } };
  if (result === "TOO_MANY") return { ok: false, message: "You have 50 saved searches. Delete one first." };
  revalidatePath("/users/work", "layout");
  return { ok: true, message: `Saved as "${name}".` };
}

export async function savedSearchCommand(searchId: number, command: "DELETE" | "STAR"): Promise<ActionResult> {
  const me = await actor();
  const search = id(searchId);
  if (!me || !search) return NOT_FOUND;
  if (!(await repo.listSavedSearches(me.id)).some((item) => item.id === search)) return NOT_FOUND;
  if (command === "DELETE") await repo.deleteSavedSearch(me.id, search);
  else await repo.toggleFavourite(me.id, "SEARCH", search);
  revalidatePath("/users/work", "layout");
  return { ok: true, message: command === "DELETE" ? "Deleted." : "Saved." };
}

// ---- D-218: recurring tasks, fields, templates, bulk, inbox, digest --------------------
export async function recurrenceAction(taskId: number, rule: { kind: string; every: number; weekdays?: number[] } | null): Promise<ActionResult> {
  const task = id(taskId);
  return task ? run("recurrence", await actor(), (me) => more.setRecurrence(task, rule, me)) : NOT_FOUND;
}

export async function addFieldAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const projectId = id(text(formData, "projectId"));
  if (!projectId) return NOT_FOUND;
  return runProject("addField", await actorForProjects(), (me) => more.addField(projectId, { name: text(formData, "name"), kind: text(formData, "kind"), options: text(formData, "options") }, me));
}

export async function removeFieldAction(fieldId: number, projectId?: number): Promise<ActionResult> {
  const field = id(fieldId);
  const project = projectId === undefined ? undefined : (id(projectId) ?? undefined);
  return field ? runProject("removeField", await actorForProjects(), (me) => more.removeField(field, me, project)) : NOT_FOUND;
}

// v1.64.0 (D-371): a value of any field type (text, number, option id or
// name, option ids, date, people ids, task ids); checked by type on the server.
export async function fieldValueAction(taskId: number, fieldId: number, value: unknown): Promise<ActionResult> {
  const task = id(taskId);
  const field = id(fieldId);
  if (!task || !field) return NOT_FOUND;
  const clean = value === null || typeof value === "string" || typeof value === "number" ? value : Array.isArray(value) && value.length <= 50 && value.every((item) => typeof item === "number") ? value : undefined;
  if (clean === undefined) return { ok: false, message: "Check the value." };
  return runProject("fieldValue", await actorForProjects(), (me) => more.setTaskField(task, field, clean, me));
}

// ---- v1.64.0 (D-371, PM phase B part 1): custom fields ------------------------------------
const fieldOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), input: z.unknown() }),
  z.object({ op: z.literal("update"), fieldId: z.number().int().positive(), input: z.unknown() }),
  z.object({ op: z.enum(["remove", "delete", "restore", "addBack", "attach"]), fieldId: z.number().int().positive() }),
  z.object({ op: z.literal("move"), fieldId: z.number().int().positive(), direction: z.enum(["up", "down"]) }),
  z.object({ op: z.literal("cards"), fieldId: z.number().int().positive(), show: z.boolean() }),
]);
export async function fieldDefAction(projectId: number, change: unknown): Promise<ActionResult & { value?: unknown }> {
  const project = id(projectId);
  const parsed = fieldOpSchema.safeParse(change);
  if (!project || !parsed.success) return NOT_FOUND;
  const op = parsed.data;
  return runProject(`field:${op.op}`, await actorForProjects(), (me) => {
    switch (op.op) {
      case "create":
        return fieldsService.createField(project, op.input, me);
      case "update":
        return fieldsService.updateField(project, op.fieldId, op.input, me);
      case "remove":
        return fieldsService.removeFieldFromProject(project, op.fieldId, me);
      case "delete":
        return fieldsService.deleteField(project, op.fieldId, me);
      case "restore":
        return fieldsService.restoreField(project, op.fieldId, me);
      case "addBack":
        return fieldsService.addBackField(project, op.fieldId, me);
      case "attach":
        return fieldsService.attachLibraryField(project, op.fieldId, me);
      case "move":
        return fieldsService.moveField(project, op.fieldId, op.direction, me);
      case "cards":
        return fieldsService.showOnCards(project, op.fieldId, op.show, me);
    }
  });
}
// The organisation's field library (the Add field dialog's second tab).
export async function fieldLibraryAction(query: string): Promise<ActionResult & { value?: { id: number; name: string; kind: string; description: string | null; options: string[]; usage: number; createdBy: string }[] }> {
  const me = await actorForProjects();
  if (me === "OFF") return PROJECTS_OFF;
  if (!me) return NOT_FOUND;
  try {
    const result = await fieldsService.libraryFor(String(query ?? ""), me);
    if (!result.ok) return result;
    return { ok: true, message: "", value: result.value.map((field) => ({ id: field.id, name: field.name, kind: field.type, description: field.description, options: field.options.filter((option) => !option.archived).map((option) => option.name), usage: field.usage, createdBy: field.createdByName })) };
  } catch (error) {
    logError("fieldLibraryAction failed", error);
    return { ok: false, message: "Couldn't load the library. Please try again." };
  }
}
export async function fieldTimerAction(taskId: number, fieldId: number, command: string): Promise<ActionResult> {
  const task = id(taskId);
  const field = id(fieldId);
  if (!task || !field || (command !== "start" && command !== "stop")) return NOT_FOUND;
  return runProject("fieldTimer", await actorForProjects(), (me) => fieldsService.timer(task, field, command, me));
}
// Tasks the person can see, by number or words (a reference field's picker).
export async function fieldTaskSearchAction(q: string): Promise<ActionResult & { value?: { id: number; taskNo: string; title: string }[] }> {
  const me = await actorForProjects();
  if (me === "OFF") return PROJECTS_OFF;
  if (!me) return NOT_FOUND;
  const text = String(q ?? "").trim().slice(0, 80);
  if (text.length < 2) return { ok: true, message: "", value: [] };
  try {
    const found = await repo.quickWork(await workViewer(me), text);
    return { ok: true, message: "", value: found.tasks.map((task) => ({ id: task.id, taskNo: task.taskNo, title: task.title })) };
  } catch (error) {
    logError("fieldTaskSearchAction failed", error);
    return { ok: false, message: "Couldn't search. Please try again." };
  }
}

export async function saveTemplateAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const projectId = id(text(formData, "projectId"));
  if (!projectId) return NOT_FOUND;
  // v1.70.0 (D-383): with "pm_extras" on, a complete template (every part of the project).
  const result = await runProject("saveTemplate", await actorForProjects(), async (me) => ((await templates.extrasOn(me)) ? templates.saveTemplate(projectId, text(formData, "name"), me) : more.saveAsTemplate(projectId, text(formData, "name"), me)));
  if (!result.ok || !result.value) return result;
  redirect(`/users/work/projects/${(result.value as { id: number }).id}`);
}

export async function fromTemplateAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const templateId = id(text(formData, "templateId"));
  const copyFrom = id(text(formData, "copyFrom"));
  if (!templateId && !copyFrom) return { ok: false, message: "Choose a template.", fieldErrors: { templateId: "Choose a template." } };
  const details = { name: text(formData, "name"), startOn: text(formData, "start_on"), privacy: text(formData, "privacy"), departmentId: id(text(formData, "department")) };
  // v1.70.0 (D-383): with "pm_extras" on, complete templates (placeholders chosen per person) and Duplicate with choices.
  const me = await actorForProjects();
  if (me && me !== "OFF" && (await templates.extrasOn(me))) {
    const extras = await runProject("fromTemplateExtras", me, async (who) => {
      if (templateId) {
        const assign: Record<string, number | null> = {};
        for (const [key, value] of formData.entries()) if (key.startsWith("assign_") && typeof value === "string") assign[key.slice(7)] = id(value);
        return templates.useTemplate(templateId, { ...details, assign }, who);
      }
      // Ticked boxes are sent; with the "parts" marker an unticked box means off.
      const marked = formData.get("parts") === "1";
      const parts = Object.fromEntries(DUPLICATE_PARTS.map((part) => [part, marked ? formData.get(`part_${part}`) === "on" : undefined]));
      return templates.duplicateProject(copyFrom!, details, readDuplicateChoice({ parts, shiftDays: text(formData, "shift_days") || 0 }), who);
    });
    if (!extras.ok || !extras.value) return extras;
    redirect(`/users/work/projects/${(extras.value as { id: number }).id}?created=1`);
  }
  const result = await runProject("fromTemplate", me, (me) =>
    more.createFromTemplate(
      { templateId: templateId ?? undefined, copyFrom: copyFrom ?? undefined, copyMembers: text(formData, "copyMembers") === "on" },
      { name: text(formData, "name"), startOn: text(formData, "start_on"), privacy: text(formData, "privacy"), departmentId: id(text(formData, "department")) },
      me,
    ),
  );
  if (!result.ok || !result.value) return result;
  redirect(`/users/work/projects/${(result.value as { id: number }).id}?created=1`);
}

export async function bulkAction(ids: number[], op: string, value: { assigneeId?: number; dueDay?: string; priority?: string; projectId?: number; sectionId?: number; tag?: string; holidayOk?: boolean } = {}): Promise<ActionResult & { holiday?: HolidayHit }> {
  const me = await actor();
  if (!me) return NOT_FOUND;
  if (!(more.BULK_OPS as readonly string[]).includes(op)) return NOT_FOUND;
  if (id(value.projectId) !== null && !projectsAllowed(me)) return PROJECTS_OFF;
  const clean = (Array.isArray(ids) ? ids : []).map((item) => id(item)).filter((item): item is number => item !== null);
  return run("bulk", me, (who) =>
    more.bulkTasks(
      clean,
      op as more.BulkOp,
      {
        assigneeId: id(value.assigneeId) ?? undefined,
        dueDay: typeof value.dueDay === "string" ? value.dueDay : undefined,
        priority: typeof value.priority === "string" ? value.priority : undefined,
        projectId: id(value.projectId) ?? undefined,
        sectionId: id(value.sectionId) ?? undefined,
        tag: typeof value.tag === "string" ? value.tag : undefined,
        holidayOk: value.holidayOk === true,
      },
      who,
    ),
  );
}

export async function digestChoiceAction(on: boolean): Promise<ActionResult> {
  const me = await actor();
  if (!me) return NOT_FOUND;
  try {
    if (on) await getDbPool().query("DELETE FROM user_settings WHERE user_id = ? AND setting_key = 'work.digest'", [me.id]);
    else await getDbPool().query("INSERT INTO user_settings (user_id, setting_key, value) VALUES (?, 'work.digest', 'OFF') ON DUPLICATE KEY UPDATE value = 'OFF'", [me.id]);
    revalidatePath("/users/work/my-tasks");
    return { ok: true, message: on ? "You'll get the morning summary." : "Morning summary switched off." };
  } catch (error) {
    logError("digestChoiceAction failed", error);
    return { ok: false, message: "Couldn't save. Please try again." };
  }
}

// ---- D-220: saved view tabs ------------------------------------------------------------
// My Tasks tabs are the person's own; a project's tabs are made by its owners
// and editors and seen by everyone in it.
async function mayChangeViews(me: TaskActor, scope: "MY_TASKS" | "PROJECT", scopeId: number): Promise<boolean> {
  if (scope === "MY_TASKS") return scopeId === me.id;
  const found = await repo.projectFor(scopeId, await workViewer(me));
  return Boolean(found && projectAbilities(found.role).edit);
}

export async function saveViewAction(scope: "MY_TASKS" | "PROJECT", scopeId: number, name: string, config: unknown): Promise<ActionResult & { value?: number }> {
  const me = await actor();
  const target = id(scopeId);
  if (!me || !target || (scope !== "MY_TASKS" && scope !== "PROJECT")) return NOT_FOUND;
  if (scope === "PROJECT" && !projectsAllowed(me)) return PROJECTS_OFF;
  const title = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (title.length < 1) return { ok: false, message: "Give the tab a name." };
  if (!(await mayChangeViews(me, scope, target))) return { ok: false, message: "Only the project's owners and editors can add tabs." };
  try {
    const result = await repo.insertWorkView(scope, target, title, parseGridConfig(config), me.id);
    if (result === "DUPLICATE") return { ok: false, message: "There is a tab with that name." };
    if (result === "TOO_MANY") return { ok: false, message: "At most 30 tabs." };
    refresh();
    return { ok: true, message: `Tab "${title}" saved.`, value: result };
  } catch (error) {
    logError("saveViewAction failed", error);
    return { ok: false, message: "Couldn't save. Please try again." };
  }
}

export async function updateViewAction(viewId: number, config: unknown): Promise<ActionResult> {
  const me = await actor();
  const view = id(viewId) ? await repo.findWorkView(id(viewId)!) : null;
  if (!me || !view || !(await mayChangeViews(me, view.scope, view.scopeId))) return NOT_FOUND;
  if (view.scope === "PROJECT" && !projectsAllowed(me)) return PROJECTS_OFF;
  await repo.updateWorkView(view.id, { config: parseGridConfig(config) });
  refresh();
  return { ok: true, message: "View saved." };
}

export async function deleteViewAction(viewId: number): Promise<ActionResult> {
  const me = await actor();
  const view = id(viewId) ? await repo.findWorkView(id(viewId)!) : null;
  if (!me || !view || !(await mayChangeViews(me, view.scope, view.scopeId))) return NOT_FOUND;
  if (view.scope === "PROJECT" && !projectsAllowed(me)) return PROJECTS_OFF;
  await repo.deleteWorkView(view.id);
  refresh();
  return { ok: true, message: "Tab deleted." };
}

// ---- v1.61.0 (D-367, PM phase A): tabs for every view --------------------------------
// Behind the "pm_foundations" switch. Owners and editors change a project's
// tabs (server/work/view-tabs-service.ts checks the role again, deny by default).
const tabInput = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), type: z.string().max(20), name: z.string().max(200).optional() }),
  z.object({ op: z.literal("rename"), key: z.string().max(20), name: z.string().max(200) }),
  z.object({ op: z.literal("default"), key: z.string().max(20) }),
  z.object({ op: z.literal("duplicate"), key: z.string().max(20) }),
  z.object({ op: z.literal("remove"), key: z.string().max(20) }),
  z.object({ op: z.literal("reorder"), keys: z.array(z.string().max(20)).max(60) }),
  z.object({ op: z.literal("save"), key: z.string().max(20), config: z.unknown(), auto: z.boolean().optional() }),
  z.object({ op: z.literal("settings"), key: z.string().max(20), range: z.string().max(20).optional(), sections: z.string().max(20).optional() }),
]);
export async function projectTabAction(projectId: number, input: unknown): Promise<ActionResult & { value?: { id: number | null } }> {
  const me = await actorForProjects();
  const target = id(projectId);
  if (!me || !target) return NOT_FOUND;
  if (me === "OFF") return PROJECTS_OFF;
  if (!(await featureOn("pm_foundations", me))) return { ok: false, message: "Tabs for every view aren't switched on yet." };
  const parsed = tabInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That change isn't valid." };
  try {
    const result = await changeTabs(target, parsed.data, me, await workViewer(me));
    if (!result.ok) return { ok: false, message: result.message };
    refresh();
    return { ok: true, message: result.message, value: result.value };
  } catch (error) {
    logError("projectTabAction failed", error);
    return { ok: false, message: "Couldn't do that. Please try again." };
  }
}

// v1.63.0 (D-369, PM-A13): the person's own My Tasks tabs (List, Board,
// Calendar), with the same menu as a project's. Only ever the signed-in
// person's strip: a tab of anyone else's is "not found".
export async function myTasksTabAction(input: unknown): Promise<ActionResult & { value?: { id: number | null } }> {
  const me = await actor();
  if (!me || (me.modules && !hasModule({ roles: me.roles, modules: me.modules }, "TASK"))) return NOT_FOUND;
  if (!(await featureOn("pm_foundations", me))) return { ok: false, message: "Tabs for every view aren't switched on yet." };
  const parsed = tabInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That change isn't valid." };
  try {
    const result = await changeMyTabs(parsed.data, me);
    if (!result.ok) return { ok: false, message: result.message };
    // v1.76.0 (D-401): an auto-save keeps the page as it is (no reload under the person's hands).
    if (!(parsed.data.op === "save" && parsed.data.auto)) refresh();
    return { ok: true, message: result.message, value: result.value };
  } catch (error) {
    logError("myTasksTabAction failed", error);
    return { ok: false, message: "Couldn't do that. Please try again." };
  }
}

// v1.61.0 (D-367): the person's row density for task lists (Comfortable or
// Compact), kept with their other preferences in user_settings.
export async function densityAction(value: string): Promise<ActionResult> {
  const me = await actor();
  if (!me) return NOT_FOUND;
  if (value !== "COMFORTABLE" && value !== "COMPACT") return { ok: false, message: "Choose Comfortable or Compact." };
  try {
    if (value === "COMFORTABLE") await getDbPool().query("DELETE FROM user_settings WHERE user_id = ? AND setting_key = 'work.density'", [me.id]);
    else await getDbPool().query("INSERT INTO user_settings (user_id, setting_key, value) VALUES (?, 'work.density', 'COMPACT') ON DUPLICATE KEY UPDATE value = 'COMPACT'", [me.id]);
    revalidatePath("/users/work", "layout");
    return { ok: true, message: value === "COMPACT" ? "Compact rows." : "Comfortable rows." };
  } catch (error) {
    logError("densityAction failed", error);
    return { ok: false, message: "Couldn't save. Please try again." };
  }
}

// D-220: the Share dialog's "Access settings" (owners only; the rest of the
// project's details stay as they are).
export async function privacyAction(projectId: number, privacy: string, departmentId: number | null): Promise<ActionResult> {
  const me = await actor();
  const project = id(projectId) ? await repo.findProject(id(projectId)!) : null;
  if (!me || !project) return NOT_FOUND;
  if (!projectsAllowed(me)) return PROJECTS_OFF;
  return run("privacy", me, (who) =>
    work.updateProjectDetails(
      project.id,
      {
        name: project.name,
        description: project.description ?? "",
        color: project.color,
        privacy,
        departmentId: privacy === "DEPARTMENT" ? (id(departmentId) ?? project.departmentId) : project.departmentId,
        defaultAccessRole: project.defaultAccessRole,
        defaultView: project.defaultView,
        startOn: project.startOn ?? "",
        dueOn: project.dueOn ?? "",
      },
      who,
    ),
  );
}

// v1.75.0 (D-399): the project's From and To from the header's date range
// picker (owners only; the same checks as the details form: real days, From ≤ To).
export async function projectDatesAction(projectId: number, startOn: string, dueOn: string): Promise<ActionResult> {
  const me = await actor();
  const project = id(projectId) ? await repo.findProject(id(projectId)!) : null;
  if (!me || !project) return NOT_FOUND;
  if (!projectsAllowed(me)) return PROJECTS_OFF;
  return run("projectDates", me, (who) =>
    work.updateProjectDetails(
      project.id,
      {
        name: project.name,
        description: project.description ?? "",
        color: project.color,
        privacy: project.privacy,
        departmentId: project.departmentId,
        defaultAccessRole: project.defaultAccessRole,
        defaultView: project.defaultView,
        startOn: typeof startOn === "string" ? startOn : "",
        dueOn: typeof dueOn === "string" ? dueOn : "",
      },
      who,
    ),
  );
}

// D-222: Project permissions (owners only, checked in the service).
export async function permissionsAction(projectId: number, permissions: unknown): Promise<ActionResult> {
  const project = id(projectId);
  return project ? runProject("permissions", await actorForProjects(), (me) => work.setPermissions(project, permissions, me)) : NOT_FOUND;
}
// v1.77.0 (D-404, owner's decision 3): Share → Manage privacy. The signed-in
// person shares their own Task Summary read-only (or stops sharing); nobody
// can change anyone else's sharing.
export async function summaryShareAction(input: unknown): Promise<ActionResult> {
  const me = await actor();
  if (!me || (me.modules && !hasModule({ roles: me.roles, modules: me.modules }, "TASK"))) return NOT_FOUND;
  if (!(await featureOn("pm_foundations", me))) return { ok: false, message: "Sharing isn't switched on yet." };
  try {
    const result = await changeShare(input, me);
    if (result.ok) revalidatePath("/users/work/my-tasks");
    return result;
  } catch (error) {
    logError("summaryShareAction failed", error);
    return { ok: false, message: "Couldn't change the sharing. Please try again." };
  }
}

// v1.77.0 (D-404): Customise › Fields: the columns of the person's Task Summary lists.
export async function summaryFieldsAction(input: unknown): Promise<ActionResult> {
  const me = await actor();
  if (!me || (me.modules && !hasModule({ roles: me.roles, modules: me.modules }, "TASK"))) return NOT_FOUND;
  if (!(await featureOn("pm_foundations", me))) return { ok: false, message: "This isn't switched on yet." };
  try {
    const result = await saveSummaryFields(input, me);
    if (result.ok) revalidatePath("/users/work/my-tasks");
    return result;
  } catch (error) {
    logError("summaryFieldsAction failed", error);
    return { ok: false, message: "Couldn't save the columns. Please try again." };
  }
}

// ---- v1.62.0 (D-368, PM phase A part 2) ---------------------------------------------------
// Behind the "pm_foundations" switch: reactions, the task pane's width, the
// celebration choice, and the sidebar's Starred and Departments lists.
const PM_OFF: ActionResult = { ok: false, message: "This isn't switched on yet." };
async function actorForPm(): Promise<TaskActor | null | "OFF"> {
  const me = await actor();
  if (!me) return null;
  return (await featureOn("pm_foundations", me)) ? me : "OFF";
}

export async function reactionAction(commentId: number, reaction: string): Promise<ActionResult & { value?: { on: boolean } }> {
  const comment = id(commentId);
  if (!comment) return NOT_FOUND;
  const me = await actorForPm();
  if (me === "OFF") return PM_OFF;
  return run("reaction", me, (who) => work.reactToComment(comment, reaction, who));
}

export async function paneWidthAction(width: number): Promise<ActionResult> {
  const me = await actorForPm();
  if (me === "OFF") return PM_OFF;
  if (!me) return NOT_FOUND;
  try {
    await setUserSetting(me.id, PANE_SETTING, String(clampPaneWidth(width)));
    return { ok: true, message: "Saved." };
  } catch (error) {
    logError("paneWidthAction failed", error);
    return { ok: false, message: "Couldn't save. Please try again." };
  }
}

export async function celebrationAction(value: string): Promise<ActionResult> {
  const me = await actorForPm();
  if (me === "OFF") return PM_OFF;
  if (!me) return NOT_FOUND;
  const choice = parseCelebration(value);
  if (!choice) return { ok: false, message: "Choose Off, Occasional or Always." };
  try {
    await setUserSetting(me.id, CELEBRATION_SETTING, choice);
    revalidatePath("/users", "layout");
    return { ok: true, message: `Celebrations: ${CELEBRATION_LABEL[choice]}.` };
  } catch (error) {
    logError("celebrationAction failed", error);
    return { ok: false, message: "Couldn't save. Please try again." };
  }
}

export async function sidebarMoveAction(list: string, projectId: number, direction: string): Promise<ActionResult> {
  const project = id(projectId);
  if (!project || !(SIDEBAR_LISTS as readonly string[]).includes(list) || (direction !== "up" && direction !== "down")) return NOT_FOUND;
  const me = await actorForPm();
  if (me === "OFF") return PM_OFF;
  if (!me || !projectsAllowed(me)) return NOT_FOUND;
  try {
    const result = await moveSidebarProject(me, list as SidebarList, project, direction);
    if (result.ok) revalidatePath("/users", "layout");
    return result;
  } catch (error) {
    logError("sidebarMoveAction failed", error);
    return { ok: false, message: "Couldn't do that. Please try again." };
  }
}

export async function sidebarSortAction(list: string, sort: string): Promise<ActionResult> {
  if (!(SIDEBAR_LISTS as readonly string[]).includes(list) || !(SIDEBAR_SORTS as readonly string[]).includes(sort)) return NOT_FOUND;
  const me = await actorForPm();
  if (me === "OFF") return PM_OFF;
  if (!me || !projectsAllowed(me)) return NOT_FOUND;
  try {
    await setSidebarSort(me, list as SidebarList, sort as SidebarSort);
    revalidatePath("/users", "layout");
    return { ok: true, message: `Sorted: ${SIDEBAR_SORT_LABEL[sort as SidebarSort]}.` };
  } catch (error) {
    logError("sidebarSortAction failed", error);
    return { ok: false, message: "Couldn't do that. Please try again." };
  }
}
