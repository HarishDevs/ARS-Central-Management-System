import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import * as work from "@/server/work/service";
import { listChildTasks, listProjectTabs, workDensity } from "@/lib/db/repositories/work.repository";
import { workViewer } from "@/server/work/task-access";
import { changeTabs } from "@/server/work/view-tabs-service";
import { buildStrip } from "@/server/work/view-tabs";
import type { ModuleCode } from "@/server/modules/modules";
import { createUser } from "./helpers";

// v1.61.0 (D-367, PM phase A): a project's tabs for every view. Owners and
// editors change them; commenters, viewers and outsiders can't (deny by default).
const tag = Date.now().toString(36);
const ALL: ModuleCode[] = ["APPROVAL", "TASK", "PROJECT"];
const person = (id: number) => ({ id, name: `P${id}`, roles: ["USER"] as string[], modules: ALL, sessionId: "pm-tabs", ipAddress: null });
let owner: number;
let editor: number;
let commenter: number;
let outsider: number;
let projectId: number;
let privateId: number;

const strip = async (id = projectId) => {
  const data = await listProjectTabs(id);
  return buildStrip(data.rows, data.tabsSet, data.defaultView);
};
const change = async (who: number, input: Parameters<typeof changeTabs>[1], id = projectId) => changeTabs(id, input, person(who), await workViewer(person(who)));

beforeAll(async () => {
  owner = await createUser({ name: `Tab owner ${tag}` });
  editor = await createUser({ name: `Tab editor ${tag}` });
  commenter = await createUser({ name: `Tab commenter ${tag}` });
  outsider = await createUser({ name: `Tab outsider ${tag}` });
  const created = await work.createProject({ name: `Tabs ${tag}`, description: "", color: "red", privacy: "ORGANISATION", departmentId: null, defaultAccessRole: "COMMENTER", defaultView: "BOARD", startOn: "", dueOn: "" }, person(owner));
  if (!created.ok) throw new Error(created.message);
  projectId = created.value.id;
  expect((await work.setMember(projectId, { type: "USER", id: editor }, "EDITOR", person(owner))).ok).toBe(true);
  expect((await work.setMember(projectId, { type: "USER", id: commenter }, "COMMENTER", person(owner))).ok).toBe(true);
  const hidden = await work.createProject({ name: `Private tabs ${tag}`, description: "", color: "blue", privacy: "PRIVATE", departmentId: null, defaultAccessRole: "EDITOR", defaultView: "LIST", startOn: "", dueOn: "" }, person(owner));
  if (!hidden.ok) throw new Error(hidden.message);
  privateId = hidden.value.id;
});

afterAll(async () => {
  await getDbPool().end();
});

describe("project tabs (D-367)", () => {
  it("a new project shows the five built-in views, its default view first choice, nothing stored", async () => {
    const tabs = await strip();
    expect(tabs.map((tab) => tab.key)).toEqual(["vOVERVIEW", "vLIST", "vBOARD", "vTIMELINE", "vCALENDAR"]);
    expect(tabs.find((tab) => tab.isDefault)?.type).toBe("BOARD");
    expect((await listProjectTabs(projectId)).tabsSet).toBe(false);
  });

  it("commenters, outsiders and people who can't see the project can't change tabs", async () => {
    expect(await change(commenter, { op: "add", type: "LIST" })).toMatchObject({ ok: false, message: expect.stringContaining("owners and editors") });
    // An organisation-wide project is seen by everyone, but only as a commenter.
    expect((await change(outsider, { op: "remove", key: "vLIST" })).ok).toBe(false);
    expect(await change(editor, { op: "add", type: "LIST" }, privateId)).toEqual({ ok: false, message: "Not found." });
    expect((await listProjectTabs(projectId)).tabsSet).toBe(false);
  });

  it("an editor adds a tab: the strip is written once, the new tab goes last with a unique name", async () => {
    const added = await change(editor, { op: "add", type: "BOARD" });
    expect(added).toMatchObject({ ok: true, message: 'Tab "Board (2)" added.' });
    const tabs = await strip();
    expect(tabs.map((tab) => [tab.type, tab.name])).toEqual([
      ["OVERVIEW", "Overview"],
      ["LIST", "List"],
      ["BOARD", "Board"],
      ["TIMELINE", "Timeline"],
      ["CALENDAR", "Calendar"],
      ["BOARD", "Board (2)"],
    ]);
    expect(tabs.every((tab) => tab.id !== null)).toBe(true);
    expect(tabs.find((tab) => tab.isDefault)?.name).toBe("Board");
    // Unknown views and the not-built ones are refused.
    expect((await change(editor, { op: "add", type: "GANTT" })).ok).toBe(false);
    const [audit] = await getDbPool().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'PROJECT_TABS_CHANGED' AND entity_id = ?", [String(projectId)]);
    expect(Number(audit[0]!.n)).toBeGreaterThanOrEqual(1);
  });

  it("rename (unique, 1–60 characters), set default, duplicate with its view, remove", async () => {
    const tabs = await strip();
    const list = tabs.find((tab) => tab.type === "LIST")!;
    expect((await change(owner, { op: "rename", key: list.key, name: "  Overdue   work " })).ok).toBe(true);
    expect((await change(owner, { op: "rename", key: list.key, name: "board" })).message).toBe("There is a tab with that name.");
    expect((await change(owner, { op: "rename", key: list.key, name: "" })).ok).toBe(false);
    expect((await change(owner, { op: "default", key: list.key })).ok).toBe(true);
    expect((await strip()).find((tab) => tab.isDefault)?.name).toBe("Overdue work");

    // Save a view on it, then duplicate: the copy sits right after it with the same view.
    const saved = await change(editor, { op: "save", key: list.key, config: { group: "assignee", sort: "modified", hideEmpty: true } });
    expect(saved.ok).toBe(true);
    expect((await change(editor, { op: "save", key: list.key, config: { sort: "nonsense" } })).ok).toBe(false);
    const copy = await change(editor, { op: "duplicate", key: list.key });
    expect(copy.ok).toBe(true);
    const after = await strip();
    const at = after.findIndex((tab) => tab.id === list.id);
    expect(after[at + 1]?.name).toBe("Overdue work (copy)");
    const rows = (await listProjectTabs(projectId)).rows;
    expect(rows.find((row) => row.name === "Overdue work (copy)")?.config).toMatchObject({ group: "assignee", sort: "modified", hideEmpty: true });

    // Removing the default moves the default to the first remaining tab.
    expect((await change(editor, { op: "remove", key: list.key })).ok).toBe(true);
    const left = await strip();
    expect(left.some((tab) => tab.id === list.id)).toBe(false);
    expect(left.filter((tab) => tab.isDefault)).toHaveLength(1);
  });

  it("reorder: the same tabs in a new order; a stale or partial order is refused", async () => {
    const tabs = await strip();
    const reversed = [...tabs].reverse().map((tab) => tab.key);
    expect((await change(editor, { op: "reorder", keys: reversed })).ok).toBe(true);
    expect((await strip()).map((tab) => tab.key)).toEqual(reversed);
    expect((await change(editor, { op: "reorder", keys: reversed.slice(1) })).ok).toBe(false);
    expect((await change(editor, { op: "reorder", keys: ["t99999999", ...reversed.slice(1)] })).ok).toBe(false);
    expect((await change(editor, { op: "reorder", keys: ["DROP TABLE"] })).ok).toBe(false);
    expect((await change(commenter, { op: "reorder", keys: tabs.map((tab) => tab.key) })).ok).toBe(false);
  });

  it("a project keeps at least one tab", async () => {
    let tabs = await strip();
    for (const tab of tabs.slice(1)) expect((await change(owner, { op: "remove", key: tab.key })).ok).toBe(true);
    tabs = await strip();
    expect(tabs).toHaveLength(1);
    expect(await change(owner, { op: "remove", key: tabs[0]!.key })).toMatchObject({ ok: false, message: "A project keeps at least one tab." });
  });

  it("the 50-tab cap", async () => {
    for (let index = (await strip()).length; index < 50; index += 1) expect((await change(owner, { op: "add", type: "CALENDAR" })).ok).toBe(true);
    expect(await change(owner, { op: "add", type: "CALENDAR" })).toMatchObject({ ok: false, message: "At most 50 tabs." });
  });

  it("row density is a personal preference (Comfortable by default)", async () => {
    expect(await workDensity(editor)).toBe("COMFORTABLE");
    await getDbPool().query("INSERT INTO user_settings (user_id, setting_key, value) VALUES (?, 'work.density', 'COMPACT')", [editor]);
    expect(await workDensity(editor)).toBe("COMPACT");
    expect(await workDensity(owner)).toBe("COMFORTABLE");
  });

  it("subtasks of many tasks load at once for the List", async () => {
    const parent = await work.quickAddTask({ title: `Parent ${tag}`, projectId, sectionId: null, parentId: null, assigneeId: owner, dueDay: "", mySectionId: null }, person(owner));
    if (!parent.ok) throw new Error(parent.message);
    const child = await work.quickAddTask({ title: `Child ${tag}`, projectId: null, sectionId: null, parentId: parent.value.id, assigneeId: owner, dueDay: "", mySectionId: null }, person(owner));
    expect(child.ok).toBe(true);
    const children = await listChildTasks([parent.value.id]);
    expect(children.map((item) => [item.parentTaskId, item.title])).toEqual([[parent.value.id, `Child ${tag}`]]);
    expect(children[0]!.updatedAt).toBeInstanceOf(Date);
  });
});
