import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDbPool } from "@/lib/db/client";
import * as work from "@/server/work/service";
import * as schedule from "@/server/work/schedule-service";
import * as time from "@/server/work/time-tracking";
import * as reporting from "@/server/work/reporting-service";
import { durationOf, planningBasis } from "@/server/work/durations";
import { saveJsonSetting } from "@/server/work/holiday-store";
import { PLANNING_SETTINGS_KEY, taskDurationDays, workingDaysBetween } from "@/server/work/working-days";
import { addDays, weekdayOf } from "@/server/work/schedule";
import type { ModuleCode } from "@/server/modules/modules";
import { createUser } from "./helpers";

// v1.74.0 (D-398) through the services: project From/To validation and
// duration, task durations and the effective estimate (manual wins, clearing
// returns to the dates, auto-recalculated when dates move), the project and
// Workload roll-ups, the critical path on the server (who may see it, links
// outside the project, a moved task changes the path) and the switch.
const tag = Date.now().toString(36);
const ALL: ModuleCode[] = ["APPROVAL", "TASK", "PROJECT"];
const who = (id: number, name = `K${id}`) => ({ id, name, roles: ["USER"] as string[], modules: ALL, sessionId: "pm-cpm", ipAddress: null });
const db = () => getDbPool();
const setting = (key: string, value: string) =>
  db().query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES (?, 'FEATURES', 'STRING', FALSE, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, value]);
let owner: number;
let viewerOnly: number;
let outsider: number;
let projectId: number;
let otherProject: number;
// A Monday well ahead, so no test day is in the past.
let monday = "2027-03-01";
while (weekdayOf(monday) !== 1) monday = addDays(monday, 1);
const HOLIDAY = addDays(monday, 9); // the second week's Wednesday

const task = async (title: string, start: string | null, due: string, project = projectId, as = owner) => {
  const added = await work.quickAddTask({ title, projectId: project, sectionId: null, parentId: null, assigneeId: null, dueDay: "", mySectionId: null }, who(as));
  if (!added.ok) throw new Error(added.message);
  const set = await work.setTaskFields(added.value.id, { dueDay: due, ...(start ? { startDay: start } : {}), holidayOk: true }, who(as));
  if (!set.ok) throw new Error(set.message);
  return added.value.id;
};
const link = (pred: number, succ: number, type = "FS") => schedule.setTypedDependency({ taskId: succ, otherId: pred, role: "BLOCKED_BY", type, on: true }, who(owner));
const projectInput = (startOn: string, dueOn: string) => ({ name: `CPM ${tag}`, description: "", color: "blue", privacy: "PRIVATE", departmentId: null, defaultAccessRole: "EDITOR", defaultView: "LIST", startOn, dueOn });

beforeAll(async () => {
  for (const name of ["pm_planning", "pm_extras", "pm_reporting"]) await setting(`features.${name}`, "ON");
  owner = await createUser({ name: `Cpm owner ${tag}` });
  viewerOnly = await createUser({ name: `Cpm viewer ${tag}` });
  outsider = await createUser({ name: `Cpm outsider ${tag}` });
  const created = await work.createProject(projectInput(monday, addDays(monday, 11)), who(owner));
  if (!created.ok) throw new Error(created.message);
  projectId = created.value.id;
  expect((await work.setMember(projectId, { type: "USER", id: viewerOnly }, "VIEWER", who(owner))).ok).toBe(true);
  const other = await work.createProject({ ...projectInput("", ""), name: `CPM other ${tag}` }, who(owner));
  if (!other.ok) throw new Error(other.message);
  otherProject = other.value.id;
  await db().query("INSERT IGNORE INTO holidays (holiday_on, name) VALUES (?, ?)", [HOLIDAY, `CPM test ${tag}`]);
  await saveJsonSetting(PLANNING_SETTINGS_KEY, { hoursPerDay: 7.5 }, owner);
});
afterAll(async () => {
  await db().query("DELETE FROM holidays WHERE holiday_on = ? AND name = ?", [HOLIDAY, `CPM test ${tag}`]);
  await db().query("DELETE FROM system_settings WHERE setting_key = ?", [PLANNING_SETTINGS_KEY]);
  for (const name of ["pm_planning", "pm_extras", "pm_reporting"]) await db().query("DELETE FROM system_settings WHERE setting_key = ?", [`features.${name}`]);
});

describe("project dates as From and To", () => {
  it("refuses To before From and dates that don't exist", async () => {
    const backwards = await work.createProject(projectInput(addDays(monday, 5), monday), who(owner));
    expect(backwards).toMatchObject({ ok: false, fieldErrors: { due_on: "The To (due) date can't be before the From (start) date." } });
    const unreal = await work.createProject(projectInput("2027-02-30", ""), who(owner));
    expect(unreal).toMatchObject({ ok: false, fieldErrors: { start_on: "Enter a real date." } });
    const update = await work.updateProjectDetails(projectId, projectInput(addDays(monday, 3), monday), who(owner));
    expect(update.ok).toBe(false);
  });
  it("works out working days (holidays skipped) and hours from the Admin setting", async () => {
    const basis = await planningBasis();
    expect(basis.hoursPerDay).toBe(7.5);
    expect(basis.calendar.offDays.has(HOLIDAY)).toBe(true);
    const to = addDays(monday, 11);
    const days = workingDaysBetween(monday, to, basis.calendar)!;
    const withoutHoliday = workingDaysBetween(monday, to, { ...basis.calendar, offDays: new Set() })!;
    expect(days).toBe(withoutHoliday - (basis.calendar.workingWeekdays.size === 0 || basis.calendar.workingWeekdays.has(weekdayOf(HOLIDAY)) ? 1 : 0));
    expect(durationOf(monday, to, basis)).toEqual({ days, hours: days * 7.5 });
    expect(durationOf(null, to, basis)).toBeNull();
  });
});

describe("task estimates from dates", () => {
  let spread: number;
  it("defaults to working days × hours per day; a manual estimate wins; clearing returns to the dates", async () => {
    spread = await task(`Spread ${tag}`, monday, addDays(monday, 4));
    const basis = await planningBasis();
    const days = taskDurationDays(monday, addDays(monday, 4), basis.calendar);
    const first = await time.loadTaskTime(spread, who(owner));
    expect(first).toMatchObject({ estimateSource: "DATES", estimate: days * 7.5 * 60, manualEstimate: null, durationDays: days, hoursPerDay: 7.5 });
    expect((await time.setEstimate(spread, "3h", who(owner))).ok).toBe(true);
    expect(await time.loadTaskTime(spread, who(viewerOnly))).toMatchObject({ estimateSource: "MANUAL", estimate: 180 });
    expect((await time.setEstimate(spread, "", who(owner))).ok).toBe(true);
    expect(await time.loadTaskTime(spread, who(owner))).toMatchObject({ estimateSource: "DATES", estimate: days * 7.5 * 60 });
  });
  it("follows the dates when they change", async () => {
    expect((await work.setTaskFields(spread, { dueDay: addDays(monday, 1), holidayOk: true }, who(owner))).ok).toBe(true);
    const basis = await planningBasis();
    expect(await time.loadTaskTime(spread, who(owner))).toMatchObject({ estimate: taskDurationDays(monday, addDays(monday, 1), basis.calendar) * 450 });
  });
  it("a task with only a due date is one day", async () => {
    const single = await task(`Single ${tag}`, null, addDays(monday, 2));
    expect(await time.loadTaskTime(single, who(owner))).toMatchObject({ estimate: 450, durationDays: 1, estimateSource: "DATES" });
  });
  it("adds up effective estimates for the project (with and without manual ones); outsiders get nothing", async () => {
    const totals = await time.projectTime(projectId, who(viewerOnly));
    expect(totals).not.toBeNull();
    const basis = await planningBasis();
    expect(totals!.tasksWithEstimate).toBe(0);
    expect(totals!.fromDates).toBeGreaterThanOrEqual(2);
    const manual = await task(`Manual ${tag}`, monday, addDays(monday, 2));
    expect((await time.setEstimate(manual, "1h", who(owner))).ok).toBe(true);
    const after = await time.projectTime(projectId, who(viewerOnly));
    expect(after!.tasksWithEstimate).toBe(1);
    expect(after!.estimate).toBe(totals!.estimate + 60);
    expect(basis.hoursPerDay).toBe(7.5);
    expect(await time.projectTime(projectId, who(outsider))).toBeNull();
  });
  it("without the planning switch only manual estimates count", async () => {
    await setting("features.pm_planning", "OFF");
    try {
      const view = await time.loadTaskTime(spread, who(owner));
      expect(view).toMatchObject({ estimate: null, estimateSource: null, hoursPerDay: null });
      expect((await time.projectTime(projectId, who(owner)))!.fromDates).toBe(0);
    } finally {
      await setting("features.pm_planning", "ON");
    }
  });
  it("Workload's Estimated time uses the effective estimate", async () => {
    const load = await reporting.loadWorkload(projectId, who(owner), { metric: "estimate", from: monday });
    expect(load.ok).toBe(true);
    if (!load.ok) return;
    const mine = load.value.people.find((person) => person.id === owner)!;
    const total = mine.cells.reduce((sum, cell) => sum + cell.load, 0);
    expect(total).toBeGreaterThan(1); // the date-based hours are spread over the days, not zero
  });
});

describe("the critical path on the server", () => {
  let a: number;
  let b: number;
  let c: number;
  let d: number;
  it("finds the longest chain among the project's tasks", async () => {
    // A To date well after the tasks (an earlier one would make every late task critical).
    expect((await work.updateProjectDetails(projectId, projectInput(monday, addDays(monday, 60)), who(owner))).ok).toBe(true);
    const start = addDays(monday, 14); // a week with no test holiday
    a = await task(`CP-A ${tag}`, start, addDays(start, 2)); // 3 days
    b = await task(`CP-B ${tag}`, start, addDays(start, 1)); // 2 days
    c = await task(`CP-C ${tag}`, start, addDays(start, 3)); // 4 days
    d = await task(`CP-D ${tag}`, start, addDays(start, 1)); // 2 days
    for (const [p, s] of [
      [a, b],
      [a, c],
      [b, d],
      [c, d],
    ] as const)
      expect((await link(p, s)).ok).toBe(true);
    const result = await schedule.projectCriticalPath(projectId, who(viewerOnly));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.criticalIds.filter((id) => [a, b, c, d].includes(id))).toEqual([a, c, d]);
    expect(result.value.tasks[b]!.slack).toBe(2);
    expect(result.value.criticalLinks).toEqual(expect.arrayContaining([`${a}-${c}`, `${c}-${d}`]));
  });
  it("changes when a task moves (shorter C: B's branch becomes critical too)", async () => {
    const start = addDays(monday, 14);
    expect((await work.setTaskFields(c, { dueDay: addDays(start, 1), holidayOk: true }, who(owner))).ok).toBe(true);
    const result = await schedule.projectCriticalPath(projectId, who(owner));
    if (!result.ok) throw new Error(result.message);
    expect(result.value.tasks[b]!.critical).toBe(true);
    expect(result.value.tasks[c]!.critical).toBe(true);
  });
  it("counts, but doesn't follow, links to tasks in other projects", async () => {
    const elsewhere = await task(`Elsewhere ${tag}`, null, addDays(monday, 30), otherProject);
    expect((await link(elsewhere, a)).ok).toBe(true);
    const result = await schedule.projectCriticalPath(projectId, who(owner));
    expect(result.ok && result.value.outsideLinks).toBeGreaterThanOrEqual(1);
    expect(result.ok && result.value.tasks[elsewhere]).toBeFalsy();
  });
  it("is refused to people who can't see the project and with the switch off", async () => {
    expect(await schedule.projectCriticalPath(projectId, who(outsider))).toMatchObject({ ok: false, message: "Not found." });
    await setting("features.pm_planning", "OFF");
    try {
      expect((await schedule.projectCriticalPath(projectId, who(owner))).ok).toBe(false);
    } finally {
      await setting("features.pm_planning", "ON");
    }
  });
});
