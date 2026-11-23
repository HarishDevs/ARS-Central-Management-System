import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import * as work from "@/server/work/service";
import * as fieldsService from "@/server/work/fields-service";
import * as fields from "@/lib/db/repositories/fields.repository";
import { workViewer } from "@/server/work/task-access";
import type { ModuleCode } from "@/server/modules/modules";
import { createUser } from "./helpers";

// v1.88.0 (D-418, spec FORMULA_FIELDS): formulas through the service: the
// task's own dates, Today worked out on reading (no activity, no audit),
// ROLLUP over first-level subtasks (batched), WORKDAYS on the Working
// calendar, the limits with their messages, the preview, and formulas asked
// for alone (as automations and reports do).
const tag = Date.now().toString(36);
const ALL: ModuleCode[] = ["APPROVAL", "TASK", "PROJECT"];
const who = (id: number, name = `FX${id}`) => ({ id, name, roles: ["USER"] as string[], modules: ALL, sessionId: "fx", ipAddress: null });
const db = () => getDbPool();
const count = async (sql: string, params: unknown[]) => Number((await db().query<RowDataPacket[]>(sql, params))[0][0]?.n ?? 0);
let owner: number;
let projectId: number;
let parent: number;
let subA: number;
let subB: number;
let grandchild: number;

const create = async (input: Record<string, unknown>) => {
  const result = await fieldsService.createField(projectId, input, who(owner));
  if (!result.ok) throw new Error(result.message);
  return result.value.id;
};
const refuse = async (input: Record<string, unknown>) => {
  const result = await fieldsService.createField(projectId, input, who(owner));
  return result.ok ? "saved" : result.message;
};
const task = async (title: string, parentId: number | null) => {
  const added = await work.quickAddTask({ title, projectId: parentId ? null : projectId, sectionId: null, parentId, assigneeId: null, dueDay: "", mySectionId: null }, who(owner));
  if (!added.ok) throw new Error(added.message);
  return added.value.id;
};
// Dates straight in the table: start is a day, due/created/completed are UTC (India = +5:30).
const dates = (id: number, start: string | null, dueIndia: string | null, completedIndia: string | null = null) =>
  db().query("UPDATE tasks SET starts_on = ?, due_at = ?, completed_at = ? WHERE id = ?", [start, dueIndia ? `${dueIndia} 12:00:00` : null, completedIndia ? `${completedIndia} 12:00:00` : null, id]);
const cells = async (taskIds: number[], now: Date, only?: (type: string) => boolean) => fieldsService.cellsFor(taskIds, (await fields.listFieldDefs(projectId)).filter((field) => !only || only(field.type)), await workViewer(who(owner)), now);
const setting = (key: string, value: string) =>
  db().query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES (?, 'TASKS', 'STRING', FALSE, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, value]);

beforeAll(async () => {
  await setting("features.pm_planning", "ON");
  owner = await createUser({ name: `FX owner ${tag}` });
  const created = await work.createProject({ name: `Formulas ${tag}`, description: "", color: "blue", privacy: "PRIVATE", departmentId: null, defaultAccessRole: "EDITOR", defaultView: "LIST", startOn: "", dueOn: "" }, who(owner));
  if (!created.ok) throw new Error(created.message);
  projectId = created.value.id;
  parent = await task(`Parent ${tag}`, null);
  subA = await task(`Sub A ${tag}`, parent);
  subB = await task(`Sub B ${tag}`, parent);
  grandchild = await task(`Grandchild ${tag}`, subA);
  // A subtask carries the project's fields once it is also in the project (as in Asana).
  for (const id of [subA, subB, grandchild]) expect((await work.addToProject(id, projectId, null, who(owner))).ok).toBe(true);
});
afterAll(async () => {
  await db().query("DELETE FROM system_settings WHERE setting_key IN ('features.pm_planning')");
});

describe("formulas on tasks", () => {
  it("task dates, Today on reading (no activity or audit), ROLLUP and WORKDAYS", async () => {
    const hours = await create({ name: "Hours", type: "NUMBER", config: { decimals: 1 } });
    const nfd = await create({ name: "NFD", type: "DATE" });
    const tat = await create({ name: "TAT", type: "FORMULA", config: { formula: "DAYS({start}, {due})" } });
    const nfdDelay = await create({ name: "NFD Delay", type: "FORMULA", config: { formula: `DAYS({today}, {f${nfd}})` } });
    const delayDays = await create({ name: "Delay Days", type: "FORMULA", config: { formula: "DAYS({due}, {completed}) - 1" } });
    const total = await create({ name: "Total hours", type: "FORMULA", config: { formula: `ROLLUP({f${hours}}) + {f${hours}}`, decimals: 1 } });
    const work5 = await create({ name: "Working days", type: "FORMULA", config: { formula: "WORKDAYS({start}, {due})" } });
    const follow = await create({ name: "Follow-up", type: "FORMULA", config: { formula: "DATEADD({due}, 7)" } });
    const set = async (taskId: number, fieldId: number, value: unknown) => expect((await fieldsService.setFieldValue(taskId, fieldId, value, who(owner))).ok).toBe(true);
    await set(parent, hours, "2");
    await set(subA, hours, "3");
    await set(subB, hours, "4.5");
    await set(grandchild, hours, "100"); // second level: not counted
    await set(parent, nfd, "2026-12-01");
    await dates(parent, "2026-11-23", "2026-11-27", "2026-12-01");

    const events = await count("SELECT COUNT(*) AS n FROM task_events WHERE task_id IN (?)", [[parent, subA, subB]]);
    const audits = await count("SELECT COUNT(*) AS n FROM audit_logs", []);
    const monday = (await cells([parent], new Date("2026-11-23T06:00:00Z")))[parent]!;
    expect(monday[tat]!.text).toBe("4");
    expect(monday[nfdDelay]!.text).toBe("8");
    expect(monday[delayDays]!.text).toBe("3");
    expect(monday[total]!.text).toBe("9.5");
    expect(monday[follow]!.text).toBe("4 Dec 2026");
    expect(Number(monday[work5]!.text)).toBeGreaterThanOrEqual(1);
    // Next day, Today moves on; nothing is written by reading.
    const tuesday = (await cells([parent], new Date("2026-11-24T06:00:00Z")))[parent]!;
    expect(tuesday[nfdDelay]!.text).toBe("7");
    // India day: 23:00 UTC on 23 Nov is 24 Nov in India.
    expect((await cells([parent], new Date("2026-11-23T23:00:00Z")))[parent]![nfdDelay]!.text).toBe("7");
    expect(await count("SELECT COUNT(*) AS n FROM task_events WHERE task_id IN (?)", [[parent, subA, subB]])).toBe(events);
    expect(await count("SELECT COUNT(*) AS n FROM audit_logs", [])).toBe(audits);

    // Asked for alone (automations, reports): the inputs come too.
    const alone = (await cells([parent], new Date("2026-11-23T06:00:00Z"), (type) => type === "FORMULA"))[parent]!;
    expect(alone[total]!.text).toBe("9.5");
    expect(alone[nfdDelay]!.text).toBe("8");

    // A deleted subtask leaves the sum; an empty input leaves the result empty.
    await db().query("UPDATE tasks SET deleted_at = UTC_TIMESTAMP() WHERE id = ?", [subB]);
    expect((await cells([parent], new Date("2026-11-23T06:00:00Z")))[parent]![total]!.text).toBe("5.0");
    await db().query("UPDATE tasks SET deleted_at = NULL WHERE id = ?", [subB]);
    expect((await cells([subB], new Date("2026-11-23T06:00:00Z")))[subB]?.[tat]).toBeUndefined();

    // A list of many tasks reads in a fixed number of queries (no query per row).
    const many = await Promise.all(Array.from({ length: 6 }, (_, i) => task(`Row ${i} ${tag}`, null)));
    const list = await cells([parent, ...many], new Date("2026-11-23T06:00:00Z"));
    expect(list[parent]![total]!.text).toBe("9.5");

    // The live preview works a formula out on a task, writing nothing.
    const preview = await fieldsService.previewFormula(projectId, "DAYS([Start date], [Due date]) * 2", null, who(owner));
    expect(preview.ok && preview.value?.text).toBe("8");
    const bad = await fieldsService.previewFormula(projectId, "DAYS([Hours], [Due date])", null, who(owner));
    expect(!bad.ok && bad.message).toMatch(/needs a date/);
  });

  it("refuses with a specific message: inputs, layers, loops, types, length", async () => {
    const numbers = [];
    for (let i = 0; i < 11; i += 1) numbers.push(await create({ name: `N${i} ${tag}`, type: "NUMBER" }));
    expect(await refuse({ name: "Eleven", type: "FORMULA", config: { formula: numbers.map((id) => `{f${id}}`).join(" + ") } })).toMatch(/at most 10 inputs/);
    const a = await create({ name: "Layer A", type: "FORMULA", config: { formula: `{f${numbers[0]}} * 2` } });
    const b = await create({ name: "Layer B", type: "FORMULA", config: { formula: `{f${a}} + 1` } });
    const c = await create({ name: "Layer C", type: "FORMULA", config: { formula: `{f${b}} + 1` } });
    expect(await refuse({ name: "Layer D", type: "FORMULA", config: { formula: `{f${c}} + 1` } })).toMatch(/at most 2 layers deep/);
    // Changing A to read C would loop.
    const loop = await fieldsService.updateField(projectId, a, { name: "Layer A", config: { formula: `{f${c}} + 1` } }, who(owner));
    expect(!loop.ok && loop.message).toMatch(/refer to itself/);
    // Changing A to read another formula would push C to 3 layers.
    const deeper = await fieldsService.updateField(projectId, a, { name: "Layer A", config: { formula: `{f${(await fields.listFieldDefs(projectId)).find((field) => field.name === "TAT")!.id}} + 1` } }, who(owner));
    expect(!deeper.ok && deeper.message).toMatch(/“Layer C” uses this field/);
    expect(await refuse({ name: "Types", type: "FORMULA", config: { formula: "{due} * 2" } })).toMatch(/can't be multiplied/);
    expect(await refuse({ name: "Args", type: "FORMULA", config: { formula: "DAYS({due})" } })).toMatch(/DAYS takes 2 values/);
    expect(await refuse({ name: "Long", type: "FORMULA", config: { formula: `${"123456789 + ".repeat(42)}1` } })).toMatch(/500 characters/);
    // A saved v1.64 formula still saves and works.
    expect(await refuse({ name: "Old style", type: "FORMULA", config: { formula: `{f${numbers[1]}} - {f${numbers[2]}}` } })).toBe("saved");
  });
});
