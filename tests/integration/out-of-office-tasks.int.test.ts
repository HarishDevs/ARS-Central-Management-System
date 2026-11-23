import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import { createDelegation } from "@/server/approvals/collab";
import * as work from "@/server/work/service";
import { createUser } from "./helpers";

// v1.54.5 (owner): "when out of office dates are set, the tasks already on
// those dates move to the day after the to-date; a new task on those dates
// shows a warning, like the approval".
const person = (id: number) => ({ id, name: `P${id}`, roles: ["USER"], modules: ["APPROVAL", "TASK"] as ("APPROVAL" | "TASK")[] });
const indiaDay = (offset: number) => new Date(Date.now() + 330 * 60_000 + offset * 86_400_000).toISOString().slice(0, 10);
let away: number;
let boss: number;
let cover: number;

beforeAll(async () => {
  boss = await createUser({ name: "OOO boss" });
  away = await createUser({ name: "OOO person", managerId: boss });
  cover = await createUser({ name: "OOO cover" });
});

afterAll(async () => {
  await getDbPool().end();
});

const dueDay = async (id: number) => {
  const [rows] = await getDbPool().query<RowDataPacket[]>("SELECT DATE_FORMAT(DATE_ADD(due_at, INTERVAL 330 MINUTE), '%Y-%m-%d') AS d FROM tasks WHERE id = ?", [id]);
  return String(rows[0]!.d);
};

describe("out of office and tasks", () => {
  it("tasks due within the dates move to the first free day after them; others stay; the giver is told", async () => {
    const [starts, ends] = [indiaDay(20), indiaDay(22)];
    const inside = await work.quickAddTask({ title: "Inside the dates", projectId: null, sectionId: null, parentId: null, assigneeId: away, dueDay: indiaDay(21), mySectionId: null, holidayOk: true }, person(boss));
    const outside = await work.quickAddTask({ title: "After the dates", projectId: null, sectionId: null, parentId: null, assigneeId: away, dueDay: indiaDay(30), mySectionId: null, holidayOk: true }, person(boss));
    if (!inside.ok || !outside.ok) throw new Error("setup");
    const made = await createDelegation({ userId: away, delegateId: cover, startsOn: starts, endsOn: ends }, { id: away, roles: ["USER"] });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.value.movedTasks).toBe(1);
    expect(made.value.movedTo > ends).toBe(true);
    expect(await dueDay(inside.value.id)).toBe(made.value.movedTo);
    expect(await dueDay(outside.value.id)).toBe(indiaDay(30));
    const [told] = await getDbPool().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND message LIKE '%out of office%'", [boss]);
    expect(Number(told[0]!.n)).toBeGreaterThan(0);

    // A new task due while away asks first (keep or move to the day after).
    const asked = await work.quickAddTask({ title: "New while away", projectId: null, sectionId: null, parentId: null, assigneeId: away, dueDay: indiaDay(21), mySectionId: null }, person(boss));
    expect(asked.ok).toBe(false);
    expect(!asked.ok && asked.holiday).toMatchObject({ away: true, mode: "WARN" });
    const kept = await work.quickAddTask({ title: "Kept while away", projectId: null, sectionId: null, parentId: null, assigneeId: away, dueDay: indiaDay(21), mySectionId: null, holidayOk: true }, person(boss));
    expect(kept.ok).toBe(true);
  });

  // v1.85.3 (owner, 23 Nov 2026): past dates for everyone, up to 30 days back.
  const overdueTask = async (assignee: number, giver: number, day: string) => {
    const made = await work.quickAddTask({ title: `Overdue ${day}`, projectId: null, sectionId: null, parentId: null, assigneeId: assignee, dueDay: indiaDay(40), mySectionId: null, holidayOk: true }, person(giver));
    if (!made.ok) throw new Error("setup");
    await getDbPool().query("UPDATE tasks SET due_at = DATE_SUB(TIMESTAMP(?, '18:29:00'), INTERVAL 0 MINUTE) WHERE id = ?", [day, made.value.id]);
    return made.value.id;
  };

  it("a wholly past out-of-office is recorded only: no task moves, the delegate isn't told, the date job is marked done", async () => {
    const giver = await createUser({ name: "OOO past boss" });
    const who = await createUser({ name: "OOO past person", managerId: giver });
    const sub = await createUser({ name: "OOO past cover" });
    const overdue = await overdueTask(who, giver, indiaDay(-10));
    const made = await createDelegation({ userId: who, delegateId: sub, startsOn: indiaDay(-12), endsOn: indiaDay(-8), reason: "Leave taken" }, { id: who, roles: ["USER"] });
    expect(made).toMatchObject({ ok: true, value: { past: true, movedTasks: 0 } });
    if (!made.ok) return;
    expect(await dueDay(overdue)).toBe(indiaDay(-10));
    const [row] = await getDbPool().query<RowDataPacket[]>("SELECT activation_logged_at IS NOT NULL AS a, expiry_logged_at IS NOT NULL AS e FROM delegations WHERE id = ?", [made.value.id]);
    expect([Number(row[0]!.a), Number(row[0]!.e)]).toEqual([1, 1]);
    const [delegateTold] = await getDbPool().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?", [sub]);
    expect(Number(delegateTold[0]!.n)).toBe(0);
    const [personTold] = await getDbPool().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND title = 'Out-of-office recorded'", [who]);
    expect(Number(personTold[0]!.n)).toBe(1);
  });

  it("one that started in the past and runs on moves only tasks due from today; overdue ones keep their dates", async () => {
    const giver = await createUser({ name: "OOO span boss" });
    const who = await createUser({ name: "OOO span person", managerId: giver });
    const sub = await createUser({ name: "OOO span cover" });
    const overdue = await overdueTask(who, giver, indiaDay(-3));
    const ahead = await work.quickAddTask({ title: "Due while still away", projectId: null, sectionId: null, parentId: null, assigneeId: who, dueDay: indiaDay(2), mySectionId: null, holidayOk: true }, person(giver));
    if (!ahead.ok) throw new Error("setup");
    const made = await createDelegation({ userId: who, delegateId: sub, startsOn: indiaDay(-5), endsOn: indiaDay(3) }, { id: who, roles: ["USER"] });
    expect(made).toMatchObject({ ok: true, value: { past: false, movedTasks: 1 } });
    if (!made.ok) return;
    expect(await dueDay(overdue)).toBe(indiaDay(-3));
    expect(await dueDay(ahead.value.id)).toBe(made.value.movedTo);
  });

  it("refuses a start more than 30 days back", async () => {
    const who = await createUser({ name: "OOO too far" });
    const sub = await createUser({ name: "OOO too far cover" });
    expect(await createDelegation({ userId: who, delegateId: sub, startsOn: indiaDay(-31), endsOn: indiaDay(-29) }, { id: who, roles: ["USER"] })).toMatchObject({ ok: false, code: "INVALID" });
  });
});
