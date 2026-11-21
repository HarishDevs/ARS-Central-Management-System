import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import * as work from "@/server/work/service";
import * as more from "@/server/work/service-more";
import { listSections, toggleFavourite } from "@/lib/db/repositories/work.repository";
import { reactionRows, sidebarProjects } from "@/lib/db/repositories/pm.repository";
import { workViewer } from "@/server/work/task-access";
import { moveSidebarProject, loadSidebar, setSidebarSort } from "@/server/work/sidebar";
import { runWorkPurge } from "@/server/work/purge";
import type { ModuleCode } from "@/server/modules/modules";
import { createDepartment, createUser, setDepartment } from "./helpers";

// v1.62.0 (D-368, PM phase A part 2): reactions (deny when the task can't be
// seen), stars and the sidebar lists, undo (restore) after delete, and the
// purge of Deleted after 30 days, with dates moved into the past.
const tag = Date.now().toString(36);
const ALL: ModuleCode[] = ["APPROVAL", "TASK", "PROJECT"];
const who = (id: number) => ({ id, name: `P${id}`, roles: ["USER"] as string[], modules: ALL, sessionId: "pm-part2", ipAddress: null });
const db = () => getDbPool();
const count = async (sql: string, params: unknown[]) => Number((await db().query<RowDataPacket[]>(sql, params))[0][0]?.n ?? 0);
let owner: number;
let member: number;
let outsider: number;
let colleague: number;
let department: number;
let privateProject: number;
let openProject: number;
let deptProject: number;
let taskId: number;
let commentId: number;

const project = async (name: string, privacy: "PRIVATE" | "ORGANISATION" | "DEPARTMENT", departmentId: number | null = null) => {
  const created = await work.createProject({ name, description: "", color: "blue", privacy, departmentId, defaultAccessRole: "EDITOR", defaultView: "LIST", startOn: "", dueOn: "" }, who(owner));
  if (!created.ok) throw new Error(created.message);
  return created.value.id;
};
const task = async (title: string, projectId: number | null, parentId: number | null = null) => {
  const added = await work.quickAddTask({ title, projectId, sectionId: null, parentId, assigneeId: null, dueDay: "", mySectionId: null }, who(owner));
  if (!added.ok) throw new Error(added.message);
  return added.value.id;
};

beforeAll(async () => {
  owner = await createUser({ name: `PM2 owner ${tag}` });
  member = await createUser({ name: `PM2 member ${tag}` });
  outsider = await createUser({ name: `PM2 outsider ${tag}` });
  colleague = await createUser({ name: `PM2 colleague ${tag}` });
  department = await createDepartment(null);
  await setDepartment(owner, department);
  await setDepartment(colleague, department);
  privateProject = await project(`Private ${tag}`, "PRIVATE");
  expect((await work.setMember(privateProject, { type: "USER", id: member }, "EDITOR", who(owner))).ok).toBe(true);
  openProject = await project(`Open ${tag}`, "ORGANISATION");
  deptProject = await project(`Dept ${tag}`, "DEPARTMENT", department);
  taskId = await task(`Reactable ${tag}`, privateProject);
  const posted = await work.addComment(taskId, "Looks good", null, who(owner));
  if (!posted.ok) throw new Error(posted.message);
  commentId = posted.value.id;
});

afterAll(async () => {
  await getDbPool().end();
});

describe("reactions on comments (D-368)", () => {
  it("a member reacts and un-reacts; counts and 'mine' are per person", async () => {
    expect(await work.reactToComment(commentId, "THUMBS_UP", who(member))).toEqual({ ok: true, value: { on: true } });
    expect((await work.reactToComment(commentId, "THUMBS_UP", who(owner))).ok).toBe(true);
    expect((await work.reactToComment(commentId, "HEART", who(owner))).ok).toBe(true);
    const rows = await reactionRows([commentId], member);
    expect(rows.find((row) => row.key === "THUMBS_UP")).toMatchObject({ count: 2, mine: true });
    expect(rows.find((row) => row.key === "HEART")).toMatchObject({ count: 1, mine: false });
    expect(await work.reactToComment(commentId, "THUMBS_UP", who(member))).toEqual({ ok: true, value: { on: false } });
    expect((await reactionRows([commentId], member)).find((row) => row.key === "THUMBS_UP")).toMatchObject({ count: 1, mine: false });
  });

  it("someone who can't see the task gets 'not found'; unknown reactions and deleted comments are refused", async () => {
    expect(await work.reactToComment(commentId, "HEART", who(outsider))).toEqual({ ok: false, message: "Not found." });
    expect(await count("SELECT COUNT(*) AS n FROM comment_reactions WHERE comment_id = ? AND user_id = ?", [commentId, outsider])).toBe(0);
    expect((await work.reactToComment(commentId, "ANGRY", who(member))).ok).toBe(false);
    const other = await work.addComment(taskId, "Remove me", null, who(owner));
    if (!other.ok) throw new Error(other.message);
    expect((await work.changeComment(other.value.id, { delete: true }, who(owner))).ok).toBe(true);
    expect(await work.reactToComment(other.value.id, "HEART", who(owner))).toEqual({ ok: false, message: "Not found." });
  });
});

describe("starred projects and the Departments section (D-368)", () => {
  it("lists only starred projects the person can see, in their manual order", async () => {
    expect(await toggleFavourite(member, "PROJECT", privateProject)).toBe(true);
    expect(await toggleFavourite(member, "PROJECT", openProject)).toBe(true);
    const viewer = await workViewer(who(member));
    let starred = await sidebarProjects(viewer, "STARRED");
    expect(starred.map((item) => item.id).sort()).toEqual([privateProject, openProject].sort());
    // The person leaves the private project: it drops out of their Starred list.
    expect((await work.setMember(privateProject, { type: "USER", id: member }, null, who(owner))).ok).toBe(true);
    starred = await sidebarProjects(await workViewer(who(member)), "STARRED");
    expect(starred.map((item) => item.id)).toEqual([openProject]);
    expect((await work.setMember(privateProject, { type: "USER", id: member }, "EDITOR", who(owner))).ok).toBe(true);
    // Reorder: the first one moves down.
    const before = (await loadSidebar(who(member))).starred.items.map((item) => item.id);
    expect(before.length).toBe(2);
    const moved = await moveSidebarProject(who(member), "STARRED", before[0]!, "down");
    expect(moved).toMatchObject({ ok: true, message: expect.stringContaining("position 2 of 2") });
    expect((await loadSidebar(who(member))).starred.items.map((item) => item.id)).toEqual([before[1], before[0]]);
    expect((await moveSidebarProject(who(member), "STARRED", before[0]!, "down")).ok).toBe(false);
    // A project that isn't in the list can't be moved.
    expect(await moveSidebarProject(who(member), "STARRED", deptProject, "up")).toEqual({ ok: false, message: "Not found." });
  });

  it("Departments lists projects shared with the person's department, sorted as they choose", async () => {
    const colleagueSide = await loadSidebar(who(colleague));
    expect(colleagueSide.departments.items.map((item) => item.id)).toContain(deptProject);
    expect(colleagueSide.departments.items.map((item) => item.id)).not.toContain(privateProject);
    expect(colleagueSide.departments.sort).toBe("AZ");
    await setSidebarSort(who(colleague), "DEPARTMENTS", "RECENT");
    expect((await loadSidebar(who(colleague))).departments.sort).toBe("RECENT");
    // No department: no Departments list.
    expect((await loadSidebar(who(outsider))).departments.items).toEqual([]);
  });
});

describe("undo after delete (D-368)", () => {
  it("restoring a just-deleted task brings back its status and subtasks", async () => {
    const parent = await task(`Undo me ${tag}`, openProject);
    const child = await task(`Undo child ${tag}`, null, parent);
    expect((await work.deleteTask(parent, who(owner))).ok).toBe(true);
    expect(await count("SELECT COUNT(*) AS n FROM tasks WHERE id IN (?) AND deleted_at IS NOT NULL AND status = 'CANCELLED'", [[parent, child]])).toBe(2);
    expect((await work.restoreTask(parent, who(owner))).ok).toBe(true);
    expect(await count("SELECT COUNT(*) AS n FROM tasks WHERE id IN (?) AND deleted_at IS NULL AND status = 'OPEN'", [[parent, child]])).toBe(2);
    // Someone else can't undo it for them.
    expect((await work.deleteTask(parent, who(owner))).ok).toBe(true);
    expect((await work.restoreTask(parent, who(outsider))).ok).toBe(false);
    expect((await work.restoreTask(parent, who(owner))).ok).toBe(true);
  });
});

describe("purge after 30 days in Deleted (D-368)", () => {
  it("removes old deleted tasks with everything on them, keeps recent ones and parents of living subtasks", async () => {
    const sections = await listSections(openProject);
    const field = await more.addField(openProject, { name: `Cost ${tag}`, kind: "TEXT", options: "" }, who(owner));
    if (!field.ok) throw new Error(field.message);
    const old = await task(`Old ${tag}`, openProject);
    const oldChild = await task(`Old child ${tag}`, null, old);
    const recent = await task(`Recent ${tag}`, openProject);
    const keeper = await task(`Keeper ${tag}`, openProject);
    const keeperChild = await task(`Keeper child ${tag}`, null, keeper);
    const blocker = await task(`Blocker ${tag}`, openProject);
    // Things that hang on the old task.
    const comment = await work.addComment(old, "On an old task", null, who(owner));
    if (!comment.ok) throw new Error(comment.message);
    await work.addComment(old, "A reply", comment.value.id, who(owner));
    expect((await work.reactToComment(comment.value.id, "TADA", who(owner))).ok).toBe(true);
    expect((await work.likeComment(comment.value.id, who(owner))).ok).toBe(true);
    expect((await work.likeTask(old, who(owner))).ok).toBe(true);
    expect((await work.setTag(old, `purge-${tag}`, true, who(owner))).ok).toBe(true);
    expect((await work.setFollower(old, member, true, who(owner))).ok).toBe(true);
    expect((await more.setTaskField(old, field.value.id, "100", who(owner))).ok).toBe(true);
    const [blockerRow] = await db().query<RowDataPacket[]>("SELECT task_no FROM tasks WHERE id = ?", [blocker]);
    expect((await work.setDependency(old, String(blockerRow[0]!.task_no), true, who(owner))).ok).toBe(true);
    expect(sections.length).toBeGreaterThan(0);
    for (const id of [old, recent, keeper]) expect((await work.deleteTask(id, who(owner))).ok).toBe(true);
    // The keeper's subtask was restored on its own: it stays, so its parent stays.
    await db().query("UPDATE tasks SET deleted_at = NULL, deleted_by = NULL WHERE id = ?", [keeperChild]);
    await db().query("UPDATE tasks SET deleted_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 40 DAY) WHERE id IN (?)", [[old, oldChild, keeper]]);
    await db().query("UPDATE tasks SET deleted_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 DAY) WHERE id = ?", [recent]);
    const auditsBefore = await count("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'WORK_TASKS_PURGED'", []);

    const result = await runWorkPurge({ force: true });
    expect(result.purgedTasks).toBeGreaterThanOrEqual(2);

    expect(await count("SELECT COUNT(*) AS n FROM tasks WHERE id IN (?)", [[old, oldChild]])).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM tasks WHERE id IN (?)", [[recent, keeper, keeperChild, blocker]])).toBe(4);
    for (const [sql, params] of [
      ["SELECT COUNT(*) AS n FROM task_comments WHERE task_id = ?", [old]],
      ["SELECT COUNT(*) AS n FROM comment_reactions WHERE comment_id = ?", [comment.value.id]],
      ["SELECT COUNT(*) AS n FROM work_likes WHERE (target_type = 'TASK' AND target_id = ?) OR (target_type = 'COMMENT' AND target_id = ?)", [old, comment.value.id]],
      ["SELECT COUNT(*) AS n FROM task_tags WHERE task_id = ?", [old]],
      ["SELECT COUNT(*) AS n FROM task_followers WHERE task_id = ?", [old]],
      ["SELECT COUNT(*) AS n FROM task_field_values WHERE task_id = ?", [old]],
      ["SELECT COUNT(*) AS n FROM task_dependencies WHERE blocked_task_id = ? OR blocker_task_id = ?", [old, old]],
      ["SELECT COUNT(*) AS n FROM task_projects WHERE task_id IN (?)", [[old, oldChild]]],
      ["SELECT COUNT(*) AS n FROM task_events WHERE task_id IN (?)", [[old, oldChild]]],
    ] as [string, unknown[]][])
      expect(await count(sql, params)).toBe(0);
    // One audit entry for the batch.
    expect(await count("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'WORK_TASKS_PURGED'", [])).toBe(auditsBefore + 1);
    // Running again removes nothing more of ours.
    await runWorkPurge({ force: true });
    expect(await count("SELECT COUNT(*) AS n FROM tasks WHERE id IN (?)", [[recent, keeper, keeperChild, blocker]])).toBe(4);
  });

  it("removes an old deleted project with its sections, fields, tabs and stars; its tasks stay", async () => {
    const doomed = await project(`Doomed ${tag}`, "ORGANISATION");
    const survivor = await task(`Survivor ${tag}`, doomed);
    const field = await more.addField(doomed, { name: `Size ${tag}`, kind: "TEXT", options: "" }, who(owner));
    if (!field.ok) throw new Error(field.message);
    expect((await more.setTaskField(survivor, field.value.id, "L", who(owner))).ok).toBe(true);
    await toggleFavourite(member, "PROJECT", doomed);
    expect((await work.setProjectLifecycle(doomed, "DELETE", who(owner))).ok).toBe(true);
    await db().query("UPDATE projects SET deleted_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 31 DAY) WHERE id = ?", [doomed]);
    const kept = await project(`Kept ${tag}`, "ORGANISATION");
    expect((await work.setProjectLifecycle(kept, "DELETE", who(owner))).ok).toBe(true);

    const result = await runWorkPurge({ force: true });
    expect(result.purgedProjects).toBeGreaterThanOrEqual(1);
    expect(await count("SELECT COUNT(*) AS n FROM projects WHERE id = ?", [doomed])).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM projects WHERE id = ?", [kept])).toBe(1);
    for (const table of ["project_sections", "project_fields", "project_members", "task_projects"]) expect(await count(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id = ?`, [doomed])).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM work_favourites WHERE object_type = 'PROJECT' AND object_id = ?", [doomed])).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM task_field_values WHERE task_id = ?", [survivor])).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM tasks WHERE id = ? AND deleted_at IS NULL", [survivor])).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'WORK_PROJECTS_PURGED' AND JSON_CONTAINS(JSON_EXTRACT(metadata_json, '$.projectIds'), CAST(? AS JSON))", [String(doomed)])).toBe(1);
  });

  it("a living (or recently deleted) task's history still can't be deleted", async () => {
    const living = await task(`History ${tag}`, openProject);
    await expect(db().query("DELETE FROM task_events WHERE task_id = ?", [living])).rejects.toThrow(/append-only/);
    await expect(db().query("UPDATE task_events SET body = 'x' WHERE task_id = ?", [living])).rejects.toThrow(/append-only/);
  });

  it("does nothing while the switch is Off or the Admin setting is off", async () => {
    await db().query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES ('tasks.pm_extras', 'TASKS', 'JSON', FALSE, '{\"celebrations\":\"OCCASIONAL\",\"purge\":false}') ON DUPLICATE KEY UPDATE value = VALUES(value)");
    expect(await runWorkPurge()).toMatchObject({ purgedTasks: 0, purgedProjects: 0 });
    await db().query("DELETE FROM system_settings WHERE setting_key = 'tasks.pm_extras'");
  });
});
