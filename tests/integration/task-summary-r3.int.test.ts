import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import * as work from "@/server/work/service";
import { changeMyTabs } from "@/server/work/view-tabs-service";
import { workViewer } from "@/server/work/task-access";
import { changeShare, summaryAccess } from "@/server/work/summary-share";
import { answerAccessRequest, hasOpenRequest, listAccessRequests, loadProfileCard, loadSummaryDashboard, loadSummaryFiles, loadSummaryNotes, requestSummaryAccess, saveSummaryNotes } from "@/server/work/summary-extras";
import { addDays, indiaDay } from "@/server/work/rules";
import { listMyTabs, listTaskItems } from "@/lib/db/repositories/work.repository";
import type { ModuleCode } from "@/server/modules/modules";
import { createUser } from "./helpers";

// v1.78.0 (D-405, Task Summary release 3): the permission matrix of the new
// Dashboard, Notes and Files tabs and of the profile Tasks card (owner,
// manager up the chain, shared viewer, stranger), Request access (notice,
// grant through the share, decline, audit), Notes tabs stored as NOTES, and
// the employee code on task rows.
const tag = Date.now().toString(36);
const ALL: ModuleCode[] = ["APPROVAL", "TASK", "PROJECT"];
const person = (id: number, roles: string[] = ["USER"]) => ({ id, name: `R3P${id}`, roles, modules: ALL, sessionId: "ts-r3", ipAddress: null });
const viewerOf = (id: number) => workViewer({ id, roles: ["USER"], modules: ALL });
const now = new Date();
const today = indiaDay(now);
let boss: number;
let owner: number;
let peer: number;
let stranger: number;
let fromPeer: number;
let fromStranger: number;

const add = async (title: string, assignee: number, by: number, due = addDays(today, 1)) => {
  const created = await work.quickAddTask({ title: `${title} ${tag}`, projectId: null, sectionId: null, parentId: null, assigneeId: assignee, dueDay: due, mySectionId: null, holidayOk: true }, person(by));
  if (!created.ok) throw new Error(created.message);
  return created.value.id;
};
const count = async (sql: string, params: unknown[]) => Number(((await getDbPool().query<RowDataPacket[]>(sql, params))[0][0] as RowDataPacket | undefined)?.n ?? 0);
const notices = (event: string, userId: number) => count("SELECT COUNT(*) AS n FROM notification_outbox WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.eventType')) = ? AND JSON_EXTRACT(payload_json, '$.userId') = ?", [event, userId]);
const audits = (action: string, actor: number) => count("SELECT COUNT(*) AS n FROM audit_logs WHERE action = ? AND actor_user_id = ?", [action, actor]);
const attach = (taskId: number, by: number, name: string) =>
  getDbPool().query("INSERT INTO record_files (entity_type, entity_id, purpose, uploaded_by, original_name, stored_path, content_type, size_bytes, sha256) VALUES ('TASK', ?, 'GENERAL', ?, ?, ?, 'text/plain', 10, ?)", [taskId, by, name, `test/${tag}-${name}`, "0".repeat(64)]);

beforeAll(async () => {
  boss = await createUser({ name: `TS3 boss ${tag}` });
  owner = await createUser({ name: `TS3 owner ${tag}`, managerId: boss });
  peer = await createUser({ name: `TS3 peer ${tag}`, managerId: boss });
  stranger = await createUser({ name: `TS3 stranger ${tag}` });
  fromPeer = await add("From peer", owner, peer, addDays(today, -2)); // overdue
  fromStranger = await add("Private from stranger", owner, stranger);
  await attach(fromPeer, peer, `peer-file-${tag}.txt`);
  await attach(fromStranger, stranger, `stranger-file-${tag}.txt`);
  await changeShare({ op: "add", userId: peer }, person(owner));
});
afterAll(async () => {
  await getDbPool().end();
});

describe("Dashboard tab", () => {
  it("the owner and their manager count every task; a shared viewer only what they may see; nothing is masked", async () => {
    const mine = await loadSummaryDashboard(owner, await viewerOf(owner), "30d", now);
    const numbers = (view: typeof mine) => Object.fromEntries(view.numbers.map((number) => [number.key, number.value]));
    expect(numbers(mine)).toMatchObject({ open: 2, overdue: 1 });
    expect(numbers(await loadSummaryDashboard(owner, await viewerOf(boss), "30d", now))).toMatchObject({ open: 2 });
    expect(numbers(await loadSummaryDashboard(owner, await viewerOf(peer), "30d", now))).toMatchObject({ open: 1, overdue: 1 });
  });
});

describe("Files tab", () => {
  it("files on the owner's tasks; a viewer gets only those on tasks they may see", async () => {
    const names = async (viewerId: number) => (await loadSummaryFiles(owner, await viewerOf(viewerId))).map((file) => file.name).filter((name) => name.includes(tag)).sort();
    expect(await names(owner)).toEqual([`peer-file-${tag}.txt`, `stranger-file-${tag}.txt`]);
    expect(await names(boss)).toEqual([`peer-file-${tag}.txt`, `stranger-file-${tag}.txt`]);
    expect(await names(peer)).toEqual([`peer-file-${tag}.txt`]);
    const files = await loadSummaryFiles(owner, await viewerOf(owner));
    expect(files.find((file) => file.name === `peer-file-${tag}.txt`)).toMatchObject({ source: "TASK", taskId: fromPeer });
  });
});

describe("Notes tab", () => {
  it("only the owner reads and writes their notes; a stale save is refused", async () => {
    expect(await loadSummaryNotes(await viewerOf(owner), owner)).toEqual({ body: "", rowVersion: 0, updatedAt: null });
    expect(await saveSummaryNotes({ body: "**Plan** for Monday", rowVersion: 0 }, person(owner))).toMatchObject({ ok: true, rowVersion: 1 });
    expect(await saveSummaryNotes({ body: "Changed", rowVersion: 1 }, person(owner))).toMatchObject({ ok: true, rowVersion: 2 });
    expect(await saveSummaryNotes({ body: "From an old window", rowVersion: 1 }, person(owner))).toMatchObject({ ok: false, conflict: true });
    expect((await loadSummaryNotes(await viewerOf(owner), owner))!.body).toBe("Changed");
    // Manager, shared viewer and stranger: private.
    expect(await loadSummaryNotes(await viewerOf(boss), owner)).toBeNull();
    expect(await loadSummaryNotes(await viewerOf(peer), owner)).toBeNull();
    expect(await loadSummaryNotes(await viewerOf(stranger), owner)).toBeNull();
    // Someone else's save only ever writes their own notes.
    expect(await saveSummaryNotes({ body: "peer's own", rowVersion: 0 }, person(peer))).toMatchObject({ ok: true });
    expect((await loadSummaryNotes(await viewerOf(owner), owner))!.body).toBe("Changed");
    expect(await saveSummaryNotes({ body: "x".repeat(50_001), rowVersion: 2 }, person(owner))).toMatchObject({ ok: false });
    expect(await audits("TASK_SUMMARY_NOTES_STARTED", owner)).toBe(1);
  });

  it("a Notes tab can be added to a Task Summary (stored as NOTES)", async () => {
    const added = await changeMyTabs({ op: "add", type: "NOTES" }, person(owner));
    expect(added).toMatchObject({ ok: true });
    const tabs = await listMyTabs(owner);
    expect(tabs.rows.some((row) => row.type === "NOTES" && row.name === "Notes")).toBe(true);
  });
});

describe("Request access", () => {
  it("a stranger refused asks once; the owner is told; asking again sends nothing", async () => {
    expect((await summaryAccess(await viewerOf(stranger), owner)).access).toBeNull();
    expect(await requestSummaryAccess({ ownerId: owner, note: "For the plant review" }, person(stranger), await viewerOf(stranger))).toMatchObject({ ok: true });
    expect(await hasOpenRequest(owner, stranger)).toBe(true);
    expect(await notices("WORK_SUMMARY_ACCESS_REQUEST", owner)).toBe(1);
    expect(await audits("TASK_SUMMARY_ACCESS_REQUESTED", stranger)).toBe(1);
    expect(await requestSummaryAccess({ ownerId: owner }, person(stranger), await viewerOf(stranger))).toMatchObject({ ok: true, message: expect.stringMatching(/already asked/) });
    expect(await notices("WORK_SUMMARY_ACCESS_REQUEST", owner)).toBe(1);
    expect((await listAccessRequests(owner)).map((request) => [request.requesterId, request.note])).toEqual([[stranger, "For the plant review"]]);
  });

  it("not for someone who can already open it, for yourself, or for an unknown person", async () => {
    expect(await requestSummaryAccess({ ownerId: owner }, person(peer), await viewerOf(peer))).toMatchObject({ ok: false });
    expect(await requestSummaryAccess({ ownerId: owner }, person(boss), await viewerOf(boss))).toMatchObject({ ok: false });
    expect(await requestSummaryAccess({ ownerId: owner }, person(owner), await viewerOf(owner))).toMatchObject({ ok: false });
    expect(await requestSummaryAccess({ ownerId: 999999999 }, person(stranger), await viewerOf(stranger))).toMatchObject({ ok: false, message: "Not found." });
  });

  it("only the owner answers their own requests; grant = a read-only share (told, audited)", async () => {
    // Someone else can't answer it (they have no request from the stranger).
    expect(await answerAccessRequest({ requesterId: stranger, decision: "grant" }, person(peer))).toMatchObject({ ok: false });
    expect((await summaryAccess(await viewerOf(stranger), owner)).access).toBeNull();
    const told = await notices("WORK_SUMMARY_SHARED", stranger);
    expect(await answerAccessRequest({ requesterId: stranger, decision: "grant" }, person(owner))).toMatchObject({ ok: true });
    expect((await summaryAccess(await viewerOf(stranger), owner)).access).toBe("SHARED");
    expect(await notices("WORK_SUMMARY_SHARED", stranger)).toBe(told + 1);
    expect(await hasOpenRequest(owner, stranger)).toBe(false);
    expect(await count("SELECT COUNT(*) AS n FROM task_summary_access_requests WHERE owner_id = ? AND requester_id = ? AND outcome = 'GRANTED' AND resolved_by = ?", [owner, stranger, owner])).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'TASK_SUMMARY_SHARED' AND actor_user_id = ? AND JSON_EXTRACT(metadata_json, '$.fromRequest') = true", [owner])).toBe(1);
    // Answered already.
    expect(await answerAccessRequest({ requesterId: stranger, decision: "decline" }, person(owner))).toMatchObject({ ok: false });
  });

  it("decline closes it (audited) and the person may ask again later", async () => {
    await changeShare({ op: "remove", userId: stranger }, person(owner));
    expect(await requestSummaryAccess({ ownerId: owner }, person(stranger), await viewerOf(stranger))).toMatchObject({ ok: true, message: expect.stringMatching(/Request sent/) });
    expect(await answerAccessRequest({ requesterId: stranger, decision: "decline" }, person(owner))).toMatchObject({ ok: true });
    expect(await audits("TASK_SUMMARY_ACCESS_DECLINED", owner)).toBe(1);
    expect((await summaryAccess(await viewerOf(stranger), owner)).access).toBeNull();
    expect(await listAccessRequests(owner)).toEqual([]);
    expect(await requestSummaryAccess({ ownerId: owner }, person(stranger), await viewerOf(stranger))).toMatchObject({ ok: true, message: expect.stringMatching(/Request sent/) });
    // Sharing through Invite answers an open request too.
    await changeShare({ op: "add", userId: stranger }, person(owner));
    expect(await hasOpenRequest(owner, stranger)).toBe(false);
    await changeShare({ op: "remove", userId: stranger }, person(owner));
  });
});

describe("profile Tasks card", () => {
  it("owner, manager and shared viewer see it (only the tasks they may see); a stranger doesn't", async () => {
    const card = async (viewerId: number) => loadProfileCard(await viewerOf(viewerId), owner);
    const own = await card(owner);
    expect(own).toMatchObject({ own: true });
    expect(own!.tasks.map((task) => task.id)).toContain(fromStranger);
    const managed = await card(boss);
    expect(managed).toMatchObject({ own: false });
    expect(managed!.tasks.map((task) => task.id)).toContain(fromStranger);
    const shared = await card(peer);
    expect(shared!.tasks.map((task) => task.id)).not.toContain(fromStranger);
    expect(await card(stranger)).toBeNull();
  });
});

describe("employee code on task rows", () => {
  it("rows carry the assignee's and creator's User ID", async () => {
    const { items } = await listTaskItems(["t.id = ?"], [fromStranger], "t.id", 5);
    const [[users]] = await getDbPool().query<RowDataPacket[]>("SELECT (SELECT login_id FROM users WHERE id = ?) AS a, (SELECT login_id FROM users WHERE id = ?) AS c", [owner, stranger]);
    expect(items[0]).toMatchObject({ assigneeCode: String(users!.a), createdByCode: String(users!.c) });
  });
});
