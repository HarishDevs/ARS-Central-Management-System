import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import { insertOutbox } from "@/lib/db/repositories/outbox.repository";
import { appendTaskEvent, findTask, insertTask, personFacts } from "@/lib/db/repositories/tasks.repository";
import { nextRequestNumber } from "@/lib/db/repositories/approvals.repository";
import { versionWithType } from "@/lib/db/repositories/module-types.repository";
import * as repo from "@/lib/db/repositories/work.repository";
import * as fieldsRepo from "@/lib/db/repositories/fields.repository";
import * as forms from "@/lib/db/repositories/intake-forms.repository";
import type { FormRecord } from "@/lib/db/repositories/intake-forms.repository";
import { afterResponse } from "@/lib/http/after-response";
import { appBaseUrl } from "@/lib/http/app-url";
import { deliverOutbox } from "@/server/approvals/service";
import { prepareFiles, uploadRoot } from "@/server/attachments/service";
import { NO_LOOKUPS, parseFormSubmission, type FormField } from "@/server/forms/fields";
import { visibleFields } from "@/server/forms/dynamic";
import { formMessages, taskMessages } from "@/server/modules/messages";
import { parseTaskSettings, type TaskPriority } from "@/server/modules/settings";
import type { TaskActor } from "@/server/modules/tasks";
import { discardStaged, insertRecordFiles, RecordFileError, type StagedFile } from "@/server/modules/files";
import { readFiles } from "@/server/modules/upload";
import { featureOn } from "@/server/settings/features";
import { projectAbilities, type WorkViewer } from "@/server/work/access";
import { checkValue, legacyText, mayCustomise, type StoredValue } from "@/server/work/custom-fields";
import {
  checkIntakeForm,
  cleanMappings,
  CONFIRMATION_MAX,
  COVER_TYPES,
  DEFAULT_SETTINGS,
  DESCRIPTION_MAX,
  describeSubmission,
  draftSchema,
  dueAnswerProblem,
  dueDayFor,
  FORM_NAME_MAX,
  isIntakeType,
  MAX_FORMS_PER_PROJECT,
  mayFill,
  priorityFromLabel,
  settingsSchema,
  submissionTitle,
  SUBMISSIONS_PER_HOUR,
  type FormProblem,
  type IntakeDraft,
  type IntakeSettings,
  type ProjectFieldInfo,
} from "@/server/work/intake-rules";
import { indiaDay, positionBetween } from "@/server/work/rules";
import { rightsOn, workViewer } from "@/server/work/task-access";
import { workCalendar } from "@/server/work/schedule-service";
import { dueFromDay, withProjects } from "@/server/work/service";

// v1.66.0 (D-374, PM phase C): project intake forms for signed-in people.
// Every operation checks the "pm_forms" switch and who may do it on the
// server (deny by default). Builders: the project's owners and editors (only
// owners with "Only admins customise"). Submitters: whoever the form's
// settings allow. A submission becomes a task created by the system user.
type Result<T = undefined> = { ok: true; value: T; message?: string } | { ok: false; message: string; fieldErrors?: Record<string, string>; problems?: FormProblem[] };
const fail = (message: string, fieldErrors?: Record<string, string>): { ok: false; message: string; fieldErrors?: Record<string, string> } => ({ ok: false, message, fieldErrors });
const NOT_FOUND = "Not found.";
const OFF = "Project forms aren't switched on yet.";
const db = () => getDbPool();
export const formLink = (token: string) => `/users/forms/${token}`;
const newToken = () => randomBytes(16).toString("base64url");

export async function formsOn(actor: { roles: readonly string[] }): Promise<boolean> {
  return featureOn("pm_forms", actor).catch(() => false);
}

// The project as the person sees it, and whether they may build its forms.
async function projectAccess(projectId: number, actor: TaskActor) {
  const viewer = await workViewer(actor);
  const found = await repo.projectFor(projectId, viewer);
  if (!found || found.project.isTemplate || found.project.deletedAt) return null;
  const can = projectAbilities(found.role);
  return { ...found, viewer, build: can.edit && mayCustomise(found.role, found.project.permissions.customise, viewer.isAdmin) };
}
const buildRefusal = (customise: "EDITOR" | "OWNER") => (customise === "OWNER" ? "Only the project's admins (owners) build its forms." : "Only the project's owners and editors build its forms.");

type Access = NonNullable<Awaited<ReturnType<typeof projectAccess>>>;
async function formForBuilder(formId: number, actor: TaskActor): Promise<{ error: string } | { form: FormRecord; access: Access }> {
  if (!(await formsOn(actor))) return { error: OFF };
  const form = await forms.findForm(formId);
  if (!form || form.deletedAt) return { error: NOT_FOUND };
  const access = await projectAccess(form.projectId, actor);
  if (!access) return { error: NOT_FOUND };
  if (!access.build) return { error: buildRefusal(access.project.permissions.customise) };
  return { form, access };
}

async function projectFieldInfo(projectId: number): Promise<ProjectFieldInfo[]> {
  return (await fieldsRepo.listFieldDefs(projectId)).map((field) => ({ id: field.id, name: field.name, type: field.type, options: field.options.map((option) => ({ name: option.name, archived: option.archived })) }));
}

// ---- builder ---------------------------------------------------------------------------------
export async function createForm(projectId: number, actor: TaskActor): Promise<Result<{ id: number }>> {
  if (!(await formsOn(actor))) return fail(OFF);
  const access = await projectAccess(projectId, actor);
  if (!access) return fail(NOT_FOUND);
  if (!access.build) return fail(buildRefusal(access.project.permissions.customise));
  const sections = await repo.listSections(projectId);
  const owner = await personFacts(access.project.ownerId);
  // BR-FORM-004: the title starts as the project's name; the first section and
  // the project's owner are filled in (both can be changed; both are required).
  const settings: IntakeSettings = { ...DEFAULT_SETTINGS, sectionId: sections[0]?.id ?? null, assigneeId: owner?.active ? owner.id : null };
  const id = await withTransaction(async (connection) => {
    if ((await forms.countProjectForms(projectId, connection)) >= MAX_FORMS_PER_PROJECT) return null;
    const formId = await forms.insertForm({ projectId, token: newToken(), name: access.project.name.slice(0, FORM_NAME_MAX), description: null, draft: { fields: [], mappings: {} }, settings, createdBy: actor.id }, connection);
    await repo.appendProjectEvent(projectId, actor.id, "FORM_ADDED", access.project.name, connection);
    await recordAudit({ actorUserId: actor.id, action: "PROJECT_FORM_CREATED", entityType: "PROJECT_FORM", entityId: formId, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { projectId } }, connection);
    return formId;
  });
  if (id === null) return fail(`A project has at most ${MAX_FORMS_PER_PROJECT} forms.`);
  return { ok: true, value: { id }, message: "Form added." };
}

export interface BuilderData {
  form: FormRecord;
  sections: { id: number; name: string }[];
  projectFields: ProjectFieldInfo[];
  problems: FormProblem[];
  link: string;
}
export async function builderData(formId: number, actor: TaskActor): Promise<BuilderData | null> {
  const found = await formForBuilder(formId, actor);
  if ("error" in found) return null;
  const { form } = found;
  const [sections, projectFields] = await Promise.all([repo.listSections(form.projectId), projectFieldInfo(form.projectId)]);
  return { form, sections: sections.map((section) => ({ id: section.id, name: section.name })), projectFields, problems: await problemsFor(form, sections.map((section) => section.id), projectFields), link: formLink(form.token) };
}
async function problemsFor(form: Pick<FormRecord, "name" | "draft" | "settings">, sectionIds: number[], projectFields: ProjectFieldInfo[]): Promise<FormProblem[]> {
  const assignee = form.settings.assigneeId ? await personFacts(form.settings.assigneeId) : null;
  return checkIntakeForm(form, { sectionIds, projectFields, assigneeActive: Boolean(assignee?.active) });
}

// Strict reading of what the builder sends.
export function readBuilderInput(raw: unknown): { ok: true; value: { name: string; description: string | null; draft: IntakeDraft; settings: IntakeSettings; rowVersion: number } } | { ok: false; message: string } {
  if (!raw || typeof raw !== "object") return { ok: false, message: "Check the form." };
  const input = raw as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.replace(/\s+/g, " ").trim() : "";
  if (name.length > FORM_NAME_MAX) return { ok: false, message: `Use ${FORM_NAME_MAX} characters or fewer for the title.` };
  const description = typeof input.description === "string" ? input.description.replace(/\r\n?/g, "\n").trim() : "";
  if (description.length > DESCRIPTION_MAX) return { ok: false, message: `Use ${DESCRIPTION_MAX} characters or fewer for the description.` };
  const draft = draftSchema.safeParse(input.draft);
  if (!draft.success) return { ok: false, message: draft.error.issues[0]?.message ?? "Check the questions." };
  const fields = draft.data.fields as FormField[];
  if (fields.some((field) => !isIntakeType(field.type))) return { ok: false, message: "That question type can't be used on a project form." };
  const settings = settingsSchema.safeParse(input.settings);
  if (!settings.success) return { ok: false, message: "Check the settings." };
  if (settings.data.confirmation.length > CONFIRMATION_MAX) return { ok: false, message: "The confirmation message is too long." };
  const rowVersion = typeof input.rowVersion === "number" && Number.isInteger(input.rowVersion) ? input.rowVersion : -1;
  return { ok: true, value: { name, description: description || null, draft: { fields, mappings: cleanMappings(fields, draft.data.mappings) }, settings: { ...settings.data, confirmation: settings.data.confirmation.trim() }, rowVersion } };
}

export async function saveForm(formId: number, raw: unknown, actor: TaskActor): Promise<Result<{ rowVersion: number; problems: FormProblem[] }>> {
  const found = await formForBuilder(formId, actor);
  if ("error" in found) return fail(found.error);
  const input = readBuilderInput(raw);
  if (!input.ok) return fail(input.message);
  const { name, description, draft, settings, rowVersion } = input.value;
  const sections = await repo.listSections(found.form.projectId);
  // A section of another project, or a department list on another audience, is dropped.
  const clean: IntakeSettings = { ...settings, sectionId: sections.some((section) => section.id === settings.sectionId) ? settings.sectionId : (sections[0]?.id ?? null), departmentIds: settings.audience === "DEPARTMENTS" ? settings.departmentIds : [] };
  const saved = await withTransaction(async (connection) => {
    const ok = await forms.saveDraft(formId, rowVersion, { name: name || found.form.name, description, draft, settings: clean }, actor.id, connection);
    if (!ok) return null;
    await recordAudit({ actorUserId: actor.id, action: "PROJECT_FORM_SAVED", entityType: "PROJECT_FORM", entityId: formId, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { questions: draft.fields.length } }, connection);
    return rowVersion + 1;
  });
  if (saved === null) return fail("Someone else changed this form. Reload the page to see the latest, then try again.");
  const projectFields = await projectFieldInfo(found.form.projectId);
  return { ok: true, value: { rowVersion: saved, problems: await problemsFor({ name: name || found.form.name, draft, settings: clean }, sections.map((section) => section.id), projectFields) }, message: "Saved." };
}

// Versioned publish: the draft is checked as a whole and copied into a new,
// never-changed version; people fill in that version.
export async function publishForm(formId: number, actor: TaskActor): Promise<Result<{ versionNo: number; link: string }>> {
  const found = await formForBuilder(formId, actor);
  if ("error" in found) return fail(found.error);
  const { form } = found;
  const sections = await repo.listSections(form.projectId);
  const problems = await problemsFor(form, sections.map((section) => section.id), await projectFieldInfo(form.projectId));
  if (problems.length) return { ok: false, message: `Fix ${problems.length === 1 ? "this" : `these ${problems.length} things`} first: ${problems[0]!.message}`, problems };
  const versionNo = await withTransaction(async (connection) => {
    const locked = await forms.findForm(formId, connection, true);
    if (!locked || locked.deletedAt || locked.rowVersion !== form.rowVersion) return null;
    const no = await forms.nextVersionNo(formId, connection);
    const versionId = await forms.insertVersion(formId, no, { name: form.name, description: form.description, hasCover: Boolean(form.coverPath), draft: form.draft, settings: form.settings }, actor.id, connection);
    await forms.markPublished(formId, versionId, actor.id, connection);
    await repo.appendProjectEvent(form.projectId, actor.id, "FORM_PUBLISHED", `${form.name} (version ${no})`, connection);
    await recordAudit({ actorUserId: actor.id, action: "PROJECT_FORM_PUBLISHED", entityType: "PROJECT_FORM", entityId: formId, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { versionNo: no } }, connection);
    return no;
  });
  if (versionNo === null) return fail("Someone else changed this form. Reload the page, then publish again.");
  return { ok: true, value: { versionNo, link: formLink(form.token) }, message: `Published (version ${versionNo}).` };
}

export async function unpublishForm(formId: number, actor: TaskActor): Promise<Result> {
  const found = await formForBuilder(formId, actor);
  if ("error" in found) return fail(found.error);
  if (found.form.status !== "PUBLISHED") return fail("The form isn't published.");
  await withTransaction(async (connection) => {
    await forms.setStatus(formId, "UNPUBLISHED", actor.id, connection);
    await repo.appendProjectEvent(found.form.projectId, actor.id, "FORM_UNPUBLISHED", found.form.name, connection);
    await recordAudit({ actorUserId: actor.id, action: "PROJECT_FORM_UNPUBLISHED", entityType: "PROJECT_FORM", entityId: formId, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null }, connection);
  });
  return { ok: true, value: undefined, message: "Unpublished: the link now says the form isn't accepting submissions." };
}

export async function deleteForm(formId: number, actor: TaskActor): Promise<Result> {
  const found = await formForBuilder(formId, actor);
  if ("error" in found) return fail(found.error);
  await withTransaction(async (connection) => {
    await forms.softDelete(formId, actor.id, connection);
    await repo.appendProjectEvent(found.form.projectId, actor.id, "FORM_DELETED", found.form.name, connection);
    await recordAudit({ actorUserId: actor.id, action: "PROJECT_FORM_DELETED", entityType: "PROJECT_FORM", entityId: formId, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null }, connection);
  });
  return { ok: true, value: undefined, message: "Form deleted. Tasks made from it stay." };
}

export async function duplicateForm(formId: number, actor: TaskActor): Promise<Result<{ id: number }>> {
  const found = await formForBuilder(formId, actor);
  if ("error" in found) return fail(found.error);
  const { form } = found;
  const id = await withTransaction(async (connection) => {
    if ((await forms.countProjectForms(form.projectId, connection)) >= MAX_FORMS_PER_PROJECT) return null;
    // The copy is a draft with its own link; the cover file is shared (never deleted while used).
    const copy = await forms.insertForm({ projectId: form.projectId, token: newToken(), name: `${form.name} (copy)`.slice(0, FORM_NAME_MAX), description: form.description, draft: form.draft, settings: form.settings, createdBy: actor.id, coverPath: form.coverPath, coverType: form.coverType }, connection);
    await repo.appendProjectEvent(form.projectId, actor.id, "FORM_ADDED", `${form.name} (copy)`, connection);
    await recordAudit({ actorUserId: actor.id, action: "PROJECT_FORM_CREATED", entityType: "PROJECT_FORM", entityId: copy, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { copyOf: formId } }, connection);
    return copy;
  });
  if (id === null) return fail(`A project has at most ${MAX_FORMS_PER_PROJECT} forms.`);
  return { ok: true, value: { id }, message: "Form duplicated as a draft." };
}

// Cover image: one PNG, JPG or WEBP file, checked like every upload (size,
// type, content sniffing), stored under the upload folder.
export async function setFormCover(formId: number, file: File | null, actor: TaskActor): Promise<Result> {
  const found = await formForBuilder(formId, actor);
  if ("error" in found) return fail(found.error);
  if (!file) {
    await withTransaction((connection) => forms.setCover(formId, null, actor.id, connection));
    return { ok: true, value: undefined, message: "Cover image removed." };
  }
  const prepared = await prepareFiles([file]);
  if (!prepared.ok) return fail(prepared.message);
  const image = prepared.files[0]!;
  if (!COVER_TYPES.includes(image.contentType)) return fail("Choose a PNG, JPG or WEBP image.");
  const root = uploadRoot();
  const now = new Date();
  const folder = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  await mkdir(path.join(root, folder), { recursive: true });
  const stored = `${folder}/${randomBytes(16).toString("hex")}`;
  await writeFile(path.join(root, stored), image.bytes, { flag: "wx" });
  try {
    await withTransaction((connection) => forms.setCover(formId, { path: stored, type: image.contentType }, actor.id, connection));
  } catch (error) {
    await unlink(path.join(root, stored)).catch(() => undefined);
    throw error;
  }
  return { ok: true, value: undefined, message: "Cover image saved." };
}

export interface FormRow {
  id: number;
  name: string;
  status: forms.FormStatus;
  versionNo: number | null;
  draftChanged: boolean;
  link: string;
  submissions: number;
}
// Forms in Customize (the project's settings page).
export async function projectFormsFor(projectId: number, actor: TaskActor): Promise<{ rows: FormRow[]; build: boolean } | null> {
  if (!(await formsOn(actor))) return null;
  const access = await projectAccess(projectId, actor);
  if (!access) return null;
  const list = await forms.listProjectForms(projectId);
  const counts = await forms.countSubmissions(list.map((form) => form.id));
  // Members who can't build see only published forms (to submit them).
  const shown = access.build ? list : list.filter((form) => form.status === "PUBLISHED");
  return { build: access.build, rows: shown.map((form) => ({ id: form.id, name: form.name, status: form.status, versionNo: form.versionNo, draftChanged: form.draftChanged, link: formLink(form.token), submissions: counts.get(form.id) ?? 0 })) };
}

// ---- fill view -------------------------------------------------------------------------------
export type FillState = "OK" | "CLOSED" | "NOT_ALLOWED";
interface Opened {
  form: FormRecord;
  state: FillState;
  version: NonNullable<Awaited<ReturnType<typeof forms.findVersion>>> | null;
  viewer: WorkViewer;
  canBuild: boolean;
}
async function openForm(token: string, actor: TaskActor): Promise<Opened | null> {
  if (!/^[A-Za-z0-9_-]{16,43}$/.test(token)) return null;
  if (!(await formsOn(actor))) return null;
  const form = await forms.findFormByToken(token);
  if (!form) return null;
  const project = await repo.findProject(form.projectId);
  if (!project || project.deletedAt) return null;
  const viewer = await workViewer(actor);
  // Who may build: the project's role, whatever the Projects module (so a builder can try it).
  const found = await repo.projectFor(form.projectId, viewer);
  const canBuild = Boolean(found && projectAbilities(found.role).edit && mayCustomise(found.role, found.project.permissions.customise, viewer.isAdmin));
  const version = form.currentVersionId ? await forms.findVersion(form.currentVersionId) : null;
  if (form.status !== "PUBLISHED" || !version || project.archivedAt) return { form, state: "CLOSED", version: null, viewer, canBuild };
  const members = await repo.listProjectMembers(form.projectId);
  const isMember = members.some((member) => (member.type === "USER" && member.id === actor.id) || (member.type === "DEPARTMENT" && viewer.departmentId !== null && member.id === viewer.departmentId));
  const allowed = mayFill(version.snapshot.settings, { departmentId: viewer.departmentId, isMember, canBuild });
  return { form, state: allowed ? "OK" : "NOT_ALLOWED", version, viewer, canBuild };
}

export interface FillView {
  state: FillState;
  formId: number;
  projectName: string;
  name: string;
  description: string | null;
  coverUrl: string | null;
  fields: FormField[];
  confirmation: string;
  submitAnother: boolean;
  submitter: { name: string; email: string };
  canBuild: boolean;
}
export async function fillView(token: string, actor: TaskActor): Promise<FillView | null> {
  const opened = await openForm(token, actor);
  if (!opened) return null;
  const me = await submitterOf(actor.id);
  const snapshot = opened.version?.snapshot;
  return {
    state: opened.state,
    formId: opened.form.id,
    projectName: opened.form.projectName,
    name: snapshot?.name ?? opened.form.name,
    description: snapshot?.description ?? null,
    coverUrl: snapshot?.hasCover && opened.form.coverPath ? `/api/forms/${token}/cover` : null,
    fields: opened.state === "OK" && snapshot ? snapshot.draft.fields : [],
    confirmation: snapshot?.settings.confirmation ?? "",
    submitAnother: snapshot?.settings.submitAnother ?? false,
    submitter: me,
    canBuild: opened.canBuild,
  };
}
async function submitterOf(userId: number): Promise<{ name: string; email: string }> {
  const [rows] = await db().query<RowDataPacket[]>("SELECT name, email FROM users WHERE id = ?", [userId]);
  return { name: String(rows[0]?.name ?? ""), email: String(rows[0]?.email ?? "") };
}
// The cover of a form the person may open (the same rule as the fill view, or a builder).
export async function coverFor(token: string, actor: TaskActor): Promise<{ path: string; type: string } | null> {
  const opened = await openForm(token, actor);
  if (!opened || !opened.form.coverPath || !opened.form.coverType) return null;
  if (opened.state !== "OK" && !opened.canBuild) return null;
  return { path: opened.form.coverPath, type: opened.form.coverType };
}

// ---- submit: a submission becomes a task -----------------------------------------------------
export interface SubmitOutcome {
  taskId: number;
  taskNo: string;
  canSee: boolean;
  confirmation: string;
  submitAnother: boolean;
  repeated: boolean;
}
const REQUIRED = / is required\.$/;
class SubmitError extends Error {}

export async function submitForm(token: string, formData: FormData, actor: TaskActor): Promise<Result<SubmitOutcome>> {
  const opened = await openForm(token, actor);
  if (!opened) return fail(NOT_FOUND);
  if (opened.state === "CLOSED" || !opened.version) return fail("This form isn't accepting submissions.");
  if (opened.state === "NOT_ALLOWED") return fail("You can't submit this form. Ask the project's owner if you need to.");
  const { form, version, viewer } = opened;
  const snapshot = version.snapshot;
  const settings = snapshot.settings;
  const key = String(formData.get("submissionKey") ?? "");
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) return fail("Reload the page and try again.");
  // A double submit (the same key) is one submission: the first one's answer.
  const existing = await forms.findSubmissionByKey(form.id, actor.id, key);
  if (existing?.taskId) return { ok: true, value: await outcomeFor(existing.taskId, settings, viewer, true), message: "Submitted." };
  if ((await forms.countRecentSubmissions(form.id, actor.id, 3600)) >= SUBMISSIONS_PER_HOUR) return fail(`You've sent this form ${SUBMISSIONS_PER_HOUR} times in the last hour. Try again later.`);

  const fields = snapshot.draft.fields;
  const raw: Record<string, string> = {};
  for (const field of fields) {
    if (field.type === "SECTION" || field.type === "ATTACHMENT") continue;
    const value = formData.get(`answer:${field.key}`);
    if (typeof value === "string") raw[field.key] = value.slice(0, 10_000);
  }
  // Files: only for attachment questions; checked like every upload (D-072).
  const attachmentKeys = fields.filter((field) => field.type === "ATTACHMENT").map((field) => field.key);
  const read = await readFiles(formData, attachmentKeys);
  if (!read.ok) return fail(read.message);
  let staged: StagedFile[] = read.staged.filter((file) => file.fieldKey !== null);
  await discardStaged(read.staged.filter((file) => file.fieldKey === null));
  for (const key of attachmentKeys) {
    const count = staged.filter((file) => file.fieldKey === key).length;
    if (count) raw[key] = String(count);
  }
  try {
    const parsed = parseFormSubmission(fields, raw, new Set(), NO_LOOKUPS);
    const shown = visibleFields(fields, parsed.data as Record<string, string | number | null>);
    // Files of a question the branches hide are not kept.
    const hidden = staged.filter((file) => file.fieldKey && !shown.has(file.fieldKey));
    await discardStaged(hidden);
    staged = staged.filter((file) => !hidden.includes(file));
    if (!parsed.ok) {
      const errors = Object.fromEntries(Object.entries(parsed.errors).map(([field, message]) => [field, REQUIRED.test(message) || /^Attach at least one file/.test(message) ? "This field is required" : message]));
      throw Object.assign(new SubmitError("Check the answers marked."), { errors });
    }
    const data = parsed.data as Record<string, unknown>;
    const mappings = snapshot.draft.mappings;
    const keyFor = (field: "title" | "description" | "due" | "priority") => Object.entries(mappings).find(([, target]) => target.kind === "TASK" && target.field === field)?.[0] ?? null;
    const today = indiaDay(new Date());
    const dueKey = keyFor("due");
    const dueAnswer = dueKey && shown.has(dueKey) ? data[dueKey] : undefined;
    const dueProblem = dueKey ? dueAnswerProblem(dueAnswer, today) : null;
    if (dueKey && dueProblem) throw Object.assign(new SubmitError("Check the answers marked."), { errors: { [dueKey]: dueProblem } });
    // Mapped custom fields: each answer checked against its field now.
    const projectDefs = await fieldsRepo.listFieldDefs(form.projectId);
    const writes: { fieldId: number; stored: StoredValue; text: string }[] = [];
    const fieldErrors: Record<string, string> = {};
    for (const [qKey, target] of Object.entries(mappings)) {
      if (target.kind !== "FIELD" || !shown.has(qKey)) continue;
      const def = projectDefs.find((item) => item.id === target.fieldId);
      const answer = data[qKey];
      if (!def || answer === undefined || answer === null || answer === "") continue; // a field gone from the project: the answer stays in the description
      let value: unknown = answer;
      if (def.type === "TEXT") value = String(answer).slice(0, 500);
      if (def.type === "MULTI_SELECT" && Array.isArray(answer)) value = answer.map((name) => def.options.find((option) => option.name.toLowerCase() === String(name).toLowerCase())?.id ?? -1);
      if (def.type === "SELECT") value = def.options.find((option) => option.name.toLowerCase() === String(answer).toLowerCase())?.name ?? String(answer);
      const checked = checkValue(def, value);
      if (!checked.ok) fieldErrors[qKey] = checked.message;
      else if (checked.stored) writes.push({ fieldId: def.id, stored: checked.stored, text: legacyText(def, checked.stored) });
    }
    if (Object.keys(fieldErrors).length) throw Object.assign(new SubmitError("Check the answers marked."), { errors: fieldErrors });

    const systemId = await forms.systemUserId();
    if (!systemId) throw new SubmitError("Forms can't take submissions yet (the system user is missing). Ask IT.");
    const general = await repo.generalTypeVersion();
    if (!general) throw new SubmitError("The General task type is switched off. Ask IT to switch it on in Admin → Task types.");
    const typeSettings = parseTaskSettings((await versionWithType(general.versionId))?.version.settings);
    const project = await repo.findProject(form.projectId);
    if (!project) throw new SubmitError(NOT_FOUND);
    // C-2: one assignee: the form's default; if they have left, the project's owner.
    let assignee = settings.assigneeId ? await personFacts(settings.assigneeId) : null;
    if (!assignee?.active) assignee = await personFacts(project.ownerId);
    if (!assignee?.active) throw new SubmitError("This form has no active person to give the task to. Tell the project's owner.");
    const submitter = await submitterOf(actor.id);
    const titleKey = keyFor("title");
    const descriptionKey = keyFor("description");
    const priorityKey = keyFor("priority");
    const title = submissionTitle(snapshot.name, titleKey && shown.has(titleKey) ? data[titleKey] : undefined);
    const priority: TaskPriority = (priorityKey && typeof data[priorityKey] === "string" ? priorityFromLabel(data[priorityKey] as string) : null) ?? typeSettings.defaultPriority;
    const link = `${appBaseUrl()}${formLink(token)}`;
    const fileNames: Record<string, string[]> = {};
    for (const file of staged) if (file.fieldKey) (fileNames[file.fieldKey] ??= []).push(file.name);
    const description = describeSubmission({ formName: snapshot.name, link, submitter, fields, data, shown, copyAll: settings.copyToDescription, descriptionKey: descriptionKey && shown.has(descriptionKey) ? descriptionKey : null, fileNames });
    const assigneeId = assignee.id;

    const outcome = await withTransaction(async (connection) => {
      const dueDay = typeof dueAnswer === "string" && dueAnswer ? dueAnswer : dueDayFor(today, settings.dueOffsetDays ?? 3, await workCalendar(connection));
      const dueAt = dueFromDay(dueDay);
      if (!dueAt) throw new SubmitError("The due date couldn't be worked out.");
      const sections = await repo.listSections(form.projectId, connection);
      const sectionId = sections.find((section) => section.id === settings.sectionId)?.id ?? sections[0]?.id; // BR-FORM-008
      if (!sectionId) throw new SubmitError("The form's project has no section to put the task in. Tell the project's owner.");
      const taskNo = await nextRequestNumber("TSK", connection);
      const id = await insertTask({ taskNo, typeVersionId: general.versionId, title, description, priority, createdBy: systemId, assigneeId, dueAt, startsOn: null, formData: {}, relatedRequestId: null, submissionKey: null }, connection);
      await forms.setTaskSourceForm(id, form.id, connection);
      // BR-FORM-007: at the top of the section. The ID field number comes with the placing (BR-FORM-010).
      const rows = await repo.sectionPositions(form.projectId, sectionId, connection);
      await repo.placeTaskInProject(id, form.projectId, sectionId, positionBetween(null, rows[0]?.position ?? null), systemId, connection);
      for (const write of writes) await fieldsRepo.writeValue(id, write.fieldId, write.stored, write.text, systemId, connection);
      if (staged.length) await insertRecordFiles("TASK", id, staged, actor.id, "GENERAL", connection);
      await appendTaskEvent(id, { actorId: systemId, type: "CREATED", to: "OPEN", payload: { assigneeId, dueAt: dueAt.toISOString(), priority, projectId: form.projectId, formId: form.id } }, connection);
      await appendTaskEvent(id, { actorId: systemId, type: "FORM_SUBMITTED", body: `Submitted through the form ${snapshot.name} on behalf of ${submitter.name}`, payload: { formId: form.id, versionNo: version.versionNo, submitterId: actor.id } }, connection);
      await repo.addFollower(id, assigneeId, "ASSIGNEE", systemId, connection);
      if (settings.addFollowers) await repo.addFollower(id, actor.id, "FORM", systemId, connection);
      const submissionId = await forms.insertSubmission({ formId: form.id, versionId: version.id, submitterId: actor.id, key, taskId: id, answers: Object.fromEntries(Object.entries(data).filter(([field]) => shown.has(field))) }, connection);
      await recordAudit({ actorUserId: actor.id, action: "PROJECT_FORM_SUBMITTED", entityType: "PROJECT_FORM", entityId: form.id, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { taskNo, taskId: id, submissionId, versionNo: version.versionNo, files: staged.length } }, connection);
      const info = { id, taskNo, title, dueAt };
      const task = await findTask(id, connection);
      const canSee = task ? (await rightsOn(task, viewer, connection)).view : false;
      const messages = [];
      if (settings.notifyAssignee && assigneeId !== actor.id) messages.push(taskMessages.assigned(info, assigneeId, `ARS-CMS Automation (form “${snapshot.name}”)`));
      if (settings.notifyOwner && project.ownerId !== actor.id && project.ownerId !== assigneeId) {
        const [owner] = await withProjects([project.ownerId], connection);
        if (owner) messages.push(formMessages.submitted(info, owner, snapshot.name, submitter.name));
      }
      messages.push(formMessages.received(info, actor.id, snapshot.name, canSee, formLink(token)));
      return { id, taskNo, canSee, outbox: await insertOutbox(null, messages, connection) };
    });
    if (outcome.outbox.length) await afterResponse("form messages", () => deliverOutbox(outcome.outbox));
    return { ok: true, value: { taskId: outcome.id, taskNo: outcome.taskNo, canSee: outcome.canSee, confirmation: settings.confirmation, submitAnother: settings.submitAnother, repeated: false }, message: "Submitted." };
  } catch (error) {
    await discardStaged(staged);
    if (error instanceof SubmitError) return fail(error.message, (error as SubmitError & { errors?: Record<string, string> }).errors);
    if (error instanceof RecordFileError) return fail(error.message);
    // The same key at the same moment from two tabs: the other one won.
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
      const again = await forms.findSubmissionByKey(form.id, actor.id, key);
      if (again?.taskId) return { ok: true, value: await outcomeFor(again.taskId, settings, viewer, true), message: "Submitted." };
    }
    throw error;
  }
}
async function outcomeFor(taskId: number, settings: IntakeSettings, viewer: WorkViewer, repeated: boolean): Promise<SubmitOutcome> {
  const task = await findTask(taskId);
  const canSee = task && !task.deletedAt ? (await rightsOn(task, viewer)).view : false;
  return { taskId, taskNo: task?.taskNo ?? "", canSee, confirmation: settings.confirmation, submitAnother: settings.submitAnother, repeated };
}

// ---- Home "Forms" widget ----------------------------------------------------------------------
export interface HomeForms {
  forms: { name: string; projectName: string; link: string }[];
  mine: forms.MySubmission[];
}
export async function homeForms(actor: TaskActor, limit = 8): Promise<HomeForms | null> {
  if (!(await formsOn(actor))) return null;
  const viewer = await workViewer(actor);
  const out: HomeForms["forms"] = [];
  for (const form of await forms.listPublishedForms()) {
    if (out.length >= limit) break;
    const version = form.currentVersionId ? await forms.findVersion(form.currentVersionId) : null;
    if (!version) continue;
    const settings = version.snapshot.settings;
    let isMember = false;
    let canBuild = false;
    if (settings.audience !== "EVERYONE") {
      const found = await repo.projectFor(form.projectId, viewer);
      canBuild = Boolean(found && projectAbilities(found.role).edit && mayCustomise(found.role, found.project.permissions.customise, viewer.isAdmin));
      const members = found?.members ?? (await repo.listProjectMembers(form.projectId));
      isMember = members.some((member) => (member.type === "USER" && member.id === actor.id) || (member.type === "DEPARTMENT" && viewer.departmentId !== null && member.id === viewer.departmentId));
    }
    if (mayFill(settings, { departmentId: viewer.departmentId, isMember, canBuild })) out.push({ name: version.snapshot.name, projectName: form.projectName, link: formLink(form.token) });
  }
  return { forms: out, mine: await forms.listMySubmissions(actor.id, 5) };
}
