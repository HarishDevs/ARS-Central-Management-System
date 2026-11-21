import { describe, expect, it } from "vitest";
import { DEFAULT_GRID, parseGridConfig } from "@/server/work/grid";
import {
  addableViews,
  boardConfigSchema,
  buildStrip,
  canRemoveTab,
  cleanTabName,
  copyName,
  DEFAULT_BOARD,
  DEFAULT_PROJECT_LIST,
  materialisePlan,
  MAX_PROJECT_TABS,
  moveKey,
  parseTabConfig,
  pickTab,
  placeKey,
  sameTabs,
  tabHref,
  tabMenu,
  uniqueName,
  validTabConfig,
  VIEW_CATALOGUE,
  type TabRow,
} from "@/server/work/view-tabs";

// v1.61.0 (D-367, PM phase A, spec PRJ-15): tab rules.
const row = (over: Partial<TabRow>): TabRow => ({ id: 1, type: "LIST", name: "Tab", config: {}, isDefault: false, position: 1024, ...over });

describe("tab catalogue", () => {
  it("offers the five built views and hides the ones not built yet", () => {
    expect(addableViews().map((entry) => entry.type)).toEqual(["LIST", "BOARD", "CALENDAR", "TIMELINE", "OVERVIEW"]);
    expect(VIEW_CATALOGUE.filter((entry) => !entry.available).map((entry) => entry.type)).toContain("GANTT");
    expect(VIEW_CATALOGUE.every((entry) => !/asana/i.test(`${entry.label} ${entry.description}`))).toBe(true);
  });
});

describe("tab names", () => {
  it("folds spaces, refuses empty or too long names and control characters", () => {
    expect(cleanTabName("  Overdue   work ")).toBe("Overdue work");
    expect(cleanTabName("")).toBeNull();
    expect(cleanTabName("   ")).toBeNull();
    expect(cleanTabName("x".repeat(61))).toBeNull();
    expect(cleanTabName("x".repeat(60))).toHaveLength(60);
    expect(cleanTabName("a\u0007b")).toBe("ab");
    expect(cleanTabName(42)).toBeNull();
  });
  it("makes unique names case-insensitively, and copies", () => {
    expect(uniqueName("List", ["Board"])).toBe("List");
    expect(uniqueName("List", ["list"])).toBe("List (2)");
    expect(uniqueName("List", ["List", "List (2)"])).toBe("List (3)");
    expect(uniqueName("x".repeat(60), ["x".repeat(60)])).toHaveLength(60);
    expect(copyName("Overdue", ["Overdue"])).toBe("Overdue (copy)");
    expect(copyName("Overdue", ["Overdue", "Overdue (copy)"])).toBe("Overdue (copy) (2)");
  });
});

describe("the strip", () => {
  it("before it is stored: the five built-in views, saved List tabs after List, default from the project", () => {
    const strip = buildStrip([row({ id: 7, name: "Overdue" })], false, "BOARD");
    expect(strip.map((tab) => tab.key)).toEqual(["vOVERVIEW", "vLIST", "t7", "vBOARD", "vTIMELINE", "vCALENDAR"]);
    expect(strip.filter((tab) => tab.isDefault).map((tab) => tab.key)).toEqual(["vBOARD"]);
  });
  it("stored: rows in position order, one default (the first marked one)", () => {
    const strip = buildStrip([row({ id: 2, position: 2048, isDefault: true }), row({ id: 1, position: 1024, isDefault: true }), row({ id: 3, type: "BOARD", position: 3072 })], true, "LIST");
    expect(strip.map((tab) => tab.id)).toEqual([1, 2, 3]);
    expect(strip.filter((tab) => tab.isDefault).map((tab) => tab.id)).toEqual([1]);
  });
  it("stored without a default: the first tab of the project's default view type, else the first tab", () => {
    expect(buildStrip([row({ id: 1 }), row({ id: 2, type: "CALENDAR", position: 2048 })], true, "CALENDAR").find((tab) => tab.isDefault)?.id).toBe(2);
    expect(buildStrip([row({ id: 1, type: "BOARD" })], true, "TIMELINE").find((tab) => tab.isDefault)?.id).toBe(1);
    expect(buildStrip([], true, "LIST")).toEqual([]);
  });
  it("picks ?tab=, then ?view=, then the default", () => {
    const strip = buildStrip([row({ id: 1, name: "Mine" }), row({ id: 2, type: "BOARD", name: "Board", position: 2048, isDefault: true }), row({ id: 3, type: "BOARD", name: "Board 2", position: 3072 })], true, "LIST");
    expect(pickTab(strip, { tab: "1" })?.id).toBe(1);
    expect(pickTab(strip, { tab: "999" })?.id).toBe(2);
    expect(pickTab(strip, { view: "board" })?.id).toBe(2);
    expect(pickTab(strip, { view: "list" })?.id).toBe(1);
    expect(pickTab(strip, { view: "gantt" })?.id).toBe(2);
    expect(pickTab(strip, { tab: "1; DROP" })?.id).toBe(2);
    expect(pickTab([], {})).toBeNull();
  });
  it("links: a stored tab by id, a built-in view by type", () => {
    expect(tabHref("/p/1", { id: 5, type: "LIST" })).toBe("/p/1?tab=5");
    expect(tabHref("/p/1", { id: null, type: "BOARD" })).toBe("/p/1?view=board");
  });
});

describe("reorder", () => {
  const keys = ["a", "b", "c", "d"];
  it("moves one step with the keyboard, clamped at both ends", () => {
    expect(moveKey(keys, "b", -1)).toEqual(["b", "a", "c", "d"]);
    expect(moveKey(keys, "b", 1)).toEqual(["a", "c", "b", "d"]);
    expect(moveKey(keys, "a", -1)).toEqual(keys);
    expect(moveKey(keys, "d", 1)).toEqual(keys);
    expect(moveKey(keys, "z", 1)).toEqual(keys);
  });
  it("drops before another tab, or at the end", () => {
    expect(placeKey(keys, "d", "a")).toEqual(["d", "a", "b", "c"]);
    expect(placeKey(keys, "a", null)).toEqual(["b", "c", "d", "a"]);
    expect(placeKey(keys, "a", "a")).toEqual(keys);
  });
  it("a new order must hold the same tabs once each", () => {
    expect(sameTabs(keys, ["d", "c", "b", "a"])).toBe(true);
    expect(sameTabs(keys, ["a", "b", "c"])).toBe(false);
    expect(sameTabs(keys, ["a", "a", "b", "c"])).toBe(false);
    expect(sameTabs(keys, ["a", "b", "c", "x"])).toBe(false);
  });
});

describe("writing the strip (materialise)", () => {
  it("keeps the order and renames a built-in view that clashes with a saved tab", () => {
    const strip = buildStrip([row({ id: 9, name: "Board" })], false, "LIST");
    const plan = materialisePlan(strip);
    expect(plan.map((item) => [item.id, item.type, item.name])).toEqual([
      [null, "OVERVIEW", "Overview"],
      [null, "LIST", "List"],
      [9, "LIST", "Board"],
      [null, "BOARD", "Board (2)"],
      [null, "TIMELINE", "Timeline"],
      [null, "CALENDAR", "Calendar"],
    ]);
  });
});

describe("menu and removal", () => {
  const strip = buildStrip([row({ id: 1, isDefault: true }), row({ id: 2, type: "BOARD", position: 2048 })], true, "LIST");
  it("editors get every choice; others can only copy the link", () => {
    expect(tabMenu(strip[1]!, strip, true)).toEqual(["rename", "default", "duplicate", "copy", "remove"]);
    expect(tabMenu(strip[0]!, strip, true)).not.toContain("default");
    expect(tabMenu(strip[1]!, strip, false)).toEqual(["copy"]);
  });
  it("the last tab stays; no duplicate at the cap", () => {
    expect(canRemoveTab(strip)).toBe(true);
    expect(canRemoveTab(strip.slice(0, 1))).toBe(false);
    expect(tabMenu(strip[0]!, strip.slice(0, 1), true)).not.toContain("remove");
    const full = Array.from({ length: MAX_PROJECT_TABS }, (_, index) => ({ ...strip[0]!, key: `t${index}`, id: index }));
    expect(tabMenu(full[0]!, full, true)).not.toContain("duplicate");
  });
});

describe("view state (Save view)", () => {
  it("List: a valid grid config is kept; junk is refused; an empty stored config is the sectioned list", () => {
    expect(validTabConfig("LIST", { ...DEFAULT_GRID, sort: "modified", hideEmpty: true })).toMatchObject({ sort: "modified", hideEmpty: true });
    expect(validTabConfig("LIST", { sort: "nonsense" })).toBeNull();
    expect(validTabConfig("LIST", "text")).toBeNull();
    expect(validTabConfig("LIST", { filters: Array.from({ length: 11 }, () => ({ field: "assignee", value: "me" })) })).toBeNull();
    expect(parseTabConfig("LIST", {})).toEqual(DEFAULT_PROJECT_LIST);
    expect(parseTabConfig("LIST", { group: "assignee" })).toMatchObject({ group: "assignee" });
    expect(parseGridConfig({}).hideEmpty).toBe(false);
  });
  it("Board: its own toolbar state; unknown sorts refused", () => {
    expect(validTabConfig("BOARD", { ...DEFAULT_BOARD, mine: true, sort: "due", dir: "desc" })).toMatchObject({ mine: true, sort: "due", dir: "desc" });
    expect(validTabConfig("BOARD", { sort: "likes" })).toBeNull();
    expect(validTabConfig("BOARD", { search: "x".repeat(101) })).toBeNull();
    expect(parseTabConfig("BOARD", "not json")).toEqual(DEFAULT_BOARD);
    expect(boardConfigSchema.parse({})).toEqual(DEFAULT_BOARD);
  });
  it("Calendar, Timeline and Overview tabs keep no view state", () => {
    expect(validTabConfig("CALENDAR", { anything: 1 })).toEqual({});
    expect(parseTabConfig("OVERVIEW", { anything: 1 })).toEqual({});
  });
});
