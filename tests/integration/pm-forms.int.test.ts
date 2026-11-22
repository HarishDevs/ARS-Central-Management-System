import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import * as work from "@/server/work/service";
import * as fieldsService from "@/server/work/fields-service";
import * as intake from "@/server/work/intake-forms";
import { findTask } from "@/lib/db/repositories/tasks.repository";
import { findForm, systemUserId } from "@/lib/db/repositories/intake-forms.repository";
import { findUserByLoginId, findUserForSignIn } from "@/lib/db/repositories/users.repository";
import { getUserForAdmin, listUsersForAdmin } from "@/lib/db/repositories/admin-users.repository";
import { checkSignInAllowed } from "@/server/auth/sign-in-rules";
import { listSections } from "@/lib/db/repositories/work.repository";
import { listFieldDefs, valueRows } from "@/lib/db/repositories/fields.repository";
import { rightsOn, workViewer } from "@/server/work/task-access";
import { indiaDay } from "@/server/work/rules";
import type { ModuleCode } from "@/server/modules/modules";
import type { FormField } from "@/server/forms/fields";
import { DEFAULT_SETTINGS, setBranch, type IntakeSettings } from "@/server/work/intake-rules";
import { createDepartment, createUser, setDepartment } from "./helpers";

// v1.66.0 (D-374, PM phase C) through the services: building (who may),
// versioned publishing, submissions becoming tasks by the system user (top
// of the section, mapped fields, ID, description, follower, messages), who
// may submit, the hourly limit, a double submit, files, and the system user
// that can never sign in.
const tag = Date.now().toString(36);
const ALL: ModuleCode[] = ["APPROVAL", "TASK", "PROJECT"];
const who = (id: number, name = `F${id}`) => ({ id, name, roles: ["USER"] as string[], modules: ALL, sessionId: "pm-forms", ipAddress: null });
const db = () => getDbPool();
const setting = (key: string, value: string) =>
  db().query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES (?, 'FEATURES', 'STRING', FALSE, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, value]);
let owner: number;
let editor: number;
let viewerOnly: number;
let outsider: number;
let deptPerson: number;
let department: number;
let projectId: number;
let stageField: number;
let costField: number;
let idField: number;
let formId: number;
let token: string;

const q = (key: string, type: FormField["type"], extra: Partial<FormField> = {}): FormField => ({ key, label: extra.label ?? key, type, required: false, ...extra });
const titles = async (userId: number, prefix: string) => {
  const [rows] = await db().query<RowDataPacket[]>(
    "SELECT JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.title')) AS title FROM notification_outbox WHERE JSON_EXTRACT(payload_json, '$.userId') = ? AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.title')) LIKE ? ORDER BY id",
    [userId, `${prefix}%`],
  );
  return rows.map((row) => String(row.title));
};
const save = async (fields: FormField[], mappings: Record<string, unknown>, settings: Partial<IntakeSettings>, as = owner, id = formId) => {
  const form = (await findForm(id))!;
  return intake.saveForm(id, { name: form.name, description: "Tell us what you need.", draft: { fields, mappings }, settings: { ...form.settings, ...settings }, rowVersion: form.rowVersion }, who(as));
};
const submission = (answers: Record<string, string>, key = `k${Math.random().toString(36).slice(2, 12)}`, files: Record<string, File[]> = {}) => {
  const data = new FormData();
  data.set("submissionKey", key);
  for (const [field, value] of Object.entries(answers)) data.set(`answer:${field}`, value);
  for (const [field, list] of Object.entries(files)) for (const file of list) data.append(`file:${field}`, file);
  return data;
};

beforeAll(async () => {
  await setting("features.pm_forms", "ON");
  await setting("features.pm_planning", "ON");
  owner = await createUser({ name: `Form owner ${tag}` });
  editor = await createUser({ name: `Form editor ${tag}` });
  viewerOnly = await createUser({ name: `Form viewer ${tag}` });
  outsider = await createUser({ name: `Form outsider ${tag}` });
  deptPerson = await createUser({ name: `Form dept ${tag}` });
  department = await createDepartment(null);
  await setDepartment(deptPerson, department);
  const created = await work.createProject({ name: `Intake ${tag}`, description: "", color: "blue", privacy: "PRIVATE", departmentId: null, defaultAccessRole: "EDITOR", defaultView: "LIST", startOn: "", dueOn: "" }, who(owner));
  if (!created.ok) throw new Error(created.message);
  projectId = created.value.id;
  expect((await work.setMember(projectId, { type: "USER", id: editor }, "EDITOR", who(owner))).ok).toBe(true);
  expect((await work.setMember(projectId, { type: "USER", id: viewerOnly }, "VIEWER", who(owner))).ok).toBe(true);
  const field = async (input: Record<string, unknown>) => {
    const result = await fieldsService.createField(projectId, input, who(owner));
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  };
  stageField = await field({ name: "Stage", type: "SELECT", options: [{ name: "Hardware" }, { name: "Software" }] });
  costField = await field({ name: "Cost", type: "NUMBER" });
  idField = await field({ name: `Req ${tag}`, type: "ID", idPrefix: "RQ" });
  // An older task already in the first section (the form's task goes above it).
  const older = await work.quickAddTask({ title: `Older ${tag}`, projectId, sectionId: null, parentId: null, assigneeId: null, dueDay: "", mySectionId: null }, who(owner));
  expect(older.ok).toBe(true);
});
afterAll(async () => {
  await db().query("DELETE FROM system_settings WHERE setting_key IN ('features.pm_forms', 'features.pm_planning')");
});

describe("the system user (C-10)", () => {
  it("exists, is inactive, and can't sign in by any route or be managed", async () => {
    const id = await systemUserId();
    expect(id).toBeGreaterThan(0);
    const record = await findUserByLoginId("ars-cms-automation");
    expect(record).toMatchObject({ active: false, isSystem: true, passwordHash: null });
    expect(checkSignInAllowed(record!, "PASSWORD")).toMatchObject({ allowed: false });
    expect(checkSignInAllowed(record!, "GOOGLE")).toMatchObject({ allowed: false });
    // Even marked active by mistake, the app still treats it as inactive.
    await db().query("UPDATE users SET active = TRUE WHERE id = ?", [id]);
    try {
      expect((await findUserForSignIn("automation@system.ars-cms.invalid"))?.active).toBe(false);
    } finally {
      await db().query("UPDATE users SET active = FALSE WHERE id = ?", [id]);
    }
    expect(await getUserForAdmin(id!)).toBeNull();
    const listed = await listUsersForAdmin({ search: "ARS-CMS Automation" }, { limit: 50, offset: 0 });
    expect(listed.items.some((user) => user.id === id)).toBe(false);
  });
});

describe("building and publishing", () => {
  it("lets owners and editors build; viewers and outsiders can't; the switch must be on", async () => {
    expect(await intake.createForm(projectId, who(viewerOnly))).toMatchObject({ ok: false, message: "Only the project's owners and editors build its forms." });
    expect(await intake.createForm(projectId, who(outsider))).toMatchObject({ ok: false, message: "Not found." });
    await setting("features.pm_forms", "OFF");
    try {
      expect(await intake.createForm(projectId, who(owner))).toMatchObject({ ok: false, message: "Project forms aren't switched on yet." });
    } finally {
      await setting("features.pm_forms", "ON");
    }
    const created = await intake.createForm(projectId, who(editor));
    expect(created.ok).toBe(true);
    formId = created.ok ? created.value.id : 0;
    const form = (await findForm(formId))!;
    token = form.token;
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    // BR-FORM-004: the project's name; the first section and the owner filled in.
    expect(form).toMatchObject({ name: `Intake ${tag}`, status: "DRAFT", settings: { assigneeId: owner, dueOffsetDays: 3, copyToDescription: true } });
    // "Only admins customise": owners only.
    await db().query("UPDATE projects SET permissions_json = JSON_OBJECT('customise', 'OWNER') WHERE id = ?", [projectId]);
    try {
      expect((await intake.saveForm(formId, {}, who(editor))).ok).toBe(false);
      expect((await intake.publishForm(formId, who(editor))).ok).toBe(false);
    } finally {
      await db().query("UPDATE projects SET permissions_json = NULL WHERE id = ?", [projectId]);
    }
  });

  it("refuses to publish an invalid form and a stale save", async () => {
    expect((await save([q("pick", "CHOICE", { label: "Pick", options: [] })], {}, {})).ok).toBe(true);
    const refused = await intake.publishForm(formId, who(owner));
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.problems?.map((problem) => problem.message)).toEqual(expect.arrayContaining(["“Pick”: question values must be specified."]));
    expect((await intake.saveForm(formId, { name: "x", draft: { fields: [], mappings: {} }, settings: DEFAULT_SETTINGS, rowVersion: 1 }, who(owner))).message).toContain("Someone else changed this form");
    expect((await intake.saveForm(formId, { name: "x", draft: { fields: [q("who", "PERSON")], mappings: {} }, settings: DEFAULT_SETTINGS, rowVersion: (await findForm(formId))!.rowVersion }, who(owner))).ok).toBe(false);
  });

  it("publishes versions: people fill in the published snapshot, not the draft", async () => {
    const sections = await listSections(projectId);
    let fields: FormField[] = [
      q("summary", "TEXT", { label: "Summary", required: true }),
      q("kind", "CHOICE", { label: "Kind", options: ["Hardware", "Software"], required: true }),
      q("model", "TEXT", { label: "Model", required: true }),
      q("priority", "CHOICE", { label: "How urgent", options: ["Critical", "Normal"] }),
      q("cost", "NUMBER", { label: "Budget" }),
      q("needed", "DATE", { label: "Needed by" }),
      q("files", "ATTACHMENT", { label: "Photos", maxFiles: 2 }),
    ];
    fields = setBranch(fields, "kind", "Hardware", "model", true);
    const mappings = { summary: { kind: "TASK", field: "title" }, kind: { kind: "FIELD", fieldId: stageField }, priority: { kind: "TASK", field: "priority" }, cost: { kind: "FIELD", fieldId: costField } };
    const saved = await save(fields, mappings, { sectionId: sections[0]!.id, assigneeId: editor, dueOffsetDays: 2, confirmation: "We'll be in touch." });
    expect(saved.ok && saved.value.problems).toEqual([]);
    const first = await intake.publishForm(formId, who(owner));
    expect(first).toMatchObject({ ok: true, value: { versionNo: 1 } });
    // An unpublished change to the draft isn't what people see.
    expect((await save([...fields, q("extra", "TEXT", { label: "Extra draft question" })], mappings, {})).ok).toBe(true);
    const view = await intake.fillView(token, who(outsider));
    expect(view).toMatchObject({ state: "OK", confirmation: "We'll be in touch." });
    expect(view!.fields.map((field) => field.key)).not.toContain("extra");
    expect((await findForm(formId))!.draftChanged).toBe(true);
    // Back to the published questions, published again: version 2.
    expect((await save(fields, mappings, {})).ok).toBe(true);
    expect(await intake.publishForm(formId, who(owner))).toMatchObject({ ok: true, value: { versionNo: 2 } });
    const [versions] = await db().query<RowDataPacket[]>("SELECT version_no FROM project_form_versions WHERE form_id = ? ORDER BY version_no", [formId]);
    expect(versions.map((row) => Number(row.version_no))).toEqual([1, 2]);
  });
});

describe("a submission becomes a task", () => {
  let taskId = 0;
  it("is created by the system user at the top of the section with every mapping", async () => {
    const result = await intake.submitForm(token, submission({ summary: "New laptop", kind: "Hardware", model: "X1", priority: "Critical", cost: "1,25,000", needed: "2027-01-15" }, "first-key-123"), who(outsider));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    taskId = result.value.taskId;
    expect(result.value).toMatchObject({ canSee: true, confirmation: "We'll be in touch.", repeated: false });
    const task = (await findTask(taskId))!;
    const system = await systemUserId();
    expect(task).toMatchObject({ title: "New laptop", createdBy: system, assigneeId: editor, priority: "URGENT" });
    // Due: 2 working days after today (India), at 11:59 pm.
    expect(task.dueAt).not.toBeNull();
    expect(indiaDay(task.dueAt!) > indiaDay(new Date())).toBe(true);
    // Top of the first section.
    const [order] = await db().query<RowDataPacket[]>("SELECT task_id FROM task_projects WHERE project_id = ? AND section_id = (SELECT section_id FROM task_projects WHERE task_id = ? AND project_id = ?) ORDER BY position, task_id", [projectId, taskId, projectId]);
    expect(Number(order[0]!.task_id)).toBe(taskId);
    // Mapped custom fields, the ID field (BR-FORM-010).
    const values = (await valueRows([taskId])).get(taskId)!;
    const defs = await listFieldDefs(projectId);
    const stage = defs.find((def) => def.id === stageField)!;
    expect(values.get(stageField)?.stored.optionId).toBe(stage.options.find((option) => option.name === "Hardware")!.id);
    expect(values.get(costField)?.stored.number).toBe(125000);
    expect(values.get(idField)?.legacy).toMatch(/^RQ-\d+$/);
    // Description: "Label: value" lines (the date too) and the footer link.
    expect(task.description).toContain("Name: Form outsider");
    expect(task.description).toContain("Model: X1");
    expect(task.description).toContain("Needed by: 15 Jan 2027");
    expect(task.description).toContain(`Submitted through the form Intake ${tag} by Form outsider ${tag}.`);
    expect(task.description).toContain(`/users/forms/${token}`);
    // The submitter follows it; the stories are by the system on their behalf.
    const [followers] = await db().query<RowDataPacket[]>("SELECT user_id, source FROM task_followers WHERE task_id = ? ORDER BY user_id", [taskId]);
    expect(followers.map((row) => [Number(row.user_id), String(row.source)])).toEqual(expect.arrayContaining([[outsider, "FORM"], [editor, "ASSIGNEE"]]));
    const [events] = await db().query<RowDataPacket[]>("SELECT actor_id, event_type, body FROM task_events WHERE task_id = ? ORDER BY id", [taskId]);
    expect(events.map((row) => String(row.event_type))).toEqual(["CREATED", "FORM_SUBMITTED"]);
    expect(events.every((row) => Number(row.actor_id) === system)).toBe(true);
    expect(String(events[1]!.body)).toBe(`Submitted through the form Intake ${tag} on behalf of Form outsider ${tag}`);
    const [submissions] = await db().query<RowDataPacket[]>("SELECT version_id, task_id, answers_json FROM project_form_submissions WHERE form_id = ?", [formId]);
    expect(submissions).toHaveLength(1);
    expect(submissions[0]!.answers_json).toMatchObject({ needed: "2027-01-15", kind: "Hardware" });
    // Messages: the assignee, the project's owner, the submitter's confirmation.
    expect(await titles(editor, "Task for you")).toContain(`Task for you: ${task.taskNo} New laptop`);
    expect(await titles(owner, "New form submission")).toContain(`New form submission: ${task.taskNo}`);
    expect(await titles(outsider, "We received your form")).toContain(`We received your form: Intake ${tag}`);
  });

  it("is the project's to edit (not an ad hoc task of the system user)", async () => {
    const task = (await findTask(taskId))!;
    expect((await rightsOn(task, await workViewer(who(owner)))).details).toBe(true);
    expect((await rightsOn(task, await workViewer(who(viewerOnly)))).details).toBe(false);
    const renamed = await work.setTaskFields(taskId, { title: "Laptop for the plant" }, who(owner));
    expect(renamed.ok).toBe(true);
  });

  it("treats the same submission key as one submission", async () => {
    const again = await intake.submitForm(token, submission({ summary: "Again", kind: "Software" }, "first-key-123"), who(outsider));
    expect(again).toMatchObject({ ok: true, value: { taskId, repeated: true } });
    const [rows] = await db().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM project_form_submissions WHERE form_id = ?", [formId]);
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it("validates on the server: required, branches, options, past due dates", async () => {
    const missing = await intake.submitForm(token, submission({ kind: "Hardware" }), who(outsider));
    expect(missing).toMatchObject({ ok: false, fieldErrors: { summary: "This field is required", model: "This field is required" } });
    // The branch hides Model for Software: not required then, and its answer is dropped.
    const software = await intake.submitForm(token, submission({ summary: "Licence", kind: "Software", model: "ignored" }), who(outsider));
    expect(software.ok).toBe(true);
    if (software.ok) expect((await findTask(software.value.taskId))!.description).not.toContain("ignored");
    expect((await intake.submitForm(token, submission({ summary: "x", kind: "Firmware" }), who(outsider))).ok).toBe(false);
  });

  it("keeps files from an attachment question on the task", async () => {
    const pdf = new File([new TextEncoder().encode("%PDF-1.4\n%test\n")], "quote.pdf", { type: "application/pdf" });
    const result = await intake.submitForm(token, submission({ summary: "With a file", kind: "Software" }, undefined, { files: [pdf] }), who(outsider));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [files] = await db().query<RowDataPacket[]>("SELECT original_name, field_key, uploaded_by FROM record_files WHERE entity_type = 'TASK' AND entity_id = ?", [result.value.taskId]);
    expect(files.map((row) => [String(row.original_name), String(row.field_key), Number(row.uploaded_by)])).toEqual([["quote.pdf", "files", outsider]]);
    expect((await findTask(result.value.taskId))!.description).toContain("Photos: quote.pdf");
    const fake = new File([new TextEncoder().encode("MZ not a pdf")], "virus.pdf", { type: "application/pdf" });
    expect((await intake.submitForm(token, submission({ summary: "Bad file", kind: "Software" }, undefined, { files: [fake] }), who(outsider))).ok).toBe(false);
  });

  it("limits each person to 20 submissions an hour per form", async () => {
    const version = (await findForm(formId))!.currentVersionId!;
    for (let i = 0; i < 20; i += 1) await db().query("INSERT INTO project_form_submissions (form_id, version_id, submitter_id, submission_key, answers_json) VALUES (?, ?, ?, ?, '{}')", [formId, version, deptPerson, `bulk-${tag}-${i}`]);
    const over = await intake.submitForm(token, submission({ summary: "One more", kind: "Software" }), who(deptPerson));
    expect(over).toMatchObject({ ok: false, message: "You've sent this form 20 times in the last hour. Try again later." });
  });
});

describe("who may submit", () => {
  it("follows the form's audience; an unpublished form takes nothing", async () => {
    const form = (await findForm(formId))!;
    expect((await save(form.draft.fields, form.draft.mappings, { audience: "MEMBERS" })).ok).toBe(true);
    expect((await intake.publishForm(formId, who(owner))).ok).toBe(true);
    expect((await intake.fillView(token, who(outsider)))?.state).toBe("NOT_ALLOWED");
    expect(await intake.submitForm(token, submission({ summary: "x", kind: "Software" }), who(outsider))).toMatchObject({ ok: false, message: "You can't submit this form. Ask the project's owner if you need to." });
    expect((await intake.fillView(token, who(viewerOnly)))?.state).toBe("OK");
    expect((await save(form.draft.fields, form.draft.mappings, { audience: "DEPARTMENTS", departmentIds: [department] })).ok).toBe(true);
    expect((await intake.publishForm(formId, who(owner))).ok).toBe(true);
    expect((await intake.fillView(token, who(viewerOnly)))?.state).toBe("NOT_ALLOWED");
    expect((await intake.fillView(token, who(deptPerson)))?.state).toBe("OK");
    expect((await intake.fillView(token, who(editor)))?.state).toBe("OK"); // a builder may always try it
    expect(await intake.unpublishForm(formId, who(owner))).toMatchObject({ ok: true });
    expect((await intake.fillView(token, who(deptPerson)))?.state).toBe("CLOSED");
    expect(await intake.submitForm(token, submission({ summary: "x", kind: "Software" }), who(deptPerson))).toMatchObject({ ok: false, message: "This form isn't accepting submissions." });
    expect(await intake.fillView("not-a-real-token-at-all-x", who(owner))).toBeNull();
  });

  it("lists, duplicates and deletes (soft) in Customize; Home shows forms I may submit", async () => {
    expect((await intake.publishForm(formId, who(owner))).ok).toBe(true);
    const copy = await intake.duplicateForm(formId, who(editor));
    expect(copy.ok).toBe(true);
    const listed = await intake.projectFormsFor(projectId, who(owner));
    expect(listed?.rows.map((row) => row.status)).toEqual(["PUBLISHED", "DRAFT"]);
    expect(listed?.rows[0]!.submissions).toBeGreaterThan(0);
    expect((await intake.projectFormsFor(projectId, who(viewerOnly)))?.rows.map((row) => row.id)).toEqual([formId]);
    const home = await intake.homeForms(who(deptPerson));
    expect(home?.forms.some((item) => item.link === `/users/forms/${token}`)).toBe(true);
    expect((await intake.homeForms(who(outsider)))?.forms.some((item) => item.link === `/users/forms/${token}`)).toBe(false);
    expect((await intake.homeForms(who(outsider)))?.mine.length).toBeGreaterThan(0);
    if (copy.ok) {
      expect((await intake.deleteForm(copy.value.id, who(viewerOnly))).ok).toBe(false);
      expect((await intake.deleteForm(copy.value.id, who(editor))).ok).toBe(true);
      expect((await findForm(copy.value.id))!.deletedAt).not.toBeNull();
    }
  });
});
