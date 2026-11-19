import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import * as meetings from "@/server/meetings/service";
import * as repo from "@/lib/db/repositories/meetings.repository";
import { findTask } from "@/lib/db/repositories/tasks.repository";
import { deleteTask } from "@/server/work/service";
import { createDepartment, createUser } from "./helpers";

// v1.57.6 (D-346, owner): meeting state-machine gaps, end to end against MySQL.
// Points decided while the MOM is written; MOM approval settles points still with
// the Owner; closing an open point closes its whole carry chain; Send back reopens
// the task under its row lock with a REOPEN task event and tells the assignee.
const tag = `v1576${Date.now().toString(36)}`;
const who = (id: number, roles: string[] = ["USER"]) => ({ id, name: `P${id}`, roles });
let owner: number;
let coordinator: number;
let member: number;
let dept: number;
let typeId: number;

const IST = 330 * 60_000;
const local = (offsetMinutes: number) => new Date(Date.now() + IST + offsetMinutes * 60_000).toISOString().slice(0, 16);
const base = (over: Partial<meetings.ScheduleMeetingInput> = {}): meetings.ScheduleMeetingInput => ({
  meetingId: null,
  rowVersion: null,
  parentMeetingId: null,
  title: `States ${tag}`,
  description: "",
  typeId,
  departmentId: dept,
  departmentIds: [dept],
  ownerId: owner,
  coordinatorId: coordinator,
  participantIds: [member],
  mode: "OFFLINE",
  venue: "Board room",
  link: "",
  priority: "NORMAL",
  confidentiality: "GENERAL",
  guests: "",
  start: local(-120),
  end: local(-60),
  agendaDue: "",
  momDue: "",
  pointsPolicy: "LAST_APPROVED",
  points: ["Production review"],
  ...over,
});
const act = (meetingId: number, action: meetings.ActOnMeetingInput["action"], actor: number, over: Partial<meetings.ActOnMeetingInput> = {}) =>
  meetings.actOnMeeting({ meetingId, action, rowVersion: null, remarks: "", response: "", points: null, mom: null, actualStart: "", actualEnd: "", ...over }, who(actor));
const onTime = { startedOnTime: true, startTime: "", extended: false, endTime: "", pointsOnTime: true, momOnTime: true };
const mom = (over: Partial<meetings.MomInput> = {}): meetings.MomInput => ({ discussions: [], decisions: [], actions: [], openPoints: [], attendance: [], timing: onTime, ...over });
async function schedule(over: Partial<meetings.ScheduleMeetingInput> = {}): Promise<number> {
  const created = await meetings.scheduleMeeting(base(over), who(coordinator));
  expect(created.ok).toBe(true);
  return created.ok ? created.value.id : 0;
}
async function events(meetingId: number, type: string): Promise<RowDataPacket[]> {
  const [rows] = await getDbPool().query<RowDataPacket[]>("SELECT body, payload_json FROM meeting_events WHERE meeting_id = ? AND event_type = ? ORDER BY id", [meetingId, type]);
  return rows;
}
// Schedule → enter MOM → submit → Owner approves (optionally with action items and open points).
async function approvedMeeting(over: Partial<meetings.ScheduleMeetingInput>, minutes: Partial<meetings.MomInput> = {}): Promise<number> {
  const id = await schedule(over);
  expect((await act(id, "ENTER_MOM", coordinator)).ok).toBe(true);
  expect((await act(id, "SUBMIT_MOM", coordinator, { mom: mom(minutes) })).ok).toBe(true);
  expect((await act(id, "APPROVE_MOM", owner)).ok).toBe(true);
  return id;
}

beforeAll(async () => {
  owner = await createUser({ name: `Owner ${tag}` });
  coordinator = await createUser({ name: `Coordinator ${tag}` });
  member = await createUser({ name: `Member ${tag}` });
  dept = await createDepartment(null);
  typeId = (await repo.listMeetingTypes()).find((type) => type.code === "IDM")!.id;
});

afterAll(async () => {
  await getDbPool().end();
});

describe("v1.57.6 (D-346) meeting states", () => {
  it("the Owner approves or returns points sent before the MOM was entered (AWAITING_MOM, MOM_RETURNED)", async () => {
    const id = await schedule({ title: `Points late ${tag}` });
    expect((await act(id, "SUBMIT_POINTS", coordinator)).ok).toBe(true);
    expect((await act(id, "ENTER_MOM", coordinator)).ok).toBe(true); // LAST_APPROVED: the MOM may start
    let row = (await repo.findMeeting(id))!;
    expect({ status: row.status, points: row.pointsStatus }).toEqual({ status: "AWAITING_MOM", points: "SUBMITTED" });
    expect((await act(id, "APPROVE_POINTS", coordinator)).ok).toBe(false); // only the Owner
    expect((await act(id, "RETURN_POINTS", owner, { remarks: "Add the safety point" })).ok).toBe(true);
    expect((await repo.findMeeting(id))!.pointsStatus).toBe("RETURNED");

    // MOM_RETURNED with points still with the Owner: approvable too.
    const other = await schedule({ title: `Points returned ${tag}` });
    expect((await act(other, "SUBMIT_POINTS", coordinator)).ok).toBe(true);
    expect((await act(other, "ENTER_MOM", coordinator)).ok).toBe(true);
    expect((await act(other, "SUBMIT_MOM", coordinator, { mom: mom() })).ok).toBe(true);
    expect((await act(other, "APPROVE_POINTS", owner)).ok).toBe(false); // MOM with the Owner: decided with the MOM
    expect((await act(other, "RETURN_MOM", owner, { remarks: "Add the decisions" })).ok).toBe(true);
    expect((await act(other, "APPROVE_POINTS", owner)).ok).toBe(true);
    row = (await repo.findMeeting(other))!;
    expect({ status: row.status, points: row.pointsStatus }).toEqual({ status: "MOM_RETURNED", points: "APPROVED" });
  });

  it("approving the MOM approves points still with the Owner, with a meeting event", async () => {
    const id = await schedule({ title: `Settle ${tag}` });
    expect((await act(id, "SUBMIT_POINTS", coordinator)).ok).toBe(true);
    expect((await act(id, "ENTER_MOM", coordinator)).ok).toBe(true);
    expect((await act(id, "SUBMIT_MOM", coordinator, { mom: mom() })).ok).toBe(true);
    expect((await repo.findMeeting(id))!.pointsStatus).toBe("SUBMITTED");
    expect((await act(id, "APPROVE_MOM", owner)).ok).toBe(true);
    const row = (await repo.findMeeting(id))!;
    expect({ status: row.status, points: row.pointsStatus }).toEqual({ status: "MOM_APPROVED", points: "APPROVED" });
    const settled = await events(id, "POINTS_APPROVED");
    expect(settled).toHaveLength(1);
    expect(String(settled[0]!.body)).toContain("with the MOM");
  });

  it("closing an open point closes it across a 3-meeting carry chain", async () => {
    const first = await approvedMeeting({ title: `Chain A ${tag}` }, { openPoints: [{ text: `Power tariff ${tag}`, ownerId: owner, reviewOn: "" }] });
    const second = await approvedMeeting({ title: `Chain B ${tag}`, parentMeetingId: first, points: [] });
    const third = await schedule({ title: `Chain C ${tag}`, parentMeetingId: second, points: [] });
    const [a] = await repo.listOpenPoints(first);
    const [b] = await repo.listOpenPoints(second);
    const [c] = await repo.listOpenPoints(third);
    expect(b!.carriedFromId).toBe(a!.id);
    expect(c!.carriedFromId).toBe(b!.id);
    expect([a, b, c].map((point) => point!.status)).toEqual(["OPEN", "OPEN", "OPEN"]);
    expect((await meetings.closeOpenPointFor({ pointId: b!.id, note: "Tariff revised" }, who(member))).ok).toBe(false); // not Owner or Coordinator
    expect((await meetings.closeOpenPointFor({ pointId: b!.id, note: "Tariff revised" }, who(coordinator))).ok).toBe(true);
    for (const point of [a, b, c]) {
      const closed = (await repo.findOpenPoint(point!.id))!;
      expect({ status: closed.status, note: closed.closedNote }).toEqual({ status: "CLOSED", note: "Tariff revised" });
    }
  });

  // v1.57.6 (D-345, owner: "Block the delete"): an action item's task closes through the meeting.
  it("an action item's task can't be deleted from the task pages, by the person who gave it or by IT", async () => {
    const id = await approvedMeeting({ title: `Delete guard ${tag}` }, { actions: [{ title: `Book the venue ${tag}`, description: "", ownerId: member, priority: "NORMAL", dueOn: "" }] });
    const [action] = await repo.listActions(id);
    expect(action!.taskId).not.toBeNull();
    const admin = await createUser({ name: `Admin ${tag}`, roles: ["USER", "IT_ADMIN"] });
    for (const actor of [who(coordinator), who(owner), who(admin, ["USER", "IT_ADMIN"])]) {
      const result = await deleteTask(action!.taskId!, { ...actor, sessionId: null } as never);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.message).toMatch(/action item of meeting|can't be deleted|Not found|Only the task's creator/);
    }
    // At least IT reaches the meeting guard (IT may edit any task), and nothing changed.
    const asIt = await deleteTask(action!.taskId!, { ...who(admin, ["USER", "IT_ADMIN"]), sessionId: null } as never);
    expect(!asIt.ok && asIt.message).toMatch(/action item of meeting/);
    const [[row]] = await getDbPool().query<RowDataPacket[]>("SELECT status, deleted_at FROM tasks WHERE id = ?", [action!.taskId]);
    expect(row!.deleted_at).toBeNull();
    expect(row!.status).not.toBe("CANCELLED");
    // The follow-up still sees it, so the meeting isn't blocked from closing by a vanished task.
    const [after] = await repo.listActions(id);
    expect(after!.taskNo).not.toBeNull();
  });

  it("Send back reopens the completed task (locked, row_version), writes a REOPEN task event and tells the assignee", async () => {
    const id = await approvedMeeting({ title: `Send back ${tag}` }, { actions: [{ title: `Hire operators ${tag}`, description: "", ownerId: member, priority: "HIGH", dueOn: "" }] });
    const [action] = await repo.listActions(id);
    expect(action!.taskId).not.toBeNull();
    await getDbPool().query("UPDATE tasks SET status = 'COMPLETED', completed_at = UTC_TIMESTAMP(), completed_by = ?, row_version = row_version + 1 WHERE id = ?", [member, action!.taskId]);
    const before = (await findTask(action!.taskId!))!;
    expect((await meetings.reviewAction({ actionId: action!.id, decision: "SEND_BACK", note: "x" }, who(owner))).ok).toBe(false); // the note is required
    const sent = await meetings.reviewAction({ actionId: action!.id, decision: "SEND_BACK", note: "Need joining dates" }, who(owner));
    expect(sent.ok).toBe(true);
    const after = (await findTask(action!.taskId!))!;
    expect(after.status).toBe("OPEN");
    expect(after.rowVersion).toBe(before.rowVersion + 1);
    const [rows] = await getDbPool().query<RowDataPacket[]>("SELECT actor_id, from_status, to_status, body, payload_json FROM task_events WHERE task_id = ? AND event_type = 'REOPEN'", [action!.taskId]);
    expect(rows).toHaveLength(1);
    const payload = typeof rows[0]!.payload_json === "string" ? JSON.parse(rows[0]!.payload_json) : rows[0]!.payload_json;
    expect({ actor: Number(rows[0]!.actor_id), from: rows[0]!.from_status, to: rows[0]!.to_status, body: rows[0]!.body, payload }).toEqual({
      actor: owner,
      from: "COMPLETED",
      to: "OPEN",
      body: "Need joining dates",
      payload: { meetingId: id, actionId: action!.id },
    });
    const [told] = await getDbPool().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND event_type = 'WORK_TASK_REOPENED' AND entity_id = ?", [member, action!.taskId]);
    expect(Number(told[0]!.n)).toBe(1);
    expect(await events(id, "ACTION_SENT_BACK")).toHaveLength(1);
  });
});
