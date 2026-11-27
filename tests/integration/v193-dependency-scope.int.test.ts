import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDbPool } from "@/lib/db/client";
import * as work from "@/server/work/service";
import * as schedule from "@/server/work/schedule-service";
import * as portfolios from "@/server/work/portfolios";
import { listDependencies } from "@/lib/db/repositories/work.repository";
import { OUT_OF_SCOPE } from "@/server/work/dependency-scope";
import type { ModuleCode } from "@/server/modules/modules";
import { createUser, workingDayFrom } from "./helpers";

// v1.93.0 (D-449, owner 27 Nov 2026, "Picker filtered"; supersedes BR-PROJ-041):
// a task's dependency search lists its own project's tasks; widened, the
// projects of its portfolio(s) (nested ones too) while pm_portfolios is on; a
// task in no project lists the person's own tasks in no project. The server
// refuses a new link outside the scope; links made before stay valid.
const tag = Date.now().toString(36);
const ALL: ModuleCode[] = ["APPROVAL", "TASK", "PROJECT"];
const who = (id: number) => ({ id, name: `D${id}`, roles: ["USER"] as string[], modules: ALL, sessionId: "v193-dep-scope", ipAddress: null });
const db = () => getDbPool();
const setting = (key: string, value: string) =>
  db().query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES (?, 'FEATURES', 'STRING', FALSE, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, value]);
let owner: number;
let other: number;
const ids: Record<string, number> = {};

const newProject = async (name: string) => {
  const created = await work.createProject({ name: `${name} ${tag}`, description: "", color: "blue", privacy: "PRIVATE", departmentId: null, defaultAccessRole: "EDITOR", defaultView: "LIST", startOn: "", dueOn: "" }, who(owner));
  if (!created.ok) throw new Error(created.message);
  return created.value.id;
};
const task = async (title: string, projectId: number | null, as = owner, parentId: number | null = null) => {
  const added = await work.quickAddTask({ title: `Dep ${tag} ${title}`, projectId, sectionId: null, parentId, assigneeId: null, dueDay: await workingDayFrom(10), mySectionId: null }, who(as));
  if (!added.ok) throw new Error(added.message);
  return added.value.id;
};
const newPortfolio = async (name: string) => {
  const created = await portfolios.createPortfolio({ name: `${name} ${tag}` }, who(owner));
  if (!created.ok) throw new Error(created.message);
  return created.value.id;
};
const titles = async (taskId: number | null, wide = false, as = owner) => {
  const found = await schedule.dependencyTargets(`Dep ${tag}`, who(as), taskId, wide);
  if (!found.ok) throw new Error(found.message);
  return { ...found.value, names: found.value.items.map((item) => item.title.replace(`Dep ${tag} `, "")) };
};
const link = (pred: number, succ: number, type = "FS") => schedule.setTypedDependency({ taskId: succ, otherId: pred, role: "BLOCKED_BY", type, on: true }, who(owner));

beforeAll(async () => {
  await setting("features.pm_planning", "ON");
  await setting("features.pm_portfolios", "ON");
  owner = await createUser({ name: `Dep owner ${tag}` });
  other = await createUser({ name: `Dep other ${tag}` });
  const a = await newProject("Alpha");
  const b = await newProject("Beta");
  const c = await newProject("Gamma");
  const d = await newProject("Delta");
  const top = await newPortfolio("Programme");
  const nested = await newPortfolio("Nested");
  for (const [portfolio, item] of [
    [top, { projectId: a }],
    [top, { projectId: b }],
    [top, { portfolioId: nested }],
    [nested, { projectId: d }],
  ] as const) {
    const added = await portfolios.addWork(portfolio, item, who(owner));
    if (!added.ok) throw new Error(added.message);
  }
  ids.a1 = await task("a1", a);
  ids.a2 = await task("a2", a);
  ids.b1 = await task("b1", b);
  ids.c1 = await task("c1", c);
  ids.d1 = await task("d1", d);
  ids.loose1 = await task("loose1", null);
  ids.loose2 = await task("loose2", null);
  ids.sub = await task("sub", null, owner, ids.a1);
  ids.othersLoose = await task("othersLoose", null, other);
});
afterAll(async () => {
  await db().query("DELETE FROM system_settings WHERE setting_key IN ('features.pm_portfolios')");
});

describe("v1.93.0 dependency picker scope (D-449)", () => {
  it("lists the task's own project first, and can widen to its portfolio (nested portfolios too)", async () => {
    const narrow = await titles(ids.a1!);
    expect(narrow).toMatchObject({ kind: "PROJECT", wide: false, canWiden: true, note: "Tasks in this task's project." });
    expect(narrow.names).toContain("a2");
    for (const name of ["b1", "c1", "d1", "loose1", "a1"]) expect(narrow.names).not.toContain(name);
    const wide = await titles(ids.a1!, true);
    expect(wide).toMatchObject({ wide: true, note: "Tasks in this task's portfolio." });
    expect(wide.names).toEqual(expect.arrayContaining(["a2", "b1", "d1"]));
    expect(wide.names).not.toContain("c1");
    expect(wide.names).not.toContain("loose1");
    // The task's own project comes first.
    expect(wide.names.indexOf("a2")).toBeLessThan(wide.names.indexOf("b1"));
  });

  it("a project in no portfolio can't widen; with pm_portfolios off nothing widens", async () => {
    expect(await titles(ids.c1!, true)).toMatchObject({ canWiden: false, wide: false });
    await setting("features.pm_portfolios", "OFF");
    try {
      const off = await titles(ids.a1!, true);
      expect(off).toMatchObject({ canWiden: false, wide: false });
      expect(off.names).not.toContain("b1");
      expect((await link(ids.b1!, ids.a1!)).ok).toBe(false);
    } finally {
      await setting("features.pm_portfolios", "ON");
    }
  });

  it("a task in no project lists only the person's own tasks in no project", async () => {
    const loose = await titles(ids.loose1!);
    expect(loose).toMatchObject({ kind: "OWN", canWiden: false });
    expect(loose.names).toContain("loose2");
    for (const name of ["a2", "b1", "othersLoose", "sub"]) expect(loose.names).not.toContain(name);
  });

  it("a subtask uses its top task's project", async () => {
    const sub = await titles(ids.sub!);
    expect(sub.kind).toBe("PROJECT");
    expect(sub.names).toEqual(expect.arrayContaining(["a1", "a2"]));
    expect(sub.names).not.toContain("loose1");
  });

  it("the server refuses a new link outside the scope (typed and legacy), and allows one inside", async () => {
    expect(await link(ids.c1!, ids.a1!)).toMatchObject({ ok: false, message: OUT_OF_SCOPE });
    expect(await link(ids.a2!, ids.loose1!)).toMatchObject({ ok: false, message: OUT_OF_SCOPE });
    const c1No = (await db().query<import("mysql2/promise").RowDataPacket[]>("SELECT task_no FROM tasks WHERE id = ?", [ids.c1]))[0][0]!.task_no as string;
    expect(await work.setDependency(ids.a1!, c1No, true, who(owner))).toMatchObject({ ok: false, message: OUT_OF_SCOPE });
    expect((await link(ids.b1!, ids.a1!)).ok).toBe(true); // same portfolio
    expect((await link(ids.d1!, ids.a2!)).ok).toBe(true); // nested portfolio
    expect((await link(ids.loose2!, ids.loose1!)).ok).toBe(true); // own, both in no project
    expect((await schedule.setTypedDependency({ taskId: ids.a1!, otherId: ids.c1!, role: "BLOCKING", type: "FS", on: true }, who(owner))).ok).toBe(false);
  });

  it("a link made before outside the scope stays shown, can change type and be removed", async () => {
    await db().query("INSERT INTO task_dependencies (blocker_task_id, blocked_task_id, dep_type, created_by) VALUES (?, ?, 'FS', ?)", [ids.c1, ids.a2, owner]);
    expect((await listDependencies(ids.a2!)).blockedBy.map((item) => item.id)).toContain(ids.c1);
    expect(await link(ids.c1!, ids.a2!, "SS")).toMatchObject({ ok: true, value: { type: "SS" } });
    expect((await schedule.setTypedDependency({ taskId: ids.a2!, otherId: ids.c1!, role: "BLOCKED_BY", type: "SS", on: false }, who(owner))).ok).toBe(true);
    expect((await listDependencies(ids.a2!)).blockedBy.map((item) => item.id)).not.toContain(ids.c1);
  });

  it("someone who can't see the task gets nothing", async () => {
    expect((await schedule.dependencyTargets(`Dep ${tag}`, who(other), ids.a1!)).ok).toBe(false);
  });
});
