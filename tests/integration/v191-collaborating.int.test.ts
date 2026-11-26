import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import { createWorkflow, publishVersion, submitRequest, type Actor } from "@/server/approvals/service";
import { addCollaborators, removeCollaborator } from "@/server/approvals/collaborators";
import { addAttachments, openAttachment, prepareFiles } from "@/server/attachments/service";
import { listAttachments } from "@/lib/db/repositories/attachments.repository";
import { createModuleType, publishTypeDraft, saveTypeDraft } from "@/server/modules/config";
import { DEFAULT_TASK_SETTINGS } from "@/server/modules/settings";
import { actOnTask, createTask, loadTaskFor } from "@/server/modules/tasks";
import * as work from "@/server/work/service";
import { countCollabTasks, listCollabTasks } from "@/lib/db/repositories/collaborating.repository";
import type { ModuleCode } from "@/types/auth";
import { createDepartment, createUser, pendingTaskKey, setDepartment } from "./helpers";

// v1.91.0 (D-433, D-434; governance D-432 §4.1): the common Collaborating
// screen and Commenter access. Owner (26 Nov 2026): "if I am not having any
// access for the approvals module, if I am added as a collaborator I should be
// able to open and access that approval" and "in this case I am a commenter.
// If I have the module access then I have my same privileges."
// Server checks are called directly (page access with a signed address, the
// server actions with a session), never through the UI.
const state = vi.hoisted(() => ({ path: "" as string, user: null as null | { id: number; roles: readonly string[]; modules: readonly string[]; name?: string } }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(state.path ? { "x-ars-path": state.path, "x-ars-path-sig": "sig" } : {}),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("@/lib/security/path-signature", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/path-signature")>()),
  verifyPath: async (value: string | null) => Boolean(value),
}));
vi.mock("@/server/authorization/guards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/authorization/guards")>()),
  requireApiArea: async () => {
    if (!state.user) throw new Error("UNAUTHENTICATED");
    return { user: state.user, sessionId: "test" };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/lib/http/request-context", () => ({ getActionContext: async () => ({ ipAddress: null }) }));

const { checkPageAccess } = await import("@/server/authorization/page-access");
const { collabAccess, hasCollabTabs } = await import("@/server/collaborating/service");
const collabActions = await import("@/app/users/collab-actions");
const requestActions = await import("@/app/users/actions");

const ALL: ModuleCode[] = ["APPROVAL", "TASK", "PROJECT", "INFORMATION", "MEETING", "TICKET"];
const person = (id: number, modules: readonly ModuleCode[] = ALL) => ({ id, roles: ["USER"] as const, modules, name: `P${id}` });
const pdf = (name: string) => new File([`%PDF-1.4\n${name}\n%%EOF`], name, { type: "application/pdf" });
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const setModules = (id: number, modules: readonly ModuleCode[]) => getDbPool().query("UPDATE users SET module_access = ? WHERE id = ?", [modules.join(","), id]);

let raiser: number;
let approver: number;
let commenter: number; // no Approvals, no Tasks module
let withModule: number; // every module
let outsider: number; // no modules, collaborates on nothing
let itAdmin: Actor;
let requestId: number;
let otherRequestId: number;
let attachmentId: number;
let otherAttachmentId: number;
let typeId: number;
let followedTask: number;
let ownTask: number;
let otherTask: number;
let deletedTask: number;
let counter = 0;

async function raise(title: string): Promise<number> {
  const all = [
    { id: "start", kind: "START", label: "Start" } as const,
    { id: "a", kind: "APPROVAL", label: "A", approvers: [{ type: "USER", userId: approver }], completion: { type: "ALL" } } as const,
    { id: "end", kind: "END", label: "End" } as const,
  ];
  const created = await createWorkflow({ code: `V191_${Date.now()}_${++counter}`, name: "V191 collab", kind: "PREDEFINED", requestPrefix: "VC", definition: { nodes: all as never, edges: all.slice(1).map((node, index) => ({ id: `e${index}`, from: all[index]!.id, to: node.id })) } }, itAdmin);
  if (!created.ok) throw new Error(created.message);
  await publishVersion(created.value.versionId, itAdmin);
  const submitted = await submitRequest({ workflowId: created.value.workflowId, title, fields: {}, allowDuplicate: true }, { id: raiser, roles: ["USER"] });
  if (!submitted.ok) throw new Error(submitted.message);
  return submitted.value.requestId;
}
async function attach(id: number, name: string): Promise<number> {
  const files = await prepareFiles([pdf(name)]);
  if (!files.ok) throw new Error(files.message);
  const added = await addAttachments(id, files.files, { id: raiser, roles: ["USER"] });
  if (!added.ok) throw new Error(added.message);
  return (await listAttachments(id)).find((file) => file.name === name)!.id;
}
const commentCount = async (id: number, author: number) => Number((await getDbPool().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM request_comments WHERE request_id = ? AND author_id = ?", [id, author]))[0][0]!.n);
const access = async (who: ReturnType<typeof person>, path: string, change = false) => {
  state.path = path;
  return checkPageAccess(who, change);
};

beforeAll(async () => {
  const superId = await createUser({ name: "V191 Super", roles: ["USER", "SUPER_ADMIN"] });
  const superAdmin = { id: superId, roles: ["USER", "SUPER_ADMIN"] };
  const adminId = await createUser({ name: "V191 IT", roles: ["USER", "IT_ADMIN"] });
  itAdmin = { id: adminId, roles: ["USER", "IT_ADMIN"] };
  raiser = await createUser({ name: "V191 Raiser" });
  approver = await createUser({ name: "V191 Approver" });
  commenter = await createUser({ name: "V191 Commenter" });
  withModule = await createUser({ name: "V191 With module" });
  outsider = await createUser({ name: "V191 Outsider" });
  const department = await createDepartment(null);
  for (const id of [raiser, approver, commenter, withModule, outsider]) await setDepartment(id, department);
  await setModules(commenter, []);
  await setModules(outsider, []);

  requestId = await raise("V191 shared request");
  otherRequestId = await raise("V191 not shared");
  attachmentId = await attach(requestId, "shared.pdf");
  otherAttachmentId = await attach(otherRequestId, "other.pdf");
  const added = await addCollaborators(requestId, [commenter, withModule], { id: raiser, roles: ["USER"] }, { notify: false });
  if (!added.ok) throw new Error(added.message);

  const type = await createModuleType("TASK", { code: `V191_${Date.now() % 100000}`, name: "V191 Task" }, superAdmin as never);
  typeId = type.ok ? type.value.id : 0;
  await saveTypeDraft("TASK", typeId, { name: "V191 Task", form: [], settings: { ...DEFAULT_TASK_SETTINGS, assignScope: "ANYONE", completion: "NONE" } }, superAdmin as never);
  await publishTypeDraft("TASK", typeId, superAdmin as never);
  const make = async (assigneeId: number, title: string, by = raiser) => {
    const created = await createTask(
      { typeId, title, description: "", priority: "NORMAL", assigneeId, due: "2031-01-15T23:59", startsOn: "", related: "", fields: {}, submissionKey: crypto.randomUUID(), files: [], holidayOk: true },
      { id: by, name: "V191", roles: ["USER"], modules: ALL } as never,
    );
    if (!created.ok) throw new Error(created.message);
    return created.value.id;
  };
  followedTask = await make(approver, "V191 followed task");
  ownTask = await make(commenter, "V191 commenter's own task");
  otherTask = await make(approver, "V191 not followed");
  deletedTask = await make(approver, "V191 deleted task");
  const creator = { id: raiser, name: "V191 Raiser", roles: ["USER"], modules: ALL };
  for (const task of [followedTask, deletedTask]) {
    for (const who of [commenter, withModule]) {
      const result = await work.setFollower(task, who, true, creator as never);
      if (!result.ok) throw new Error(result.message);
    }
  }
  await work.setFollower(ownTask, commenter, true, creator as never); // a party: never on the Tasks tab
  await getDbPool().query("UPDATE tasks SET deleted_at = UTC_TIMESTAMP() WHERE id = ?", [deletedTask]);
});

afterAll(async () => {
  await getDbPool().query("DELETE FROM system_settings WHERE setting_key = 'features.tasks'");
  await getDbPool().end();
});

describe("the Tasks tab's list", () => {
  it("holds tasks the person was added to and is no party of; not their own, not deleted", async () => {
    const { items, total } = await listCollabTasks(commenter, { q: "", sort: { sortBy: null, dir: "asc" }, page: 1 });
    expect(items.map((item) => item.id)).toEqual([followedTask]);
    expect(total).toBe(1);
    expect(await countCollabTasks(withModule)).toBe(1);
    expect(await countCollabTasks(outsider)).toBe(0);
  });
  it("searches and sorts on the server, paged", async () => {
    expect((await listCollabTasks(commenter, { q: "followed", sort: { sortBy: "due", dir: "desc" }, page: 1 })).total).toBe(1);
    expect((await listCollabTasks(commenter, { q: "nothing like this", sort: { sortBy: "task", dir: "asc" }, page: 1 })).total).toBe(0);
    expect((await listCollabTasks(commenter, { q: "", sort: { sortBy: null, dir: "asc" }, page: 99 })).items).toEqual([]);
  });
});

describe("the tabs (D-433, D-434)", () => {
  it("with both modules: both tabs and their counts", async () => {
    // v1.92.0 (D-441): with the Ticketing module the Tickets tab shows too (no ticket here: 0).
    expect(await collabAccess(person(withModule))).toEqual({ tabs: ["approvals", "tasks", "tickets"], counts: { approvals: 1, tasks: 1, tickets: 0 } });
  });
  it("without the modules but collaborating: a tab per module with items", async () => {
    expect(await collabAccess(person(commenter, []))).toEqual({ tabs: ["approvals", "tasks"], counts: { approvals: 1, tasks: 1 } });
    expect(await hasCollabTabs(person(commenter, []))).toBe(true);
  });
  it("no module and no collaboration: no tab, no sidebar item", async () => {
    expect(await collabAccess(person(outsider, []))).toEqual({ tabs: [], counts: {} });
    expect(await hasCollabTabs(person(outsider, []))).toBe(false);
  });
  it("Tasks switched off for everyone hides the Tasks tab, even for collaborators", async () => {
    await getDbPool().query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES ('features.tasks', 'FEATURES', 'STRING', FALSE, 'OFF') ON DUPLICATE KEY UPDATE value = 'OFF'");
    try {
      expect((await collabAccess(person(withModule))).tabs).toEqual(["approvals", "tickets"]); // v1.92.0: Tickets has no switch
      expect((await collabAccess(person(commenter, []))).tabs).toEqual(["approvals"]);
    } finally {
      await getDbPool().query("DELETE FROM system_settings WHERE setting_key = 'features.tasks'");
    }
  });
});

describe("a request, for a collaborator without the Approvals module (Commenter)", () => {
  const me = () => person(commenter, []);

  it("opens that request, its PDF and progress, and its attachment downloads", async () => {
    expect(await access(me(), `/users/requests/${requestId}`)).toMatchObject({ ok: true });
    expect(await access(me(), `/api/requests/${requestId}/summary.pdf`)).toMatchObject({ ok: true });
    expect(await access(me(), `/api/requests/${requestId}/progress`)).toMatchObject({ ok: true });
    expect(await access(me(), `/api/attachments/${attachmentId}`)).toMatchObject({ ok: true });
    const file = await openAttachment(attachmentId, { id: commenter, roles: ["USER"] });
    expect(file?.record.name).toBe("shared.pdf");
  });

  it("opens nothing else of the module: another request (forced ID), its file, the lists, raising, amending", async () => {
    for (const path of [`/users/requests/${otherRequestId}`, `/api/attachments/${otherAttachmentId}`, `/api/requests/${otherRequestId}/summary.pdf`, "/users/requests", "/users/queue", "/users/custom", "/users/search", `/users/requests/${requestId}/amend`]) {
      expect(await access(me(), path), path).toMatchObject({ ok: false, reason: "MODULE" });
    }
  });

  it("comments, by a direct call of the server action", async () => {
    state.user = me();
    const before = await commentCount(requestId, commenter);
    expect(await collabActions.commentAction(null, form({ requestId: String(requestId), body: "Commenter here" }))).toMatchObject({ ok: true });
    expect(await commentCount(requestId, commenter)).toBe(before + 1);
    // Not on a request they aren't on.
    expect(await collabActions.commentAction(null, form({ requestId: String(otherRequestId), body: "Sneaky" }))).toEqual({ ok: false, message: "Not found." });
    expect(await commentCount(otherRequestId, commenter)).toBe(0);
  });

  it("is refused everything beyond commenting: files, collaborators, links, advice, decisions", async () => {
    state.user = me();
    const id = String(requestId);
    const files = form({ requestId: id });
    files.append("attachments", pdf("nope.pdf"));
    expect(await requestActions.addFilesAction(null, files)).toEqual({ ok: false, message: "Not found." });
    expect(await collabActions.addCollaboratorsAction(null, form({ requestId: id, collaborator: String(outsider) }))).toEqual({ ok: false, message: "Not found." });
    expect(await collabActions.removeCollaboratorAction(null, form({ requestId: id, userId: String(commenter) }))).toEqual({ ok: false, message: "Not found." });
    expect(await collabActions.linkAction(null, form({ requestId: id, otherRequestNo: "VC-0001" }))).toEqual({ ok: false, message: "Not found." });
    expect(await collabActions.consultAction(null, form({ requestId: id, consulteeId: String(outsider), question: "?" }))).toEqual({ ok: false, message: "Not found." });
    expect(await requestActions.withdrawAction(null, form({ requestId: id, reason: "no" }))).toEqual({ ok: false, message: "Not found." });
    expect((await listAttachments(requestId)).map((file) => file.name)).toEqual(["shared.pdf"]);
  });

  it("can't approve, even when also an approver on it", async () => {
    // Make the commenter the approver's delegate-free stand-in: put them on the step itself.
    const key = await pendingTaskKey(requestId, approver);
    await getDbPool().query("UPDATE approval_tasks SET approver_id = ? WHERE request_id = ? AND task_key = ?", [commenter, requestId, key]);
    try {
      state.user = me();
      expect(await requestActions.decideAction(null, form({ requestId: String(requestId), taskKey: key, decision: "APPROVE", comment: "" }))).toEqual({ ok: false, message: "Not found." });
      const [[row]] = await getDbPool().query<RowDataPacket[]>("SELECT status FROM approval_tasks WHERE request_id = ? AND task_key = ?", [requestId, key]);
      expect(row!.status).toBe("PENDING");
    } finally {
      await getDbPool().query("UPDATE approval_tasks SET approver_id = ? WHERE request_id = ? AND task_key = ?", [approver, requestId, key]);
    }
  });

  it("a person with no module and no collaboration opens nothing", async () => {
    expect(await access(person(outsider, []), `/users/requests/${requestId}`)).toMatchObject({ ok: false, reason: "MODULE" });
    state.user = person(outsider, []);
    expect(await collabActions.commentAction(null, form({ requestId: String(requestId), body: "Hi" }))).toEqual({ ok: false, message: "Not found." });
  });
});

describe("a request, for a collaborator with the Approvals module (unchanged rights)", () => {
  it("opens it, comments and adds a file as before", async () => {
    const me = person(withModule);
    expect(await access(me, `/users/requests/${requestId}`)).toMatchObject({ ok: true });
    state.user = me;
    expect(await collabActions.commentAction(null, form({ requestId: String(requestId), body: "With module" }))).toMatchObject({ ok: true });
    const files = form({ requestId: String(requestId) });
    files.append("attachments", pdf("by-collaborator.pdf"));
    expect(await requestActions.addFilesAction(null, files)).toMatchObject({ ok: true });
    expect((await listAttachments(requestId)).map((file) => file.name)).toContain("by-collaborator.pdf");
  });
});

describe("a task, for a collaborator without the Task module (Commenter)", () => {
  const me = () => ({ id: commenter, name: "V191 Commenter", roles: ["USER"], modules: [] as ModuleCode[], sessionId: "t", ipAddress: null });

  it("opens that task as a Commenter: COMMENT is its only action", async () => {
    const loaded = await loadTaskFor(followedTask, me());
    expect(loaded?.task.id).toBe(followedTask);
    expect(loaded?.viewer.commenter).toBe(true);
    expect([...loaded!.actions]).toEqual(["COMMENT"]);
  });

  it("opens no other task (forced ID) and no deleted one", async () => {
    expect(await loadTaskFor(otherTask, me())).toBeNull();
    expect(await loadTaskFor(deletedTask, me())).toBeNull();
  });

  it("comments (task actions and the work comment)", async () => {
    expect(await actOnTask({ taskId: followedTask, action: "COMMENT", rowVersion: null, reason: "Looks good", assigneeId: null, files: [] }, me() as never)).toMatchObject({ ok: true });
    expect(await work.addComment(followedTask, "From the pane", null, me() as never)).toMatchObject({ ok: true });
    expect(await work.likeTask(followedTask, me() as never)).toMatchObject({ ok: true });
  });

  it("is refused files, status changes, edits and collaborator changes", async () => {
    const staged = { name: "x.pdf", contentType: "application/pdf", size: 10, sha256: "0".repeat(64), storedPath: "none", absolute: "Z:/none/x.pdf", fieldKey: null };
    expect(await actOnTask({ taskId: followedTask, action: "COMMENT", rowVersion: null, reason: "with a file", assigneeId: null, files: [staged] }, me() as never)).toMatchObject({ ok: false });
    for (const action of ["START", "COMPLETE", "CANCEL", "REASSIGN", "EDIT"] as const) {
      expect(await actOnTask({ taskId: followedTask, action, rowVersion: null, reason: "x", assigneeId: outsider, files: [] }, me() as never), action).toMatchObject({ ok: false });
    }
    expect(await work.setFollower(followedTask, outsider, true, me() as never)).toMatchObject({ ok: false });
    expect(await work.setFollower(followedTask, commenter, false, me() as never)).toMatchObject({ ok: false });
    expect(await work.deleteTask(followedTask, me() as never)).toMatchObject({ ok: false });
    const [[row]] = await getDbPool().query<RowDataPacket[]>("SELECT status, deleted_at FROM tasks WHERE id = ?", [followedTask]);
    expect(row).toMatchObject({ status: "OPEN", deleted_at: null });
  });

  it("a mention by a Commenter never adds a collaborator", async () => {
    const before = Number((await getDbPool().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM task_followers WHERE task_id = ?", [followedTask]))[0][0]!.n);
    expect(await work.addComment(followedTask, `Hi @[Outsider](user:${outsider})`, null, me() as never)).toMatchObject({ ok: true });
    const after = Number((await getDbPool().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM task_followers WHERE task_id = ?", [followedTask]))[0][0]!.n);
    expect(after).toBe(before);
  });

  it("with the Task module, a collaborator keeps the usual rights", async () => {
    const full = { id: withModule, name: "V191 With module", roles: ["USER"], modules: ALL, sessionId: "t", ipAddress: null };
    const loaded = await loadTaskFor(followedTask, full);
    expect(loaded?.viewer.commenter).toBeUndefined();
    expect([...loaded!.actions]).toContain("COMMENT");
    // As before v1.91.0: a collaborator with the module may add (and remove) other collaborators.
    expect(await work.setFollower(followedTask, approver, true, full as never)).toMatchObject({ ok: true });
    expect(await work.setFollower(followedTask, outsider, true, full as never)).toMatchObject({ ok: true });
    expect(await work.setFollower(followedTask, outsider, false, full as never)).toMatchObject({ ok: true });
  });
});

describe("removal revokes at once; nothing is deleted (D-434)", () => {
  it("a removed request collaborator is refused the page, the file and commenting", async () => {
    await removeCollaborator(requestId, commenter, { id: raiser, roles: ["USER"] });
    const me = person(commenter, []);
    expect(await access(me, `/users/requests/${requestId}`)).toMatchObject({ ok: false, reason: "MODULE" });
    expect(await access(me, `/api/attachments/${attachmentId}`)).toMatchObject({ ok: false, reason: "MODULE" });
    state.user = me;
    expect(await collabActions.commentAction(null, form({ requestId: String(requestId), body: "Still here?" }))).toEqual({ ok: false, message: "Not found." });
    // Their earlier comment stays.
    expect(await commentCount(requestId, commenter)).toBeGreaterThan(0);
  });

  it("a removed task collaborator is refused the task", async () => {
    await work.setFollower(followedTask, commenter, false, { id: raiser, name: "V191 Raiser", roles: ["USER"], modules: ALL } as never);
    expect(await loadTaskFor(followedTask, { id: commenter, roles: ["USER"], modules: [] })).toBeNull();
    expect(await work.addComment(followedTask, "Still here?", null, { id: commenter, name: "C", roles: ["USER"], modules: [] } as never)).toMatchObject({ ok: false });
    expect(await collabAccess(person(commenter, []))).toEqual({ tabs: [], counts: {} });
  });

  it("access comes back with the module, without anything having been deleted", async () => {
    expect((await collabAccess(person(commenter, ["APPROVAL", "TASK"]))).tabs).toEqual(["approvals", "tasks"]);
  });
});
