import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import * as work from "@/server/work/service";
import * as repo from "@/lib/db/repositories/work.repository";
import { actOnTask } from "@/server/modules/tasks";
import { findTask } from "@/lib/db/repositories/tasks.repository";
import { changeMyTabs, changeTabs } from "@/server/work/view-tabs-service";
import { workViewer } from "@/server/work/task-access";
import { buildStrip, MY_TASKS_VIEWS } from "@/server/work/view-tabs";
import { promoteForUser, runMyTaskRules, saveRules, startMySections, mySectionChoice } from "@/server/work/my-rules";
import { loadTaskSummary } from "@/server/work/task-summary";
import { addDays, indiaDay } from "@/server/work/rules";
import { EVERY_DAY } from "@/server/work/schedule";
import type { ModuleCode } from "@/server/modules/modules";
import { createUser } from "./helpers";

// v1.76.0 (D-401): Task Summary release 1 against the database: personal
// sections and placement, the nightly rules (idempotent), reassignment back
// into Recently assigned, the range per tab, duplicate personal tab names,
// and nobody seeing anyone else's sections.
const tag = Date.now().toString(36);
const ALL: ModuleCode[] = ["APPROVAL", "TASK", "PROJECT"];
const person = (id: number) => ({ id, name: `P${id}`, roles: ["USER"] as string[], modules: ALL, sessionId: "ts-r1", ipAddress: null });
const now = new Date();
const today = indiaDay(now);
let me: number;
let boss: number;
let other: number;

const add = async (title: string, assignee: number, dueDay: string, by = boss) => {
  const created = await work.quickAddTask({ title: `${title} ${tag}`, projectId: null, sectionId: null, parentId: null, assigneeId: assignee, dueDay, mySectionId: null, holidayOk: true }, person(by));
  if (!created.ok) throw new Error(created.message);
  return created.value.id;
};
const sectionOf = async (userId: number, taskId: number) => {
  const data = await loadTaskSummary(userId, { range: "all", recentOn: true, mine: true, now });
  const row = data.rows.find((item) => item.id === taskId);
  return row ? data.mySections!.find((section) => section.id === row.mySectionId)?.system ?? data.mySections!.find((section) => section.id === row.mySectionId)?.name : null;
};

beforeAll(async () => {
  boss = await createUser({ name: `TS boss ${tag}` });
  me = await createUser({ name: `TS me ${tag}`, managerId: boss });
  other = await createUser({ name: `TS other ${tag}`, managerId: boss });
});
afterAll(async () => {
  await getDbPool().end();
});

describe("range per tab", () => {
  it("Summary window leaves out tasks due after 7 days (unless just given); All my open tasks lists them", async () => {
    const far = await add("Far away", me, addDays(today, 40), me);
    const summary = await loadTaskSummary(me, { range: "summary", recentOn: true, mine: false, now });
    expect(summary.rows.some((row) => row.id === far)).toBe(false);
    const all = await loadTaskSummary(me, { range: "all", recentOn: true, mine: false, now });
    expect(all.rows.some((row) => row.id === far)).toBe(true);
    expect(all.dateSections.some((section) => section.name === "Due later")).toBe(true);
  });

  it("the range is a tab setting kept apart from the view (auto-save never resets it)", async () => {
    const tabs = async () => {
      const data = await repo.listMyTabs(me);
      return buildStrip(data.rows, data.tabsSet, data.defaultView, MY_TASKS_VIEWS);
    };
    const add1 = await changeMyTabs({ op: "add", type: "LIST", name: "Pending Tasks" }, person(me));
    expect(add1.ok).toBe(true);
    const key = `t${add1.ok ? add1.value.id : 0}`;
    expect((await changeMyTabs({ op: "settings", key, range: "all" }, person(me))).ok).toBe(true);
    expect((await changeMyTabs({ op: "settings", key, range: "everything" }, person(me))).ok).toBe(false);
    expect((await changeMyTabs({ op: "save", key, config: { group: "createdBy" }, auto: true }, person(me))).ok).toBe(true);
    const row = (await repo.listMyTabs(me)).rows.find((item) => item.name === "Pending Tasks");
    expect(row?.config).toMatchObject({ group: "createdBy", range: "all" });
    expect((await tabs()).length).toBeGreaterThan(3);
  });

  it("personal tab names may repeat; project tab names stay unique; settings is personal only", async () => {
    expect((await changeMyTabs({ op: "add", type: "LIST", name: "Today's DB" }, person(me))).ok).toBe(true);
    expect(await changeMyTabs({ op: "add", type: "LIST", name: "Today's DB" }, person(me))).toMatchObject({ ok: true, message: 'Tab "Today\'s DB" added.' });
    const names = (await repo.listMyTabs(me)).rows.map((row) => row.name);
    expect(names.filter((name) => name === "Today's DB")).toHaveLength(2);
    const project = await work.createProject({ name: `TS project ${tag}`, description: "", color: "red", privacy: "ORGANISATION", departmentId: null, defaultAccessRole: "EDITOR", defaultView: "LIST", startOn: "", dueOn: "" }, person(me));
    if (!project.ok) throw new Error(project.message);
    const viewer = await workViewer(person(me));
    expect(await changeTabs(project.value.id, { op: "add", type: "BOARD" }, person(me), viewer)).toMatchObject({ ok: true, message: 'Tab "Board (2)" added.' });
    expect((await changeTabs(project.value.id, { op: "settings", key: "vLIST", range: "all" }, person(me), viewer)).ok).toBe(false);
    // The database key still refuses a clash on a project.
    await expect(getDbPool().query("INSERT INTO work_views (scope, scope_id, name, config_json, created_by) VALUES ('PROJECT', ?, 'Board', '{}', ?)", [project.value.id, me])).rejects.toThrow(/Duplicate/);
  });
});

describe("My sections", () => {
  it("new work lands in Recently assigned and stays there; placing moves it; deleting a section sends it back", async () => {
    await startMySections(me, now);
    const later = await add("Later work", me, addDays(today, 60));
    expect(await sectionOf(me, later)).toBe("RECENT");
    const sections = await repo.ensureMySections(me);
    const mine = await repo.insertMySection(me, `Waiting ${tag}`, 99_999);
    expect((await work.placeMine(later, mine, 5, person(me))).ok).toBe(true);
    expect(await sectionOf(me, later)).toBe(`Waiting ${tag}`);
    // Someone else's task or section can't be placed.
    expect((await work.placeMine(later, sections[0]!.id, 5, person(other))).ok).toBe(false);
    expect(await repo.deleteMySection(me, mine)).toBe(true);
    expect(await sectionOf(me, later)).toBe("RECENT");
    // Built-in sections can't be deleted.
    expect(await repo.deleteMySection(me, sections.find((section) => section.system === "RECENT")!.id)).toBe(false);
  });

  it("reassigned away and back lands in Recently assigned (not where it was)", async () => {
    const id = await add("Round trip", me, addDays(today, 20));
    const sections = await repo.ensureMySections(me);
    const laterId = sections.find((section) => section.system === "LATER")!.id;
    expect((await work.placeMine(id, laterId, 1, person(me))).ok).toBe(true);
    expect(await sectionOf(me, id)).toBe("LATER");
    for (const to of [other, me]) {
      const task = (await findTask(id))!;
      const result = await actOnTask({ taskId: id, action: "REASSIGN", rowVersion: task.rowVersion, reason: "Hand over", assigneeId: to, files: [] }, person(boss));
      expect(result.ok).toBe(true);
    }
    expect(await sectionOf(me, id)).toBe("RECENT");
  });

  it("nobody sees or changes anyone else's sections", async () => {
    const id = await add("Private order", me, addDays(today, 3));
    // The other person's summary never lists my task, nor my sections.
    const theirs = await loadTaskSummary(other, { range: "all", recentOn: true, mine: true, now });
    expect(theirs.rows.some((row) => row.id === id)).toBe(false);
    const mySections = await repo.ensureMySections(me);
    expect(theirs.mySections!.some((section) => mySections.some((one) => one.id === section.id))).toBe(false);
    // Only the assignee gets the pane's section picker.
    expect(await mySectionChoice(boss, id)).toBeNull();
    expect(await mySectionChoice(me, id)).not.toBeNull();
    // A tab of someone else's strip is not found.
    const theirTab = await changeMyTabs({ op: "add", type: "LIST", name: "Theirs" }, person(other));
    expect(theirTab.ok).toBe(true);
    expect(await changeMyTabs({ op: "settings", key: `t${theirTab.ok ? theirTab.value.id : 0}`, range: "all" }, person(me))).toEqual({ ok: false, message: "Not found." });
  });
});

describe("rules (nightly)", () => {
  it("moves due-today to Today and due-soon to Upcoming, once per due day, with a private activity note", async () => {
    const dueToday = await add("Due today", me, today);
    const dueSoon = await add("Due soon", me, addDays(today, 2));
    const dueFar = await add("Due far", me, addDays(today, 50));
    const moved = await withTransaction((db) => promoteForUser(me, today, EVERY_DAY, db));
    expect(moved).toBeGreaterThanOrEqual(2);
    expect(await sectionOf(me, dueToday)).toBe("TODAY");
    expect(await sectionOf(me, dueSoon)).toBe("UPCOMING");
    expect(await sectionOf(me, dueFar)).toBe("RECENT");
    // Idempotent: a second run moves nothing.
    expect(await withTransaction((db) => promoteForUser(me, today, EVERY_DAY, db))).toBe(0);
    // The person moves it back: it stays (once per due day).
    const recent = (await repo.ensureMySections(me)).find((section) => section.system === "RECENT")!.id;
    expect((await work.placeMine(dueToday, recent, 1, person(me))).ok).toBe(true);
    expect(await withTransaction((db) => promoteForUser(me, today, EVERY_DAY, db))).toBe(0);
    expect(await sectionOf(me, dueToday)).toBe("RECENT");
    const [events] = await getDbPool().query<RowDataPacket[]>("SELECT actor_id, body FROM task_events WHERE task_id = ? AND event_type = 'MY_SECTION_RULE'", [dueSoon]);
    expect(events).toHaveLength(1);
    expect(Number(events[0]!.actor_id)).toBe(me);
    expect(String(events[0]!.body)).toContain("Upcoming");
  });

  it("the job step runs each person once per India day", async () => {
    await getDbPool().query("UPDATE my_task_rules SET last_run_day = ? WHERE user_id = ?", [addDays(today, -1), me]);
    const first = await runMyTaskRules(now);
    expect(first.myRulePeople).toBeGreaterThanOrEqual(1);
    const [[row]] = await getDbPool().query<RowDataPacket[]>("SELECT DATE_FORMAT(last_run_day, '%Y-%m-%d') AS day FROM my_task_rules WHERE user_id = ?", [me]);
    expect(row!.day).toBe(today);
    const again = await runMyTaskRules(now);
    expect(again.myRuleMoves).toBe(0);
  });

  it("saving rules validates them and turning a rule off stops it", async () => {
    expect((await saveRules({ todayOn: true, upcomingOn: true, upcomingDays: 0 }, person(me), now)).ok).toBe(false);
    expect((await saveRules({ todayOn: false, upcomingOn: false, upcomingDays: 5 }, person(me), now)).ok).toBe(true);
    const fresh = await add("After off", me, today);
    expect(await withTransaction((db) => promoteForUser(me, today, EVERY_DAY, db))).toBe(0);
    expect(await sectionOf(me, fresh)).toBe("RECENT");
    const [audit] = await getDbPool().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'MY_TASKS_RULES_CHANGED' AND entity_id = ?", [String(me)]);
    expect(Number(audit[0]!.n)).toBe(1);
  });
});

describe("repeating tasks", () => {
  it("the next task of a series keeps its predecessor's section (BR-MYT-023)", async () => {
    const first = await add("Series one", me, addDays(today, 15));
    const next = await add("Series two", me, addDays(today, 16));
    const waiting = await repo.insertMySection(me, `Series ${tag}`, 123_456);
    expect((await work.placeMine(first, waiting, 7, person(me))).ok).toBe(true);
    await withTransaction((db) => repo.copyPlacement(first, next, me, db));
    expect(await sectionOf(me, next)).toBe(`Series ${tag}`);
    // Only the assignee's own placement is copied.
    await withTransaction((db) => repo.copyPlacement(first, next, other, db));
    const [rows] = await getDbPool().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM my_task_placements WHERE task_id = ?", [next]);
    expect(Number(rows[0]!.n)).toBe(1);
  });
});
