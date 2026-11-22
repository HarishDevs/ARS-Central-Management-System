import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import * as work from "@/server/work/service";
import * as repo from "@/lib/db/repositories/work.repository";
import { changeMyTabs } from "@/server/work/view-tabs-service";
import { workViewer } from "@/server/work/task-access";
import { loadTaskSummary } from "@/server/work/task-summary";
import { changeShare, listShares, managersAbove, openableSummaries, saveSummaryFields, summaryAccess, summaryFields } from "@/server/work/summary-share";
import { addDays, indiaDay } from "@/server/work/rules";
import type { ModuleCode } from "@/server/modules/modules";
import { createUser } from "./helpers";

// v1.77.0 (D-404, owner's Task Summary decision 3, release 2): the
// permissions matrix for opening someone's Task Summary (owner, manager up
// the chain, peer without a grant, granted viewer, revoked viewer, IT), that
// a viewer only gets the tasks they may see (the rest left out), the audit
// trail and the notice, Customise › Fields, and Board/Calendar tab settings.
const tag = Date.now().toString(36);
const ALL: ModuleCode[] = ["APPROVAL", "TASK", "PROJECT"];
const person = (id: number, roles: string[] = ["USER"]) => ({ id, name: `P${id}`, roles, modules: ALL, sessionId: "ts-r2", ipAddress: null });
const viewerOf = (id: number, roles: string[] = ["USER"]) => workViewer({ id, roles, modules: ALL });
const now = new Date();
const today = indiaDay(now);
let bigBoss: number;
let boss: number;
let owner: number;
let peer: number;
let stranger: number;
let it_: number;
let inactive: number;
let fromPeer: number;
let fromStranger: number;

const add = async (title: string, assignee: number, by: number) => {
  const created = await work.quickAddTask({ title: `${title} ${tag}`, projectId: null, sectionId: null, parentId: null, assigneeId: assignee, dueDay: addDays(today, 1), mySectionId: null, holidayOk: true }, person(by));
  if (!created.ok) throw new Error(created.message);
  return created.value.id;
};
const access = async (viewerId: number, ownerId: number, roles: string[] = ["USER"]) => (await summaryAccess(await viewerOf(viewerId, roles), ownerId)).access;
const count = async (sql: string, params: unknown[]) => Number(((await getDbPool().query<RowDataPacket[]>(sql, params))[0][0] as RowDataPacket | undefined)?.n ?? 0);
const notices = (userId: number) => count("SELECT COUNT(*) AS n FROM notification_outbox WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.eventType')) = 'WORK_SUMMARY_SHARED' AND JSON_EXTRACT(payload_json, '$.userId') = ?", [userId]);
const audits = (action: string, actor: number) => count("SELECT COUNT(*) AS n FROM audit_logs WHERE action = ? AND actor_user_id = ?", [action, actor]);

beforeAll(async () => {
  bigBoss = await createUser({ name: `TS2 big boss ${tag}` });
  boss = await createUser({ name: `TS2 boss ${tag}`, managerId: bigBoss });
  owner = await createUser({ name: `TS2 owner ${tag}`, managerId: boss });
  peer = await createUser({ name: `TS2 peer ${tag}`, managerId: boss });
  stranger = await createUser({ name: `TS2 stranger ${tag}` });
  it_ = await createUser({ name: `TS2 IT ${tag}`, roles: ["USER", "IT_ADMIN"] });
  inactive = await createUser({ name: `TS2 gone ${tag}`, active: false });
  fromPeer = await add("From peer", owner, peer);
  fromStranger = await add("Private from stranger", owner, stranger);
});
afterAll(async () => {
  await getDbPool().end();
});

describe("who may open whose Task Summary", () => {
  it("owner, managers up the chain; not a peer, a stranger, IT or a report", async () => {
    expect(await access(owner, owner)).toBe("OWN");
    expect(await access(boss, owner)).toBe("MANAGER");
    expect(await access(bigBoss, owner)).toBe("MANAGER");
    expect(await access(peer, owner)).toBeNull();
    expect(await access(stranger, owner)).toBeNull();
    expect(await access(it_, owner, ["USER", "IT_ADMIN"])).toBeNull();
    expect(await access(owner, boss)).toBeNull();
    expect(await access(boss, 999999999)).toBeNull();
  });

  it("a grant opens it read-only; a removal closes it again; both audited; the person is told once", async () => {
    const before = await notices(peer);
    expect(await changeShare({ op: "add", userId: peer }, person(owner))).toMatchObject({ ok: true });
    expect(await access(peer, owner)).toBe("SHARED");
    expect(await notices(peer)).toBe(before + 1);
    expect(await audits("TASK_SUMMARY_SHARED", owner)).toBe(1);
    // Sharing again changes nothing and tells nobody again.
    expect(await changeShare({ op: "add", userId: peer }, person(owner))).toMatchObject({ ok: true, message: expect.stringMatching(/already/) });
    expect(await notices(peer)).toBe(before + 1);
    expect((await listShares(owner)).map((share) => share.id)).toEqual([peer]);
    expect((await openableSummaries(await viewerOf(peer))).shared.map((item) => item.id)).toContain(owner);

    expect(await changeShare({ op: "remove", userId: peer }, person(owner))).toMatchObject({ ok: true });
    expect(await access(peer, owner)).toBeNull();
    expect(await audits("TASK_SUMMARY_UNSHARED", owner)).toBe(1);
    expect(await listShares(owner)).toEqual([]);
    // The record is kept (revoked), and sharing again reopens the same row.
    expect(await count("SELECT COUNT(*) AS n FROM task_summary_shares WHERE owner_id = ? AND viewer_id = ? AND revoked_at IS NOT NULL", [owner, peer])).toBe(1);
    expect(await changeShare({ op: "add", userId: peer }, person(owner))).toMatchObject({ ok: true });
    expect(await count("SELECT COUNT(*) AS n FROM task_summary_shares WHERE owner_id = ? AND viewer_id = ?", [owner, peer])).toBe(1);
    expect(await notices(peer)).toBe(before + 2);
  });

  it("refuses yourself, inactive and unknown people, and bad input", async () => {
    expect(await changeShare({ op: "add", userId: owner }, person(owner))).toMatchObject({ ok: false });
    expect(await changeShare({ op: "add", userId: inactive }, person(owner))).toMatchObject({ ok: false, message: expect.stringMatching(/inactive/) });
    expect(await changeShare({ op: "add", userId: 999999999 }, person(owner))).toMatchObject({ ok: false });
    expect(await changeShare({ op: "share", userId: peer }, person(owner))).toMatchObject({ ok: false });
  });

  it("a grant is the owner's own: someone else's grants can't be changed (the actor is always the owner)", async () => {
    // The stranger "removes" the peer: it acts on the stranger's own list only.
    await changeShare({ op: "remove", userId: peer }, person(stranger));
    expect(await access(peer, owner)).toBe("SHARED");
  });

  it("the managers above are listed as always able to open it", async () => {
    expect((await managersAbove(owner)).map((item) => item.id)).toEqual([boss, bigBoss]);
    expect((await openableSummaries(await viewerOf(boss))).team.map((item) => item.id)).toEqual(expect.arrayContaining([owner, peer]));
  });

  it("nobody opens an inactive person's list", async () => {
    expect(await changeShare({ op: "add", userId: stranger }, person(owner))).toMatchObject({ ok: true });
    await getDbPool().query("UPDATE users SET active = FALSE WHERE id = ?", [owner]);
    try {
      expect(await access(stranger, owner)).toBeNull();
      expect(await access(boss, owner)).toBeNull();
    } finally {
      await getDbPool().query("UPDATE users SET active = TRUE WHERE id = ?", [owner]);
    }
    await changeShare({ op: "remove", userId: stranger }, person(owner));
  });
});

describe("what a viewer sees", () => {
  it("the owner and their manager see every task; a granted peer only those they may see, read-only", async () => {
    const mine = await loadTaskSummary(owner, { range: "all", recentOn: true, mine: false, now });
    expect(mine.rows.map((row) => row.id)).toEqual(expect.arrayContaining([fromPeer, fromStranger]));
    const manager = await loadTaskSummary(owner, { range: "all", recentOn: true, mine: false, now, viewer: await viewerOf(boss) });
    expect(manager.rows.map((row) => row.id)).toEqual(expect.arrayContaining([fromPeer, fromStranger]));
    expect(manager.rows.every((row) => !row.canEdit && !row.canComplete)).toBe(true);
    const shared = await loadTaskSummary(owner, { range: "all", recentOn: true, mine: false, now, viewer: await viewerOf(peer) });
    const ids = shared.rows.map((row) => row.id);
    expect(ids).toContain(fromPeer);
    // The stranger's task is left out altogether: no row, no title.
    expect(ids).not.toContain(fromStranger);
    expect(JSON.stringify(shared.rows)).not.toContain("Private from stranger");
    expect(JSON.stringify(shared.items)).not.toContain("Private from stranger");
  });

  it("reading someone's sections creates none for them", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM my_task_sections WHERE user_id = ?", [peer]);
    const data = await loadTaskSummary(peer, { range: "summary", recentOn: true, mine: true, now, viewer: await viewerOf(boss) });
    expect(data.mySections).toBeNull();
    expect(await count("SELECT COUNT(*) AS n FROM my_task_sections WHERE user_id = ?", [peer])).toBe(before);
    // The owner's own sections are read (and made) as before.
    await repo.ensureMySections(owner);
    const owned = await loadTaskSummary(owner, { range: "summary", recentOn: true, mine: true, now, viewer: await viewerOf(boss) });
    expect(owned.mySections?.length).toBeGreaterThanOrEqual(5);
  });
});

describe("Customise › Fields", () => {
  it("saves the default columns, applies them to stored List tabs, and new List tabs start with them", async () => {
    const added = await changeMyTabs({ op: "add", type: "LIST", name: "Mine" }, person(owner));
    expect(added.ok).toBe(true);
    expect((await changeMyTabs({ op: "save", key: `t${added.ok ? added.value.id : 0}`, config: { group: "createdBy" }, auto: true }, person(owner))).ok).toBe(true);
    expect(await saveSummaryFields({ hidden: ["visibility", "priority"], hiddenFields: [], applyToTabs: true }, person(owner))).toMatchObject({ ok: true });
    expect(await summaryFields(owner)).toEqual({ hidden: ["visibility", "priority"], hiddenFields: [] });
    const rows = (await repo.listMyTabs(owner)).rows.filter((row) => row.type === "LIST");
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) expect((row.config as { hidden: string[] }).hidden).toEqual(["visibility", "priority"]);
    // The stored tab keeps its grouping.
    expect(rows.find((row) => row.name === "Mine")?.config).toMatchObject({ group: "createdBy" });
    const next = await changeMyTabs({ op: "add", type: "LIST", name: "Later one" }, person(owner));
    const row = (await repo.listMyTabs(owner)).rows.find((item) => item.id === (next.ok ? next.value.id : 0));
    expect(row?.config).toMatchObject({ hidden: ["visibility", "priority"], group: "section" });
    expect(await saveSummaryFields({ hidden: ["assignee"], hiddenFields: [] }, person(owner))).toMatchObject({ ok: false });
    expect(await audits("MY_TASKS_FIELDS_CHANGED", owner)).toBe(1);
  });
});

describe("Board and Calendar tab settings", () => {
  it("a Task Summary Board and Calendar tab store their own settings (range kept)", async () => {
    const board = await changeMyTabs({ op: "add", type: "BOARD", name: "Board 2" }, person(owner));
    const key = `t${board.ok ? board.value.id : 0}`;
    expect((await changeMyTabs({ op: "settings", key, range: "all", sections: "mine" }, person(owner))).ok).toBe(true);
    expect((await changeMyTabs({ op: "save", key, config: { show: "incomplete", dueWithin: "next", sort: "priority", dir: "desc", search: "" }, auto: true }, person(owner))).ok).toBe(true);
    expect((await repo.listMyTabs(owner)).rows.find((row) => `t${row.id}` === key)?.config).toMatchObject({ show: "incomplete", sort: "priority", range: "all", sections: "mine" });
    expect((await changeMyTabs({ op: "save", key, config: { show: "everything" }, auto: true }, person(owner))).ok).toBe(false);
    const calendar = await changeMyTabs({ op: "add", type: "CALENDAR", name: "Cal 2" }, person(owner));
    const ckey = `t${calendar.ok ? calendar.value.id : 0}`;
    expect((await repo.listMyTabs(owner)).rows.find((row) => `t${row.id}` === ckey)?.config).toMatchObject({ show: "all", weekends: true, unit: "month" });
    expect((await changeMyTabs({ op: "save", key: ckey, config: { show: "all", weekends: false, unit: "week" }, auto: true }, person(owner))).ok).toBe(true);
    expect((await repo.listMyTabs(owner)).rows.find((row) => `t${row.id}` === ckey)?.config).toMatchObject({ weekends: false, unit: "week" });
  });
});
