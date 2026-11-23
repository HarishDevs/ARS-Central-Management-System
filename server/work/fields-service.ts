import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { getDbPool, type Queryable } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import { insertOutbox } from "@/lib/db/repositories/outbox.repository";
import { appendTaskEvent, findTask } from "@/lib/db/repositories/tasks.repository";
import * as repo from "@/lib/db/repositories/work.repository";
import * as fields from "@/lib/db/repositories/fields.repository";
import type { FieldRecord } from "@/lib/db/repositories/fields.repository";
import { afterResponse } from "@/lib/http/after-response";
import { deliverOutbox } from "@/server/approvals/service";
import { taskMessages } from "@/server/modules/messages";
import type { TaskActor } from "@/server/modules/tasks";
import { featureOn } from "@/server/settings/features";
import { projectAbilities, type ProjectRole, type WorkViewer } from "@/server/work/access";
import {
  checkValue,
  cleanIdPrefix,
  cleanName,
  cleanOptions,
  DEFAULT_CONFIG,
  EMPTY_CELL,
  FIELD_LIMITS_KEY,
  FIELD_TYPE_LABEL,
  fieldConfigSchema,
  formulaAnalysis,
  formulaCell,
  fxFields,
  isFieldType,
  LEGACY_TYPES,
  legacyText,
  mayCustomise,
  mayEditDefinition,
  NOTIFY_TYPES,
  OPTION_TYPES,
  optionInputSchema,
  parseFieldLimits,
  READ_ONLY_TYPES,
  storedCell,
  type CellMap,
  type FieldCell,
  type FieldConfig,
  type FieldDef,
  type FieldLimits,
  type FieldType,
  type FieldView,
  type FormulaTask,
  type StoredValue,
  type TaskDates,
} from "@/server/work/custom-fields";
import { analyseFormula, formulaFields, formulaFromText, parseFormula } from "@/server/work/formula";
import { planningBasis } from "@/server/work/durations";
import { indiaDay } from "@/server/work/rules";
import { loadSetting } from "@/server/work/holiday-store";
import { rightsOn, workViewer } from "@/server/work/task-access";
import { fieldBlockedBy, withProjects } from "@/server/work/service";

// v1.64.0 (D-371, PM phase B part 1): custom fields. Every operation checks
// on the server who may do it (deny by default), runs in one transaction with
// its history entry and audit, and sends messages after the commit.
type Result<T = undefined> = { ok: true; value: T; message?: string } | { ok: false; message: string; fieldErrors?: Record<string, string> };
const fail = (message: string, fieldErrors?: Record<string, string>): { ok: false; message: string; fieldErrors?: Record<string, string> } => ({ ok: false, message, fieldErrors });
const NOT_FOUND = "Not found.";
const OFF = "Custom fields aren't switched on yet.";
const db = () => getDbPool();

export async function fieldLimits(): Promise<FieldLimits> {
  return parseFieldLimits(await loadSetting(FIELD_LIMITS_KEY).catch(() => null));
}
const planningOn = (actor: TaskActor) => featureOn("pm_planning", actor).catch(() => false);

// The project and what the person may do with its fields.
async function projectAccess(projectId: number, actor: TaskActor) {
  const viewer = await workViewer(actor);
  const found = await repo.projectFor(projectId, viewer);
  if (!found || found.project.isTemplate) return null;
  const can = projectAbilities(found.role);
  return { ...found, viewer, can, customise: can.edit && mayCustomise(found.role, found.project.permissions.customise, viewer.isAdmin) };
}
const customiseRefusal = (customise: "EDITOR" | "OWNER") => (customise === "OWNER" ? "Only the project's admins (owners) customise its fields." : "Only the project's owners and editors customise its fields.");
async function mayEditField(field: FieldRecord, actor: TaskActor, viewer: WorkViewer): Promise<boolean> {
  let home = false;
  if (!field.library && field.homeProjectId) {
    const found = await repo.projectFor(field.homeProjectId, viewer);
    home = Boolean(found && projectAbilities(found.role).edit && mayCustomise(found.role, found.project.permissions.customise, viewer.isAdmin));
  }
  return mayEditDefinition(field, { id: actor.id, isAdmin: viewer.isAdmin }, home);
}

// ---- input ------------------------------------------------------------------------------
export const fieldInputSchema = z.object({
  name: z.string().max(200),
  type: z.string(),
  description: z.string().max(500).nullable().optional(),
  library: z.boolean().default(false),
  notify: z.boolean().default(false),
  config: fieldConfigSchema.partial().default({}),
  options: z.array(optionInputSchema).max(1000).default([]),
  idPrefix: z.string().max(20).nullable().optional(),
});
export type FieldInput = z.input<typeof fieldInputSchema>;

interface Checked {
  name: string;
  type: FieldType;
  description: string | null;
  library: boolean;
  notify: boolean;
  config: FieldConfig;
  options: { id?: number | null; name: string; color: number; archived?: boolean }[];
  idPrefix: string | null;
}
// What's wrong with a formula for this project (null: nothing). A change to
// an existing formula field must also leave every formula that uses it
// within the limits (2 layers) and its types.
function formulaProblem(expr: string, projectFields: readonly FieldRecord[], existing: FieldRecord | null): string | null {
  const map = fxFields(projectFields);
  const analysis = analyseFormula(expr, map, existing?.id ?? null);
  if (!analysis.ok) {
    // A field of another project or another type reads as "isn't in this project".
    return analysis.code === "MISSING" ? "Use number, date, timer and formula fields of this project." : analysis.message;
  }
  if (!existing) return null;
  const before = fxFields(projectFields);
  const after = new Map(map);
  after.set(existing.id, { id: existing.id, name: existing.name, kind: "FORMULA", formula: expr });
  for (const other of projectFields) {
    if (other.type !== "FORMULA" || other.id === existing.id) continue;
    if (!analyseFormula(other.config.formula, before, other.id).ok) continue; // already broken: not this change's doing
    const checked = analyseFormula(other.config.formula, after, other.id);
    if (!checked.ok) return `“${other.name}” uses this field and then: ${checked.message.charAt(0).toLowerCase()}${checked.message.slice(1)}`;
  }
  return null;
}

// Check a field's settings against the project's other fields.
async function checkInput(raw: unknown, projectFields: readonly FieldRecord[], limits: FieldLimits, existing: FieldRecord | null): Promise<{ ok: true; value: Checked } | { ok: false; message: string; fieldErrors?: Record<string, string> }> {
  const parsed = fieldInputSchema.safeParse(raw);
  if (!parsed.success) return fail("Check the field's settings.");
  const input = parsed.data;
  const name = cleanName(input.name);
  if (!name) return fail("Give the field a title.", { name: "Give the field a title." });
  const type = existing ? existing.type : input.type;
  if (!isFieldType(type)) return fail("Choose a field type.");
  if (projectFields.some((field) => field.id !== existing?.id && field.name.toLowerCase() === name.toLowerCase())) return fail("The project has a field with that title.", { name: "Choose another title." });
  const config: FieldConfig = { ...DEFAULT_CONFIG, ...(existing?.config ?? {}), ...input.config };
  const library = type === "ID" ? true : input.library || Boolean(existing?.library); // BR-PROJ-071; a library field stays one
  if (library && (await fields.libraryNameTaken(name, existing?.id ?? null))) return fail("The field library has a field with that title. Choose it from the library, or use another title.", { name: "Already in the library." });
  let options: Checked["options"] = [];
  if (OPTION_TYPES.includes(type)) {
    const cleaned = cleanOptions(input.options.map((item) => ({ id: item.id ?? null, name: item.name, color: item.color, archived: item.archived })), limits.options);
    if (!cleaned.ok) return fail(cleaned.message, { options: cleaned.message });
    if (existing && cleaned.options.some((item) => item.id && !existing.options.some((option) => option.id === item.id))) return fail("Check the options.");
    options = cleaned.options;
  }
  let idPrefix: string | null = existing?.idPrefix ?? null;
  if (type === "ID" && !existing) {
    idPrefix = cleanIdPrefix(input.idPrefix);
    if (!idPrefix) return fail("Give a prefix: 1 to 10 capital letters or digits, starting with a letter (for example PO).", { idPrefix: "For example PO." });
  }
  if (type === "FORMULA") {
    // v1.88.0 (D-418): functions, the task's dates, types and the limits
    // (10 inputs, 2 layers, 500 characters, no loops), each with its own message.
    const problem = formulaProblem(config.formula, projectFields, existing);
    if (problem) return fail(`Formula: ${problem}`, { formula: problem });
  }
  if (type === "LOOKUP") {
    const reference = projectFields.find((field) => field.id === config.referenceFieldId && field.type === "REFERENCE");
    if (!projectFields.some((field) => field.type === "REFERENCE")) return fail("No reference fields are available to use; create one first.");
    if (!reference) return fail("Choose a reference field.", { referenceFieldId: "Choose a reference field." });
    const target = config.targetFieldId ? await fields.findField(config.targetFieldId) : null;
    if (!target || READ_ONLY_TYPES.includes(target.type) || target.type === "REFERENCE") return fail("Choose the field to show from the linked task.", { targetFieldId: "Choose a field." });
  }
  const notify = NOTIFY_TYPES.includes(type) ? input.notify : false; // BR-PROJ-073
  const description = cleanName(input.description ?? "", 500) || null;
  return { ok: true, value: { name, type, description, library, notify, config, options, idPrefix } };
}

// ---- create, attach, edit ---------------------------------------------------------------------
export async function createField(projectId: number, raw: unknown, actor: TaskActor): Promise<Result<{ id: number; numbered: number }>> {
  const access = await projectAccess(projectId, actor);
  if (!access) return fail(NOT_FOUND);
  if (!access.customise) return fail(customiseRefusal(access.project.permissions.customise));
  const planning = await planningOn(actor);
  const type = (raw as { type?: unknown } | null)?.type;
  if (!planning && !(LEGACY_TYPES as readonly unknown[]).includes(type)) return fail(OFF);
  const limits = await fieldLimits();
  const current = await fields.listFieldDefs(projectId);
  if (current.length >= limits.perProject) return fail(`A project has at most ${limits.perProject} fields (Admin → Task settings).`);
  const checked = await checkInput(raw, current, limits, null);
  if (!checked.ok) return checked;
  const input = checked.value;
  if (!planning && (input.library || input.notify)) return fail(OFF);
  const result = await withTransaction(async (connection) => {
    const id = await fields.insertField({ homeProjectId: input.library ? null : projectId, name: input.name, type: input.type, description: input.description, library: input.library, notify: input.notify, config: input.config, idPrefix: input.idPrefix, createdBy: actor.id }, connection);
    if (OPTION_TYPES.includes(input.type)) await fields.saveOptions(id, input.options, connection);
    await fields.linkField(projectId, id, actor.id, connection);
    const numbered = input.type === "ID" ? await numberProjectTasks(projectId, id, input.name, actor.id, connection) : 0;
    await repo.appendProjectEvent(projectId, actor.id, "FIELD_ADDED", `${input.name} (${FIELD_TYPE_LABEL[input.type]}${input.library ? ", library" : ""})`, connection);
    await recordAudit({ actorUserId: actor.id, action: "PROJECT_FIELD_CREATED", entityType: "PROJECT", entityId: projectId, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { fieldId: id, name: input.name, type: input.type, library: input.library } }, connection);
    return { id, numbered };
  });
  return { ok: true, value: result, message: `Field “${input.name}” added.${result.numbered ? ` ${result.numbered} task${result.numbered === 1 ? "" : "s"} numbered.` : ""}` };
}
// ID fields: every task of the project gets the next number, in list order, with a history entry.
async function numberProjectTasks(projectId: number, fieldId: number, name: string, by: number, connection: Queryable): Promise<number> {
  const order = await fields.projectTaskOrder(projectId, connection);
  const given = await fields.assignIds(fieldId, order, by, connection);
  for (const item of given) await appendTaskEvent(item.taskId, { actorId: null, type: "FIELD_SET", body: `${name} set to ${item.text}` }, connection);
  return given.length;
}

// "Choose from library": show an organisation field in this project.
export async function attachLibraryField(projectId: number, fieldId: number, actor: TaskActor): Promise<Result> {
  if (!(await planningOn(actor))) return fail(OFF);
  const access = await projectAccess(projectId, actor);
  if (!access) return fail(NOT_FOUND);
  if (!access.customise) return fail(customiseRefusal(access.project.permissions.customise));
  const field = await fields.findField(fieldId);
  if (!field || !field.library) return fail(NOT_FOUND);
  const current = await fields.listFieldDefs(projectId);
  if (current.some((item) => item.id === fieldId)) return fail("The project already has this field.");
  const limits = await fieldLimits();
  if (current.length >= limits.perProject) return fail(`A project has at most ${limits.perProject} fields (Admin → Task settings).`);
  if (current.some((item) => item.name.toLowerCase() === field.name.toLowerCase())) return fail("The project has a field with that title.");
  await withTransaction(async (connection) => {
    await fields.linkField(projectId, fieldId, actor.id, connection);
    if (field.type === "ID") await numberProjectTasks(projectId, fieldId, field.name, actor.id, connection);
    await repo.appendProjectEvent(projectId, actor.id, "FIELD_ADDED", `${field.name} (from the library)`, connection);
  });
  return { ok: true, value: undefined, message: `Field “${field.name}” added from the library.` };
}

// Change a field: title, description, notify, options (add, rename, recolour,
// reorder, archive), number format and decimals, formula, date with time.
// The type and an ID prefix never change.
export async function updateField(projectId: number, fieldId: number, raw: unknown, actor: TaskActor): Promise<Result> {
  if (!(await planningOn(actor))) return fail(OFF);
  const access = await projectAccess(projectId, actor);
  if (!access) return fail(NOT_FOUND);
  const current = await fields.listFieldDefs(projectId);
  const field = current.find((item) => item.id === fieldId);
  if (!field) return fail(NOT_FOUND);
  if (!(await mayEditField(field, actor, access.viewer))) return fail(field.library ? "Only the field's creator and the IT team change a library field (it is used in other projects too)." : customiseRefusal(access.project.permissions.customise));
  const limits = await fieldLimits();
  const checked = await checkInput({ ...(raw as object), type: field.type }, current, limits, field);
  if (!checked.ok) return checked;
  const input = checked.value;
  // Becoming a library field: only from a local field of this project.
  const toLibrary = input.library && !field.library;
  await withTransaction(async (connection) => {
    await fields.updateFieldRow(fieldId, { name: input.name, description: input.description, notify: input.notify, config: input.config, ...(toLibrary ? { library: true, homeProjectId: null } : {}) }, connection);
    if (OPTION_TYPES.includes(field.type)) await fields.saveOptions(fieldId, input.options, connection);
    await repo.appendProjectEvent(projectId, actor.id, "FIELD_CHANGED", field.name === input.name ? input.name : `${field.name} → ${input.name}`, connection);
    await recordAudit({ actorUserId: actor.id, action: "PROJECT_FIELD_CHANGED", entityType: "PROJECT", entityId: projectId, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { fieldId, from: field.name, to: input.name, toLibrary } }, connection);
  });
  return { ok: true, value: undefined, message: `Field “${input.name}” saved.` };
}

// Remove from the project: its values stay on the tasks and come back when
// the field is added again (BR-CF-003, AC-PROJC-09).
export async function removeFieldFromProject(projectId: number, fieldId: number, actor: TaskActor): Promise<Result> {
  const access = await projectAccess(projectId, actor);
  if (!access) return fail(NOT_FOUND);
  const field = (await fields.listFieldDefs(projectId)).find((item) => item.id === fieldId);
  if (!field) return fail(NOT_FOUND);
  if (!access.customise) return fail(customiseRefusal(access.project.permissions.customise));
  await withTransaction(async (connection) => {
    await fields.unlinkField(projectId, fieldId, connection);
    await repo.appendProjectEvent(projectId, actor.id, "FIELD_REMOVED", field.name, connection);
  });
  return { ok: true, value: undefined, message: `Field “${field.name}” removed from the project. Its values are kept.` };
}
// Add a removed field back.
export async function addBackField(projectId: number, fieldId: number, actor: TaskActor): Promise<Result> {
  const access = await projectAccess(projectId, actor);
  if (!access) return fail(NOT_FOUND);
  if (!access.customise) return fail(customiseRefusal(access.project.permissions.customise));
  const gone = await fields.listGoneFields(projectId);
  const field = gone.removed.find((item) => item.id === fieldId);
  if (!field) return fail(NOT_FOUND);
  const current = await fields.listFieldDefs(projectId);
  const limits = await fieldLimits();
  if (current.length >= limits.perProject) return fail(`A project has at most ${limits.perProject} fields (Admin → Task settings).`);
  if (current.some((item) => item.name.toLowerCase() === field.name.toLowerCase())) return fail("The project has a field with that title. Rename one first.");
  await withTransaction(async (connection) => {
    await fields.linkField(projectId, fieldId, actor.id, connection);
    await repo.appendProjectEvent(projectId, actor.id, "FIELD_ADDED", `${field.name} (added back)`, connection);
  });
  return { ok: true, value: undefined, message: `Field “${field.name}” is back, with its values.` };
}

// Delete a field (everywhere): restorable for 30 days, then removed for good
// with its values by the purge job (BR-CF-004).
export async function deleteField(projectId: number, fieldId: number, actor: TaskActor): Promise<Result> {
  if (!(await planningOn(actor))) return fail(OFF);
  const access = await projectAccess(projectId, actor);
  if (!access) return fail(NOT_FOUND);
  const field = (await fields.listFieldDefs(projectId)).find((item) => item.id === fieldId);
  if (!field) return fail(NOT_FOUND);
  if (!(await mayEditField(field, actor, access.viewer))) return fail(field.library ? "Only the field's creator and the IT team delete a library field. You can remove it from this project." : customiseRefusal(access.project.permissions.customise));
  const used = await db().query<RowDataPacket[]>("SELECT id FROM project_fields WHERE kind = 'LOOKUP' AND deleted_at IS NULL AND JSON_EXTRACT(config_json, '$.referenceFieldId') = ?", [fieldId]);
  if (used[0].length) return fail("A lookup field uses this reference field. Delete the lookup field first.");
  await withTransaction(async (connection) => {
    await fields.softDeleteField(fieldId, actor.id, connection);
    await repo.appendProjectEvent(projectId, actor.id, "FIELD_DELETED", field.name, connection);
    await recordAudit({ actorUserId: actor.id, action: "PROJECT_FIELD_DELETED", entityType: "PROJECT", entityId: projectId, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { fieldId, name: field.name, library: field.library } }, connection);
  });
  return { ok: true, value: undefined, message: `Field “${field.name}” deleted. You can restore it for 30 days.` };
}
export async function restoreField(projectId: number, fieldId: number, actor: TaskActor): Promise<Result> {
  if (!(await planningOn(actor))) return fail(OFF);
  const access = await projectAccess(projectId, actor);
  if (!access) return fail(NOT_FOUND);
  const field = (await fields.listGoneFields(projectId)).deleted.find((item) => item.id === fieldId);
  if (!field) return fail(NOT_FOUND);
  if (!(await mayEditField(field, actor, access.viewer))) return fail(field.library ? "Only the field's creator and the IT team restore a library field." : customiseRefusal(access.project.permissions.customise));
  if (field.library && (await fields.libraryNameTaken(field.name, field.id))) return fail("The field library now has another field with that title.");
  const current = await fields.listFieldDefs(projectId);
  if (current.some((item) => item.name.toLowerCase() === field.name.toLowerCase())) return fail("The project has a field with that title. Rename one first.");
  await withTransaction(async (connection) => {
    await fields.restoreFieldRow(fieldId, connection);
    await repo.appendProjectEvent(projectId, actor.id, "FIELD_RESTORED", field.name, connection);
    await recordAudit({ actorUserId: actor.id, action: "PROJECT_FIELD_RESTORED", entityType: "PROJECT", entityId: projectId, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { fieldId } }, connection);
  });
  return { ok: true, value: undefined, message: `Field “${field.name}” restored, with its values.` };
}
// Move a field one place in the project's order (Alt+↑/↓ or the buttons).
export async function moveField(projectId: number, fieldId: number, direction: "up" | "down", actor: TaskActor): Promise<Result> {
  const access = await projectAccess(projectId, actor);
  if (!access) return fail(NOT_FOUND);
  if (!access.customise) return fail(customiseRefusal(access.project.permissions.customise));
  const current = await fields.listFieldDefs(projectId);
  const index = current.findIndex((item) => item.id === fieldId);
  if (index < 0) return fail(NOT_FOUND);
  const other = current[index + (direction === "up" ? -1 : 1)];
  if (!other) return { ok: true, value: undefined };
  await withTransaction(async (connection) => {
    await fields.moveFieldLink(projectId, fieldId, other.position ?? 0, connection);
    await fields.moveFieldLink(projectId, other.id, current[index]!.position ?? 0, connection);
  });
  return { ok: true, value: undefined };
}
export async function showOnCards(projectId: number, fieldId: number, show: boolean, actor: TaskActor): Promise<Result> {
  const access = await projectAccess(projectId, actor);
  if (!access) return fail(NOT_FOUND);
  if (!access.customise) return fail(customiseRefusal(access.project.permissions.customise));
  if (!(await fields.listFieldDefs(projectId)).some((item) => item.id === fieldId)) return fail(NOT_FOUND);
  await fields.setShowOnCards(projectId, fieldId, show, db());
  return { ok: true, value: undefined };
}

// The library for the Add field dialog (anyone who may customise some project).
export async function libraryFor(query: string, actor: TaskActor): Promise<Result<(FieldRecord & { usage: number })[]>> {
  if (!(await planningOn(actor))) return fail(OFF);
  return { ok: true, value: await fields.listLibrary(query.slice(0, 60)) };
}

// ---- values --------------------------------------------------------------------------------
// The task must be in a project that shows the field; the person needs the
// task's planning right (D-222) and the project's field restriction.
export async function setFieldValue(taskId: number, fieldId: number, value: unknown, actor: TaskActor): Promise<Result<{ text: string }>> {
  const task = await findTask(taskId);
  if (!task || task.deletedAt) return fail(NOT_FOUND);
  const links = await repo.listTaskProjects(taskId);
  const projectIds = await fields.fieldProjects(fieldId);
  if (!links.some((link) => projectIds.includes(link.projectId))) return fail(NOT_FOUND);
  const field = await fields.findField(fieldId);
  if (!field) return fail(NOT_FOUND);
  const viewer = await workViewer(actor);
  const rights = await rightsOn(task, viewer);
  if (!rights.view) return fail(NOT_FOUND);
  if (!LEGACY_TYPES.includes(field.type) && !(await planningOn(actor))) return fail(OFF);
  if (!rights.planning) return fail(rights.adhoc ? "Only its creator can change an ad hoc task's details." : "You can't change this task.");
  const blocked = await fieldBlockedBy(taskId, `field:${fieldId}`, viewer);
  if (blocked) return fail(`In ${blocked}, only some people may change ${field.name} (Project permissions).`);
  const current = field.type === "MULTI_SELECT" ? (fields.storedOf(field, (await fields.valueRows([taskId])).get(taskId)?.get(fieldId))?.ids ?? []) : [];
  const checked = checkValue(field, value, current);
  if (!checked.ok) return fail(`${field.name}: ${checked.message}`);
  const stored = checked.stored;
  const names: { people?: Map<number, string>; tasks?: Map<number, string> } = {};
  if (stored && field.type === "PEOPLE") {
    const [rows] = await db().query<RowDataPacket[]>("SELECT id, name FROM users WHERE id IN (?) AND active = TRUE", [stored.ids]);
    if (rows.length !== (stored.ids ?? []).length) return fail(`${field.name}: choose active people.`);
    names.people = new Map(rows.map((row) => [Number(row.id), String(row.name)]));
    stored.ids = (stored.ids ?? []).filter((id) => names.people!.has(id));
  }
  if (stored && field.type === "REFERENCE") {
    names.tasks = new Map();
    for (const id of stored.ids ?? []) {
      const other = id === taskId ? null : await findTask(id);
      if (!other || other.deletedAt || !(await rightsOn(other, viewer)).view) return fail(`${field.name}: choose tasks you can see (not this task).`);
      names.tasks.set(id, `${other.taskNo} ${other.title}`);
    }
  }
  if (stored) {
    const limits = await fieldLimits();
    const used = await fields.fieldsWithValues(taskId);
    if (!used.includes(fieldId) && used.length >= limits.perTask) return fail(`A task has values in at most ${limits.perTask} fields (Admin → Task settings).`);
  }
  const text = stored ? legacyText(field, stored, names) : "";
  const outbox = await withTransaction(async (connection) => {
    await fields.writeValue(taskId, fieldId, stored, text, actor.id, connection);
    // Activity story (spec §8.9): "<actor> changed <field> to …".
    await appendTaskEvent(taskId, { actorId: actor.id, type: "FIELD_SET", body: stored ? `changed ${field.name} to ${text}` : `cleared ${field.name}`, payload: { fieldId } }, connection);
    if (!field.notify) return [];
    // Notify on change: the task's followers (not the person who changed it), with the Projects module (D-308).
    const followers = (await repo.listFollowers(taskId, connection)).map((person) => person.id).filter((id) => id !== actor.id);
    const to = await withProjects(followers, connection);
    const what = stored ? `${actor.name} changed ${field.name} to ${text}` : `${actor.name} cleared ${field.name}`;
    return insertOutbox(null, to.map((id) => taskMessages.updated({ id: task.id, taskNo: task.taskNo, title: task.title, dueAt: task.dueAt }, id, what)), connection);
  });
  if (outbox.length) await afterResponse("field messages", () => deliverOutbox(outbox));
  return { ok: true, value: { text }, message: "Saved." };
}

// A template's value (text, number, choice name or date) on a task it creates.
export async function writeTemplateValue(taskId: number, fieldId: number, value: string, by: number, connection: Queryable): Promise<void> {
  const field = await fields.findField(fieldId, connection);
  if (!field) return;
  const checked = checkValue(field, value);
  if (checked.ok && checked.stored) await fields.writeValue(taskId, fieldId, checked.stored, legacyText(field, checked.stored), by, connection);
}

// Timers: start or stop the person's own run; the field adds up every run.
export async function timer(taskId: number, fieldId: number, command: "start" | "stop", actor: TaskActor): Promise<Result<{ seconds: number }>> {
  if (!(await planningOn(actor))) return fail(OFF);
  const task = await findTask(taskId);
  if (!task || task.deletedAt) return fail(NOT_FOUND);
  const links = await repo.listTaskProjects(taskId);
  const projectIds = await fields.fieldProjects(fieldId);
  const field = await fields.findField(fieldId);
  if (!field || field.type !== "TIMER" || !links.some((link) => projectIds.includes(link.projectId))) return fail(NOT_FOUND);
  const viewer = await workViewer(actor);
  const rights = await rightsOn(task, viewer);
  if (!rights.view) return fail(NOT_FOUND);
  if (!rights.progress && !rights.planning) return fail("You can't time this task.");
  const result = await withTransaction(async (connection) => {
    if (command === "start") {
      const started = await fields.startTimerRun(taskId, fieldId, actor.id, connection);
      if (started) await appendTaskEvent(taskId, { actorId: actor.id, type: "FIELD_SET", body: `started ${field.name}` }, connection);
      return { ok: started, seconds: 0 };
    }
    const seconds = await fields.stopTimerRun(taskId, fieldId, actor.id, connection);
    if (seconds === null) return { ok: false, seconds: 0 };
    const [rows] = await connection.query<RowDataPacket[]>("SELECT number_value FROM task_field_values WHERE task_id = ? AND field_id = ? FOR UPDATE", [taskId, fieldId]);
    const total = Number(rows[0]?.number_value ?? 0) + seconds;
    const stored: StoredValue = { text: null, number: total, date: null, time: null, optionId: null, ids: null };
    await fields.writeValue(taskId, fieldId, stored, legacyText(field, stored), actor.id, connection);
    await appendTaskEvent(taskId, { actorId: actor.id, type: "FIELD_SET", body: `stopped ${field.name} (${legacyText(field, stored)} in all)`, payload: { fieldId } }, connection);
    return { ok: true, seconds: total };
  });
  if (!result.ok) return fail(command === "start" ? "Your timer is already running." : "Your timer isn't running.");
  return { ok: true, value: { seconds: result.seconds }, message: command === "start" ? "Timer started." : "Timer stopped." };
}

// ---- cells for a list --------------------------------------------------------------------------
// Every value of the given tasks in the given fields, as the viewer sees it:
// formulas worked out, lookups read from linked tasks the viewer may see,
// timers with their running time.
export async function cellsFor(taskIds: readonly number[], defs: readonly FieldRecord[], viewer: { id: number } & WorkViewer, now = new Date()): Promise<CellMap> {
  const out: CellMap = {};
  if (!taskIds.length || !defs.length) return out;
  const rows = await fields.valueRows(taskIds);
  const byId = new Map<number, FieldDef>(defs.map((field) => [field.id, field]));
  // Lookups read fields that may not be in this project.
  const lookupTargets = defs.filter((field) => field.type === "LOOKUP").map((field) => field.config.targetFieldId).filter((id): id is number => id !== null && !byId.has(id));
  for (const target of await fields.fieldsByIds([...new Set(lookupTargets)])) byId.set(target.id, target);
  // v1.88.0 (D-418): what the formulas read comes too: fields not asked for
  // (automations and reports ask for formulas only), the tasks' own dates,
  // first-level subtasks for ROLLUP (one query each, never per row) and the
  // Working calendar for WORKDAYS. Nothing is written: Today is worked out
  // here, on reading, and leaves no history or audit entry.
  const formulas = await formulaNeeds(defs, byId);
  const task = formulas.any ? await formulaTasks(taskIds, formulas, viewer, now) : null;
  const storedFor = (taskId: number) => new Map([...byId.values()].map((field) => [field.id, fields.storedOf(field, rows.get(taskId)?.get(field.id))]));
  // People and linked tasks named in the values.
  const peopleIds = new Set<number>();
  const refIds = new Set<number>();
  for (const map of rows.values())
    for (const [fieldId, row] of map) {
      const field = byId.get(fieldId);
      if (field?.type === "PEOPLE") for (const id of row.stored.ids ?? []) peopleIds.add(id);
      if (field?.type === "REFERENCE") for (const id of row.stored.ids ?? []) refIds.add(id);
    }
  const people = new Map<number, string>();
  if (peopleIds.size) for (const row of (await db().query<RowDataPacket[]>("SELECT id, name FROM users WHERE id IN (?)", [[...peopleIds]]))[0]) people.set(Number(row.id), String(row.name));
  const tasks = new Map<number, { taskNo: string; title: string }>();
  if (refIds.size) {
    const visible = repo.visibleTaskClause(viewer);
    const [taskRows] = await db().query<RowDataPacket[]>(`SELECT t.id, t.task_no, t.title FROM tasks t JOIN users a ON a.id = t.assignee_id WHERE t.id IN (?) AND ${visible.sql}`, [[...refIds], ...visible.params]);
    for (const row of taskRows) tasks.set(Number(row.id), { taskNo: String(row.task_no), title: String(row.title) });
  }
  // Values of linked tasks for lookups.
  const lookupRows = defs.some((field) => field.type === "LOOKUP") && tasks.size ? await fields.valueRows([...tasks.keys()]) : new Map();
  const timers = defs.some((field) => field.type === "TIMER") ? await fields.runningTimers(taskIds) : [];
  const context = { people, tasks };
  for (const taskId of taskIds) {
    const stored = storedFor(taskId);
    const own: Record<number, FieldCell> = {};
    for (const field of defs) {
      let cell: FieldCell;
      if (field.type === "FORMULA") cell = formulaCell(field, byId, stored, task?.get(taskId));
      else if (field.type === "LOOKUP") {
        const reference = field.config.referenceFieldId ? byId.get(field.config.referenceFieldId) : undefined;
        const target = field.config.targetFieldId ? byId.get(field.config.targetFieldId) : undefined;
        const linked = (reference ? stored.get(reference.id)?.ids ?? [] : []).filter((id) => tasks.has(id));
        const texts = target ? linked.map((id) => storedCell(target, fields.storedOf(target, lookupRows.get(id)?.get(target.id)), context).text).filter(Boolean) : [];
        cell = texts.length ? { text: texts.join(", "), sort: texts.join(", "), edit: "" } : EMPTY_CELL;
      } else if (field.type === "TIMER") {
        const runs = timers.filter((run) => run.taskId === taskId && run.fieldId === field.id);
        const base = stored.get(field.id)?.number ?? 0;
        const running = runs.reduce((sum, run) => sum + Math.max(0, Math.floor((now.getTime() - run.startedAt.getTime()) / 1000)), 0);
        const mine = runs.find((run) => run.userId === viewer.id);
        cell = storedCell(field, stored.get(field.id) ?? null, context, { seconds: base + running, runningSince: mine ? mine.startedAt.toISOString() : null, mine: Boolean(mine), others: runs.filter((run) => run.userId !== viewer.id).length });
      } else cell = storedCell(field, stored.get(field.id) ?? null, context);
      if (cell.text || cell.timer) own[field.id] = cell;
    }
    out[taskId] = own;
  }
  return out;
}

// Which formula inputs a list needs; adds the fields the formulas read (and
// the fields those read) to `byId`.
interface FormulaNeeds {
  any: boolean;
  dates: boolean;
  rollup: boolean;
  workdays: boolean;
}
async function formulaNeeds(defs: readonly FieldDef[], byId: Map<number, FieldDef>): Promise<FormulaNeeds> {
  const needs: FormulaNeeds = { any: false, dates: false, rollup: false, workdays: false };
  let pending = defs.filter((field) => field.type === "FORMULA");
  const seen = new Set<number>();
  for (let round = 0; pending.length && round < 5; round += 1) {
    const missing = new Set<number>();
    for (const field of pending) {
      if (seen.has(field.id)) continue;
      seen.add(field.id);
      const parsed = parseFormula(field.config.formula);
      if (parsed.ok) for (const id of formulaFields(parsed.node)) if (!byId.has(id)) missing.add(id);
    }
    const loaded = missing.size ? await fields.fieldsByIds([...missing]) : [];
    for (const field of loaded) byId.set(field.id, field);
    pending = loaded.filter((field) => field.type === "FORMULA");
  }
  for (const field of byId.values()) {
    if (field.type !== "FORMULA") continue;
    const analysis = formulaAnalysis(field, byId);
    if (!analysis.ok) continue;
    needs.any = true;
    // A rolled-up formula reads the subtasks' dates.
    needs.dates ||= analysis.builtins.length > 0 || analysis.rollup;
    needs.rollup ||= analysis.rollup;
    needs.workdays ||= analysis.workdays;
  }
  return needs;
}
// The tasks' own dates as India days (due, created and completed are stored in UTC).
type DatedTask = { parent: number | null; dates: TaskDates };
async function taskDates(taskIds: readonly number[]): Promise<Map<number, DatedTask>> {
  const out = new Map<number, DatedTask>();
  if (!taskIds.length) return out;
  const day = (column: string) => `DATE_FORMAT(DATE_ADD(t.${column}, INTERVAL 330 MINUTE), '%Y-%m-%d')`;
  const [rows] = await db().query<RowDataPacket[]>(
    `SELECT t.id, t.parent_task_id, DATE_FORMAT(t.starts_on, '%Y-%m-%d') AS start_day, ${day("due_at")} AS due_day, ${day("created_at")} AS created_day, ${day("completed_at")} AS completed_day FROM tasks t WHERE t.id IN (?)`,
    [[...taskIds]],
  );
  const text = (value: unknown) => (value === null || value === undefined ? null : String(value));
  for (const row of rows) out.set(Number(row.id), { parent: row.parent_task_id === null ? null : Number(row.parent_task_id), dates: { start: text(row.start_day), due: text(row.due_day), created: text(row.created_day), completed: text(row.completed_day) } });
  return out;
}
async function formulaTasks(taskIds: readonly number[], needs: FormulaNeeds, viewer: WorkViewer, now: Date): Promise<Map<number, FormulaTask>> {
  const out = new Map<number, FormulaTask>();
  const today = indiaDay(now);
  const own = needs.dates ? await taskDates(taskIds) : new Map<number, DatedTask>();
  const calendar = needs.workdays ? (await planningBasis()).calendar : undefined;
  // ROLLUP: the first-level subtasks the viewer can see, with their values and dates.
  const subtasksOf = new Map<number, number[]>();
  let subDates = new Map<number, DatedTask>();
  let subRows = new Map<number, Map<number, fields.ValueRow>>();
  if (needs.rollup) {
    const visible = repo.visibleTaskClause(viewer);
    const [rows] = await db().query<RowDataPacket[]>(`SELECT t.id, t.parent_task_id FROM tasks t JOIN users a ON a.id = t.assignee_id WHERE t.parent_task_id IN (?) AND t.deleted_at IS NULL AND ${visible.sql}`, [[...taskIds], ...visible.params]);
    for (const row of rows) subtasksOf.set(Number(row.parent_task_id), [...(subtasksOf.get(Number(row.parent_task_id)) ?? []), Number(row.id)]);
    const ids = rows.map((row) => Number(row.id));
    [subDates, subRows] = await Promise.all([taskDates(ids), fields.valueRows(ids)]);
  }
  for (const taskId of taskIds) {
    const task: FormulaTask = { dates: { ...(own.get(taskId)?.dates ?? {}), today }, calendar };
    if (needs.rollup) task.subtasks = (subtasksOf.get(taskId) ?? []).map((id) => ({ stored: subStored(id, subRows), dates: subDates.get(id)?.dates }));
    out.set(taskId, task);
  }
  return out;
}
// A subtask's typed values by field id.
function subStored(id: number, rows: Map<number, Map<number, fields.ValueRow>>): ReadonlyMap<number, StoredValue | null> {
  const out = new Map<number, StoredValue | null>();
  for (const [fieldId, row] of rows.get(id) ?? []) out.set(fieldId, row.typed ? row.stored : null);
  return out;
}

// v1.88.0 (D-418): the Add field dialog's live preview: the formula worked
// out on a task of the project (the first of 25 that gives a value), as the
// person sees it. Checked like a save; writes nothing.
export async function previewFormula(projectId: number, text: string, fieldId: number | null, actor: TaskActor): Promise<Result<{ taskNo: string; title: string; text: string; error: boolean } | null>> {
  const access = await projectAccess(projectId, actor);
  if (!access) return fail(NOT_FOUND);
  const defs = await fields.listFieldDefs(projectId);
  const existing = fieldId ? (defs.find((field) => field.id === fieldId) ?? null) : null;
  const sources = defs.filter((field) => ["NUMBER", "DATE", "TIMER", "FORMULA"].includes(field.type) && field.id !== existing?.id);
  const typed = formulaFromText(String(text ?? "").slice(0, 2000), sources);
  if (!typed.ok) return fail(typed.message);
  const problem = formulaProblem(typed.expr, defs, existing);
  if (problem) return fail(problem);
  const order = (await fields.projectTaskOrder(projectId, db())).slice(0, 25);
  if (!order.length) return { ok: true, value: null };
  const draft: FieldRecord = {
    ...(existing ?? { description: null, library: false, notify: false, homeProjectId: projectId, createdBy: actor.id, createdByName: actor.name, createdAt: new Date(), deletedAt: null, deletedBy: null, idPrefix: null }),
    id: existing?.id ?? -1,
    name: existing?.name ?? "Preview",
    type: "FORMULA",
    config: { ...DEFAULT_CONFIG, ...(existing?.config ?? {}), formula: typed.expr },
    options: [],
  };
  const list = [...defs.filter((field) => field.id !== draft.id), draft];
  const cells = await cellsFor(order, list, { ...access.viewer, id: actor.id });
  const pick = order.find((id) => cells[id]?.[draft.id]?.text) ?? order[0]!;
  const [rows] = await db().query<RowDataPacket[]>("SELECT task_no, title FROM tasks WHERE id = ?", [pick]);
  const cell = cells[pick]?.[draft.id];
  return { ok: true, value: { taskNo: String(rows[0]?.task_no ?? ""), title: String(rows[0]?.title ?? ""), text: cell?.text ?? "", error: Boolean(cell?.error) } };
}

// ---- what the browser gets ------------------------------------------------------------------
export async function fieldViews(defs: readonly FieldRecord[], actor: TaskActor, viewer: WorkViewer, customise: boolean): Promise<FieldView[]> {
  return Promise.all(
    defs.map(async (field) => ({
      id: field.id,
      name: field.name,
      kind: field.type,
      options: field.options.filter((option) => !option.archived).map((option) => option.name),
      description: field.description,
      library: field.library,
      notify: field.notify,
      config: field.config,
      choices: field.options,
      idPrefix: field.idPrefix,
      showOnCards: field.showOnCards ?? true,
      canEdit: field.library ? await mayEditField(field, actor, viewer) : customise,
    })),
  );
}
// The project page's fields and whether this person may customise them.
export async function projectFieldsFor(projectId: number, actor: TaskActor): Promise<{ defs: FieldRecord[]; views: FieldView[]; customise: boolean; customiseRole: "EDITOR" | "OWNER" }> {
  const access = await projectAccess(projectId, actor);
  const defs = await fields.listFieldDefs(projectId);
  // A task's people see its projects' fields (as before v1.64) even without a role in the project; they change none.
  if (!access) return { defs, views: (await fieldViews(defs, actor, await workViewer(actor), false)).map((view) => ({ ...view, canEdit: false })), customise: false, customiseRole: "EDITOR" };
  return { defs, views: await fieldViews(defs, actor, access.viewer, access.customise), customise: access.customise, customiseRole: access.project.permissions.customise };
}
// Fields removed from the project and deleted ones (Fields settings).
export async function goneFieldsFor(projectId: number, actor: TaskActor): Promise<{ removed: GoneFieldView[]; deleted: GoneFieldView[] }> {
  const access = await projectAccess(projectId, actor);
  if (!access) return { removed: [], deleted: [] };
  const gone = await fields.listGoneFields(projectId);
  const until = (date: Date | null) => (date ? new Date(date.getTime() + 30 * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10) : undefined);
  return {
    removed: gone.removed.map((field) => ({ id: field.id, name: field.name, kind: field.type, library: field.library, canRestore: access.customise })),
    deleted: await Promise.all(gone.deleted.map(async (field) => ({ id: field.id, name: field.name, kind: field.type, library: field.library, until: until(field.deletedAt), canRestore: await mayEditField(field, actor, access.viewer) }))),
  };
}
export interface GoneFieldView {
  id: number;
  name: string;
  kind: FieldType;
  library: boolean;
  until?: string;
  canRestore: boolean;
}
export type { ProjectRole };
