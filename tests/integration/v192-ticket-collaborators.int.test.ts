import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { NextRequest } from "next/server";
import { getDbPool } from "@/lib/db/client";
import { createModuleType, publishTypeDraft, saveTypeDraft } from "@/server/modules/config";
import { findTicket, saveTicketFormSetup } from "@/lib/db/repositories/tickets.repository";
import { assignTicket, confirmTicket, loadTicketFor, raiseTicket, workOnTicket, commentOnTicket } from "@/server/tickets/service";
import { addTicketCollaborators, removeTicketCollaborator } from "@/server/tickets/collaborators";
import { listRecordFiles, stageFiles } from "@/server/modules/files";
import { countCollabTickets, listCollabTickets } from "@/lib/db/repositories/collaborating.repository";
import { indiaDate } from "@/server/workflows/calendar";
import type { TaskActor } from "@/server/modules/tasks";
import type { ModuleCode } from "@/types/auth";
import { createUser } from "./helpers";

// v1.92.0 (D-438..D-441; governance D-432 §2, §4.1): collaborators on tickets.
// Owner (26 Nov 2026, answering Q-036): "tickets get collaborators, like
// requests"; then the Collaborating screen's Tickets tab and the Commenter
// rule (D-434) apply. Server checks are called directly (the service, the
// server actions with a session, page access with a signed address and the
// file download route), never through the UI.
const state = vi.hoisted(() => ({ path: "" as string, user: null as null | { id: number; roles: readonly string[]; modules: readonly string[]; name: string } }));
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
const { collabAccess } = await import("@/server/collaborating/service");
const ticketActions = await import("@/app/users/tickets/actions");
const filesRoute = await import("@/app/api/files/[id]/route");

const ALL: ModuleCode[] = ["APPROVAL", "TASK", "PROJECT", "INFORMATION", "MEETING", "TICKET"];
const NO_TICKET: ModuleCode[] = ["APPROVAL", "TASK"];
const q = async <T,>(sql: string, params: unknown[] = []) => (await getDbPool().query<(RowDataPacket & T)[]>(sql, params))[0];
const setModules = (id: number, modules: readonly ModuleCode[]) => getDbPool().query("UPDATE users SET module_access = ? WHERE id = ?", [modules.join(","), id]);
const form = (values: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) for (const item of [value].flat()) data.append(key, item);
  return data;
};
const pdf = (name: string) => ({ name, contentType: "application/pdf", bytes: Buffer.from(`%PDF-1.4\n% ${name}\n%%EOF\n`) });
const today = () => indiaDate(new Date());
const tomorrow = () => new Date(Date.now() + 330 * 60_000 + 86_400_000).toISOString().slice(0, 10);
let key = 0;

let typeId = 0;
const p: Record<"admin" | "raiser" | "coordinator" | "assignee" | "withModule" | "commenter" | "stranger" | "inactive" | "other", TaskActor> = {} as never;
const sessionOf = (who: TaskActor, modules: readonly ModuleCode[] = ALL) => ({ id: who.id, roles: who.roles, modules, name: who.name });
let ticketId = 0;
let otherTicketId = 0;

async function raise(title: string, by = p.raiser): Promise<number> {
  const result = await raiseTicket({ typeId, title, description: "The printer jams on every page.", priority: "HIGH", requiredOn: tomorrow(), fields: {}, files: [], submissionKey: `v192-${Date.now().toString(36)}-${(key += 1)}` }, by);
  if (!result.ok) throw new Error(result.message);
  return result.value.id;
}
const count = async (sql: string, params: unknown[]) => Number((await q<{ n: number }>(sql, params))[0]!.n);
const notices = (userId: number, ticket: number, event: string) =>
  count("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND event_type = ? AND deep_link LIKE ?", [userId, event, `%/users/tickets/${ticket}`]);
const download = async (who: TaskActor | null, fileId: number, modules: readonly ModuleCode[] = ALL) => {
  state.user = who ? sessionOf(who, modules) : null;
  const response = await filesRoute.GET(new NextRequest(`http://localhost/api/files/${fileId}`), { params: Promise.resolve({ id: String(fileId) }) });
  return response.status;
};
const pageAccess = async (who: TaskActor, modules: readonly ModuleCode[], address: string, change = false) => {
  state.path = address;
  return checkPageAccess(sessionOf(who, modules), change);
};

beforeAll(async () => {
  const actor = async (name: string, roles: string[] = ["USER"]) => ({ id: await createUser({ name, roles: roles as never }), name, roles }) as TaskActor;
  p.admin = await actor("V192 IT", ["USER", "IT_ADMIN"]);
  p.raiser = await actor("V192 Raiser");
  p.coordinator = await actor("V192 Coordinator");
  p.assignee = await actor("V192 Assignee");
  p.withModule = await actor("V192 With module");
  p.commenter = await actor("V192 Commenter");
  p.stranger = await actor("V192 Stranger");
  p.inactive = await actor("V192 Inactive");
  p.other = await actor("V192 Other");
  await getDbPool().query("UPDATE users SET active = FALSE WHERE id = ?", [p.inactive.id]);
  await setModules(p.commenter.id, NO_TICKET);
  await setModules(p.stranger.id, NO_TICKET);
  const created = await createModuleType("TICKET", { code: `V192_${Date.now().toString(36).toUpperCase()}`, name: "V192 Printer" }, p.admin);
  if (!created.ok) throw new Error(created.message);
  typeId = created.value.id;
  const saved = await saveTypeDraft("TICKET", typeId, { name: "V192 Printer", form: [], settings: { access: { mode: "EVERYONE", departmentIds: [], userIds: [] }, defaultPriority: "NORMAL", requesterPriority: true } }, p.admin);
  if (!saved.ok) throw new Error(saved.message);
  const published = await publishTypeDraft("TICKET", typeId, p.admin);
  if (!published.ok) throw new Error(published.message);
  const [category] = await q<{ id: number }>("SELECT id FROM ticket_categories WHERE code = 'IT_HARDWARE'");
  const connection = await getDbPool().getConnection();
  try {
    await saveTicketFormSetup(typeId, category!.id, [p.coordinator.id], p.admin.id, connection);
  } finally {
    connection.release();
  }
  ticketId = await raise("V192 shared ticket");
  otherTicketId = await raise("V192 not shared");
  const assigned = await assignTicket({ ticketId, assigneeId: p.assignee.id, targetDate: today(), remarks: "", rowVersion: null }, p.coordinator);
  if (!assigned.ok) throw new Error(assigned.message);
});

afterAll(() => {
  state.user = null;
  state.path = "";
});

describe("the migration (D-438, governance §2)", () => {
  it("creates ticket_collaborators with its key, index and foreign keys", async () => {
    const columns = (await q<{ COLUMN_NAME: string; IS_NULLABLE: string }>("SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ticket_collaborators' ORDER BY ORDINAL_POSITION")).map((row) => `${row.COLUMN_NAME}:${row.IS_NULLABLE}`);
    expect(columns).toEqual(["ticket_id:NO", "user_id:NO", "added_by:NO", "added_at:NO", "removed_by:YES", "removed_at:YES"]);
    const keys = (await q<{ CONSTRAINT_NAME: string }>("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ticket_collaborators' ORDER BY CONSTRAINT_NAME")).map((row) => row.CONSTRAINT_NAME);
    expect(keys).toEqual(["fk_ticket_collaborators_added", "fk_ticket_collaborators_removed", "fk_ticket_collaborators_ticket", "fk_ticket_collaborators_user", "PRIMARY"]);
    const index = await q<{ COLUMN_NAME: string }>("SELECT COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ticket_collaborators' AND INDEX_NAME = 'idx_ticket_collaborators_user' ORDER BY SEQ_IN_INDEX");
    expect(index.map((row) => row.COLUMN_NAME)).toEqual(["user_id", "removed_at"]);
  });
  it("has no trigger block (nothing needs -- @optional)", () => {
    const sql = fs.readFileSync(path.resolve(__dirname, "../../database/migrations/202611261000_ticket_collaborators.sql"), "utf8");
    expect(sql).not.toMatch(/CREATE\s+TRIGGER/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS ticket_collaborators/);
  });
});

describe("adding and removing (D-438)", () => {
  it("a stranger, a read-only viewer or someone without a part can't add; the ticket stays hidden to a stranger", async () => {
    expect(await addTicketCollaborators(ticketId, [p.other.id], p.stranger)).toEqual({ ok: false, message: "Not found." });
    expect(await count("SELECT COUNT(*) AS n FROM ticket_collaborators WHERE ticket_id = ?", [ticketId])).toBe(0);
  });
  it("the raiser adds people; inactive people and the ticket's own people are refused with a reason; events and audit are written", async () => {
    const result = await addTicketCollaborators(ticketId, [p.withModule.id, p.inactive.id, p.raiser.id, p.assignee.id, p.coordinator.id], p.raiser);
    expect(result).toEqual({ ok: true, added: [p.withModule.id], skipped: ["V192 Inactive (inactive)", "V192 Raiser (raised it, already sees it)", "V192 Assignee (the assignee, already sees it)", "V192 Coordinator (a coordinator, already sees it)"] });
    expect(await count("SELECT COUNT(*) AS n FROM ticket_events WHERE ticket_id = ? AND action = 'COLLABORATORS_ADDED'", [ticketId])).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'TICKET_COLLABORATORS_ADDED' AND entity_id = ?", [ticketId])).toBe(1);
    expect(await notices(p.withModule.id, ticketId, "TICKET_UPDATED")).toBe(1);
  });
  it("the coordinator, the assignee and IT add too", async () => {
    expect((await addTicketCollaborators(ticketId, [p.commenter.id], p.coordinator)).ok).toBe(true);
    expect((await addTicketCollaborators(otherTicketId, [p.other.id], p.admin)).ok).toBe(true);
    expect(await removeTicketCollaborator(otherTicketId, p.other.id, p.admin)).toEqual({ ok: true });
    const extra = await raise("V192 assignee adds");
    expect((await assignTicket({ ticketId: extra, assigneeId: p.assignee.id, targetDate: today(), remarks: "", rowVersion: null }, p.coordinator)).ok).toBe(true);
    expect((await addTicketCollaborators(extra, [p.other.id], p.assignee)).ok).toBe(true);
  });
  it("a collaborator (with the module or not) never adds anyone", async () => {
    expect((await addTicketCollaborators(ticketId, [p.other.id], p.withModule)).ok).toBe(false);
    expect((await addTicketCollaborators(ticketId, [p.other.id], p.commenter)).ok).toBe(false);
    expect(await count("SELECT COUNT(*) AS n FROM ticket_collaborators WHERE ticket_id = ? AND user_id = ?", [ticketId, p.other.id])).toBe(0);
  });
  it("two adds of the same person at once make one row", async () => {
    const twice = await Promise.all([addTicketCollaborators(otherTicketId, [p.withModule.id], p.raiser), addTicketCollaborators(otherTicketId, [p.withModule.id], p.raiser)]);
    expect(twice.every((result) => result.ok)).toBe(true);
    expect(twice.map((result) => (result.ok ? result.added.length : -1)).sort()).toEqual([0, 1]);
    expect(await count("SELECT COUNT(*) AS n FROM ticket_collaborators WHERE ticket_id = ? AND user_id = ? AND removed_at IS NULL", [otherTicketId, p.withModule.id])).toBe(1);
  });
});

describe("rights by direct calls (D-439)", () => {
  it("each person sees what their part allows; a forced ID of another ticket stays hidden", async () => {
    for (const who of [p.raiser, p.coordinator, p.assignee, p.admin, p.withModule, p.commenter]) expect(await loadTicketFor(ticketId, who), who.name).not.toBeNull();
    expect(await loadTicketFor(ticketId, p.stranger)).toBeNull();
    expect(await loadTicketFor(ticketId, p.other)).toBeNull();
    // The commenter collaborates on ticketId only.
    expect(await loadTicketFor(otherTicketId, p.commenter)).toBeNull();
    const asCommenter = (await loadTicketFor(ticketId, p.commenter))!;
    expect([...asCommenter.actions]).toEqual(["COMMENT"]);
    expect(asCommenter.viewer.commenter).toBe(true);
    expect(asCommenter.internal).toBe(false);
    const asCollaborator = (await loadTicketFor(ticketId, p.withModule))!;
    expect([...asCollaborator.actions]).toEqual(["COMMENT"]);
    expect(asCollaborator.viewer.commenter).toBe(false);
  });
  it("server actions: a collaborator comments; files only with the module; assign / work / confirm / reopen / collaborator changes refused", async () => {
    state.user = sessionOf(p.commenter, NO_TICKET);
    expect(await ticketActions.commentTicketAction(null, form({ ticketId: String(ticketId), body: "Commenter remark" }))).toMatchObject({ ok: true });
    const withFile = form({ ticketId: String(ticketId), body: "With a file" });
    withFile.append("attachments", new File(["%PDF-1.4\n%%EOF\n"], "c.pdf", { type: "application/pdf" }));
    expect(await ticketActions.commentTicketAction(null, withFile)).toMatchObject({ ok: false, message: "Adding files needs the Ticketing module. You can still write a remark." });
    expect(await ticketActions.commentTicketAction(null, form({ ticketId: String(ticketId), body: "Internal try", internal: "yes" }))).toMatchObject({ ok: true });
    expect((await q<{ internal: number }>("SELECT internal FROM ticket_comments WHERE ticket_id = ? AND body = 'Internal try'", [ticketId]))[0]!.internal).toBe(0);
    expect(await ticketActions.assignTicketAction(null, form({ ticketId: String(ticketId), assignee: String(p.commenter.id), target: today() }))).toMatchObject({ ok: false });
    expect(await ticketActions.ticketWorkAction(null, form({ ticketId: String(ticketId), step: "RESOLVE", remarks: "Done by me" }))).toMatchObject({ ok: false });
    expect(await ticketActions.addTicketCollaboratorsAction(null, form({ ticketId: String(ticketId), collaborator: String(p.other.id) }))).toMatchObject({ ok: false });
    expect(await ticketActions.removeTicketCollaboratorAction(null, form({ ticketId: String(ticketId), userId: String(p.withModule.id) }))).toMatchObject({ ok: false });
    // D-434: a Commenter can't remove themselves either.
    expect(await ticketActions.removeTicketCollaboratorAction(null, form({ ticketId: String(ticketId), userId: String(p.commenter.id) }))).toMatchObject({ ok: false });
    // Raising needs the module.
    expect(await ticketActions.raiseTicketAction(null, form({ type: String(typeId), title: "Should fail" }))).toEqual({ ok: false, message: "Not found." });

    state.user = sessionOf(p.withModule, ALL);
    const files = form({ ticketId: String(ticketId), body: "With the module, a file" });
    files.append("attachments", new File(["%PDF-1.4\n%%EOF\n"], "m.pdf", { type: "application/pdf" }));
    expect(await ticketActions.commentTicketAction(null, files)).toMatchObject({ ok: true });
    expect(await ticketActions.ticketWorkAction(null, form({ ticketId: String(ticketId), step: "START" }))).toMatchObject({ ok: false });
    expect((await findTicket(ticketId))!.status).toBe("ASSIGNED");

    state.user = sessionOf(p.stranger, NO_TICKET);
    expect(await ticketActions.commentTicketAction(null, form({ ticketId: String(ticketId), body: "Stranger" }))).toEqual({ ok: false, message: "Not found." });
    expect(await ticketActions.addTicketCollaboratorsAction(null, form({ ticketId: String(ticketId), collaborator: String(p.stranger.id) }))).toMatchObject({ ok: false, message: "Not found." });
    state.user = null;
  });
  it("page access: the ticket page opens for the Commenter without the module; the lists, board, dashboards and raising don't", async () => {
    expect(await pageAccess(p.commenter, NO_TICKET, `/users/tickets/${ticketId}`)).toMatchObject({ ok: true });
    for (const address of ["/users/tickets", "/users/tickets/new", "/users/tickets/board", "/users/tickets/dashboards"]) expect(await pageAccess(p.commenter, NO_TICKET, address), address).toMatchObject({ ok: false, reason: "MODULE" });
  });
  it("file downloads follow the ticket: this ticket's public file yes, another ticket's no, an internal one no", async () => {
    const internal = await stageFiles([pdf("v192-internal.pdf")]);
    expect((await commentOnTicket({ ticketId, body: "Internal file", internal: true, files: internal }, p.coordinator)).ok).toBe(true);
    const other = await stageFiles([pdf("v192-other.pdf")]);
    expect((await commentOnTicket({ ticketId: otherTicketId, body: "Other ticket's file", internal: false, files: other }, p.raiser)).ok).toBe(true);
    const all = await listRecordFiles("TICKET", ticketId, { internal: true });
    const publicFile = all.find((file) => file.name === "m.pdf")!;
    const internalFile = all.find((file) => file.name === "v192-internal.pdf")!;
    const otherFile = (await listRecordFiles("TICKET", otherTicketId, { internal: true })).find((file) => file.name === "v192-other.pdf")!;
    expect(await download(p.commenter, publicFile.id, NO_TICKET)).toBe(200);
    expect(await download(p.commenter, internalFile.id, NO_TICKET)).toBe(404);
    expect(await download(p.commenter, otherFile.id, NO_TICKET)).toBe(404);
    expect(await download(p.stranger, publicFile.id, NO_TICKET)).toBe(404);
    expect(await download(p.withModule, otherFile.id)).toBe(200); // a collaborator on the other ticket since the double add
  });
});

describe("notifications (D-440)", () => {
  it("collaborators hear status changes, public remarks and the closure; never internal remarks or their own actions", async () => {
    const before = await notices(p.withModule.id, ticketId, "TICKET_COMMENT");
    expect((await commentOnTicket({ ticketId, body: "Public note", internal: false, files: [] }, p.coordinator)).ok).toBe(true);
    expect(await notices(p.withModule.id, ticketId, "TICKET_COMMENT")).toBe(before + 1);
    expect((await commentOnTicket({ ticketId, body: "Coordinators only", internal: true, files: [] }, p.coordinator)).ok).toBe(true);
    expect(await notices(p.withModule.id, ticketId, "TICKET_COMMENT")).toBe(before + 1);
    const updates = await notices(p.commenter.id, ticketId, "TICKET_UPDATED");
    expect((await workOnTicket({ ticketId, step: "START", remarks: "", rowVersion: null }, p.assignee)).ok).toBe(true);
    expect((await workOnTicket({ ticketId, step: "RESOLVE", remarks: "Replaced the roller", rowVersion: null }, p.assignee)).ok).toBe(true);
    expect(await notices(p.commenter.id, ticketId, "TICKET_UPDATED")).toBe(updates + 2);
    expect((await confirmTicket({ ticketId, rating: 5, feedback: "" }, p.raiser)).ok).toBe(true);
    expect(await notices(p.commenter.id, ticketId, "TICKET_CLOSED")).toBe(1);
    expect(await notices(p.withModule.id, ticketId, "TICKET_CLOSED")).toBe(1);
  });
  it("collaborators don't change the ticket's counts or status", async () => {
    expect((await findTicket(ticketId))!.status).toBe("CLOSED");
    expect(await count("SELECT COUNT(*) AS n FROM tickets WHERE id IN (?, ?)", [ticketId, otherTicketId])).toBe(2);
  });
});

describe("the Collaborating screen's Tickets tab (D-441)", () => {
  it("lists active collaborations with status, category and assignee; searches; counts", async () => {
    expect(await countCollabTickets(p.commenter.id)).toBe(1);
    const { items, total } = await listCollabTickets(p.withModule.id, { q: "", sort: { sortBy: null, dir: "asc" }, page: 1 });
    expect(total).toBe(2);
    expect(items.map((item) => item.title).sort()).toEqual(["V192 not shared", "V192 shared ticket"]);
    expect(items.find((item) => item.id === ticketId)).toMatchObject({ status: "CLOSED", categoryName: "IT Hardware", assigneeName: "V192 Assignee" });
    expect((await listCollabTickets(p.withModule.id, { q: "not shared", sort: { sortBy: "status", dir: "desc" }, page: 1 })).total).toBe(1);
  });
  it("the tab shows with the module, or without it when the person collaborates on a ticket; not for a stranger", async () => {
    expect((await collabAccess(sessionOf(p.commenter, NO_TICKET))).tabs).toContain("tickets");
    expect((await collabAccess(sessionOf(p.commenter, NO_TICKET))).counts.tickets).toBe(1);
    expect((await collabAccess(sessionOf(p.stranger, NO_TICKET))).tabs).not.toContain("tickets");
    expect((await collabAccess(sessionOf(p.stranger, ALL))).tabs).toContain("tickets");
  });
});

describe("removal revokes at once (D-439)", () => {
  it("removed: the ticket, its files, commenting and the tab are gone; the row and history stay", async () => {
    const reopenable = await raise("V192 removal");
    expect((await addTicketCollaborators(reopenable, [p.commenter.id], p.raiser)).ok).toBe(true);
    const files = await stageFiles([pdf("v192-removal.pdf")]);
    expect((await commentOnTicket({ ticketId: reopenable, body: "File", internal: false, files }, p.raiser)).ok).toBe(true);
    const file = (await listRecordFiles("TICKET", reopenable, { internal: false }))[0]!;
    expect(await download(p.commenter, file.id, NO_TICKET)).toBe(200);
    expect(await removeTicketCollaborator(reopenable, p.commenter.id, p.raiser)).toEqual({ ok: true });
    expect(await loadTicketFor(reopenable, p.commenter)).toBeNull();
    expect(await download(p.commenter, file.id, NO_TICKET)).toBe(404);
    state.user = sessionOf(p.commenter, NO_TICKET);
    expect(await ticketActions.commentTicketAction(null, form({ ticketId: String(reopenable), body: "After removal" }))).toEqual({ ok: false, message: "Not found." });
    state.user = null;
    const [row] = await q<{ removed_at: Date | null; removed_by: number }>("SELECT removed_at, removed_by FROM ticket_collaborators WHERE ticket_id = ? AND user_id = ?", [reopenable, p.commenter.id]);
    expect(row!.removed_at).not.toBeNull();
    expect(Number(row!.removed_by)).toBe(p.raiser.id);
    expect(await count("SELECT COUNT(*) AS n FROM ticket_events WHERE ticket_id = ? AND action = 'COLLABORATOR_REMOVED'", [reopenable])).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'TICKET_COLLABORATOR_REMOVED' AND entity_id = ?", [reopenable])).toBe(1);
    // Added again: the same row comes back (one row per pair).
    expect((await addTicketCollaborators(reopenable, [p.commenter.id], p.raiser)).ok).toBe(true);
    expect(await count("SELECT COUNT(*) AS n FROM ticket_collaborators WHERE ticket_id = ? AND user_id = ?", [reopenable, p.commenter.id])).toBe(1);
  });
  it("a collaborator with the module stops following; giving the module back to a Commenter restores full collaborator rights", async () => {
    state.user = sessionOf(p.withModule, ALL);
    expect(await ticketActions.removeTicketCollaboratorAction(null, form({ ticketId: String(otherTicketId), userId: String(p.withModule.id) }))).toEqual({ ok: true, message: "You no longer follow this ticket." });
    state.user = null;
    expect(await loadTicketFor(otherTicketId, p.withModule)).toBeNull();
    const ticket = await raise("V192 module back");
    expect((await addTicketCollaborators(ticket, [p.commenter.id], p.raiser)).ok).toBe(true);
    expect((await loadTicketFor(ticket, p.commenter))!.viewer.commenter).toBe(true);
    await setModules(p.commenter.id, ALL);
    try {
      expect((await loadTicketFor(ticket, p.commenter))!.viewer.commenter).toBe(false);
    } finally {
      await setModules(p.commenter.id, NO_TICKET);
    }
  });
});

describe("the migration again, on this database with data (governance §2.1)", () => {
  it("re-running the runner finds nothing to do; re-applying the file (ledger row gone) keeps every row", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM ticket_collaborators", []);
    expect(before).toBeGreaterThan(0);
    const env = { ...process.env, DB_HOST: process.env.DB_HOST, DB_PORT: process.env.DB_PORT, DB_NAME: process.env.DB_NAME, DB_USER: process.env.DB_USER, DB_PASSWORD: process.env.DB_PASSWORD };
    const runner = path.resolve(__dirname, "../../scripts/database/migrate.js");
    expect(execFileSync(process.execPath, [runner], { env, stdio: "pipe" }).toString()).toContain("No pending migrations.");
    await getDbPool().query("DELETE FROM schema_migrations WHERE filename = '202611261000_ticket_collaborators.sql'");
    expect(execFileSync(process.execPath, [runner], { env, stdio: "pipe" }).toString()).toContain("Applied 1 migration(s).");
    expect(await count("SELECT COUNT(*) AS n FROM ticket_collaborators", [])).toBe(before);
    expect(await count("SELECT COUNT(*) AS n FROM schema_migrations WHERE filename = '202611261000_ticket_collaborators.sql'", [])).toBe(1);
  });
});
