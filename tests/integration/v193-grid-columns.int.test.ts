import { beforeAll, describe, expect, it } from "vitest";
import { getDbPool } from "@/lib/db/client";
import * as work from "@/server/work/service";
import * as repo from "@/lib/db/repositories/work.repository";
import { changeMyTabs } from "@/server/work/view-tabs-service";
import { saveSummaryFields, summaryFields } from "@/server/work/summary-share";
import { toGridTask } from "@/server/work/grid-rows";
import type { ModuleCode } from "@/server/modules/modules";
import { createUser, workingDayFrom } from "./helpers";

// v1.93.0 (owner 27 Nov 2026): the Last comment column's data (D-448), the
// column order saved with a view (D-446) and the new defaults (D-447),
// through the services against MySQL.
const tag = Date.now().toString(36);
const ALL: ModuleCode[] = ["APPROVAL", "TASK", "PROJECT"];
const who = (id: number) => ({ id, name: `G${id}`, roles: ["USER"] as string[], modules: ALL, sessionId: "v193-grid", ipAddress: null });
const db = () => getDbPool();
let owner: number;
let projectId: number;

const task = async (title: string) => {
  const added = await work.quickAddTask({ title: `${title} ${tag}`, projectId, sectionId: null, parentId: null, assigneeId: null, dueDay: await workingDayFrom(10), mySectionId: null }, who(owner));
  if (!added.ok) throw new Error(added.message);
  return added.value.id;
};
const comment = async (taskId: number, body: string, parent: number | null = null) => {
  const added = await work.addComment(taskId, body, parent, who(owner), { addMentionedAsFollowers: false });
  if (!added.ok) throw new Error(added.message);
  return added.value.id;
};

beforeAll(async () => {
  owner = await createUser({ name: `Grid owner ${tag}` });
  const created = await work.createProject({ name: `Grid ${tag}`, description: "", color: "blue", privacy: "PRIVATE", departmentId: null, defaultAccessRole: "EDITOR", defaultView: "LIST", startOn: "", dueOn: "" }, who(owner));
  if (!created.ok) throw new Error(created.message);
  projectId = created.value.id;
});

describe("Last comment (D-448)", () => {
  it("is the newest live comment (a reply counts), as plain text with its author; deleted ones are skipped", async () => {
    const withReply = await task("Replied");
    const first = await comment(withReply, "First note");
    await comment(withReply, "Reply with **bold** and @[Grid owner](user:1)", first);
    const deleted = await task("Deleted");
    await comment(deleted, "Kept one");
    const gone = await comment(deleted, "Removed one");
    expect((await work.changeComment(gone, { delete: true }, who(owner))).ok).toBe(true);
    const none = await task("Quiet");
    const items = await repo.listProjectTasks(projectId);
    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.get(withReply)?.lastComment).toMatchObject({ text: "Reply with bold and @Grid owner", authorName: `Grid owner ${tag}` });
    expect(byId.get(withReply)?.lastComment?.at).toBeInstanceOf(Date);
    expect(byId.get(deleted)?.lastComment?.text).toBe("Kept one");
    expect(byId.get(none)?.lastComment).toBeNull();
    // The table row carries it as ISO text.
    const row = toGridTask(byId.get(withReply)!, owner, true);
    expect(row.lastComment).toMatchObject({ text: "Reply with bold and @Grid owner" });
    expect(typeof row.lastComment?.at).toBe("string");
  });
  it("is read for every task of a list in one batch (other lists use the same decorate)", async () => {
    const { items } = await repo.listTaskItems(["t.created_by = ?", "t.deleted_at IS NULL"], [owner], "t.id", 50);
    expect(items.filter((item) => item.lastComment).length).toBe(2);
  });
});

describe("column order and defaults saved with a view (D-446, D-447)", () => {
  it("a personal List tab keeps its column order; a stored choice of columns keeps Created by once shown again", async () => {
    const added = await changeMyTabs({ op: "add", type: "LIST", name: "Ordered" }, who(owner));
    if (!added.ok) throw new Error(added.message);
    expect((await changeMyTabs({ op: "save", key: `t${added.value.id}`, config: { v: 2, hidden: [], columnOrder: ["lastComment", "due", "start"] }, auto: true }, who(owner))).ok).toBe(true);
    const stored = (await repo.listMyTabs(owner)).rows.find((row) => row.id === added.value.id);
    expect(stored?.config).toMatchObject({ v: 2, hidden: [], columnOrder: ["lastComment", "due", "start"] });
    // Junk in the order is refused, not stored.
    expect((await changeMyTabs({ op: "save", key: `t${added.value.id}`, config: { v: 2, columnOrder: ["bad key!"] } }, who(owner))).ok).toBe(false);
    // Customise > Fields: the default leaves Created by out; ticked back on, it stays on.
    expect(await summaryFields(owner)).toEqual({ hidden: ["createdBy"], hiddenFields: [] });
    expect((await saveSummaryFields({ hidden: [], hiddenFields: [] }, who(owner))).ok).toBe(true);
    expect(await summaryFields(owner)).toEqual({ hidden: [], hiddenFields: [] });
  });
  it("an old stored view (no version) is read with Created by hidden and the owner's hidden columns kept", async () => {
    const added = await changeMyTabs({ op: "add", type: "LIST", name: "Old one" }, who(owner));
    if (!added.ok) throw new Error(added.message);
    await db().query("UPDATE work_views SET config_json = ? WHERE id = ?", [JSON.stringify({ group: "section", hidden: ["tags"] }), added.value.id]);
    const { parseTabConfig } = await import("@/server/work/view-tabs");
    const stored = (await repo.listMyTabs(owner)).rows.find((row) => row.id === added.value.id);
    expect(parseTabConfig("LIST", stored?.config)).toMatchObject({ v: 2, hidden: ["tags", "createdBy"], columnOrder: [] });
  });
});
