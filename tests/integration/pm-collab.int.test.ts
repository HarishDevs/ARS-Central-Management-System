import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import * as work from "@/server/work/service";
import * as collab from "@/server/work/collab";
import * as time from "@/server/work/time-tracking";
import * as reporting from "@/server/work/reporting-service";
import { chartConfigSchema } from "@/server/work/reporting";
import { indiaDay } from "@/server/work/rules";
import { addDays } from "@/server/work/schedule";
import { purgeProject } from "@/lib/db/repositories/pm.repository";
import { withTransaction } from "@/lib/db/transaction";
import type { ModuleCode } from "@/server/modules/modules";
import { createUser } from "./helpers";

// v1.71.0 (D-384, PM phase E part 2) through the services: the Files tab
// (only files on tasks the person may see, message files, deleted ones gone),
// Messages (who writes, threads and one level of replies, mentions and
// notices, edit/delete with versions, reactions), the Page (owners/editors,
// stale saves refused, 50 versions kept, restore, mentions told once,
// linked tasks masked) and time tracking (who logs, start/stop, others'
// entries by owners/editors with audit, estimates, totals, CSV, Dashboard
// "time entries"). The pm_extras switch refuses all of it.
const tag = Date.now().toString(36);
const ALL: ModuleCode[] = ["APPROVAL", "TASK", "PROJECT"];
const who = (id: number, name = `C${id}`, roles: string[] = ["USER"]) => ({ id, name, roles, modules: ALL, sessionId: "pm-collab", ipAddress: null });
const db = () => getDbPool();
const setting = (key: string, value: string) =>
  db().query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES (?, 'FEATURES', 'STRING', FALSE, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, value]);
const rows = async (sql: string, params: unknown[] = []) => (await db().query<RowDataPacket[]>(sql, params))[0];
let owner: number;
let editor: number;
let commenter: number;
let viewer: number;
let outsider: number;
let itAdmin: number;
let projectId: number;
let otherProject: number;
let taskA: number;
let subtask: number;
let secret: number;
let today: string;

const task = async (title: string, project: number | null, as: number, extra: { parentId?: number; assigneeId?: number } = {}) => {
  const added = await work.quickAddTask({ title, projectId: extra.parentId ? null : project, sectionId: null, parentId: extra.parentId ?? null, assigneeId: extra.assigneeId ?? null, dueDay: addDays(today, 5), mySectionId: null, holidayOk: true }, who(as));
  if (!added.ok) throw new Error(added.message);
  return added.value.id;
};
let pathNo = 0;
const fileOn = async (entity: "TASK" | "PROJECT_MESSAGE", entityId: number, by: number, name: string, type = "application/pdf") => {
  pathNo += 1;
  await db().query("INSERT INTO record_files (entity_type, entity_id, purpose, uploaded_by, original_name, stored_path, content_type, size_bytes, sha256) VALUES (?, ?, 'GENERAL', ?, ?, ?, ?, 10, ?)", [entity, entityId, by, name, `test/${tag}-${pathNo}`, type, "0".repeat(64)]);
};
const form = (fields: Record<string, string>, files: File[] = []) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  for (const file of files) data.append("attachments", file);
  return data;
};
const outbox = async (eventType: string, userId: number) => (await rows("SELECT id FROM notification_outbox WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.eventType')) = ? AND JSON_EXTRACT(payload_json, '$.userId') = ?", [eventType, userId])).length;

beforeAll(async () => {
  for (const name of ["pm_extras", "pm_reporting", "pm_planning"]) await setting(`features.${name}`, "ON");
  today = indiaDay(new Date());
  owner = await createUser({ name: `Co owner ${tag}` });
  editor = await createUser({ name: `Co editor ${tag}` });
  commenter = await createUser({ name: `Co commenter ${tag}` });
  viewer = await createUser({ name: `Co viewer ${tag}` });
  outsider = await createUser({ name: `Co outsider ${tag}` });
  itAdmin = await createUser({ name: `Co IT ${tag}`, roles: ["IT_ADMIN"] });
  const created = await work.createProject({ name: `Collab ${tag}`, description: "", color: "blue", privacy: "PRIVATE", departmentId: null, defaultAccessRole: "VIEWER", defaultView: "LIST", startOn: "", dueOn: "" }, who(owner));
  if (!created.ok) throw new Error(created.message);
  projectId = created.value.id;
  await work.setMember(projectId, { type: "USER", id: editor }, "EDITOR", who(owner));
  await work.setMember(projectId, { type: "USER", id: commenter }, "COMMENTER", who(owner));
  await work.setMember(projectId, { type: "USER", id: viewer }, "VIEWER", who(owner));
  const other = await work.createProject({ name: `Other ${tag}`, description: "", color: "red", privacy: "PRIVATE", departmentId: null, defaultAccessRole: "VIEWER", defaultView: "LIST", startOn: "", dueOn: "" }, who(outsider));
  if (!other.ok) throw new Error(other.message);
  otherProject = other.value.id;
  taskA = await task(`Alpha ${tag}`, projectId, owner, { assigneeId: commenter });
  await task(`Beta ${tag}`, projectId, owner);
  subtask = await task(`Sub ${tag}`, null, owner, { parentId: taskA });
  secret = await task(`Secret ${tag}`, otherProject, outsider);
});

afterAll(async () => {
  await setting("features.pm_extras", "ON");
});

describe("files tab", () => {
  it("lists files on the project's tasks and subtasks and its messages, for people who see the project", async () => {
    await fileOn("TASK", taskA, owner, "plan.pdf");
    await fileOn("TASK", subtask, commenter, "photo.png", "image/png");
    await fileOn("TASK", secret, outsider, "secret.pdf");
    const posted = await collab.postMessage(projectId, form({ subject: "Drawings", body: "The drawings are attached." }), who(commenter));
    expect(posted.ok).toBe(true);
    const messageId = posted.ok ? posted.value.id : 0;
    await fileOn("PROJECT_MESSAGE", messageId, commenter, "drawing.pdf");
    const seen = await collab.loadProjectFiles(projectId, who(viewer));
    expect(seen.ok).toBe(true);
    const names = seen.ok ? seen.value.map((file) => file.name).sort() : [];
    expect(names).toEqual(["drawing.pdf", "photo.png", "plan.pdf"]);
    const fromMessage = seen.ok ? seen.value.find((file) => file.name === "drawing.pdf") : null;
    expect(fromMessage).toMatchObject({ source: "MESSAGE", messageId, messageSubject: "Drawings", taskId: null });
    expect(await collab.loadProjectFiles(projectId, who(outsider))).toEqual({ ok: false, message: "Not found." });
    // A message's file opens for the project's people only, and not once the message is deleted.
    expect(await collab.messageFileVisible(messageId, who(viewer))).toBe(true);
    expect(await collab.messageFileVisible(messageId, who(outsider))).toBe(false);
    expect((await collab.changeMessage(messageId, { delete: true }, who(commenter))).ok).toBe(true);
    expect(await collab.messageFileVisible(messageId, who(viewer))).toBe(false);
    const after = await collab.loadProjectFiles(projectId, who(viewer));
    expect(after.ok && after.value.map((file) => file.name).sort()).toEqual(["photo.png", "plan.pdf"]);
  });
  it("drops the files of a deleted task", async () => {
    const doomed = await task(`Doomed ${tag}`, projectId, owner);
    await fileOn("TASK", doomed, owner, "doomed.pdf");
    expect((await work.deleteTask(doomed, who(owner))).ok).toBe(true);
    const seen = await collab.loadProjectFiles(projectId, who(owner));
    expect(seen.ok && seen.value.some((file) => file.name === "doomed.pdf")).toBe(false);
  });
});

describe("messages", () => {
  let thread = 0;
  it("commenters and above write; viewers and outsiders can't", async () => {
    const viewerBefore = await outbox("WORK_PROJECT_MESSAGE", viewer);
    const ownerBefore = await outbox("WORK_PROJECT_MESSAGE", owner);
    expect((await collab.postMessage(projectId, form({ subject: "Hello", body: "Hi" }), who(viewer))).ok).toBe(false);
    expect(await collab.postMessage(projectId, form({ subject: "Hello", body: "Hi" }), who(outsider))).toEqual({ ok: false, message: "Not found." });
    expect((await collab.postMessage(projectId, form({ subject: "", body: "Hi" }), who(owner))).ok).toBe(false);
    const posted = await collab.postMessage(projectId, form({ subject: `Kick-off ${tag}`, body: `Welcome @[Co viewer](user:${viewer}) and @[Co outsider](user:${outsider})` }), who(owner));
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;
    thread = posted.value.id;
    expect(posted.message).toContain("can't see this project");
    // Members are told of a new thread; the mentioned viewer once (as a mention); the outsider not at all.
    expect(await outbox("WORK_PROJECT_MESSAGE", editor)).toBeGreaterThanOrEqual(1);
    expect(await outbox("WORK_PROJECT_MESSAGE", viewer)).toBe(viewerBefore + 1);
    expect(await outbox("WORK_PROJECT_MESSAGE", outsider)).toBe(0);
    expect(await outbox("WORK_PROJECT_MESSAGE", owner)).toBe(ownerBefore);
  });
  it("replies are one level and tell the thread's people", async () => {
    const before = await outbox("WORK_PROJECT_MESSAGE", owner);
    const reply = await collab.postMessage(projectId, form({ parentId: String(thread), body: "Thanks!" }), who(commenter));
    expect(reply.ok).toBe(true);
    expect(await outbox("WORK_PROJECT_MESSAGE", owner)).toBe(before + 1);
    const deeper = await collab.postMessage(projectId, form({ parentId: String(reply.ok ? reply.value.id : 0), body: "Deeper" }), who(owner));
    expect(deeper.ok).toBe(false);
    const view = await collab.loadMessages(projectId, who(viewer));
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.value.canWrite).toBe(false);
    const top = view.value.threads.find((item) => item.id === thread)!;
    expect(top.replies).toBe(1);
    expect(view.value.replies.filter((item) => item.parentId === thread)).toHaveLength(1);
  });
  it("only the writer and IT edit or delete; every earlier text is kept", async () => {
    expect((await collab.changeMessage(thread, { subject: "Changed", body: "Changed" }, who(editor))).ok).toBe(false);
    expect((await collab.changeMessage(thread, { subject: "New subject", body: "Edited text" }, who(owner))).ok).toBe(true);
    expect((await collab.changeMessage(thread, { delete: true }, who(itAdmin, "IT", ["IT_ADMIN"]))).ok).toBe(true);
    const versions = await collab.messageVersions(thread, who(viewer));
    expect(versions.ok && versions.value.map((version) => [version.kind, version.subject])).toEqual([
      ["EDIT", `Kick-off ${tag}`],
      ["DELETE", "New subject"],
    ]);
    expect((await collab.messageVersions(thread, who(outsider))).ok).toBe(false);
    const view = await collab.loadMessages(projectId, who(viewer));
    const deleted = view.ok ? view.value.threads.find((item) => item.id === thread) : null;
    expect(deleted).toMatchObject({ deleted: true, body: "", subject: null });
    // No replies to a deleted thread.
    expect((await collab.postMessage(projectId, form({ parentId: String(thread), body: "Late" }), who(commenter))).ok).toBe(false);
  });
  it("reactions: commenters and above, toggled", async () => {
    const posted = await collab.postMessage(projectId, form({ subject: "React", body: "Like this" }), who(editor));
    const id = posted.ok ? posted.value.id : 0;
    expect((await collab.reactToMessage(id, "THUMBS_UP", who(viewer))).ok).toBe(false);
    expect(await collab.reactToMessage(id, "THUMBS_UP", who(commenter))).toMatchObject({ ok: true, value: { on: true } });
    expect((await collab.reactToMessage(id, "NOPE", who(commenter))).ok).toBe(false);
    const view = await collab.loadMessages(projectId, who(commenter));
    expect(view.ok && view.value.threads.find((item) => item.id === id)?.reactions).toEqual([{ key: "THUMBS_UP", count: 1, mine: true }]);
    expect(await collab.reactToMessage(id, "THUMBS_UP", who(commenter))).toMatchObject({ ok: true, value: { on: false } });
  });
});

describe("page", () => {
  it("owners and editors write; stale saves are refused; mentions are told once", async () => {
    expect((await collab.savePage(projectId, { title: "Brief", body: "x", rowVersion: 0 }, who(commenter))).ok).toBe(false);
    expect((await collab.savePage(projectId, { title: "Brief", body: "x", rowVersion: 0 }, who(outsider))).ok).toBe(false);
    const first = await collab.savePage(projectId, { title: "Brief", body: `# Goals\nShip it. @[Co viewer](user:${viewer})`, rowVersion: 0 }, who(editor));
    expect(first).toMatchObject({ ok: true, value: { rowVersion: 1 } });
    const told = await outbox("WORK_PROJECT_MESSAGE", viewer);
    const stale = await collab.savePage(projectId, { title: "Brief", body: "Mine", rowVersion: 0 }, who(owner));
    expect(stale.ok).toBe(false);
    expect(await collab.savePage(projectId, { title: "Brief", body: `# Goals\nShip it. @[Co viewer](user:${viewer})`, rowVersion: 1 }, who(owner))).toMatchObject({ ok: true, message: "No change." });
    const second = await collab.savePage(projectId, { title: "Brief", body: `# Goals\nShip it soon. @[Co viewer](user:${viewer})`, rowVersion: 1 }, who(owner));
    expect(second).toMatchObject({ ok: true, value: { rowVersion: 2 } });
    expect(await outbox("WORK_PROJECT_MESSAGE", viewer)).toBe(told); // already mentioned: not told again
    const page = await collab.loadPage(projectId, who(viewer));
    expect(page.ok && page.value).toMatchObject({ title: "Brief", rowVersion: 2, canEdit: false });
  });
  it("keeps the newest 50 versions and restores one as a new version", async () => {
    let version = 2;
    for (let n = 0; n < 50; n += 1) {
      const saved = await collab.savePage(projectId, { title: "Brief", body: `Draft ${n}`, rowVersion: version }, who(owner));
      if (!saved.ok) throw new Error(saved.message);
      version = saved.value.rowVersion;
    }
    const counted = await rows("SELECT COUNT(*) AS total FROM project_page_versions WHERE project_id = ?", [projectId]);
    expect(Number(counted[0]?.total)).toBe(50);
    const restored = await collab.savePage(projectId, { title: undefined, body: undefined, rowVersion: version, restore: version - 3 }, who(editor));
    expect(restored.ok).toBe(true);
    const page = await collab.loadPage(projectId, who(owner));
    expect(page.ok && page.value.body).toBe("Draft 46");
    expect(page.ok && page.value.versions[0]).toMatchObject({ versionNo: version + 1, restoredFrom: version - 3 });
    expect((await collab.savePage(projectId, { title: undefined, body: undefined, rowVersion: version + 1, restore: 1 }, who(owner))).ok).toBe(false); // dropped
  });
  it("shows linked tasks the reader may see and counts the others", async () => {
    const page = await collab.loadPage(projectId, who(owner));
    const base = page.ok ? page.value.rowVersion : 0;
    const body = `Links: [A](https://cms.example/users/tasks/${taskA}) [S](https://cms.example/users/tasks/${secret})`;
    expect((await collab.savePage(projectId, { title: "Brief", body, rowVersion: base }, who(owner))).ok).toBe(true);
    const seen = await collab.loadPage(projectId, who(viewer));
    expect(seen.ok && seen.value.linked.map((item) => item.id)).toEqual([taskA]);
    expect(seen.ok && seen.value.hiddenLinks).toBe(1);
  });
});

describe("time tracking", () => {
  it("the assignee logs time; viewers and outsiders can't; days are checked", async () => {
    expect((await time.logTime(taskA, { workDay: today, duration: "1h 30m", note: "Site visit" }, who(commenter))).ok).toBe(true);
    expect((await time.logTime(taskA, { workDay: today, duration: "1h" }, who(viewer))).ok).toBe(false);
    expect(await time.logTime(taskA, { workDay: today, duration: "1h" }, who(outsider))).toEqual({ ok: false, message: "Not found." });
    expect((await time.logTime(taskA, { workDay: addDays(today, 1), duration: "1h" }, who(commenter))).ok).toBe(false);
    expect((await time.logTime(taskA, { workDay: today, duration: "30h" }, who(commenter))).ok).toBe(false);
  });
  it("start and stop: one running entry per person, at most a day", async () => {
    const t0 = new Date();
    expect((await time.timeTimer(taskA, "start", who(owner), t0)).ok).toBe(true);
    expect((await time.timeTimer(taskA, "start", who(owner), t0)).ok).toBe(false);
    const view = await time.loadTaskTime(taskA, who(owner));
    expect(view?.running).not.toBeNull();
    expect(await time.timeTimer(taskA, "stop", who(owner), new Date(t0.getTime() + 45 * 60_000))).toMatchObject({ ok: true, value: { minutes: 45 } });
    expect((await time.timeTimer(taskA, "stop", who(owner))).ok).toBe(false);
  });
  it("others' entries: owners and editors (audited), not commenters", async () => {
    const view = await time.loadTaskTime(taskA, who(commenter));
    const mine = view!.entries.find((entry) => entry.userId === commenter)!;
    const owners = view!.entries.find((entry) => entry.userId === owner)!;
    expect(mine.canChange).toBe(true);
    expect(owners.canChange).toBe(false);
    expect((await time.changeEntry(owners.id, { duration: "5h" }, who(commenter))).ok).toBe(false);
    expect((await time.changeEntry(mine.id, { duration: "2h" }, who(editor))).ok).toBe(true);
    const audit = await rows("SELECT metadata_json FROM audit_logs WHERE action = 'TIME_ENTRY_CHANGED' AND entity_id = ? ORDER BY id DESC LIMIT 1", [String(taskA)]);
    expect(audit[0]?.metadata_json).toMatchObject({ others: true, before: { minutes: 90 }, after: { minutes: 120 } });
    expect((await time.changeEntry(owners.id, { delete: true }, who(owner))).ok).toBe(true);
    const after = await time.loadTaskTime(taskA, who(viewer));
    expect(after?.total).toBe(120);
    expect(after?.canLog).toBe(false);
  });
  it("estimates by planners; totals roll up to the project; CSV of visible entries", async () => {
    expect((await time.setEstimate(taskA, "4h", who(viewer))).ok).toBe(false);
    expect(await time.setEstimate(taskA, "4h", who(owner))).toMatchObject({ ok: true, value: { minutes: 240 } });
    expect((await time.setEstimate(taskA, "lots", who(owner))).ok).toBe(false);
    expect((await time.logTime(subtask, { workDay: today, duration: "30m" }, who(owner))).ok).toBe(true);
    expect(await time.projectTime(projectId, who(viewer))).toEqual({ logged: 150, estimate: 240, tasksWithEstimate: 1 });
    expect(await time.projectTime(projectId, who(outsider))).toBeNull();
    const csv = await time.timeCsv(projectId, who(viewer));
    expect(csv.ok).toBe(true);
    const lines = csv.ok ? csv.value.csv.trim().split(/\r\n/) : [];
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Date,Person,Task ID");
    expect(csv.ok && csv.value.csv).toContain("Site visit");
    expect((await time.timeCsv(projectId, who(outsider))).ok).toBe(false);
  });
  it("the Dashboard's time entries count logged time; Workload offers the estimate", async () => {
    const chart = await reporting.previewChart(projectId, chartConfigSchema.parse({ style: "bar", source: "time", x: { by: "person" }, metrics: [{ measure: "sum" }] }), who(owner));
    expect(chart.ok).toBe(true);
    if (!chart.ok) return;
    const byName = Object.fromEntries(chart.value.categories.map((category, index) => [category.label, chart.value.values[0]![index]]));
    expect(byName).toEqual({ [`Co commenter ${tag}`]: 2 }); // the subtask isn't in the project's own task list
    const workload = await reporting.loadWorkload(projectId, who(owner), { metric: "estimate", from: today });
    expect(workload.ok && workload.value.metric).toBe("estimate");
    expect(workload.ok && workload.value.metricKind).toBe("hours");
  });
});

describe("the switch and the purge", () => {
  it("pm_extras off refuses every new operation", async () => {
    await setting("features.pm_extras", "OFF");
    try {
      expect((await collab.loadProjectFiles(projectId, who(owner))).ok).toBe(false);
      expect((await collab.loadMessages(projectId, who(owner))).ok).toBe(false);
      expect((await collab.savePage(projectId, { title: "x", body: "x", rowVersion: 0 }, who(owner))).ok).toBe(false);
      expect((await time.logTime(taskA, { workDay: today, duration: "1h" }, who(owner))).ok).toBe(false);
      expect(await time.loadTaskTime(taskA, who(owner))).toBeNull();
    } finally {
      await setting("features.pm_extras", "ON");
    }
  });
  it("a purged project takes its messages, versions, reactions, files and page with it", async () => {
    const made = await work.createProject({ name: `Purge ${tag}`, description: "", color: "blue", privacy: "PRIVATE", departmentId: null, defaultAccessRole: "VIEWER", defaultView: "LIST", startOn: "", dueOn: "" }, who(owner));
    if (!made.ok) throw new Error(made.message);
    const pid = made.value.id;
    const posted = await collab.postMessage(pid, form({ subject: "Bye", body: "Soon gone" }), who(owner));
    const mid = posted.ok ? posted.value.id : 0;
    await collab.postMessage(pid, form({ parentId: String(mid), body: "Reply" }), who(owner));
    await collab.changeMessage(mid, { subject: "Bye!", body: "Edited" }, who(owner));
    await collab.reactToMessage(mid, "HEART", who(owner));
    await fileOn("PROJECT_MESSAGE", mid, owner, "bye.pdf");
    await collab.savePage(pid, { title: "P", body: "Page", rowVersion: 0 }, who(owner));
    await db().query("UPDATE projects SET deleted_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 40 DAY) WHERE id = ?", [pid]);
    const files: string[] = [];
    expect(await withTransaction((connection) => purgeProject(pid, connection, files))).toBe(1);
    expect(files).toHaveLength(1);
    for (const table of ["project_messages", "project_pages", "project_page_versions"]) expect(await rows(`SELECT 1 FROM ${table} WHERE project_id = ?`, [pid])).toHaveLength(0);
    expect(await rows("SELECT 1 FROM project_message_versions WHERE message_id = ?", [mid])).toHaveLength(0);
    expect(await rows("SELECT 1 FROM record_files WHERE entity_type = 'PROJECT_MESSAGE' AND entity_id = ?", [mid])).toHaveLength(0);
  });
});
