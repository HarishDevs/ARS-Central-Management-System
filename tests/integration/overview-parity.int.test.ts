import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import { getHomeLayout } from "@/lib/db/repositories/home.repository";
import { homeAccess, homeLayoutFor, overviewWidgets, saveLayout } from "@/server/home/home-service";
import { approvalDaily, approvalInsights, meetingDaily, meetingSummary, taskInsights } from "@/lib/db/repositories/overview.repository";
import { createWorkflow, decideTask, publishVersion, submitRequest, type Actor } from "@/server/approvals/service";
import { parsePeriod } from "@/server/work/period";
import { addDays, indiaDay } from "@/server/work/rules";
import type { ModuleCode } from "@/server/modules/modules";
import { createUser, pendingTaskKey } from "./helpers";

// v1.79.0 (D-406): the three Home overviews identically featured: a separate
// layout per overview, defaults that reproduce today's screens, access limits
// on every widget (meeting figures need the dashboard page access), the new
// cards' period comparisons and the new widgets' queries.
const tag = Date.now().toString(36);
const ALL: ModuleCode[] = ["APPROVAL", "TASK", "PROJECT", "MEETING"];
const person = (id: number, modules: ModuleCode[] = ALL) => ({ id, name: `P${id}`, roles: ["USER"] as string[], modules, sessionId: "overview-parity", ipAddress: null });
const kinds = (layout: { kind: string }[]) => layout.map((item) => item.kind);
const db = () => getDbPool();
let alice: number;
let bob: number;
let carol: number;
let admin: number;
let typeVersion: number;
let meetingType: number;
const today = indiaDay(new Date());
const tenDays = parsePeriod({ period: "custom", from: addDays(today, -9), to: today }, today, "month");
const weekdayNow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;

beforeAll(async () => {
  alice = await createUser({ name: `Overview Alice ${tag}` });
  bob = await createUser({ name: `Overview Bob ${tag}` });
  carol = await createUser({ name: `Overview Carol ${tag}` });
  admin = await createUser({ name: `Overview Admin ${tag}`, roles: ["USER", "IT_ADMIN"] });
  await db().query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES ('features.pm_foundations', 'FEATURES', 'STRING', FALSE, 'ON') ON DUPLICATE KEY UPDATE value = 'ON'");
  const [type] = await db().query<ResultSetHeader>("INSERT INTO module_types (module, code, name, active, created_by) VALUES ('TASK', ?, 'Overview task type', TRUE, ?)", [`OV_${tag}`.slice(0, 40), admin]);
  const [version] = await db().query<ResultSetHeader>("INSERT INTO module_type_versions (type_id, version_no, status, form_json, settings_json, created_by) VALUES (?, 1, 'PUBLISHED', JSON_ARRAY(), JSON_OBJECT(), ?)", [type.insertId, admin]);
  typeVersion = version.insertId;
  const [types] = await db().query<RowDataPacket[]>("SELECT id FROM meeting_types ORDER BY id LIMIT 1");
  if (types[0]) meetingType = Number(types[0].id);
  else {
    const [made] = await db().query<ResultSetHeader>("INSERT INTO meeting_types (code, name) VALUES (?, 'Overview type')", [`OV${tag}`.slice(0, 40)]);
    meetingType = made.insertId;
  }
  // Carol may not see the meeting dashboard figures.
  await db().query("INSERT INTO page_access_rules (page_key, scope, scope_id, level) VALUES ('users.meeting_dashboard', 'USER', ?, 'HIDDEN')", [carol]);
});

afterAll(async () => {
  await getDbPool().end();
});

describe("one layout per overview (D-406)", () => {
  it("each overview starts with its default (today's screen), nothing stored", async () => {
    expect(kinds((await homeLayoutFor(person(alice), undefined, "approvals")).widgets)).toEqual(["ap_waiting", "ap_due", "ap_returned", "ap_recent", "ap_drafts", "ap_insights"]);
    expect(kinds((await homeLayoutFor(person(alice), undefined, "meetings")).widgets)).toEqual(["mt_attention", "mt_upcoming", "mt_actions", "mt_approve", "mt_confirm", "mt_insights", "mt_figures", "mt_register"]);
    expect(kinds((await homeLayoutFor(person(alice))).widgets)).toEqual(["my_tasks", "projects", "status_updates", "notepad", "workload", "assigned", "people"]);
    for (const scope of ["approvals", "tasks", "meetings"] as const) expect(await getHomeLayout(alice, scope)).toBeNull();
  });

  it("saves each overview separately; a reset clears only that overview", async () => {
    expect(await saveLayout(person(alice), { scope: "approvals", widgets: [{ kind: "ap_attention", size: "half" }, { kind: "ap_waiting", size: "full" }, { kind: "notepad", size: "half" }], version: 0 })).toMatchObject({ ok: true, value: { version: 1 } });
    expect(await saveLayout(person(alice), { scope: "meetings", widgets: [{ kind: "mt_chart", size: "full" }], version: 0 })).toMatchObject({ ok: true, value: { version: 1 } });
    expect(await saveLayout(person(alice), { widgets: [{ kind: "task_insights", size: "half" }], version: 0 })).toMatchObject({ ok: true }); // no scope: My Work, as before
    expect(kinds((await homeLayoutFor(person(alice), undefined, "approvals")).widgets)).toEqual(["ap_attention", "ap_waiting", "notepad"]);
    expect(kinds((await homeLayoutFor(person(alice), undefined, "meetings")).widgets)).toEqual(["mt_chart"]);
    expect(kinds((await homeLayoutFor(person(alice), undefined, "tasks")).widgets)).toEqual(["task_insights"]);
    // Versions are per overview: a stale approvals version is a conflict, the meetings one isn't touched.
    expect(await saveLayout(person(alice), { scope: "approvals", widgets: [], version: 0 })).toMatchObject({ ok: false, conflict: true });
    expect((await saveLayout(person(alice), { scope: "approvals", reset: true })).ok).toBe(true);
    expect(await getHomeLayout(alice, "approvals")).toBeNull();
    expect(await getHomeLayout(alice, "meetings")).toMatchObject({ version: 1 });
    expect(await getHomeLayout(alice, "tasks")).toMatchObject({ version: 1 });
    // Nobody else's layout changes.
    expect(await getHomeLayout(bob, "meetings")).toBeNull();
  });

  it("refuses widgets of another overview, unknown overviews and overviews the person can't open", async () => {
    expect(await saveLayout(person(bob), { scope: "approvals", widgets: [{ kind: "my_tasks", size: "full" }], version: 0 })).toMatchObject({ ok: false, message: "That layout isn't valid." });
    expect(await saveLayout(person(bob), { scope: "meetings", widgets: [{ kind: "ap_waiting", size: "full" }], version: 0 })).toMatchObject({ ok: false });
    expect(await saveLayout(person(bob), { scope: "projects", widgets: [], version: 0 })).toMatchObject({ ok: false, message: "That change isn't valid." });
    const noMeetings = person(bob, ["APPROVAL", "TASK"]);
    expect(await saveLayout(noMeetings, { scope: "meetings", widgets: [{ kind: "notepad", size: "half" }], version: 0 })).toMatchObject({ ok: false, message: "That overview isn't open to you." });
    const noApprovals = person(bob, ["TASK", "MEETING"]);
    expect(await saveLayout(noApprovals, { scope: "approvals", reset: true })).toMatchObject({ ok: false });
    expect(await getHomeLayout(bob, "meetings")).toBeNull();
  });

  it("meeting figures follow the dashboard page access: hidden by default, refused on save, dropped from a stored layout", async () => {
    const access = await homeAccess(person(carol));
    expect(access).toMatchObject({ approvals: true, meetings: true, meetingFigures: false });
    expect(kinds((await homeLayoutFor(person(carol), access, "meetings")).widgets)).toEqual(["mt_attention", "mt_upcoming", "mt_actions", "mt_approve", "mt_confirm"]);
    expect(await saveLayout(person(carol), { scope: "meetings", widgets: [{ kind: "mt_figures", size: "full" }], version: 0 })).toMatchObject({ ok: false });
    // A layout stored while the access was given keeps the rest when it is taken away.
    await db().query("INSERT INTO home_layouts (user_id, scope, widgets_json, version) VALUES (?, 'meetings', ?, 1)", [carol, JSON.stringify([{ kind: "mt_register", size: "full" }, { kind: "mt_upcoming", size: "half" }])]);
    const widgets = await overviewWidgets(person(carol), "meetings");
    expect(kinds(widgets.layout)).toEqual(["mt_upcoming"]);
    expect(widgets.addable.map((entry) => entry.kind)).not.toContain("mt_figures");
    expect(widgets.editable).toBe(true);
    expect((await homeAccess(person(alice))).meetingFigures).toBe(true);
  });

  it("the notepad is one note shared by the three overviews", async () => {
    const [a, b] = await Promise.all([overviewWidgets(person(alice), "approvals"), overviewWidgets(person(alice), "meetings")]);
    expect(a.note).toEqual(b.note);
  });
});

describe("the new cards' comparisons and the new widgets' queries (D-406)", () => {
  it("Approvals: decided by me this period vs the period before; raised and decided by day", async () => {
    const actor: Actor = { id: admin, roles: ["USER", "IT_ADMIN"] };
    const created = await createWorkflow(
      {
        code: `OVP_${tag}`.toUpperCase(),
        name: `Overview ${tag}`,
        kind: "PREDEFINED",
        requestPrefix: "OV",
        form: [{ key: "note", label: "Note", type: "TEXT", required: false }],
        definition: {
          nodes: [
            { id: "start", kind: "START", label: "Start" },
            { id: "a", kind: "APPROVAL", label: "Check", approvers: [{ type: "USER", userId: bob }], completion: { type: "ALL" } },
            { id: "end", kind: "END", label: "End" },
          ],
          edges: [
            { id: "e1", from: "start", to: "a" },
            { id: "e2", from: "a", to: "end" },
          ],
        },
      },
      actor,
    );
    if (!created.ok) throw new Error(created.message);
    await publishVersion(created.value.versionId, actor);
    const submitted = await submitRequest({ workflowId: created.value.workflowId, title: `Overview request ${tag}`, fields: { note: "x" } }, { id: alice, roles: ["USER"] });
    if (!submitted.ok) throw new Error(submitted.message);
    const requestId = submitted.value.requestId;
    const decided = await decideTask({ requestId, taskKey: await pendingTaskKey(requestId, bob), decision: "APPROVE" }, { id: bob, roles: ["USER"] });
    expect(decided.ok).toBe(true);

    const week = parsePeriod({ period: "week" }, today, "month");
    expect(await approvalInsights(bob, week)).toMatchObject({ decided: 1, decidedBefore: 0 });
    const daily = await approvalDaily(alice, week);
    expect(daily.raised[weekdayNow]).toBe(1);
    expect((await approvalDaily(bob, week)).decided[weekdayNow]).toBe(1);
    // Moved into the previous week: counted there, so the change compares like with like.
    await db().query("UPDATE approval_tasks SET decided_at = ? WHERE request_id = ? AND approver_id = ?", [new Date(week.prevFrom.getTime() + 3_600_000), requestId, bob]);
    expect(await approvalInsights(bob, week)).toMatchObject({ decided: 0, decidedBefore: 1 });
    expect((await approvalDaily(bob, week)).decided.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("Meetings: held this period (ran or attended) vs before, and the day-by-day chart", async () => {
    const meeting = async (no: string, status: string, start: Date | null, owner: number) => {
      const [result] = await db().query<ResultSetHeader>(
        "INSERT INTO meetings (meeting_no, title, type_id, owner_id, coordinator_id, status, scheduled_start, scheduled_end, actual_start, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [`${no}-${tag}`.slice(0, 30), `Meeting ${no}`, meetingType, owner, owner, status, start ?? new Date(), start ?? new Date(), start, owner],
      );
      return result.insertId;
    };
    const now = new Date(Date.now() - 60_000);
    await meeting("M1", "CLOSED", now, alice); // ran by Alice, this period
    const attended = await meeting("M2", "MOM_APPROVED", now, bob); // Bob's; Alice present
    await db().query("INSERT INTO meeting_participants (meeting_id, user_id, attendance) VALUES (?, ?, 'PRESENT')", [attended, alice]);
    const absent = await meeting("M3", "CLOSED", now, bob); // Bob's; Alice absent: not counted
    await db().query("INSERT INTO meeting_participants (meeting_id, user_id, attendance) VALUES (?, ?, 'ABSENT')", [absent, alice]);
    await meeting("M4", "CANCELLED", now, alice); // cancelled: not counted
    await meeting("M5", "CLOSED", new Date(tenDays.prevFrom.getTime() + 3_600_000), alice); // the period before
    expect(await meetingSummary(alice, tenDays)).toEqual({ held: 2, heldBefore: 1 });

    // A meeting action of Alice's, its task completed now.
    const [task] = await db().query<ResultSetHeader>(
      "INSERT INTO tasks (task_no, type_version_id, title, priority, status, created_by, assignee_id, assigned_by, due_at, completed_at, form_data_json) VALUES (?, ?, 'Action', 'NORMAL', 'COMPLETED', ?, ?, ?, UTC_TIMESTAMP() + INTERVAL 1 DAY, ?, JSON_OBJECT())",
      [`TSK-OVA-${tag}`.slice(0, 30), typeVersion, bob, alice, bob, now],
    );
    await db().query("INSERT INTO meeting_actions (meeting_id, position, title, owner_id, task_id) VALUES (?, 1, 'Action', ?, ?)", [attended, alice, task.insertId]);
    const daily = await meetingDaily(alice, tenDays);
    expect(daily.held.reduce((a, b) => a + b, 0)).toBe(2);
    expect(daily.held[weekdayNow]).toBe(2);
    expect(daily.done[weekdayNow]).toBe(1);
    expect((await meetingDaily(carol, tenDays)).held.every((value) => value === 0)).toBe(true);
  });

  it("My Work: completion rate, on-time share and average days to complete", async () => {
    const add = async (no: string, status: string, createdDaysAgo: number, dueDays: number | null, completed: boolean) => {
      await db().query(
        `INSERT INTO tasks (task_no, type_version_id, title, priority, status, created_by, assignee_id, assigned_by, due_at, completed_at, form_data_json, created_at)
         VALUES (?, ?, ?, 'NORMAL', ?, ?, ?, ?, ${dueDays === null ? "NULL" : "UTC_TIMESTAMP() + INTERVAL ? DAY"}, ${completed ? "UTC_TIMESTAMP() - INTERVAL 1 MINUTE" : "NULL"}, JSON_OBJECT(), UTC_TIMESTAMP() - INTERVAL ? DAY)`,
        [`TSK-${no}-${tag}`.slice(0, 30), typeVersion, no, status, bob, carol, bob, ...(dueDays === null ? [] : [dueDays]), createdDaysAgo],
      );
    };
    await add("OT", "COMPLETED", 2, 1, true); // on time
    await add("LATE", "COMPLETED", 3, -2, true); // late
    await add("OPEN", "OPEN", 1, 3, false);
    const insights = await taskInsights(carol, tenDays);
    expect(insights).toMatchObject({ given: 3, givenDone: 2, completed: 2, withDue: 2, onTime: 1 });
    expect(insights.avgDays).toBeGreaterThan(2.4);
    expect(insights.avgDays).toBeLessThan(2.6);
    expect(await taskInsights(bob, tenDays)).toMatchObject({ given: 0, completed: 0, avgDays: null });
  });
});
