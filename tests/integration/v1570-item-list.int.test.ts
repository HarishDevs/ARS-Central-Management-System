import { beforeAll, describe, expect, it } from "vitest";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import { createModuleType, publishTypeDraft, saveTypeDraft } from "@/server/modules/config";
import { listTickets, replaceTicketViewers, saveTicketFormSetup, seesAllTickets } from "@/lib/db/repositories/tickets.repository";
import { loadTicketFor, raiseTicket } from "@/server/tickets/service";
import { checklistsFor, setItemProvided } from "@/server/records/item-checks";
import type { TaskActor } from "@/server/modules/tasks";
import { createUser } from "./helpers";

// v1.57.0 (owner, 18 Nov 2026):
//  D-335 an Item list field (item + qty) on a ticket form; the coordinators and
//        the assignee tick each item as provided; nobody else can.
//  D-336 departments named in Admin → Ticket categories see every ticket.
let typeId = 0;
let departmentId = 0;
const people: Record<string, TaskActor & { name: string }> = {};
const actor = (id: number, name: string, roles: string[] = ["USER"]) => ({ id, name, roles });
const q = async <T,>(sql: string, params: unknown[] = []) => (await getDbPool().query<(RowDataPacket & T)[]>(sql, params))[0];
const tomorrow = () => new Date(Date.now() + 330 * 60_000 + 86_400_000).toISOString().slice(0, 10);

async function viewers(departmentIds: number[]) {
  const connection = await getDbPool().getConnection();
  try {
    await replaceTicketViewers(departmentIds, [], people.admin!.id, connection);
  } finally {
    connection.release();
  }
}

beforeAll(async () => {
  const adminId = await createUser({ name: "I Admin", roles: ["USER", "IT_ADMIN"] });
  people.admin = actor(adminId, "I Admin", ["USER", "IT_ADMIN"]);
  people.requester = actor(await createUser({ name: "I Requester" }), "I Requester");
  people.coordinator = actor(await createUser({ name: "I Coordinator" }), "I Coordinator");
  people.stranger = actor(await createUser({ name: "I Stranger" }), "I Stranger");
  const tag = Date.now().toString(36).toUpperCase();
  const [dept] = await getDbPool().query<ResultSetHeader>("INSERT INTO departments (code, name, active) VALUES (?, ?, TRUE)", [`ITV${tag}`.slice(0, 20), `IT viewers ${tag}`]);
  departmentId = dept.insertId;
  people.itStaff = actor(await createUser({ name: "I IT staff", departmentId }), "I IT staff");
  const created = await createModuleType("TICKET", { code: `STN_${tag}`, name: "Stationery" }, people.admin);
  if (!created.ok) throw new Error(created.message);
  typeId = created.value.id;
  const saved = await saveTypeDraft("TICKET", typeId, { name: "Stationery", form: [{ key: "items", label: "Stationery items", type: "ITEM_LIST", required: true }], settings: { access: { mode: "EVERYONE", departmentIds: [], userIds: [] }, defaultPriority: "NORMAL", requesterPriority: true } }, people.admin);
  if (!saved.ok) throw new Error(saved.message);
  const published = await publishTypeDraft("TICKET", typeId, people.admin);
  if (!published.ok) throw new Error(published.message);
  const [category] = await q<{ id: number }>("SELECT id FROM ticket_categories ORDER BY id LIMIT 1");
  const connection = await getDbPool().getConnection();
  try {
    await saveTicketFormSetup(typeId, category!.id, [people.coordinator.id], adminId, connection);
  } finally {
    connection.release();
  }
});

async function raiseWith(items: string) {
  return raiseTicket({ typeId, title: "Stationery for HR", description: "For the new joiners", priority: "NORMAL", requiredOn: tomorrow(), fields: { items }, files: [], submissionKey: `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` }, people.requester!);
}

describe("an Item list on a ticket form", () => {
  it("refuses an empty list (required) and a bad quantity", async () => {
    expect((await raiseWith("[]")).ok).toBe(false);
    const badQty = await raiseWith(JSON.stringify([{ description: "Pens", quantity: "0" }]));
    expect(!badQty.ok && badQty.fieldErrors?.items).toMatch(/whole number from 1/);
  });

  it("stores the items; coordinators tick them; the requester and others cannot", async () => {
    const raised = await raiseWith(JSON.stringify([{ description: "A4 paper (ream)", quantity: "5" }, { description: "Blue pens", quantity: "20" }]));
    expect(raised.ok ? "ok" : JSON.stringify(raised)).toBe("ok");
    const id = raised.ok ? raised.value.id : 0;
    const loaded = (await loadTicketFor(id, people.coordinator!))!;
    let lists = await checklistsFor("TICKET", id, loaded.form, loaded.ticket.formData);
    expect(lists[0]!.lines.map((line) => [line.description, line.quantity, line.provided])).toEqual([
      ["A4 paper (ream)", 5, false],
      ["Blue pens", 20, false],
    ]);
    const tick = (who: TaskActor & { name: string }, lineNo: number, provided = true) => setItemProvided({ entityType: "TICKET", entityId: id, fieldKey: "items", lineNo, provided }, who);
    expect((await tick(people.requester!, 1)).ok).toBe(false);
    expect((await tick(people.stranger!, 1)).ok).toBe(false);
    expect((await tick(people.coordinator!, 5)).ok).toBe(false);
    expect((await tick(people.coordinator!, 1)).ok).toBe(true);
    lists = await checklistsFor("TICKET", id, loaded.form, loaded.ticket.formData);
    expect(lists[0]!.lines[1]).toMatchObject({ provided: true, checkedBy: "I Coordinator" });
    expect(lists[0]!.lines[0]!.provided).toBe(false);
    // Unticking is recorded too.
    expect((await tick(people.admin!, 1, false)).ok).toBe(true);
    lists = await checklistsFor("TICKET", id, loaded.form, loaded.ticket.formData);
    expect(lists[0]!.lines[1]).toMatchObject({ provided: false, checkedBy: "I Admin" });
    const [audit] = await q<{ n: number }>("SELECT COUNT(*) AS n FROM audit_logs WHERE entity_type = 'TICKET' AND entity_id = ? AND action IN ('ITEM_PROVIDED', 'ITEM_NOT_PROVIDED')", [String(id)]);
    expect(Number(audit!.n)).toBe(2);
  });
});

describe("who else sees every ticket", () => {
  it("a department named as a viewer sees all tickets, read-only", async () => {
    const raised = await raiseWith(JSON.stringify([{ description: "Stapler", quantity: "1" }]));
    const id = raised.ok ? raised.value.id : 0;
    expect(await seesAllTickets(people.itStaff!.id)).toBe(false);
    expect(await loadTicketFor(id, people.itStaff!)).toBeNull();
    await viewers([departmentId]);
    try {
      expect(await seesAllTickets(people.itStaff!.id)).toBe(true);
      const seen = await loadTicketFor(id, people.itStaff!);
      expect(seen).not.toBeNull();
      expect(seen!.actions.has("ASSIGN")).toBe(false);
      expect((await listTickets({ scope: "all", categoryId: null, status: null, q: "", page: 1 }, { id: people.itStaff!.id, isAdmin: true })).items.some((item) => item.id === id)).toBe(true);
      // Ticking items stays with the coordinators and the assignee.
      expect((await setItemProvided({ entityType: "TICKET", entityId: id, fieldKey: "items", lineNo: 0, provided: true }, people.itStaff!)).ok).toBe(false);
    } finally {
      await viewers([]);
    }
  });
});
