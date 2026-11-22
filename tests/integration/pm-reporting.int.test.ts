import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import * as work from "@/server/work/service";
import * as fieldsService from "@/server/work/fields-service";
import * as reporting from "@/server/work/reporting-service";
import * as reports from "@/lib/db/repositories/reporting.repository";
import { listFieldDefs } from "@/lib/db/repositories/fields.repository";
import { workViewer } from "@/server/work/task-access";
import { changeTabs } from "@/server/work/view-tabs-service";
import { chartConfigSchema } from "@/server/work/reporting";
import type { ModuleCode } from "@/server/modules/modules";
import { createUser } from "./helpers";

// v1.67.0 (D-375, PM phase D part 1) through the services: the switch, the
// 8 default widgets, figures worked out by SQL (and formulas in code), the
// time-entry source, widget add/save/move/remove with permissions and the
// 20-widget limit, figures limited to tasks the person may see, capacity and
// the Workload grid.
const tag = Date.now().toString(36);
const ALL: ModuleCode[] = ["APPROVAL", "TASK", "PROJECT"];
const who = (id: number, modules: ModuleCode[] = ALL) => ({ id, name: `R${id}`, roles: ["USER"] as string[], modules, sessionId: "pm-reporting", ipAddress: null });
const db = () => getDbPool();
const setting = (key: string, value: string) =>
  db().query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES (?, 'FEATURES', 'STRING', FALSE, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, value]);
let owner: number;
let editor: number;
let viewerOnly: number;
let outsider: number;
let projectId: number;
let sectionA: number;
let sectionB: number;
let cost: number;
let margin: number;
let timer: number;
const ids: Record<string, number> = {};

const task = async (title: string, due: string, sectionId: number, assignee: number) => {
  const added = await work.quickAddTask({ title, projectId, sectionId, parentId: null, assigneeId: null, dueDay: "", mySectionId: null }, who(owner));
  if (!added.ok) throw new Error(added.message);
  await db().query("UPDATE tasks SET assignee_id = ?, due_at = ? WHERE id = ?", [assignee, `${due} 12:00:00`, added.value.id]);
  return added.value.id;
};
const preview = async (partial: Record<string, unknown>, as = owner) => {
  const result = await reporting.previewChart(projectId, chartConfigSchema.parse(partial), who(as));
  if (!result.ok) throw new Error(result.message);
  return result.value;
};
const byLabel = (data: Awaited<ReturnType<typeof preview>>, series = 0) => Object.fromEntries(data.categories.map((category, index) => [category.label, data.values[series]![index]]));

beforeAll(async () => {
  await setting("features.pm_reporting", "ON");
  await setting("features.pm_planning", "ON");
  owner = await createUser({ name: `Rep owner ${tag}` });
  editor = await createUser({ name: `Rep editor ${tag}` });
  viewerOnly = await createUser({ name: `Rep viewer ${tag}` });
  outsider = await createUser({ name: `Rep outsider ${tag}` });
  const created = await work.createProject({ name: `Reporting ${tag}`, description: "", color: "blue", privacy: "PRIVATE", departmentId: null, defaultAccessRole: "EDITOR", defaultView: "LIST", startOn: "", dueOn: "" }, who(owner));
  if (!created.ok) throw new Error(created.message);
  projectId = created.value.id;
  expect((await work.setMember(projectId, { type: "USER", id: editor }, "EDITOR", who(owner))).ok).toBe(true);
  expect((await work.setMember(projectId, { type: "USER", id: viewerOnly }, "VIEWER", who(owner))).ok).toBe(true);
  const [sections] = await db().query<RowDataPacket[]>("SELECT id FROM project_sections WHERE project_id = ? ORDER BY position, id", [projectId]);
  sectionA = Number(sections[0]!.id);
  const added = await work.addSection(projectId, "Later work", sectionA, who(owner));
  if (!added.ok) throw new Error(added.message);
  sectionB = added.value.id;
  const field = async (input: Record<string, unknown>) => {
    const result = await fieldsService.createField(projectId, input, who(owner));
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  };
  cost = await field({ name: "Cost", type: "NUMBER" });
  margin = await field({ name: "Double cost", type: "FORMULA", config: { formula: `{f${cost}} * 2` } });
  timer = await field({ name: "Time spent", type: "TIMER" });
  // 6 tasks: A1 done, A2 overdue, A3 open (owner); B1, B2 open (editor); B3 the outsider's own.
  ids.a1 = await task(`A1 ${tag}`, "2027-03-01", sectionA, owner);
  ids.a2 = await task(`A2 ${tag}`, "2026-01-05", sectionA, owner);
  ids.a3 = await task(`A3 ${tag}`, "2027-03-03", sectionA, owner);
  ids.b1 = await task(`B1 ${tag}`, "2027-03-02", sectionB, editor);
  ids.b2 = await task(`B2 ${tag}`, "2027-03-02", sectionB, editor);
  ids.b3 = await task(`B3 ${tag}`, "2027-03-04", sectionB, outsider);
  await db().query("UPDATE tasks SET status = 'COMPLETED', completed_at = UTC_TIMESTAMP() WHERE id = ?", [ids.a1]);
  for (const [id, value] of [
    [ids.a1, 10],
    [ids.a3, 30],
    [ids.b1, 5],
  ] as const)
    expect((await fieldsService.setFieldValue(id, cost, String(value), who(owner))).ok).toBe(true);
  // Two stopped timer runs on B1: the editor 2 h, the owner 1 h.
  await db().query("INSERT INTO task_field_timer_runs (task_id, field_id, user_id, started_at, stopped_at) VALUES (?, ?, ?, '2026-11-02 04:00:00', '2026-11-02 06:00:00'), (?, ?, ?, '2026-11-03 04:00:00', '2026-11-03 05:00:00')", [ids.b1, timer, editor, ids.b1, timer, owner]);
});
afterAll(async () => {
  await db().query("DELETE FROM system_settings WHERE setting_key IN ('features.pm_reporting', 'features.pm_planning')");
});

describe("the switch and the default widgets", () => {
  it("refuses everything with the switch off", async () => {
    await setting("features.pm_reporting", "OFF");
    try {
      expect(await reporting.loadDashboard(projectId, who(owner))).toMatchObject({ ok: false, message: "Dashboards and Workload aren't switched on yet." });
      expect((await reporting.saveWidget(projectId, { kind: "TEXT", title: "x", body: "y" }, who(owner))).ok).toBe(false);
      expect((await reporting.loadWorkload(projectId, who(owner), {})).ok).toBe(false);
      expect((await reporting.saveCapacity(projectId, { userId: null, metric: "count", perDay: 3 }, who(owner))).ok).toBe(false);
      expect((await changeTabs(projectId, { op: "add", type: "DASHBOARD" }, who(owner), await workViewer(who(owner)))).ok).toBe(false);
    } finally {
      await setting("features.pm_reporting", "ON");
    }
    expect((await changeTabs(projectId, { op: "add", type: "DASHBOARD" }, who(owner), await workViewer(who(owner)))).ok).toBe(true);
    expect((await changeTabs(projectId, { op: "add", type: "WORKLOAD" }, who(owner), await workViewer(who(owner)))).ok).toBe(true);
  });
  it("writes the 8 default widgets once and works out their figures", async () => {
    const first = await reporting.loadDashboard(projectId, who(viewerOnly));
    const again = await reporting.loadDashboard(projectId, who(owner));
    if (!first.ok || !again.ok) throw new Error("load failed");
    expect(again.value.widgets.map((widget) => widget.id)).toEqual(first.value.widgets.map((widget) => widget.id));
    const totals = Object.fromEntries(again.value.widgets.filter((widget) => widget.config?.style === "number").map((widget) => [widget.title, widget.data?.total]));
    expect(totals).toEqual({ "Total completed tasks": 1, "Total incomplete tasks": 5, "Total overdue tasks": 1, "Total tasks": 6 });
    const bySection = again.value.widgets.find((widget) => widget.title === "Incomplete tasks by section")!;
    expect(bySection.data!.values[0]).toEqual([2, 3]);
    expect(bySection.filters).toBe(2);
    expect(first.value.canEdit).toBe(false);
    expect(again.value.canEdit).toBe(true);
    expect(await reporting.loadDashboard(projectId, who(outsider))).toMatchObject({ ok: false, message: "Not found." });
    // Without the Projects module (D-308) the project isn't seen.
    expect((await reporting.loadDashboard(projectId, who(owner, ["APPROVAL", "TASK"]))).ok).toBe(false);
  });
});

describe("figures", () => {
  it("counts, stacks, sums and averages by SQL", async () => {
    expect(byLabel(await preview({ style: "bar", x: { by: "assignee" } }))).toMatchObject({ [`Rep owner ${tag}`]: 3, [`Rep editor ${tag}`]: 2, [`Rep outsider ${tag}`]: 1 });
    const stacked = await preview({ style: "stacked", x: { by: "section" }, series: { by: "completion" } });
    expect(stacked.series.map((series) => series.label)).toEqual(["Completed", "Incomplete"]);
    expect(stacked.values).toEqual([
      [1, 0],
      [2, 3],
    ]);
    const money = await preview({ style: "grouped", x: { by: "section" }, metrics: [{ measure: "sum", fieldId: cost }, { measure: "avg", fieldId: cost }] });
    expect(money.values).toEqual([
      [40, 5],
      [20, 5],
    ]);
    expect(byLabel(await preview({ style: "donut", x: { by: "dueStatus" } }))).toMatchObject({ Overdue: 1, Done: 1 });
  });
  it("works formulas out in code, with the same filters", async () => {
    const doubled = await preview({ style: "bar", x: { by: "section" }, metrics: [{ measure: "sum", fieldId: margin }] });
    expect(doubled.values[0]).toEqual([80, 10]);
    const filtered = await preview({ style: "number", filters: { fields: [{ fieldId: margin, op: "gt", value: "15" }] } });
    expect(filtered.total).toBe(2); // A1 (20) and A3 (60)
    const sqlFilter = await preview({ style: "number", filters: { completion: "open", fields: [{ fieldId: cost, op: "notEmpty", value: "" }] } });
    expect(sqlFilter.total).toBe(2); // A3 and B1
  });
  it("time entries add up the timer runs by the person who logged them", async () => {
    const hours = await preview({ style: "bar", source: "time", x: { by: "person" }, metrics: [{ measure: "sum" }] });
    expect(byLabel(hours)).toEqual({ [`Rep editor ${tag}`]: 2, [`Rep owner ${tag}`]: 1 });
    expect(hours.formats[0]).toEqual({ kind: "hours" });
  });
  it("burnup counts every task by the day it was made, completed when it was done", async () => {
    const up = await preview({ style: "burnup", range: "14d" });
    expect(up.values[0]!.at(-1)).toBe(6);
    expect(up.values[1]!.at(-1)).toBe(1);
  });
  it("only counts tasks the person may see (the SQL visibility clause)", async () => {
    const spec = (viewerId: number) =>
      workViewer(who(viewerId)).then((viewer) => ({ projectId, viewer, today: "2026-11-22", config: chartConfigSchema.parse({ style: "number" }), fields: new Map(), xUnit: null, codeFilterIds: new Set<number>() }));
    const outsiderRows = await reports.groupedFigures(await spec(outsider));
    expect(outsiderRows.reduce((sum, row) => sum + row.tasks, 0)).toBe(1); // only their own task (B3)
    const ownerRows = await reports.groupedFigures(await spec(owner));
    expect(ownerRows.reduce((sum, row) => sum + row.tasks, 0)).toBe(6);
  });
});

describe("widgets", () => {
  it("owners and editors add, save, move and remove; viewers and outsiders can't", async () => {
    const chart = { kind: "CHART" as const, title: "Cost by section", config: { style: "bar", x: { by: "section" }, metrics: [{ measure: "sum", fieldId: cost }] } };
    expect(await reporting.saveWidget(projectId, chart, who(viewerOnly))).toMatchObject({ ok: false, message: "Only the project's owners and editors change its dashboard." });
    expect(await reporting.saveWidget(projectId, chart, who(outsider))).toMatchObject({ ok: false, message: "Not found." });
    expect((await reporting.saveWidget(projectId, { ...chart, config: { style: "bar" } }, who(editor))).ok).toBe(false);
    expect((await reporting.saveWidget(projectId, { ...chart, title: "  " }, who(editor))).ok).toBe(false);
    const added = await reporting.saveWidget(projectId, chart, who(editor));
    if (!added.ok) throw new Error(added.message);
    const text = await reporting.saveWidget(projectId, { kind: "TEXT", title: "Read me", body: "See https://example.test" }, who(owner));
    expect(text.ok).toBe(true);
    const stored = (await reports.findWidget(added.value.id))!;
    expect(stored.config).toMatchObject({ style: "bar", metrics: [{ measure: "sum", fieldId: cost }] });
    // Save with the row version; a stale one is refused.
    expect((await reporting.saveWidget(projectId, { ...chart, id: stored.id, title: "Spend", size: "FULL", rowVersion: stored.rowVersion }, who(owner))).ok).toBe(true);
    expect(await reporting.saveWidget(projectId, { ...chart, id: stored.id, rowVersion: stored.rowVersion }, who(owner))).toMatchObject({ ok: false });
    expect((await reports.findWidget(stored.id))).toMatchObject({ title: "Spend", size: "FULL" });
    // Move: the same widgets, each once.
    const order = (await reports.listWidgets(projectId)).map((widget) => widget.id);
    const moved = [stored.id, ...order.filter((id) => id !== stored.id)];
    expect((await reporting.moveWidgets(projectId, moved, who(viewerOnly))).ok).toBe(false);
    expect((await reporting.moveWidgets(projectId, moved.slice(1), who(editor))).ok).toBe(false);
    expect((await reporting.moveWidgets(projectId, moved, who(editor))).ok).toBe(true);
    expect((await reports.listWidgets(projectId)).map((widget) => widget.id)).toEqual(moved);
    // Remove.
    expect((await reporting.removeWidget(projectId, stored.id, who(viewerOnly))).ok).toBe(false);
    expect((await reporting.removeWidget(projectId, stored.id, who(editor))).ok).toBe(true);
    expect(await reports.findWidget(stored.id)).toBeNull();
    const [audit] = await db().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'WORK_DASHBOARD_CHANGED' AND entity_id = ?", [String(projectId)]);
    expect(Number(audit[0]!.n)).toBeGreaterThanOrEqual(4);
  });
  it("keeps to 20 widgets a dashboard", async () => {
    const count = (await reports.listWidgets(projectId)).length;
    for (let index = count; index < 20; index += 1) expect((await reporting.saveWidget(projectId, { kind: "TEXT", title: `Note ${index}`, body: "x" }, who(owner))).ok).toBe(true);
    expect(await reporting.saveWidget(projectId, { kind: "TEXT", title: "One more", body: "x" }, who(owner))).toMatchObject({ ok: false, message: "A dashboard has at most 20 widgets. Remove one first." });
  });
  it("a chart whose field was removed shows a message instead of failing", async () => {
    const widgets = await reports.listWidgets(projectId);
    await reporting.removeWidget(projectId, widgets.at(-1)!.id, who(owner));
    const added = await reporting.saveWidget(projectId, { kind: "CHART", title: "By temp", config: { style: "number", metrics: [{ measure: "sum", fieldId: cost }] } }, who(owner));
    if (!added.ok) throw new Error(added.message);
    expect((await fieldsService.removeFieldFromProject(projectId, cost, who(owner))).ok).toBe(true);
    try {
      const loaded = await reporting.loadDashboard(projectId, who(owner));
      expect(loaded.ok && loaded.value.widgets.find((widget) => widget.id === added.value.id)).toMatchObject({ data: null, error: expect.stringContaining("number, formula or timer") });
    } finally {
      expect((await fieldsService.addBackField(projectId, cost, who(owner))).ok).toBe(true);
    }
    expect((await listFieldDefs(projectId)).some((field) => field.id === cost)).toBe(true);
  });
});

describe("Workload and capacity", () => {
  it("counts each person's open tasks per day against capacity, and over capacity", async () => {
    // Four more open tasks for the editor on Tue 2 Mar 2027: six that day.
    for (let index = 0; index < 4; index += 1) await task(`Load ${index} ${tag}`, "2027-03-02", sectionB, editor);
    const loaded = await reporting.loadWorkload(projectId, who(viewerOnly), { from: "2027-03-01", unit: "day" });
    if (!loaded.ok) throw new Error(loaded.message);
    const view = loaded.value;
    expect(view.canEdit).toBe(false);
    expect(view.columns[0]!.key).toBe("2027-03-01");
    const column = view.columns.findIndex((item) => item.key === "2027-03-02");
    const editorRow = view.people.find((person) => person.id === editor)!;
    expect(editorRow.cells[column]).toMatchObject({ load: 6, capacity: view.columns[column]!.workDays ? 5 : 0, state: "over" });
    expect(editorRow.cells[column]!.taskIds).toHaveLength(6);
    // The viewer is a member with nothing: listed so work can go to them.
    expect(view.people.find((person) => person.id === viewerOnly)!.cells.every((cell) => cell.state === "empty")).toBe(true);
    // Done tasks don't count (A1).
    const ownerRow = view.people.find((person) => person.id === owner)!;
    expect(ownerRow.cells[0]!.taskIds).not.toContain(ids.a1);
  });
  it("capacity: editors set the project's and a person's; viewers can't; effort fields", async () => {
    expect((await reporting.saveCapacity(projectId, { userId: null, metric: "count", perDay: 8 }, who(viewerOnly))).ok).toBe(false);
    expect((await reporting.saveCapacity(projectId, { userId: null, metric: "count", perDay: -1 }, who(editor))).ok).toBe(false);
    expect((await reporting.saveCapacity(projectId, { userId: null, metric: "f999999", perDay: 2 }, who(editor))).ok).toBe(false);
    expect((await reporting.saveCapacity(projectId, { userId: null, metric: "count", perDay: 8 }, who(editor))).ok).toBe(true);
    expect((await reporting.saveCapacity(projectId, { userId: editor, metric: "count", perDay: 6 }, who(owner))).ok).toBe(true);
    let loaded = await reporting.loadWorkload(projectId, who(owner), { from: "2027-03-01", unit: "day" });
    if (!loaded.ok) throw new Error(loaded.message);
    const column = loaded.value.columns.findIndex((item) => item.key === "2027-03-02");
    expect(loaded.value.people.find((person) => person.id === editor)).toMatchObject({ perDay: 6, own: true });
    expect(loaded.value.people.find((person) => person.id === editor)!.cells[column]!.state).toBe("ok");
    expect(loaded.value.people.find((person) => person.id === owner)).toMatchObject({ perDay: 8, own: false });
    // Back to the project's capacity.
    expect((await reporting.saveCapacity(projectId, { userId: editor, metric: "count", perDay: null }, who(owner))).ok).toBe(true);
    // Effort: the Cost field (B1 is 5 on 2 Mar).
    expect((await reporting.saveCapacity(projectId, { userId: null, metric: `f${cost}`, perDay: 4 }, who(owner))).ok).toBe(true);
    loaded = await reporting.loadWorkload(projectId, who(owner), { from: "2027-03-01", unit: "week", metric: `f${cost}` });
    if (!loaded.ok) throw new Error(loaded.message);
    expect(loaded.value.metricLabel).toBe("Cost");
    expect(loaded.value.people.find((person) => person.id === editor)!.cells[0]!.load).toBe(5);
    expect(loaded.value.columns).toHaveLength(8);
  });
});
