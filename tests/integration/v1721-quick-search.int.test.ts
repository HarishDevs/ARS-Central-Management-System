import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import { createModuleType, publishTypeDraft, saveTypeDraft } from "@/server/modules/config";
import { saveTicketFormSetup } from "@/lib/db/repositories/tickets.repository";
import { assignTicket, raiseTicket } from "@/server/tickets/service";
import * as meetings from "@/server/meetings/service";
import * as repo from "@/lib/db/repositories/meetings.repository";
import { quickMeetings, quickTickets } from "@/server/search/quick-more";
import { indiaDate } from "@/server/workflows/calendar";
import { createDepartment, createUser } from "./helpers";

// v1.72.1 (D-395, QA F-08): Ctrl+K finds tickets and meetings by number or
// title, and only those the person may see on the lists.
const tag = `qk${Date.now().toString(36)}`;
const who = (id: number, roles: string[] = ["USER"]) => ({ id, name: `P${id}`, roles });
const IST = 330 * 60_000;
const local = (offsetMinutes: number) => new Date(Date.now() + IST + offsetMinutes * 60_000).toISOString().slice(0, 16);
let requester = 0;
let coordinator = 0;
let assignee = 0;
let stranger = 0;
let admin = 0;
let owner = 0;
let member = 0;
let ticketNo = "";
let meetingNo = "";

beforeAll(async () => {
  admin = await createUser({ name: `Q Admin ${tag}`, roles: ["USER", "IT_ADMIN"] });
  requester = await createUser({ name: `Q Requester ${tag}` });
  coordinator = await createUser({ name: `Q Coordinator ${tag}` });
  assignee = await createUser({ name: `Q Assignee ${tag}` });
  stranger = await createUser({ name: `Q Stranger ${tag}` });
  owner = await createUser({ name: `Q Owner ${tag}` });
  member = await createUser({ name: `Q Member ${tag}` });
  const adminActor = { id: admin, name: "Q Admin", roles: ["USER", "IT_ADMIN"] };
  const created = await createModuleType("TICKET", { code: `QK_${Date.now().toString(36).toUpperCase()}`, name: "Quick search form" }, adminActor);
  if (!created.ok) throw new Error(created.message);
  const typeId = created.value.id;
  const saved = await saveTypeDraft("TICKET", typeId, { name: "Quick search form", form: [], settings: { access: { mode: "EVERYONE", departmentIds: [], userIds: [] }, defaultPriority: "NORMAL", requesterPriority: true } }, adminActor);
  if (!saved.ok) throw new Error(saved.message);
  const published = await publishTypeDraft("TICKET", typeId, adminActor);
  if (!published.ok) throw new Error(published.message);
  const [rows] = await getDbPool().query<RowDataPacket[]>("SELECT id FROM ticket_categories WHERE code = 'IT_SOFTWARE'");
  const connection = await getDbPool().getConnection();
  try {
    await saveTicketFormSetup(typeId, Number(rows[0]!.id), [coordinator], admin, connection);
  } finally {
    connection.release();
  }
  const raised = await raiseTicket(
    { typeId, title: `Printer ${tag}`, description: "The printer does not print.", priority: "NORMAL", requiredOn: new Date(Date.now() + IST + 86_400_000).toISOString().slice(0, 10), fields: {}, files: [], submissionKey: `qk-${tag}` },
    who(requester),
  );
  if (!raised.ok) throw new Error(raised.message);
  ticketNo = raised.value.ticketNo;
  const assigned = await assignTicket({ ticketId: raised.value.id, assigneeId: assignee, targetDate: indiaDate(new Date()), remarks: "", rowVersion: null }, who(coordinator));
  if (!assigned.ok) throw new Error(assigned.message);

  const dept = await createDepartment(await createUser({ name: `Q HOD ${tag}` }));
  const typeIdMeeting = (await repo.listMeetingTypes()).find((type) => type.code === "IDM")!.id;
  const meeting = await meetings.scheduleMeeting(
    {
      meetingId: null, rowVersion: null, parentMeetingId: null, title: `Despatch review ${tag}`, description: "", typeId: typeIdMeeting, departmentId: dept, departmentIds: [dept],
      ownerId: owner, coordinatorId: owner, participantIds: [member], mode: "OFFLINE", venue: "Board room", link: "", priority: "IMPORTANT", confidentiality: "GENERAL", guests: "",
      start: local(60 * 24), end: local(60 * 25), agendaDue: "", momDue: "", pointsPolicy: "BLOCK", points: ["Review"],
    },
    who(owner),
  );
  if (!meeting.ok) throw new Error(meeting.message);
  meetingNo = (await repo.findMeeting(meeting.value.id))!.meetingNo;
});

afterAll(async () => {
  await getDbPool().end();
});

describe("Ctrl+K tickets (D-395)", () => {
  it("the requester, the assignee, the coordinator and IT find the ticket by title or number", async () => {
    for (const id of [requester, assignee, coordinator]) expect((await quickTickets(who(id), `Printer ${tag}`)).map((item) => item.ticketNo)).toEqual([ticketNo]);
    expect((await quickTickets(who(admin, ["USER", "IT_ADMIN"]), ticketNo)).map((item) => item.title)).toEqual([`Printer ${tag}`]);
  });
  it("someone not on it finds nothing; a one-letter search finds nothing", async () => {
    expect(await quickTickets(who(stranger), `Printer ${tag}`)).toEqual([]);
    expect(await quickTickets(who(requester), "P")).toEqual([]);
  });
});

describe("Ctrl+K meetings (D-395)", () => {
  it("the owner and a participant find the meeting by title or number", async () => {
    expect((await quickMeetings(who(owner), `Despatch review ${tag}`)).map((item) => item.meetingNo)).toEqual([meetingNo]);
    expect((await quickMeetings(who(member), meetingNo)).map((item) => item.meetingNo)).toEqual([meetingNo]);
  });
  it("someone not on it finds nothing", async () => {
    expect(await quickMeetings(who(stranger), `Despatch review ${tag}`)).toEqual([]);
  });
});
