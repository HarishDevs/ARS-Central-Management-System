import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import { getHomeLayout, getHomeNote } from "@/lib/db/repositories/home.repository";
import { listMyTabs } from "@/lib/db/repositories/work.repository";
import { homeAccess, homeLayoutFor, saveLayout, saveNote } from "@/server/home/home-service";
import { changeMyTabs } from "@/server/work/view-tabs-service";
import { buildStrip, MY_TASKS_VIEWS, MAX_MY_TABS } from "@/server/work/view-tabs";
import type { ModuleCode } from "@/server/modules/modules";
import { createUser } from "./helpers";

// v1.63.0 (D-369, PM phase A part 3): Home layout and notepad (per person,
// validated, versioned) and My Tasks tabs (the person's own strip only).
const tag = Date.now().toString(36);
const ALL: ModuleCode[] = ["APPROVAL", "TASK", "PROJECT"];
const person = (id: number, modules: ModuleCode[] = ALL) => ({ id, name: `P${id}`, roles: ["USER"] as string[], modules, sessionId: "pm-home", ipAddress: null });
let alice: number;
let bob: number;
let noProjects: number;

beforeAll(async () => {
  alice = await createUser({ name: `Home Alice ${tag}` });
  bob = await createUser({ name: `Home Bob ${tag}` });
  noProjects = await createUser({ name: `Home NoProj ${tag}` });
  await getDbPool().query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES ('features.pm_foundations', 'FEATURES', 'STRING', FALSE, 'ON') ON DUPLICATE KEY UPDATE value = 'ON'");
});

afterAll(async () => {
  await getDbPool().end();
});

describe("Home layout (D-369)", () => {
  it("starts with the default layout, nothing stored", async () => {
    const layout = await homeLayoutFor(person(alice));
    expect(layout.version).toBe(0);
    expect(layout.widgets.map((item) => item.kind)).toContain("notepad");
    expect(await getHomeLayout(alice)).toBeNull();
  });

  it("saves a valid layout with optimistic versions; a stale version is a conflict", async () => {
    const first = await saveLayout(person(alice), { widgets: [{ kind: "notepad", size: "full" }, { kind: "my_tasks", size: "full" }], version: 0 });
    expect(first).toMatchObject({ ok: true, value: { version: 1 } });
    const second = await saveLayout(person(alice), { widgets: [{ kind: "my_tasks", size: "half" }, { kind: "notepad", size: "full" }], version: 1 });
    expect(second).toMatchObject({ ok: true, value: { version: 2 } });
    expect(await saveLayout(person(alice), { widgets: [], version: 1 })).toMatchObject({ ok: false, conflict: true });
    expect((await homeLayoutFor(person(alice))).widgets).toEqual([
      { kind: "my_tasks", size: "half" },
      { kind: "notepad", size: "full" },
    ]);
  });

  it("refuses invalid layouts and widgets of modules the person lacks", async () => {
    expect(await saveLayout(person(alice), { widgets: [{ kind: "notepad", size: "half" }, { kind: "notepad", size: "half" }], version: 2 })).toMatchObject({ ok: false, message: "That layout isn't valid." });
    expect(await saveLayout(person(alice), { widgets: [{ kind: "forms", size: "half" }], version: 2 })).toMatchObject({ ok: false });
    expect(await saveLayout(person(alice), { widgets: [{ kind: "notepad", size: "half" }], version: -1 })).toMatchObject({ ok: false });
    // Without the Projects module: no Projects widget.
    const lacking = person(noProjects, ["APPROVAL", "TASK"]);
    expect((await homeAccess(lacking)).projects).toBe(false);
    expect(await saveLayout(lacking, { widgets: [{ kind: "projects", size: "half" }], version: 0 })).toMatchObject({ ok: false });
    expect((await homeLayoutFor(lacking)).widgets.map((item) => item.kind)).not.toContain("projects");
    // Without Tasks: only the notepad.
    const notes = person(noProjects, ["APPROVAL"]);
    expect((await homeLayoutFor(notes)).widgets.map((item) => item.kind)).toEqual(["notepad"]);
    expect(await saveLayout(notes, { widgets: [{ kind: "my_tasks", size: "full" }], version: 0 })).toMatchObject({ ok: false });
  });

  it("each person has their own layout; Reset goes back to the default", async () => {
    expect((await homeLayoutFor(person(bob))).version).toBe(0);
    expect((await saveLayout(person(alice), { reset: true })).ok).toBe(true);
    expect(await getHomeLayout(alice)).toBeNull();
  });

  it("is refused while the switch is off", async () => {
    await getDbPool().query("UPDATE system_settings SET value = 'OFF' WHERE setting_key = 'features.pm_foundations'");
    try {
      expect(await saveLayout(person(alice), { widgets: [], version: 0 })).toMatchObject({ ok: false });
      expect(await saveNote(person(alice), "x", 0)).toMatchObject({ ok: false });
    } finally {
      await getDbPool().query("UPDATE system_settings SET value = 'ON' WHERE setting_key = 'features.pm_foundations'");
    }
  });
});

describe("private notepad (BR-HOME-007)", () => {
  it("belongs to its owner only: Bob's note never shows Alice's text", async () => {
    expect(await saveNote(person(alice), "**Call** the vendor\n- quotes", 0)).toMatchObject({ ok: true, value: { version: 1 } });
    expect(await getHomeNote(alice)).toEqual({ body: "**Call** the vendor\n- quotes", version: 1 });
    expect(await getHomeNote(bob)).toEqual({ body: "", version: 0 });
    // Bob saving (even naming Alice's version) writes only his own note.
    expect(await saveNote(person(bob), "Bob's own", 1)).toMatchObject({ ok: false, conflict: true });
    expect(await saveNote(person(bob), "Bob's own", 0)).toMatchObject({ ok: true });
    expect((await getHomeNote(alice)).body).toBe("**Call** the vendor\n- quotes");
  });

  it("refuses a stale version and a note over 50,000 characters", async () => {
    expect(await saveNote(person(alice), "newer", 0)).toMatchObject({ ok: false, conflict: true });
    expect(await saveNote(person(alice), "x".repeat(50_001), 1)).toMatchObject({ ok: false, message: expect.stringContaining("too long") });
    expect(await saveNote(person(alice), "", 1)).toMatchObject({ ok: true, value: { version: 2 } });
  });
});

describe("My Tasks tabs (PM-A13)", () => {
  const strip = async (id: number) => {
    const data = await listMyTabs(id);
    return buildStrip(data.rows, data.tabsSet, data.defaultView, MY_TASKS_VIEWS);
  };
  it("starts with List, Board and Calendar, nothing stored", async () => {
    expect((await strip(alice)).map((tab) => tab.key)).toEqual(["vLIST", "vBOARD", "vCALENDAR"]);
    expect((await listMyTabs(alice)).tabsSet).toBe(false);
  });

  it("adds, renames, sets default, duplicates, saves a List view, reorders and removes, all on the person's own strip", async () => {
    // v1.76.0 (D-401, owner): personal tab names may repeat (was "Board (2)").
    expect(await changeMyTabs({ op: "add", type: "BOARD" }, person(alice))).toMatchObject({ ok: true, message: 'Tab "Board" added.' });
    expect((await changeMyTabs({ op: "add", type: "TIMELINE" }, person(alice))).ok).toBe(false);
    let tabs = await strip(alice);
    expect(tabs.map((tab) => tab.name)).toEqual(["List", "Board", "Calendar", "Board"]);
    expect((await listMyTabs(alice)).tabsSet).toBe(true);
    const list = tabs[0]!;
    expect((await changeMyTabs({ op: "rename", key: list.key, name: "Everything" }, person(alice))).ok).toBe(true);
    expect((await changeMyTabs({ op: "save", key: list.key, config: { group: "priority", sort: "due" } }, person(alice))).ok).toBe(true);
    expect((await changeMyTabs({ op: "save", key: list.key, config: { group: "nonsense" } }, person(alice))).ok).toBe(false);
    const calendar = tabs.find((tab) => tab.type === "CALENDAR")!;
    expect((await changeMyTabs({ op: "default", key: calendar.key }, person(alice))).ok).toBe(true);
    expect((await changeMyTabs({ op: "duplicate", key: list.key }, person(alice))).ok).toBe(true);
    tabs = await strip(alice);
    expect(tabs.map((tab) => tab.name)).toEqual(["Everything", "Everything (copy)", "Board", "Calendar", "Board"]);
    expect(tabs.find((tab) => tab.isDefault)?.name).toBe("Calendar");
    expect((await listMyTabs(alice)).rows.find((row) => row.name === "Everything (copy)")?.config).toMatchObject({ group: "priority", sort: "due" });
    const reversed = [...tabs].reverse().map((tab) => tab.key);
    expect((await changeMyTabs({ op: "reorder", keys: reversed }, person(alice))).ok).toBe(true);
    expect((await strip(alice)).map((tab) => tab.key)).toEqual(reversed);
    expect((await changeMyTabs({ op: "remove", key: calendar.key }, person(alice))).ok).toBe(true);
    expect((await strip(alice)).filter((tab) => tab.isDefault)).toHaveLength(1);
    const [audit] = await getDbPool().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'MY_TASKS_TABS_CHANGED' AND entity_id = ?", [String(alice)]);
    expect(Number(audit[0]!.n)).toBeGreaterThanOrEqual(5);
  });

  it("someone else can't touch the person's tabs: their ids are not found on anyone else's strip", async () => {
    const aliceTab = (await strip(alice))[0]!;
    for (const input of [
      { op: "rename" as const, key: aliceTab.key, name: "Mine now" },
      { op: "remove" as const, key: aliceTab.key },
      { op: "save" as const, key: aliceTab.key, config: {} },
      { op: "default" as const, key: aliceTab.key },
      { op: "duplicate" as const, key: aliceTab.key },
    ])
      expect(await changeMyTabs(input, person(bob))).toEqual({ ok: false, message: "Not found." });
    expect((await strip(alice))[0]!.name).toBe(aliceTab.name);
    expect((await changeMyTabs({ op: "reorder", keys: [aliceTab.key] }, person(bob))).ok).toBe(false);
  });

  it("keeps at least one tab and at most 30", async () => {
    const tabs = await strip(bob);
    for (const tab of tabs.slice(1)) expect((await changeMyTabs({ op: "remove", key: tab.key }, person(bob))).ok).toBe(true);
    const last = (await strip(bob))[0]!;
    expect(await changeMyTabs({ op: "remove", key: last.key }, person(bob))).toMatchObject({ ok: false, message: "My Tasks keeps at least one tab." });
    for (let n = 1; n < MAX_MY_TABS; n += 1) expect((await changeMyTabs({ op: "add", type: "LIST" }, person(bob))).ok).toBe(true);
    expect(await changeMyTabs({ op: "add", type: "LIST" }, person(bob))).toMatchObject({ ok: false, message: `At most ${MAX_MY_TABS} tabs.` });
  });
});
