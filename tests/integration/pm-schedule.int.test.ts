import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import * as work from "@/server/work/service";
import * as schedule from "@/server/work/schedule-service";
import { findTask } from "@/lib/db/repositories/tasks.repository";
import { listDependencies, listProjectTasks } from "@/lib/db/repositories/work.repository";
import { afterTaskCompleted } from "@/server/work/on-complete";
import { indiaDay } from "@/server/work/rules";
import type { ModuleCode } from "@/server/modules/modules";
import { createUser } from "./helpers";

// v1.65.0 (D-373, PM phase B part 2) through the services: typed
// dependencies (types, cycles, the cap, permissions, the switch), auto-shift
// in one transaction (keep the gap, use up the slack, off), Undo (only by the
// mover, once), project scheduling settings (owners only), the fuller status
// update (highlights, recipients) and the weekly reminder job.
const tag = Date.now().toString(36);
const ALL: ModuleCode[] = ["APPROVAL", "TASK", "PROJECT"];
const who = (id: number, name = `S${id}`) => ({ id, name, roles: ["USER"] as string[], modules: ALL, sessionId: "pm-schedule", ipAddress: null });
const db = () => getDbPool();
const setting = (key: string, value: string) =>
  db().query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES (?, 'FEATURES', 'STRING', FALSE, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, value]);
let owner: number;
let editor: number;
let viewerOnly: number;
let outsider: number;
let projectId: number;

const task = async (title: string, start: string | null, due: string, as = owner) => {
  const added = await work.quickAddTask({ title, projectId, sectionId: null, parentId: null, assigneeId: null, dueDay: "", mySectionId: null }, who(as));
  if (!added.ok) throw new Error(added.message);
  const set = await work.setTaskFields(added.value.id, { dueDay: due, ...(start ? { startDay: start } : {}), holidayOk: true }, who(as));
  if (!set.ok) throw new Error(set.message);
  return added.value.id;
};
const dates = async (id: number) => {
  const found = (await findTask(id))!;
  return { start: found.startsOn, due: indiaDay(found.dueAt!) };
};
// Messages queued for a person whose title starts with `prefix`.
const titles = async (userId: number, prefix: string) => {
  const [rows] = await db().query<RowDataPacket[]>(
    "SELECT JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.title')) AS title FROM notification_outbox WHERE JSON_EXTRACT(payload_json, '$.userId') = ? AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.title')) LIKE ? ORDER BY id",
    [userId, `${prefix}%`],
  );
  return rows.map((row) => String(row.title));
};
const link = (pred: number, succ: number, type = "FS", as = owner) => schedule.setTypedDependency({ taskId: succ, otherId: pred, role: "BLOCKED_BY", type, on: true }, who(as));
const mode = (value: string, skip = false) => db().query("UPDATE projects SET shift_mode = ?, shift_skip_off_days = ? WHERE id = ?", [value, skip, projectId]);

beforeAll(async () => {
  await setting("features.pm_planning", "ON");
  owner = await createUser({ name: `Sch owner ${tag}` });
  editor = await createUser({ name: `Sch editor ${tag}` });
  viewerOnly = await createUser({ name: `Sch viewer ${tag}` });
  outsider = await createUser({ name: `Sch outsider ${tag}` });
  const created = await work.createProject({ name: `Schedule ${tag}`, description: "", color: "blue", privacy: "PRIVATE", departmentId: null, defaultAccessRole: "EDITOR", defaultView: "LIST", startOn: "", dueOn: "" }, who(owner));
  if (!created.ok) throw new Error(created.message);
  projectId = created.value.id;
  expect((await work.setMember(projectId, { type: "USER", id: editor }, "EDITOR", who(owner))).ok).toBe(true);
  expect((await work.setMember(projectId, { type: "USER", id: viewerOnly }, "VIEWER", who(owner))).ok).toBe(true);
});
afterAll(async () => {
  await db().query("DELETE FROM system_settings WHERE setting_key = 'features.pm_planning'");
});

describe("typed dependencies", () => {
  it("adds FS by default, changes the type, writes stories, and refuses loops", async () => {
    const a = await task(`A ${tag}`, null, "2027-03-01");
    const b = await task(`B ${tag}`, null, "2027-03-03");
    const added = await schedule.setTypedDependency({ taskId: b, otherId: a, role: "BLOCKED_BY", type: "", on: true }, who(owner));
    expect(added.ok).toBe(true);
    expect((await listDependencies(b)).blockedBy).toEqual([expect.objectContaining({ id: a, type: "FS", lag: 0 })]);
    expect((await link(a, b, "SS")).ok).toBe(true);
    expect((await listDependencies(a)).blocking[0]).toMatchObject({ id: b, type: "SS" });
    const [events] = await db().query<RowDataPacket[]>("SELECT body FROM task_events WHERE task_id = ? AND event_type = 'DEPENDENCY_ADDED' ORDER BY id", [b]);
    expect(events.map((row) => String(row.body))).toEqual([expect.stringContaining("Marked this task as blocked by"), expect.stringContaining("Start to start")]);
    // A loop: A waits for B (from A's side, "blocking" the other way round).
    const loop = await schedule.setTypedDependency({ taskId: a, otherId: b, role: "BLOCKED_BY", type: "FS", on: true }, who(owner));
    expect(loop).toMatchObject({ ok: false, message: "This would create a circular dependency." });
    expect((await schedule.setTypedDependency({ taskId: a, otherId: a, role: "BLOCKED_BY", type: "FS", on: true }, who(owner))).ok).toBe(false);
    // Remove.
    expect((await schedule.setTypedDependency({ taskId: a, otherId: b, role: "BLOCKING", type: "SS", on: false }, who(owner))).ok).toBe(true);
    expect((await listDependencies(b)).blockedBy).toEqual([]);
  });
  it("needs the planning right on the waiting task and sight of the other; deny by default", async () => {
    // D-222: a one-time task's dates are planned by its creator (here the editor made B).
    const a = await task(`P1 ${tag}`, null, "2027-03-01");
    const b = await task(`P2 ${tag}`, null, "2027-03-02", editor);
    expect((await link(a, b, "FS", viewerOnly)).ok).toBe(false);
    expect((await link(b, a, "FS", editor)).ok).toBe(false); // A is the owner's: the editor can't plan it
    expect(await link(a, b, "FS", outsider)).toMatchObject({ ok: false, message: "Not found." });
    expect((await link(a, b, "FF", editor)).ok).toBe(true);
    const mine = await work.quickAddTask({ title: `Private ${tag}`, projectId: null, sectionId: null, parentId: null, assigneeId: null, dueDay: "", mySectionId: null }, who(outsider));
    if (!mine.ok) throw new Error(mine.message);
    expect(await link(mine.value.id, b, "FS", editor)).toMatchObject({ ok: false, message: "No task with that name that you can see." });
  });
  it("keeps the 30-link cap", async () => {
    const hub = await task(`Hub ${tag}`, null, "2027-04-01");
    for (let i = 0; i < 30; i += 1) {
      const other = await task(`Spoke ${i} ${tag}`, null, "2027-04-02");
      await db().query("INSERT INTO task_dependencies (blocker_task_id, blocked_task_id, dep_type, created_by) VALUES (?, ?, 'FS', ?)", [hub, other, owner]);
    }
    const extra = await task(`Spoke extra ${tag}`, null, "2027-04-02");
    expect(await link(hub, extra)).toMatchObject({ ok: false, message: "A task has at most 30 dependencies." });
  });
  // v1.93.0 (D-449, supersedes BR-PROJ-041): the search is scoped to the task's
  // project (see v193-dependency-scope for portfolios and tasks in no project).
  it("searches the task's own project with the project name, only tasks the person sees", async () => {
    const anchor = await task(`Anchor ${tag}`, null, "2027-04-03");
    const found = await schedule.dependencyTargets(`Spoke extra ${tag}`, who(owner), anchor);
    expect(found.ok && found.value.items[0]).toMatchObject({ title: `Spoke extra ${tag}`, projectName: `Schedule ${tag}` });
    expect(found.ok && found.value).toMatchObject({ kind: "PROJECT", wide: false, canWiden: false });
    // The outsider can't see the anchor task at all.
    expect((await schedule.dependencyTargets(`Spoke extra ${tag}`, who(outsider), anchor)).ok).toBe(false);
    const none = await schedule.dependencyTargets(`Spoke extra ${tag}`, who(outsider), null);
    expect(none.ok && none.value.items).toEqual([]);
  });
  it("tells the waiting task's assignee per type (SF never; FS when the last holding link is done)", async () => {
    const a = await task(`Done A ${tag}`, null, "2027-03-01");
    const b = await task(`Wait B ${tag}`, null, "2027-03-05", editor);
    const c = await task(`SF C ${tag}`, null, "2027-03-05", editor);
    await db().query("UPDATE tasks SET assignee_id = ? WHERE id IN (?)", [editor, [b, c]]);
    expect((await link(a, b, "FS", editor)).ok).toBe(true);
    expect((await link(a, c, "SF", editor)).ok).toBe(true);
    const items = (await listProjectTasks(projectId)).filter((item) => [b, c].includes(item.id));
    expect(items.find((item) => item.id === b)!.blockedBy).toBe(1);
    expect(items.find((item) => item.id === c)!.blockedBy).toBe(0); // SF holds nothing back
    await db().query("UPDATE tasks SET status = 'COMPLETED', completed_at = UTC_TIMESTAMP() WHERE id = ?", [a]);
    await afterTaskCompleted(a, { id: owner, name: "Owner" });
    const ready = await titles(editor, "Ready to start");
    expect(ready).toContain(`Ready to start: ${(await findTask(b))!.taskNo}`);
    expect(ready).not.toContain(`Ready to start: ${(await findTask(c))!.taskNo}`);
  });
  it("is refused with the planning switch off", async () => {
    await setting("features.pm_planning", "OFF");
    try {
      expect((await schedule.dependencyTargets("anything", who(owner), null)).ok).toBe(false);
      expect((await schedule.saveProjectSchedule(projectId, { mode: "KEEP_GAP" }, who(owner))).ok).toBe(false);
    } finally {
      await setting("features.pm_planning", "ON");
    }
  });
});

describe("auto-shift", () => {
  it("owners only change the project's scheduling", async () => {
    expect((await schedule.saveProjectSchedule(projectId, { mode: "KEEP_GAP" }, who(editor))).ok).toBe(false);
    expect((await schedule.saveProjectSchedule(projectId, { mode: "SIDEWAYS" }, who(owner))).ok).toBe(false);
    expect((await schedule.saveProjectSchedule(projectId, { mode: "KEEP_GAP", skipOffDays: false }, who(owner))).ok).toBe(true);
    expect(await schedule.projectSchedule(projectId)).toMatchObject({ mode: "KEEP_GAP", skipOffDays: false });
  });
  it("keep the gap: moves the chain in one transaction, with stories, and Undo puts it back", async () => {
    await mode("KEEP_GAP");
    const a = await task(`KA ${tag}`, "2027-05-03", "2027-05-04");
    const b = await task(`KB ${tag}`, "2027-05-06", "2027-05-07");
    const c = await task(`KC ${tag}`, null, "2027-05-10");
    expect((await link(a, b)).ok).toBe(true);
    expect((await link(b, c)).ok).toBe(true);
    await db().query("UPDATE tasks SET due_at = DATE_ADD(due_at, INTERVAL -6 HOUR) WHERE id = ?", [b]); // a due time other than 23:59 is kept
    const timeBefore = (await findTask(b))!.dueAt!.toISOString().slice(11, 16);
    const moved = await work.setTaskFields(a, { dueDay: "2027-05-06", holidayOk: true }, who(owner));
    expect(moved.ok).toBe(true);
    const shifted = moved.ok ? moved.value?.shifted : undefined;
    expect(shifted?.moved).toBe(2);
    expect(await dates(b)).toEqual({ start: "2027-05-08", due: "2027-05-09" });
    expect(await dates(c)).toEqual({ start: null, due: "2027-05-12" });
    expect((await findTask(b))!.dueAt!.toISOString().slice(11, 16)).toBe(timeBefore);
    const [stories] = await db().query<RowDataPacket[]>("SELECT actor_id, body FROM task_events WHERE task_id = ? ORDER BY id DESC LIMIT 1", [c]);
    expect(String(stories[0]!.body)).toContain("keep the gap");
    expect(Number(stories[0]!.actor_id)).toBe(owner); // the mover may plan it
    // Undo: not by someone else; by the mover, once.
    expect((await schedule.undoShift(shifted!.batchId, who(editor))).ok).toBe(false);
    const undone = await schedule.undoShift(shifted!.batchId, who(owner));
    expect(undone).toMatchObject({ ok: true, value: { restored: 3, skipped: 0 } });
    expect(await dates(a)).toEqual({ start: "2027-05-03", due: "2027-05-04" });
    expect(await dates(b)).toEqual({ start: "2027-05-06", due: "2027-05-07" });
    expect(await dates(c)).toEqual({ start: null, due: "2027-05-10" });
    expect((await schedule.undoShift(shifted!.batchId, who(owner))).ok).toBe(false);
  });
  it("a dependent task the mover can't plan is moved by the system (its story has no person)", async () => {
    await mode("KEEP_GAP");
    const a = await task(`SA ${tag}`, null, "2027-09-01", editor);
    const b = await task(`SB ${tag}`, null, "2027-09-03");
    expect((await link(a, b, "FS", owner)).ok).toBe(true);
    const moved = await work.setTaskFields(a, { dueDay: "2027-09-02", holidayOk: true }, who(editor));
    expect(moved.ok && moved.value?.shifted?.moved).toBe(1);
    const [stories] = await db().query<RowDataPacket[]>("SELECT actor_id, body FROM task_events WHERE task_id = ? ORDER BY id DESC LIMIT 1", [b]);
    expect(stories[0]!.actor_id).toBeNull();
    expect(await dates(b)).toEqual({ start: null, due: "2027-09-04" });
  });
  it("Undo leaves a task changed since then alone", async () => {
    await mode("KEEP_GAP");
    const a = await task(`UA ${tag}`, null, "2027-06-01");
    const b = await task(`UB ${tag}`, null, "2027-06-03");
    expect((await link(a, b)).ok).toBe(true);
    const moved = await work.setTaskFields(a, { dueDay: "2027-06-02", holidayOk: true }, who(owner));
    const batch = moved.ok ? moved.value?.shifted?.batchId : undefined;
    expect(await dates(b)).toEqual({ start: null, due: "2027-06-04" });
    await db().query("UPDATE tasks SET due_at = DATE_ADD(due_at, INTERVAL 1 DAY) WHERE id = ?", [b]);
    expect(await schedule.undoShift(batch!, who(owner))).toMatchObject({ ok: true, value: { restored: 1, skipped: 1 } });
  });
  it("use up the slack: moves only past the gap; done tasks stay; off moves nothing", async () => {
    await mode("CONSUME");
    const a = await task(`CA ${tag}`, null, "2027-07-05");
    const b = await task(`CB ${tag}`, "2027-07-07", "2027-07-08");
    const done = await task(`CD ${tag}`, null, "2027-07-06");
    expect((await link(a, b)).ok).toBe(true);
    expect((await link(a, done)).ok).toBe(true);
    await db().query("UPDATE tasks SET status = 'COMPLETED', completed_at = UTC_TIMESTAMP() WHERE id = ?", [done]);
    const small = await work.setTaskFields(a, { dueDay: "2027-07-06", holidayOk: true }, who(owner));
    expect(small.ok && small.value?.shifted).toBeFalsy();
    expect(await dates(b)).toEqual({ start: "2027-07-07", due: "2027-07-08" });
    const big = await work.setTaskFields(a, { dueDay: "2027-07-09", holidayOk: true }, who(owner));
    expect(big.ok && big.value?.shifted?.moved).toBe(1);
    expect(await dates(b)).toEqual({ start: "2027-07-09", due: "2027-07-10" });
    expect(await dates(done)).toEqual({ start: null, due: "2027-07-06" });
    await mode("OFF");
    const none = await work.setTaskFields(a, { dueDay: "2027-07-20", holidayOk: true }, who(owner));
    expect(none.ok && none.value?.shifted).toBeFalsy();
    expect(await dates(b)).toEqual({ start: "2027-07-09", due: "2027-07-10" });
  });
  it("with weekly offs skipped, a moved task never lands on one", async () => {
    await mode("KEEP_GAP", true);
    const a = await task(`WA ${tag}`, null, "2027-08-02");
    const b = await task(`WB ${tag}`, null, "2027-08-03");
    expect((await link(a, b)).ok).toBe(true);
    const moved = await work.setTaskFields(a, { dueDay: "2027-08-06", holidayOk: true }, who(owner));
    expect(moved.ok).toBe(true);
    const [[working]] = await db().query<RowDataPacket[]>("SELECT value FROM system_settings WHERE setting_key = 'calendar.working_days'");
    const due = (await dates(b)).due;
    const weekday = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][new Date(`${due}T00:00:00Z`).getUTCDay()]!;
    if (working?.value) expect(String(working.value)).toContain(weekday);
    else expect(weekday).not.toBe("SUN");
    await mode("OFF");
  });
});

describe("status updates", () => {
  it("posts with sections, picked highlights and extra recipients; owners and editors only", async () => {
    const done = await task(`Milestone ${tag}`, null, "2027-02-01");
    await db().query("UPDATE tasks SET status = 'COMPLETED', completed_at = UTC_TIMESTAMP(), is_milestone = TRUE WHERE id = ?", [done]);
    const lights = await schedule.statusHighlights(projectId, 7, who(editor));
    expect(lights.ok && lights.value.items.find((item) => item.id === done)).toMatchObject({ milestone: true });
    expect((await schedule.statusHighlights(projectId, 7, who(outsider))).ok).toBe(false);
    const input = { status: "AT_RISK", title: `Week ${tag}`, summary: "Going fine", nextSteps: "Ship it", ownerId: editor, startOn: "2027-01-01", dueOn: "2027-12-31", highlightDays: 7, highlightIds: [done], extraRecipients: [outsider] };
    expect((await schedule.postStatusUpdate(projectId, input, who(viewerOnly))).ok).toBe(false);
    expect((await schedule.postStatusUpdate(projectId, { ...input, status: "" }, who(owner))).ok).toBe(false);
    expect((await schedule.postStatusUpdate(projectId, { ...input, title: "", summary: "", nextSteps: "" }, who(owner))).ok).toBe(false);
    expect((await schedule.postStatusUpdate(projectId, { ...input, highlightIds: [999999999] }, who(owner))).ok).toBe(false);
    const posted = await schedule.postStatusUpdate(projectId, input, who(owner));
    expect(posted.ok).toBe(true);
    const [rows] = await db().query<RowDataPacket[]>("SELECT owner_id, next_steps, highlights_json, recipients_json FROM project_status_updates WHERE id = ?", [posted.ok ? posted.value.id : 0]);
    expect(Number(rows[0]!.owner_id)).toBe(editor);
    expect(rows[0]!.next_steps).toBe("Ship it");
    const recipients = (typeof rows[0]!.recipients_json === "string" ? JSON.parse(rows[0]!.recipients_json) : rows[0]!.recipients_json) as number[];
    expect(recipients.sort()).toEqual([editor, viewerOnly, outsider].sort());
    const [[project]] = await db().query<RowDataPacket[]>("SELECT current_status FROM projects WHERE id = ?", [projectId]);
    expect(project!.current_status).toBe("AT_RISK");
  });
  it("the weekly reminder: on Friday from 9 am, once, to the owner", async () => {
    expect((await schedule.setStatusReminder(projectId, true, who(viewerOnly))).ok).toBe(false);
    expect((await schedule.setStatusReminder(projectId, true, who(editor))).ok).toBe(true);
    const friday = new Date("2030-11-22T05:00:00Z"); // 10:30 India, a Friday
    const thursday = new Date("2030-11-21T05:00:00Z");
    expect((await schedule.runStatusReminders(thursday)).statusReminders).toBe(0);
    await db().query("UPDATE projects SET status_reminded_on = NULL WHERE id = ?", [projectId]);
    const first = await schedule.runStatusReminders(friday);
    expect(first.statusReminders).toBeGreaterThan(0);
    const [[claimed]] = await db().query<RowDataPacket[]>("SELECT DATE_FORMAT(status_reminded_on, '%Y-%m-%d') AS day FROM projects WHERE id = ?", [projectId]);
    expect(claimed!.day).toBe("2030-11-22");
    const count = (await titles(owner, `Status update due: Schedule ${tag}`)).length;
    await schedule.runStatusReminders(friday);
    expect((await titles(owner, `Status update due: Schedule ${tag}`)).length).toBe(count);
    expect(count).toBe(1);
  });
});
