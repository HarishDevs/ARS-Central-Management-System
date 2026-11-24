import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import * as work from "@/server/work/service";
import * as more from "@/server/work/service-more";
import * as fieldsService from "@/server/work/fields-service";
import * as fields from "@/lib/db/repositories/fields.repository";
import { workViewer } from "@/server/work/task-access";
import { runWorkPurge } from "@/server/work/purge";
import type { ModuleCode } from "@/server/modules/modules";
import { createUser } from "./helpers";

// v1.64.0 (D-371, PM phase B part 1): custom fields through the service:
// create each type, values by type, permissions (deny by default, "Only
// admins customise", library fields), limits, IDs, notify on change, remove
// and add back, delete and restore, value migration, purge.
const tag = Date.now().toString(36);
const ALL: ModuleCode[] = ["APPROVAL", "TASK", "PROJECT"];
const who = (id: number, name = `F${id}`) => ({ id, name, roles: ["USER"] as string[], modules: ALL, sessionId: "pm-fields", ipAddress: null });
const db = () => getDbPool();
const count = async (sql: string, params: unknown[]) => Number((await db().query<RowDataPacket[]>(sql, params))[0][0]?.n ?? 0);
let owner: number;
let editor: number;
let viewerOnly: number;
let outsider: number;
let projectId: number;
let otherProject: number;
let taskA: number;
let taskB: number;

const project = async (name: string) => {
  const created = await work.createProject({ name, description: "", color: "blue", privacy: "PRIVATE", departmentId: null, defaultAccessRole: "EDITOR", defaultView: "LIST", startOn: "", dueOn: "" }, who(owner));
  if (!created.ok) throw new Error(created.message);
  return created.value.id;
};
const task = async (title: string, inProject: number) => {
  const added = await work.quickAddTask({ title, projectId: inProject, sectionId: null, parentId: null, assigneeId: null, dueDay: "", mySectionId: null }, who(owner));
  if (!added.ok) throw new Error(added.message);
  return added.value.id;
};
const create = async (input: Record<string, unknown>, as = owner, inProject = projectId) => {
  const result = await fieldsService.createField(inProject, input, who(as));
  if (!result.ok) throw new Error(result.message);
  return result.value.id;
};
const cells = async (taskIds: number[], as = owner, inProject = projectId) => fieldsService.cellsFor(taskIds, await fields.listFieldDefs(inProject), await workViewer(who(as)));
const setting = (key: string, value: string) =>
  db().query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES (?, 'TASKS', 'STRING', FALSE, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, value]);

beforeAll(async () => {
  await setting("features.pm_planning", "ON");
  owner = await createUser({ name: `CF owner ${tag}` });
  editor = await createUser({ name: `CF editor ${tag}` });
  viewerOnly = await createUser({ name: `CF viewer ${tag}` });
  outsider = await createUser({ name: `CF outsider ${tag}` });
  projectId = await project(`Fields ${tag}`);
  otherProject = await project(`Fields other ${tag}`);
  expect((await work.setMember(projectId, { type: "USER", id: editor }, "EDITOR", who(owner))).ok).toBe(true);
  expect((await work.setMember(projectId, { type: "USER", id: viewerOnly }, "VIEWER", who(owner))).ok).toBe(true);
  taskA = await task(`Alpha ${tag}`, projectId);
  taskB = await task(`Beta ${tag}`, projectId);
});
afterAll(async () => {
  await db().query("DELETE FROM system_settings WHERE setting_key IN ('features.pm_planning', 'tasks.field_limits')");
});

describe("create and edit fields", () => {
  it("creates each of the 11 types; values by type; cells formatted", async () => {
    const stage = await create({ name: "Stage", type: "SELECT", options: [{ name: "Open", color: 1 }, { name: "Done", color: 6 }] });
    const plants = await create({ name: "Plants", type: "MULTI_SELECT", options: [{ name: "Raipur", color: 2 }, { name: "Bilaspur", color: 3 }] });
    const cost = await create({ name: "Cost", type: "NUMBER", config: { format: "currency", decimals: 2 } });
    const hours = await create({ name: "Hours", type: "NUMBER" });
    const review = await create({ name: "Review", type: "DATE", config: { withTime: true } });
    const reviewer = await create({ name: "Reviewer", type: "PEOPLE", notify: true });
    const notes = await create({ name: "Notes", type: "TEXT" });
    const rate = await create({ name: "Rate", type: "FORMULA", config: { formula: `{f${cost}} / {f${hours}}`, decimals: 1 } });
    const timer = await create({ name: "Time spent", type: "TIMER" });
    const link = await create({ name: "Linked", type: "REFERENCE" });
    const linkedStage = await create({ name: "Linked stage", type: "LOOKUP", config: { referenceFieldId: link, targetFieldId: stage } });
    expect((await fields.listFieldDefs(projectId)).map((field) => field.type)).toEqual(["SELECT", "MULTI_SELECT", "NUMBER", "NUMBER", "DATE", "PEOPLE", "TEXT", "FORMULA", "TIMER", "REFERENCE", "LOOKUP"]);
    const defs = await fields.listFieldDefs(projectId);
    const option = (fieldId: number, name: string) => defs.find((field) => field.id === fieldId)!.options.find((item) => item.name === name)!.id;
    const set = async (taskId: number, fieldId: number, value: unknown, as = owner) => fieldsService.setFieldValue(taskId, fieldId, value, who(as));
    expect((await set(taskA, stage, option(stage, "Open"))).ok).toBe(true);
    expect((await set(taskB, stage, option(stage, "Done"))).ok).toBe(true);
    expect((await set(taskA, plants, [option(plants, "Raipur"), option(plants, "Bilaspur")])).ok).toBe(true);
    expect((await set(taskA, cost, "1,234.5")).ok).toBe(true);
    expect((await set(taskA, hours, "4")).ok).toBe(true);
    expect((await set(taskA, review, "2026-12-01T10:30")).ok).toBe(true);
    expect((await set(taskA, reviewer, [editor])).ok).toBe(true);
    expect((await set(taskA, notes, "Check the invoice")).ok).toBe(true);
    expect((await set(taskA, link, [taskB])).ok).toBe(true);
    expect((await set(taskA, link, [taskA])).ok).toBe(false); // not itself
    expect((await set(taskA, rate, "5")).ok).toBe(false); // read-only
    expect((await set(taskA, cost, "abc")).ok).toBe(false);
    expect((await fieldsService.timer(taskA, timer, "start", who(owner))).ok).toBe(true);
    expect((await fieldsService.timer(taskA, timer, "start", who(owner))).ok).toBe(false); // already running
    await db().query("UPDATE task_field_timer_runs SET started_at = DATE_SUB(started_at, INTERVAL 90 MINUTE) WHERE task_id = ? AND field_id = ?", [taskA, timer]);
    const stopped = await fieldsService.timer(taskA, timer, "stop", who(owner));
    expect(stopped.ok && stopped.value.seconds).toBeGreaterThanOrEqual(5400);
    const view = (await cells([taskA]))[taskA]!;
    expect(view[stage]!.text).toBe("Open");
    expect(view[plants]!.text).toBe("Raipur, Bilaspur");
    expect(view[cost]!.text).toBe("₹1,234.50");
    expect(view[review]!.text).toBe("1 Dec 2026, 10:30 am");
    expect(view[reviewer]!.text).toMatch(/CF editor/);
    expect(view[rate]!.text).toBe("308.6");
    expect(view[timer]!.text).toBe("1:30");
    expect(view[link]!.text).toContain(`Beta ${tag}`);
    expect(view[linkedStage]!.text).toBe("Done");
    // Activity story and the old column kept up to date.
    const [events] = await db().query<RowDataPacket[]>("SELECT body FROM task_events WHERE task_id = ? AND event_type = 'FIELD_SET' ORDER BY id", [taskA]);
    expect(events.map((row) => String(row.body))).toContain("changed Stage to Open");
    expect((await fields.valueRows([taskA])).get(taskA)!.get(plants)!.legacy).toBe("Raipur, Bilaspur");
  });

  it("refuses bad definitions: no title, duplicates, bad formula, loop-free lookups, ID prefix", async () => {
    expect((await fieldsService.createField(projectId, { name: " ", type: "TEXT" }, who(owner))).ok).toBe(false);
    expect((await fieldsService.createField(projectId, { name: "stage", type: "TEXT" }, who(owner))).ok).toBe(false);
    expect((await fieldsService.createField(projectId, { name: "Bad formula", type: "FORMULA", config: { formula: "1 +" } }, who(owner))).ok).toBe(false);
    expect((await fieldsService.createField(projectId, { name: "Bad ref", type: "FORMULA", config: { formula: "{f999999}" } }, who(owner))).ok).toBe(false);
    expect((await fieldsService.createField(otherProject, { name: "Lookup", type: "LOOKUP" }, who(owner))).message).toMatch(/No reference fields/);
    expect((await fieldsService.createField(projectId, { name: "Ticket", type: "ID", idPrefix: "1x" }, who(owner))).ok).toBe(false);
  });

  it("edits: rename, options add/rename/recolour/reorder/archive, number format", async () => {
    const field = (await fields.listFieldDefs(projectId)).find((item) => item.name === "Stage")!;
    const [open, done] = field.options;
    const result = await fieldsService.updateField(projectId, field.id, { name: "Status stage", options: [{ id: done!.id, name: "Finished", color: 7 }, { id: open!.id, name: "Open", color: 1, archived: true }, { name: "Blocked", color: 4 }] }, who(editor));
    expect(result.ok).toBe(true);
    const after = (await fields.findField(field.id))!;
    expect(after.name).toBe("Status stage");
    expect(after.options.map((option) => [option.name, option.color, option.archived])).toEqual([
      ["Finished", 7, false],
      ["Open", 1, true],
      ["Blocked", 4, false],
    ]);
    // Archived: kept on the task, not chosen again.
    expect((await cells([taskA]))[taskA]![field.id]!.text).toBe("Open");
    expect((await fieldsService.setFieldValue(taskB, field.id, open!.id, who(owner))).ok).toBe(false);
    const cost = (await fields.listFieldDefs(projectId)).find((item) => item.name === "Cost")!;
    expect((await fieldsService.updateField(projectId, cost.id, { name: "Cost", config: { format: "plain", decimals: 0 } }, who(owner))).ok).toBe(true);
    expect((await cells([taskA]))[taskA]![cost.id]!.text).toBe("1,235");
    // Type never changes.
    await fieldsService.updateField(projectId, cost.id, { name: "Cost", type: "TEXT" }, who(owner));
    expect((await fields.findField(cost.id))!.type).toBe("NUMBER");
  });
});

describe("permissions", () => {
  it("viewers and outsiders can't add fields or set values; editors can unless only admins customise", async () => {
    expect((await fieldsService.createField(projectId, { name: "Viewer's", type: "TEXT" }, who(viewerOnly))).ok).toBe(false);
    expect((await fieldsService.createField(projectId, { name: "Outsider's", type: "TEXT" }, who(outsider))).message).toBe("Not found.");
    const notes = (await fields.listFieldDefs(projectId)).find((item) => item.name === "Notes")!;
    expect((await fieldsService.setFieldValue(taskA, notes.id, "x", who(outsider))).ok).toBe(false);
    expect((await fieldsService.setFieldValue(taskA, notes.id, "x", who(viewerOnly))).ok).toBe(false);
    expect((await work.setPermissions(projectId, { fields: [], shareTasks: "EDITOR", customise: "OWNER" }, who(owner))).ok).toBe(true);
    expect((await fieldsService.createField(projectId, { name: "Editor's", type: "TEXT" }, who(editor))).message).toMatch(/admins/);
    expect((await fieldsService.updateField(projectId, notes.id, { name: "Notes 2" }, who(editor))).ok).toBe(false);
    expect((await fieldsService.createField(projectId, { name: "Owner's", type: "TEXT" }, who(owner))).ok).toBe(true);
    expect((await work.setPermissions(projectId, { fields: [], shareTasks: "EDITOR", customise: "EDITOR" }, who(owner))).ok).toBe(true);
    expect((await fieldsService.createField(projectId, { name: "Editor's", type: "TEXT" }, who(editor))).ok).toBe(true);
  });
  it("the switch off: only the v1.63 types", async () => {
    await setting("features.pm_planning", "OFF");
    try {
      expect((await fieldsService.createField(otherProject, { name: "People off", type: "PEOPLE" }, who(owner))).ok).toBe(false);
      expect((await more.addField(otherProject, { name: "Plain", kind: "TEXT", options: "" }, who(owner))).ok).toBe(true);
    } finally {
      await setting("features.pm_planning", "ON");
    }
  });
});

describe("library, IDs, limits, notify", () => {
  it("a library field is reused by another project; option edits show in both (AC-PROJC-10); only its creator or IT edits it", async () => {
    const shared = await create({ name: `Priority ${tag}`, type: "SELECT", library: true, options: [{ name: "High", color: 4 }] }, editor);
    expect((await fieldsService.createField(otherProject, { name: `priority ${tag}`, type: "TEXT", library: true }, who(owner))).ok).toBe(false); // library names unique
    expect((await fieldsService.attachLibraryField(otherProject, shared, who(owner))).ok).toBe(true);
    expect((await fieldsService.attachLibraryField(otherProject, shared, who(owner))).ok).toBe(false);
    expect((await fieldsService.updateField(otherProject, shared, { name: `Priority ${tag}`, options: [{ name: "High", color: 4 }, { name: "Low", color: 6 }] }, who(owner))).ok).toBe(false); // owner of a project, not the creator
    const field = (await fields.findField(shared))!;
    expect((await fieldsService.updateField(projectId, shared, { name: `Priority ${tag}`, options: [{ id: field.options[0]!.id, name: "High", color: 4 }, { name: "Low", color: 6 }] }, who(editor))).ok).toBe(true);
    expect((await fields.listFieldDefs(otherProject)).find((item) => item.id === shared)!.options.map((option) => option.name)).toEqual(["High", "Low"]);
    const library = await fieldsService.libraryFor(tag, who(outsider));
    expect(library.ok && library.value.find((item) => item.id === shared)?.usage).toBe(2);
  });
  it("an ID field numbers existing tasks in list order and each new task; IDs never change (AC-PROJC-04)", async () => {
    const idField = await create({ name: "Ticket", type: "ID", idPrefix: "tk" });
    expect((await fields.findField(idField))!.library).toBe(true); // forced
    const first = await cells([taskA, taskB]);
    expect([first[taskA]![idField]!.text, first[taskB]![idField]!.text]).toEqual(["TK-1", "TK-2"]);
    const taskC = await task(`Gamma ${tag}`, projectId);
    expect((await cells([taskC]))[taskC]![idField]!.text).toBe("TK-3");
    expect((await fieldsService.setFieldValue(taskC, idField, "TK-9", who(owner))).ok).toBe(false);
    const [events] = await db().query<RowDataPacket[]>("SELECT body FROM task_events WHERE task_id = ? AND body = 'Ticket set to TK-1'", [taskA]);
    expect(events.length).toBe(1);
  });
  it("limits from Admin settings: fields per project, values per task, options", async () => {
    await setting("tasks.field_limits", JSON.stringify({ perProject: 2, perTask: 1, options: 2 }));
    try {
      const small = await project(`Limits ${tag}`);
      const t = await task(`Limited ${tag}`, small);
      const one = await create({ name: "One", type: "TEXT" }, owner, small);
      const two = await create({ name: "Two", type: "TEXT" }, owner, small);
      expect((await fieldsService.createField(small, { name: "Three", type: "TEXT" }, who(owner))).message).toMatch(/at most 2 fields/);
      expect((await fieldsService.setFieldValue(t, one, "a", who(owner))).ok).toBe(true);
      expect((await fieldsService.setFieldValue(t, two, "b", who(owner))).message).toMatch(/at most 1 field/);
      expect((await fieldsService.updateField(small, one, { name: "One", type: "SELECT" }, who(owner))).ok).toBe(true);
      const opts = await fieldsService.createField(otherProject, { name: "Many", type: "SELECT", options: [{ name: "a" }, { name: "b" }, { name: "c" }] }, who(owner));
      expect(opts.ok).toBe(false);
    } finally {
      await db().query("DELETE FROM system_settings WHERE setting_key = 'tasks.field_limits'");
    }
  });
  it("notify on change tells the task's followers, not the person who changed it", async () => {
    const reviewer = (await fields.listFieldDefs(projectId)).find((item) => item.name === "Reviewer")!;
    expect((await work.setFollower(taskB, editor, true, who(owner))).ok).toBe(true);
    const before = await count("SELECT COUNT(*) AS n FROM notification_outbox WHERE payload_json LIKE ?", [`%changed Reviewer%`]);
    expect((await fieldsService.setFieldValue(taskB, reviewer.id, [owner], who(owner))).ok).toBe(true);
    const [rows] = await db().query<RowDataPacket[]>("SELECT payload_json FROM notification_outbox WHERE payload_json LIKE ? ORDER BY id DESC", [`%changed Reviewer%`]);
    expect(rows.length).toBeGreaterThan(before);
    const payloads = rows.slice(0, rows.length - before).map((row) => (typeof row.payload_json === "string" ? JSON.parse(row.payload_json) : row.payload_json));
    expect(payloads.some((payload) => JSON.stringify(payload).includes(`"userId":${editor}`) || JSON.stringify(payload).includes(`${editor}`))).toBe(true);
    expect(payloads.every((payload) => !JSON.stringify(payload).includes(`"userId":${owner},`))).toBe(true);
  });
});

describe("remove, delete, restore, purge, migration", () => {
  it("remove from the project keeps values; adding back shows them again (AC-PROJC-09)", async () => {
    const notes = (await fields.listFieldDefs(projectId)).find((item) => item.name === "Notes")!;
    expect((await fieldsService.removeFieldFromProject(projectId, notes.id, who(editor))).ok).toBe(true);
    expect((await fields.listFieldDefs(projectId)).some((item) => item.id === notes.id)).toBe(false);
    expect((await fieldsService.addBackField(projectId, notes.id, who(editor))).ok).toBe(true);
    expect((await cells([taskA]))[taskA]![notes.id]!.text).toBe("Check the invoice");
  });
  it("delete is restorable for 30 days, then the purge removes it with its values", async () => {
    const temp = await create({ name: "Temporary", type: "TEXT" });
    await fieldsService.setFieldValue(taskA, temp, "keep me", who(owner));
    expect((await fieldsService.deleteField(projectId, temp, who(viewerOnly))).ok).toBe(false);
    expect((await fieldsService.deleteField(projectId, temp, who(owner))).ok).toBe(true);
    expect((await fields.listGoneFields(projectId)).deleted.map((item) => item.id)).toContain(temp);
    expect((await fieldsService.restoreField(projectId, temp, who(owner))).ok).toBe(true);
    expect((await cells([taskA]))[taskA]![temp]!.text).toBe("keep me");
    expect((await fieldsService.deleteField(projectId, temp, who(owner))).ok).toBe(true);
    await db().query("UPDATE project_fields SET deleted_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 31 DAY) WHERE id = ?", [temp]);
    const purged = await runWorkPurge({ force: true });
    expect(purged.purgedFields).toBeGreaterThanOrEqual(1);
    expect(await count("SELECT COUNT(*) AS n FROM task_field_values WHERE field_id = ?", [temp])).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM project_fields WHERE id = ?", [temp])).toBe(0);
  });
  it("v1.63 values (the old column only) are copied into typed columns; unreadable ones still read from the old column", async () => {
    const field = await create({ name: "Legacy number", type: "NUMBER" });
    const legacyDate = await create({ name: "Legacy date", type: "DATE" });
    const choice = await create({ name: "Legacy choice", type: "SELECT", options: [{ name: "Raipur", color: 1 }] });
    await db().query("INSERT INTO task_field_values (task_id, field_id, value, updated_by) VALUES (?, ?, '1200.5', ?), (?, ?, '2026-01-31', ?), (?, ?, 'Raipur', ?)", [taskB, field, owner, taskB, legacyDate, owner, taskB, choice, owner]);
    const before = (await cells([taskB]))[taskB]!;
    expect(before[field]!.text).toBe("1,201"); // read from the old column by the field's rules
    expect(await fields.backfillTypedValues()).toBeGreaterThanOrEqual(3);
    const [rows] = await db().query<RowDataPacket[]>("SELECT field_id, value, number_value, date_value, option_id, typed_at FROM task_field_values WHERE task_id = ? AND field_id IN (?)", [taskB, [field, legacyDate, choice]]);
    for (const row of rows) expect(row.typed_at).not.toBeNull();
    expect(Number(rows.find((row) => Number(row.field_id) === field)!.number_value)).toBe(1200.5);
    expect(rows.find((row) => Number(row.field_id) === choice)!.option_id).not.toBeNull();
    expect(rows.every((row) => row.value !== null)).toBe(true); // the old column is kept
    expect((await cells([taskB]))[taskB]![legacyDate]!.text).toBe("31 Jan 2026");
  });
});
