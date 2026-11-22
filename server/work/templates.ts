import "server-only";
import { randomBytes } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import { insertOutbox } from "@/lib/db/repositories/outbox.repository";
import { nextRequestNumber } from "@/lib/db/repositories/approvals.repository";
import { appendTaskEvent, insertTask, personFacts } from "@/lib/db/repositories/tasks.repository";
import { versionWithType } from "@/lib/db/repositories/module-types.repository";
import * as repo from "@/lib/db/repositories/work.repository";
import * as fieldsRepo from "@/lib/db/repositories/fields.repository";
import * as autoRepo from "@/lib/db/repositories/automations.repository";
import * as formsRepo from "@/lib/db/repositories/intake-forms.repository";
import * as reportingRepo from "@/lib/db/repositories/reporting.repository";
import { afterResponse } from "@/lib/http/after-response";
import { deliverOutbox } from "@/server/approvals/service";
import { taskMessages } from "@/server/modules/messages";
import { mayAssignTo } from "@/server/modules/task-rules";
import { parseTaskSettings } from "@/server/modules/settings";
import type { TaskActor } from "@/server/modules/tasks";
import { featureOn } from "@/server/settings/features";
import { indiaDate } from "@/server/workflows/calendar";
import { parseProjectPermissions, projectAbilities, type ProjectRole } from "@/server/work/access";
import { checkValue, legacyText, LEGACY_TYPES, OPTION_TYPES, parseFieldConfig } from "@/server/work/custom-fields";
import { fieldLimits } from "@/server/work/fields-service";
import { nearestWorkingDay } from "@/server/work/holidays";
import { holidayContext } from "@/server/work/holiday-store";
import { parseDefinition } from "@/server/work/automation-rules";
import { parseDraft, parseSettings } from "@/server/work/intake-rules";
import { chartConfigSchema } from "@/server/work/reporting";
import { isShiftMode } from "@/server/work/schedule";
import { daysBetween, shiftDays } from "@/server/work/more-rules";
import { allowedView } from "@/server/work/view-tabs";
import { isAdminRoles, workViewer } from "@/server/work/task-access";
import * as work from "@/server/work/service";
import {
  allTasks,
  applyChoice,
  countTasks,
  fromPortable,
  parseTemplateBody,
  remapRefs,
  templateSummary,
  toPortable,
  type DuplicateChoice,
  type IdMaps,
  type PortableValue,
  type TemplateField,
  type TemplateSummary,
  type TemplateTaskV2,
  type TemplateV2,
} from "@/server/work/template-rules";

// v1.70.0 (D-383, PM phase E part 1): complete templates (PM-B12), the
// template gallery, and Duplicate with choices. Behind the "pm_extras"
// switch (with it off the D-218 code in service-more.ts runs as before).
// Deny by default: saving and duplicating need owner/editor rights on the
// project; using a template needs sight of it (or an organisation template);
// renaming and deleting need its owner (or IT); sharing with the
// organisation is IT's.
type Result<T = undefined> = { ok: true; value: T; message?: string } | { ok: false; message: string; fieldErrors?: Record<string, string> };
const fail = (message: string, fieldErrors?: Record<string, string>): { ok: false; message: string; fieldErrors?: Record<string, string> } => ({ ok: false, message, fieldErrors });
const NOT_FOUND = "Not found.";
const OFF = "This isn't switched on yet (Super Admin → Features → Projects E).";
type Row = RowDataPacket & Record<string, unknown>;
const db = () => getDbPool();
const audit = (actor: TaskActor, action: string, entityId: number, metadata: Record<string, unknown>) => ({ actorUserId: actor.id, action, entityType: "PROJECT", entityId, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata });

export async function extrasOn(actor: { roles: readonly string[] }): Promise<boolean> {
  return featureOn("pm_extras", actor).catch(() => false);
}
interface Switches {
  planning: boolean;
  reporting: boolean;
  forms: boolean;
  automations: boolean;
}
async function switchesFor(actor: { roles: readonly string[] }): Promise<Switches> {
  const [planning, reporting, forms, automations] = await Promise.all(["pm_planning", "pm_reporting", "pm_forms", "pm_automations"].map((name) => featureOn(name as "pm_planning", actor).catch(() => false)));
  return { planning: planning!, reporting: reporting!, forms: forms!, automations: automations! };
}

// ---- capture: a live project as a template shape ------------------------------------------
export interface Captured {
  template: TemplateV2;
  start: string;
}
export async function captureProject(projectId: number, switches: Switches, connection: Queryable = db()): Promise<Captured> {
  const project = await repo.findProject(projectId, connection);
  if (!project) throw new Error("captureProject: no project");
  const sections = await repo.listSections(projectId, connection);
  const sectionIndex = new Map(sections.map((section, index) => [section.id, index]));
  const fields = await fieldsRepo.listFieldDefs(projectId, connection);
  const top = (await repo.listProjectTasks(projectId, connection)).filter((task) => task.status !== "CANCELLED" && task.parentTaskId === null);
  top.sort((a, b) => (sectionIndex.get(a.sectionId ?? -1) ?? 0) - (sectionIndex.get(b.sectionId ?? -1) ?? 0) || a.position - b.position);
  // Every task with its subtasks (5 levels), not cancelled.
  const tree = new Map<number, number[]>();
  const items = new Map<number, repo.WorkTaskItem>(top.map((task) => [task.id, task]));
  let level = top.map((task) => task.id);
  for (let depth = 0; depth < 5 && level.length; depth += 1) {
    const children = (await repo.listChildTasks(level, connection)).filter((task) => task.status !== "CANCELLED");
    for (const child of children) {
      items.set(child.id, child);
      tree.set(child.parentTaskId!, [...(tree.get(child.parentTaskId!) ?? []), child.id]);
    }
    level = children.map((child) => child.id);
  }
  const ids = [...items.keys()];
  const dueDays = top.map((task) => (task.dueAt ? indiaDate(task.dueAt) : null)).filter((day): day is string => day !== null).sort();
  const start = project.startOn ?? dueDays[0] ?? indiaDate(new Date());
  const keyOf = new Map<number, string>();
  ids.forEach((id, index) => keyOf.set(id, `t${index + 1}`));
  const [extra] = ids.length ? await connection.query<Row[]>("SELECT id, description, starts_on FROM tasks WHERE id IN (?)", [ids]) : [[] as Row[]];
  const details = new Map(extra.map((row) => [Number(row.id), { description: row.description === null ? null : String(row.description).slice(0, 4000), startsOn: row.starts_on ? (row.starts_on instanceof Date ? row.starts_on.toISOString().slice(0, 10) : String(row.starts_on).slice(0, 10)) : null }]));
  const [tagRows] = ids.length ? await connection.query<Row[]>("SELECT tt.task_id, wt.name FROM task_tags tt JOIN work_tags wt ON wt.id = tt.tag_id WHERE tt.task_id IN (?)", [ids]) : [[] as Row[]];
  const tags = new Map<number, string[]>();
  for (const row of tagRows) tags.set(Number(row.task_id), [...(tags.get(Number(row.task_id)) ?? []), String(row.name)].slice(0, 20));
  const values = await fieldsRepo.valueRows(ids, connection);
  // Assignees become placeholders ("p1"…), resolved when the template is used.
  const placeholders = new Map<number, { key: string; label: string; userId: number }>();
  for (const id of ids) {
    const task = items.get(id)!;
    if (!placeholders.has(task.assigneeId)) placeholders.set(task.assigneeId, { key: `p${placeholders.size + 1}`, label: task.assigneeName, userId: task.assigneeId });
  }
  const toTask = (id: number): TemplateTaskV2 => {
    const task = items.get(id)!;
    const own = values.get(id);
    const portable: Record<string, PortableValue> = {};
    for (const field of fields) {
      const value = toPortable(field, fieldsRepo.storedOf(field, own?.get(field.id)), start, (other) => keyOf.get(other) ?? null);
      if (value) portable[String(field.id)] = value;
    }
    const detail = details.get(id);
    const due = task.dueAt ? indiaDate(task.dueAt) : (detail?.startsOn ?? start);
    return {
      key: keyOf.get(id)!,
      title: task.title.slice(0, 200),
      description: detail?.description ?? null,
      priority: task.priority,
      section: sectionIndex.get(task.sectionId ?? -1) ?? 0,
      dueOffset: daysBetween(start, due),
      startOffset: detail?.startsOn ? daysBetween(start, detail.startsOn) : null,
      isMilestone: task.isMilestone,
      tags: tags.get(id) ?? [],
      assignee: placeholders.get(task.assigneeId)!.key,
      values: portable,
      subtasks: (tree.get(id) ?? []).slice(0, 100).map(toTask),
    };
  };
  const [links] = ids.length
    ? await connection.query<Row[]>("SELECT blocker_task_id, blocked_task_id, dep_type, lag_days FROM task_dependencies WHERE blocker_task_id IN (?) AND blocked_task_id IN (?)", [ids, ids])
    : [[] as Row[]];
  const [settingsRows] = await connection.query<Row[]>("SELECT shift_mode, shift_skip_off_days, status_reminder, permissions_json FROM projects WHERE id = ?", [projectId]);
  const settings = settingsRows[0];
  const tabs = await repo.listProjectTabs(projectId, connection);
  const widgets = switches.reporting ? await reportingRepo.listWidgets(projectId, connection) : [];
  const rules = switches.automations ? await autoRepo.listProjectRules(projectId, connection) : [];
  const forms = switches.forms ? (await formsRepo.listProjectForms(projectId, connection)).filter((form) => !form.deletedAt) : [];
  const templateFields: TemplateField[] = fields.map((field) => ({
    ref: field.id,
    name: field.name,
    type: field.type,
    description: field.description,
    notify: field.notify,
    config: { ...field.config },
    idPrefix: field.idPrefix,
    library: field.library,
    showOnCards: field.showOnCards ?? true,
    options: field.options.map((option) => ({ ref: option.id, name: option.name, color: option.color, archived: option.archived })),
  }));
  const template: TemplateV2 = {
    version: 2,
    project: {
      description: project.description,
      color: project.color,
      defaultView: project.defaultView,
      shiftMode: isShiftMode(settings?.shift_mode) ? settings.shift_mode : "OFF",
      shiftSkipOffDays: settings ? Boolean(settings.shift_skip_off_days) : true,
      statusReminder: Boolean(settings?.status_reminder),
      permissions: parseProjectPermissions(settings?.permissions_json ?? null),
    },
    sections: sections.length ? sections.map((section) => ({ ref: section.id, name: section.name })) : [{ ref: 0, name: "To do" }],
    fields: templateFields,
    placeholders: [...placeholders.values()],
    tasks: top.slice(0, 2000).map((task) => toTask(task.id)),
    dependencies: links.map((row) => ({ predecessor: keyOf.get(Number(row.blocker_task_id))!, successor: keyOf.get(Number(row.blocked_task_id))!, type: (["FS", "SS", "FF", "SF"].includes(String(row.dep_type)) ? row.dep_type : "FS") as "FS", lag: Number(row.lag_days ?? 0) })),
    tabs: tabs.tabsSet ? tabs.rows.map((tab) => ({ type: tab.type, name: tab.name, config: tab.config ?? {}, isDefault: tab.isDefault })) : [],
    widgets: widgets.map((widget) => ({ kind: widget.kind, title: widget.title, config: widget.config, body: widget.body, size: widget.size })),
    automations: rules.map((rule) => ({ name: rule.name, definition: rule.draft })),
    forms: forms.map((form) => ({ ref: form.id, name: form.name, description: form.description, draft: form.draft, settings: form.settings, coverPath: form.coverPath, coverType: form.coverType })),
  };
  return { template, start };
}

// ---- instantiate: a new project from a shape ----------------------------------------------
export interface MakeInput {
  name: string;
  startOn: string; // YYYY-MM-DD
  privacy: string;
  departmentId: number | null;
  assign: Record<string, number | null>; // placeholder key → person (missing/null: the creator)
}
interface MakeExtras {
  label: string; // "From the template X" / "Copied from X"
  event: "FROM_TEMPLATE" | "COPIED";
  members?: repo.ProjectMember[];
  statusFrom?: number;
}
export interface Made {
  id: number;
  tasks: number;
  notes: string[]; // what couldn't come along
}
export async function instantiate(template: TemplateV2, input: MakeInput, actor: TaskActor, extras: MakeExtras): Promise<Result<Made>> {
  const switches = await switchesFor(actor);
  const start = /^\d{4}-\d{2}-\d{2}$/.test(input.startOn) ? input.startOn : indiaDate(new Date());
  const general = await repo.generalTypeVersion();
  if (!general) return fail("The General task type is switched off. Ask IT to switch it on in Admin → Task types.");
  // Who the tasks go to: each placeholder's person, when active and allowed by the General type's rules; else the creator.
  const notes: string[] = [];
  const typeSettings = parseTaskSettings((await versionWithType(general.versionId))?.version.settings);
  const me = await personFacts(actor.id);
  if (!me) return fail(NOT_FOUND);
  const viewer = await workViewer(actor);
  const resolved = new Map<string, number>();
  for (const holder of template.placeholders) {
    const chosen = input.assign[holder.key] ?? null;
    if (!chosen || chosen === actor.id) {
      resolved.set(holder.key, actor.id);
      continue;
    }
    const person = await personFacts(chosen);
    if (!person?.active || !mayAssignTo(typeSettings, { creatorId: actor.id, creatorDepartmentId: me.departmentId, creatorTeamIds: viewer.teamIds, candidate: person }, isAdminRoles(actor.roles))) {
      notes.push(`${holder.label}'s tasks are yours: that person can't be given General tasks by you (or isn't active).`);
      resolved.set(holder.key, actor.id);
    } else resolved.set(holder.key, chosen);
  }
  const created = await work.createProject(
    { name: input.name, description: template.project.description ?? "", color: template.project.color, privacy: input.privacy || "PRIVATE", departmentId: input.departmentId, defaultAccessRole: "VIEWER", defaultView: template.project.defaultView, startOn: start, dueOn: "" },
    actor,
  );
  if (!created.ok) return created;
  const projectId = created.value.id;
  const { settings: holidays, calendar } = await holidayContext();
  const onWorkingDay = (day: string) => (holidays.mode === "OFF" ? day : nearestWorkingDay(day, calendar, holidays, "NEXT"));
  const limits = await fieldLimits();
  const given = new Map<number, { id: number; taskNo: string; title: string; dueAt: Date | null; count: number }>();
  let made = 0;
  await withTransaction(async (connection) => {
    // Sections: the template's replace the starter ones.
    const starter = await repo.listSections(projectId, connection);
    const sectionIds: number[] = [];
    const sectionMap = new Map<number, number>();
    for (const [index, section] of template.sections.entries()) {
      const id = starter[index] ? starter[index]!.id : await repo.insertSection(projectId, section.name, (index + 1) * 1024, actor.id, connection);
      if (starter[index]) await repo.updateSection(id, { name: section.name }, connection);
      sectionIds.push(id);
      sectionMap.set(section.ref, id);
    }
    for (const extra of starter.slice(template.sections.length)) await repo.updateSection(extra.id, { deleted: true }, connection);
    await connection.query("UPDATE projects SET shift_mode = ?, shift_skip_off_days = ?, status_reminder = ? WHERE id = ?", [template.project.shiftMode, template.project.shiftSkipOffDays, template.project.statusReminder, projectId]);

    // Fields: library ones by reference (shown again), the others made as this project's own.
    const fieldMap = new Map<number, number>();
    const optionMap = new Map<number, number>();
    const optionFields = new Set<number>();
    const madeLocal: { field: TemplateField; id: number }[] = [];
    let count = 0;
    for (const field of template.fields) {
      if (count >= limits.perProject) {
        notes.push(`Only ${limits.perProject} fields come along (Admin → Task settings).`);
        break;
      }
      if (!switches.planning && !LEGACY_TYPES.includes(field.type)) {
        notes.push(`The field ${field.name} needs "Projects B" switched on.`);
        continue;
      }
      if (OPTION_TYPES.includes(field.type)) optionFields.add(field.ref);
      if (field.library) {
        const existing = await fieldsRepo.findField(field.ref, connection);
        if (existing?.library) {
          await fieldsRepo.linkField(projectId, existing.id, actor.id, connection);
          if (field.showOnCards === false) await fieldsRepo.setShowOnCards(projectId, existing.id, false, connection);
          fieldMap.set(field.ref, existing.id);
          for (const option of existing.options) {
            const source = field.options.find((item) => item.ref === option.id || item.name.toLowerCase() === option.name.toLowerCase());
            if (source) optionMap.set(source.ref, option.id);
          }
          count += 1;
          continue;
        }
        if (field.type === "ID") {
          notes.push(`The library field ${field.name} no longer exists, so it didn't come along.`);
          continue;
        }
      }
      if (field.type === "ID") continue; // ID fields are always library fields (BR-PROJ-071)
      const config = parseFieldConfig(field.config);
      const id = await fieldsRepo.insertField({ homeProjectId: projectId, name: field.name, type: field.type, description: field.description, library: false, notify: field.notify, config, idPrefix: null, createdBy: actor.id }, connection);
      if (OPTION_TYPES.includes(field.type)) {
        await fieldsRepo.saveOptions(id, field.options.map((option) => ({ name: option.name, color: option.color, archived: option.archived })), connection);
        const [rows] = await connection.query<Row[]>("SELECT id FROM project_field_options WHERE field_id = ? ORDER BY position, id", [id]);
        rows.forEach((row, index) => {
          const source = field.options[index];
          if (source) optionMap.set(source.ref, Number(row.id));
        });
      }
      await fieldsRepo.linkField(projectId, id, actor.id, connection);
      if (field.showOnCards === false) await fieldsRepo.setShowOnCards(projectId, id, false, connection);
      fieldMap.set(field.ref, id);
      madeLocal.push({ field, id });
      count += 1;
    }
    const maps: IdMaps = { fields: fieldMap, options: optionMap, sections: sectionMap, forms: new Map(), optionFields };
    // Formula and lookup settings point at the new fields.
    for (const { field, id } of madeLocal) {
      if (field.type !== "FORMULA" && field.type !== "LOOKUP") continue;
      await fieldsRepo.updateFieldRow(id, { config: parseFieldConfig(remapRefs(field.config, maps)) }, connection);
    }
    const permissions = parseProjectPermissions(remapRefs(template.project.permissions, maps));
    await repo.setProjectPermissions(projectId, permissions, connection);

    // Tasks and subtasks.
    const idOfKey = new Map<string, number>();
    const valueQueue: { taskId: number; values: Record<string, PortableValue> }[] = [];
    const make = async (item: TemplateTaskV2, parent: { id: number; root: number; depth: number } | null) => {
      const taskNo = await nextRequestNumber("TSK", connection);
      const due = onWorkingDay(shiftDays(start, item.dueOffset));
      const dueAt = new Date(`${due}T23:59:00+05:30`);
      const assigneeId = (item.assignee && resolved.get(item.assignee)) || actor.id;
      const startsOn = item.startOffset === null || item.isMilestone ? null : shiftDays(start, item.startOffset);
      const id = await insertTask(
        { taskNo, typeVersionId: general.versionId, title: item.title, description: item.description, priority: item.priority, createdBy: actor.id, assigneeId, dueAt, startsOn: startsOn && startsOn <= due ? startsOn : null, formData: {}, relatedRequestId: null, submissionKey: null },
        connection,
      );
      made += 1;
      idOfKey.set(item.key, id);
      if (parent) await repo.setTaskTree(id, { parentTaskId: parent.id, rootTaskId: parent.root, depth: parent.depth + 1, position: made * 1024 }, connection);
      else await repo.placeTaskInProject(id, projectId, sectionIds[Math.min(item.section, sectionIds.length - 1)]!, made * 1024, actor.id, connection);
      if (item.isMilestone) await repo.setTaskWorkFields(id, { is_milestone: true }, connection);
      for (const tag of item.tags) await repo.setTaskTag(id, await repo.tagByName(tag, actor.id, "gray", connection), true, actor.id, connection);
      await repo.addFollower(id, actor.id, "CREATOR", actor.id, connection);
      if (assigneeId !== actor.id) {
        await repo.addFollower(id, assigneeId, "ASSIGNEE", actor.id, connection);
        const seen = given.get(assigneeId);
        given.set(assigneeId, seen ? { ...seen, count: seen.count + 1 } : { id, taskNo, title: item.title, dueAt, count: 1 });
      }
      await appendTaskEvent(id, { actorId: actor.id, type: "CREATED", to: "OPEN", body: extras.label }, connection);
      if (Object.keys(item.values).length) valueQueue.push({ taskId: id, values: item.values });
      for (const child of item.subtasks) await make(child, { id, root: parent?.root ?? id, depth: parent ? parent.depth + 1 : 0 });
    };
    for (const item of template.tasks) await make(item, null);

    // Field values (after every task exists, for references between them).
    const defs = new Map((await fieldsRepo.listFieldDefs(projectId, connection)).map((field) => [field.id, field]));
    const activePeople = new Set<number>();
    const wanted = [...new Set(valueQueue.flatMap((entry) => Object.values(entry.values).flatMap((value) => ("people" in value ? value.people : []))))];
    if (wanted.length) {
      const [rows] = await connection.query<Row[]>("SELECT id FROM users WHERE id IN (?) AND active = TRUE AND is_system = FALSE", [wanted]);
      for (const row of rows) activePeople.add(Number(row.id));
    }
    for (const entry of valueQueue) {
      for (const [ref, value] of Object.entries(entry.values)) {
        const fieldId = fieldMap.get(Number(ref));
        const field = fieldId ? defs.get(fieldId) : undefined;
        if (!field) continue;
        let raw = fromPortable(field, value, start, (key) => idOfKey.get(key) ?? null);
        if (raw === undefined) continue;
        if (field.type === "PEOPLE" && Array.isArray(raw)) raw = (raw as number[]).filter((person) => activePeople.has(person));
        if (field.type === "REFERENCE" && Array.isArray(raw)) raw = (raw as number[]).filter((other) => other !== entry.taskId);
        const checked = checkValue(field, raw);
        if (checked.ok && checked.stored) await fieldsRepo.writeValue(entry.taskId, field.id, checked.stored, legacyText(field, checked.stored), actor.id, connection);
      }
    }

    // Dependencies (type and lag).
    for (const link of template.dependencies) {
      const blocker = idOfKey.get(link.predecessor);
      const blocked = idOfKey.get(link.successor);
      if (blocker && blocked && blocker !== blocked)
        await connection.query("INSERT IGNORE INTO task_dependencies (blocker_task_id, blocked_task_id, dep_type, lag_days, created_by) VALUES (?, ?, ?, ?, ?)", [blocker, blocked, link.type, link.lag, actor.id]);
    }

    // Saved tabs.
    let position = 1024;
    let tabs = 0;
    for (const tab of template.tabs) {
      if (!allowedView("PROJECT", tab.type, switches.planning, switches.reporting, true)) continue;
      const inserted = await repo.insertProjectTab(projectId, { type: tab.type, name: tab.name, config: remapRefs(tab.config, maps) ?? {}, position, isDefault: tab.isDefault }, actor.id, connection);
      if (inserted !== "DUPLICATE") {
        tabs += 1;
        position += 1024;
      }
    }
    if (tabs) await repo.markProjectTabsSet(projectId, connection);

    // Dashboard widgets.
    if (template.widgets.length && switches.reporting) {
      for (const [index, widget] of template.widgets.entries()) {
        const parsed = widget.kind === "CHART" ? chartConfigSchema.safeParse(remapRefs(widget.config, maps)) : null;
        if (widget.kind === "CHART" && !parsed?.success) continue;
        await reportingRepo.insertWidget(projectId, { kind: widget.kind, title: widget.title, config: parsed?.success ? parsed.data : null, body: widget.body, size: widget.size }, (index + 1) * 1024, actor.id, connection);
      }
      await reportingRepo.markDashboardSet(projectId, connection);
    } else if (template.widgets.length) notes.push('The dashboard needs "Projects D, dashboards" switched on.');

    // Intake forms: unpublished drafts with their own new links.
    const formMap = new Map<number, number>();
    if (template.forms.length && switches.forms) {
      for (const form of template.forms) {
        const id = await formsRepo.insertForm(
          { projectId, token: randomBytes(16).toString("base64url"), name: form.name, description: form.description, draft: parseDraft(remapRefs(form.draft, maps)), settings: parseSettings(remapRefs(form.settings, maps)), createdBy: actor.id, coverPath: form.coverPath, coverType: form.coverType },
          connection,
        );
        if (form.ref) formMap.set(form.ref, id);
      }
    } else if (template.forms.length) notes.push('Forms need "Projects C" switched on.');

    // Automations: drafts owned by the creator; never published here.
    if (template.automations.length && switches.automations) {
      const ruleMaps: IdMaps = { ...maps, forms: formMap };
      for (const rule of template.automations) await autoRepo.insertRule({ projectId, name: rule.name, ownerId: actor.id, draft: parseDefinition(remapRefs(rule.definition, ruleMaps)), createdBy: actor.id }, connection);
    } else if (template.automations.length) notes.push('Automations need "Projects D, automations" switched on.');

    // Members (duplicate) and status updates (duplicate, off by default).
    for (const member of extras.members ?? []) if (!(member.type === "USER" && member.id === actor.id)) await repo.setProjectMember(projectId, member.type, member.id, member.role as ProjectRole, actor.id, connection);
    if (extras.statusFrom) await copyStatusUpdates(extras.statusFrom, projectId, connection);
    await repo.appendProjectEvent(projectId, actor.id, extras.event, extras.label.slice(0, 400), connection);
    if (notes.length) await repo.appendProjectEvent(projectId, actor.id, "COPY_NOTES", notes.join(" ").slice(0, 500), connection);
    await recordAudit(audit(actor, extras.event === "COPIED" ? "PROJECT_DUPLICATED" : "PROJECT_FROM_TEMPLATE", projectId, { tasks: made, fields: fieldMap.size, tabs, widgets: template.widgets.length, forms: formMap.size, automations: template.automations.length }), connection);
  });
  // One notice per person given tasks (not one per task).
  const messages = [...given.entries()].map(([person, first]) =>
    taskMessages.assigned({ id: first.id, taskNo: first.taskNo, title: first.count > 1 ? `${first.title} and ${first.count - 1} more in ${input.name}` : first.title, dueAt: first.dueAt }, person, actor.name),
  );
  if (messages.length) {
    const queued = await insertOutbox(null, messages, db());
    await afterResponse("template notices", () => deliverOutbox(queued));
  }
  return { ok: true, value: { id: projectId, tasks: made, notes }, message: `Project created with ${made} task${made === 1 ? "" : "s"}.${notes.length ? ` ${notes.join(" ")}` : ""}` };
}

async function copyStatusUpdates(from: number, to: number, connection: Queryable): Promise<void> {
  const [rows] = await connection.query<Row[]>("SELECT * FROM project_status_updates WHERE project_id = ? AND deleted_at IS NULL ORDER BY id LIMIT 200", [from]);
  for (const row of rows) {
    const columns = Object.keys(row).filter((name) => name !== "id" && name !== "project_id");
    const values = columns.map((name) => {
      const value = row[name];
      return value !== null && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value) ? JSON.stringify(value) : value;
    });
    await connection.query(`INSERT INTO project_status_updates (project_id, ${columns.join(", ")}) VALUES (?, ${columns.map(() => "?").join(", ")})`, [to, ...values]);
  }
  const [latest] = await connection.query<Row[]>("SELECT current_status FROM projects WHERE id = ?", [from]);
  if (latest[0]?.current_status) await connection.query("UPDATE projects SET current_status = ? WHERE id = ?", [latest[0].current_status, to]);
}

// ---- save as template ---------------------------------------------------------------------
export async function saveTemplate(projectId: number, name: string, actor: TaskActor): Promise<Result<{ id: number }>> {
  if (!(await extrasOn(actor))) return fail(OFF);
  const viewer = await workViewer(actor);
  const found = await repo.projectFor(projectId, viewer);
  if (!found || found.project.isTemplate) return fail(NOT_FOUND);
  if (!projectAbilities(found.role).edit) return fail("Only the project's owners and editors can save it as a template.");
  const title = name.replace(/\s+/g, " ").trim().slice(0, 150) || `${found.project.name} (template)`;
  const { template } = await captureProject(projectId, await switchesFor(actor));
  const id = await withTransaction(async (connection) => {
    const newId = await repo.insertProject(
      { name: title, description: found.project.description, color: found.project.color, departmentId: found.project.departmentId, privacy: found.project.privacy, defaultAccessRole: "VIEWER", defaultView: found.project.defaultView, ownerId: actor.id, startOn: null, dueOn: null },
      connection,
    );
    await repo.setTemplateBody(newId, template, connection);
    for (const member of found.members) await repo.setProjectMember(newId, member.type, member.id, "VIEWER", actor.id, connection);
    await repo.setProjectMember(newId, "USER", actor.id, "OWNER", actor.id, connection);
    await repo.appendProjectEvent(newId, actor.id, "TEMPLATE_SAVED", `From ${found.project.name}`, connection);
    await recordAudit(audit(actor, "PROJECT_TEMPLATE_SAVED", newId, { from: projectId, ...templateSummary(template) }), connection);
    return newId;
  });
  return { ok: true, value: { id }, message: `Saved as the template "${title}".` };
}

// ---- the gallery and one template ---------------------------------------------------------
export interface GalleryItem {
  id: number;
  name: string;
  description: string | null;
  ownerId: number;
  ownerName: string;
  shared: boolean;
  createdAt: Date;
  summary: TemplateSummary;
  sections: string[];
  placeholders: { key: string; label: string }[];
  mine: boolean;
  canManage: boolean; // rename, delete
}
async function templateRows(actor: TaskActor, onlyId: number | null): Promise<GalleryItem[]> {
  const viewer = await workViewer(actor);
  if (viewer.projects === false) return [];
  const visible = repo.visibleProjectClause(viewer);
  const [rows] = await db().query<Row[]>(
    `SELECT p.id, p.name, p.description, p.owner_id, o.name AS owner_name, p.template_shared, p.template_json, p.created_at FROM projects p JOIN users o ON o.id = p.owner_id
     WHERE p.is_template = TRUE AND p.deleted_at IS NULL AND (p.template_shared = TRUE OR ${visible.sql})${onlyId ? " AND p.id = ?" : ""} ORDER BY p.name LIMIT 300`,
    [...visible.params, ...(onlyId ? [onlyId] : [])],
  );
  const admin = isAdminRoles(actor.roles);
  return rows.flatMap((row) => {
    const body = parseTemplateBody(row.template_json);
    if (!body) return [];
    const ownerId = Number(row.owner_id);
    return [
      {
        id: Number(row.id),
        name: String(row.name),
        description: row.description === null ? null : String(row.description),
        ownerId,
        ownerName: String(row.owner_name),
        shared: Boolean(row.template_shared),
        createdAt: row.created_at as Date,
        summary: templateSummary(body),
        sections: body.sections.map((section) => section.name),
        placeholders: body.placeholders.map((holder) => ({ key: holder.key, label: holder.label })),
        mine: ownerId === actor.id,
        canManage: ownerId === actor.id || admin,
      },
    ];
  });
}
export async function gallery(actor: TaskActor): Promise<GalleryItem[] | null> {
  if (!(await extrasOn(actor))) return null;
  return templateRows(actor, null);
}
export async function templateFor(templateId: number, actor: TaskActor): Promise<{ item: GalleryItem; template: TemplateV2 } | null> {
  const [item] = await templateRows(actor, templateId);
  if (!item) return null;
  const template = parseTemplateBody(await repo.templateBody(templateId));
  return template ? { item, template } : null;
}

export async function useTemplate(templateId: number, input: MakeInput, actor: TaskActor): Promise<Result<Made>> {
  if (!(await extrasOn(actor))) return fail(OFF);
  const found = await templateFor(templateId, actor);
  if (!found) return fail(NOT_FOUND);
  const departmentId = input.departmentId ?? (await repo.findProject(templateId))?.departmentId ?? null;
  const result = await instantiate(found.template, { ...input, departmentId }, actor, { label: `From the template ${found.item.name}`, event: "FROM_TEMPLATE" });
  return result;
}

export async function renameTemplate(templateId: number, name: string, actor: TaskActor): Promise<Result> {
  if (!(await extrasOn(actor))) return fail(OFF);
  const [item] = await templateRows(actor, templateId);
  if (!item) return fail(NOT_FOUND);
  if (!item.canManage) return fail("Only the template's owner (or IT) can rename it.");
  const title = name.replace(/\s+/g, " ").trim().slice(0, 150);
  if (title.length < 2) return fail("Give it a name of at least 2 characters.", { name: "At least 2 characters." });
  await withTransaction(async (connection) => {
    await repo.updateProject(templateId, { name: title }, connection);
    await repo.appendProjectEvent(templateId, actor.id, "DETAILS", `Renamed ${item.name} → ${title}`, connection);
    await recordAudit(audit(actor, "PROJECT_TEMPLATE_RENAMED", templateId, { from: item.name, to: title }), connection);
  });
  return { ok: true, value: undefined, message: "Template renamed." };
}

// Deleted like a project (30 days in Deleted, then purged). Projects made from it stay.
export async function deleteTemplate(templateId: number, actor: TaskActor): Promise<Result> {
  if (!(await extrasOn(actor))) return fail(OFF);
  const [item] = await templateRows(actor, templateId);
  if (!item) return fail(NOT_FOUND);
  if (!item.canManage) return fail("Only the template's owner (or IT) can delete it.");
  await withTransaction(async (connection) => {
    await repo.updateProject(templateId, { deleted_at: new Date(), deleted_by: actor.id }, connection);
    await repo.appendProjectEvent(templateId, actor.id, "DELETED", item.name, connection);
    await recordAudit(audit(actor, "PROJECT_TEMPLATE_DELETED", templateId, { name: item.name }), connection);
  });
  return { ok: true, value: undefined, message: "Template deleted. Projects made from it stay." };
}

// IT marks a template as an organisation template (everyone with Projects sees it).
export async function shareTemplate(templateId: number, shared: boolean, actor: TaskActor): Promise<Result> {
  if (!(await extrasOn(actor))) return fail(OFF);
  if (!isAdminRoles(actor.roles)) return fail("Only the IT team can make a template an organisation template.");
  const [item] = await templateRows(actor, templateId);
  if (!item) return fail(NOT_FOUND);
  await withTransaction(async (connection) => {
    await connection.query<ResultSetHeader>("UPDATE projects SET template_shared = ? WHERE id = ? AND is_template = TRUE", [shared, templateId]);
    await repo.appendProjectEvent(templateId, actor.id, "DETAILS", shared ? "Made an organisation template" : "No longer an organisation template", connection);
    await recordAudit(audit(actor, shared ? "PROJECT_TEMPLATE_SHARED" : "PROJECT_TEMPLATE_UNSHARED", templateId, {}), connection);
  });
  return { ok: true, value: undefined, message: shared ? "Everyone with Projects can now use this template." : "It's no longer an organisation template." };
}

// ---- duplicate with choices ---------------------------------------------------------------
export async function duplicateProject(projectId: number, input: Omit<MakeInput, "assign" | "startOn">, choice: DuplicateChoice, actor: TaskActor): Promise<Result<Made>> {
  if (!(await extrasOn(actor))) return fail(OFF);
  const viewer = await workViewer(actor);
  const found = await repo.projectFor(projectId, viewer);
  if (!found || found.project.isTemplate) return fail(NOT_FOUND);
  if (!projectAbilities(found.role).edit) return fail("Only the project's owners and editors can duplicate it.");
  const captured = await captureProject(projectId, await switchesFor(actor));
  const shape = applyChoice(captured.template, choice);
  const assign = Object.fromEntries(shape.placeholders.map((holder) => [holder.key, holder.userId]));
  return instantiate(shape, { ...input, departmentId: input.departmentId ?? found.project.departmentId, startOn: shiftDays(captured.start, choice.shiftDays), assign }, actor, {
    label: `Copied from ${found.project.name}`,
    event: "COPIED",
    members: choice.parts.members ? found.members : [],
    statusFrom: choice.parts.statusUpdates ? projectId : undefined,
  });
}

// For the JSON export: the same shape as a template (owners and editors).
export async function projectJson(projectId: number, actor: TaskActor): Promise<Result<{ name: string; body: TemplateV2 & { exportedAt: string; start: string; name: string } }>> {
  if (!(await extrasOn(actor))) return fail(OFF);
  const viewer = await workViewer(actor);
  const found = await repo.projectFor(projectId, viewer);
  if (!found || found.project.isTemplate) return fail(NOT_FOUND);
  if (!projectAbilities(found.role).edit) return fail("Only the project's owners and editors can export its full structure.");
  const captured = await captureProject(projectId, await switchesFor(actor));
  return { ok: true, value: { name: found.project.name, body: { ...captured.template, name: found.project.name, start: captured.start, exportedAt: new Date().toISOString() } } };
}

export { countTasks, allTasks };
