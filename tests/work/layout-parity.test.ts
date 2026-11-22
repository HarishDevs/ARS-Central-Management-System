import { describe, expect, it } from "vitest";
import { SORTS, SORT_LABEL, sortMenu } from "@/server/work/grid";
import { addableViews, buildStrip, catalogueGroups, tabMenuEntries, VIEW_CATALOGUE } from "@/server/work/view-tabs";

// v1.72.0 (D-387): the option sets and their order on the project screens
// follow the spec (PROJECTS_MODULE §3.7.2, §3.7.3, §3.8.2).
describe("Sort menu order", () => {
  it("lists None, the spec's sorts in order, then Project last", () => {
    const { before, after } = sortMenu(SORTS);
    expect(before.map((sort) => SORT_LABEL[sort]).slice(0, 10)).toEqual(["None", "Start date", "Due date", "Assignee", "Created by", "Created on", "Last modified", "Completed on", "Likes", "Alphabetical"]);
    expect(after).toEqual(["projects"]);
    expect([...before, ...after].sort()).toEqual([...SORTS].sort());
  });
  it("keeps only the sorts a table offers", () => {
    expect(sortMenu(["alpha", "due", "none"]).before).toEqual(["none", "due", "alpha"]);
    expect(sortMenu(["alpha"]).after).toEqual([]);
  });
});

describe("Add tab groups", () => {
  it("puts List, Page, Gantt, Board, Calendar, Timeline under Popular and the rest under Other", () => {
    const groups = catalogueGroups(addableViews("PROJECT", true, true, true));
    expect(groups.map((group) => group.name)).toEqual(["Popular", "Other"]);
    expect(groups[0]!.entries.map((entry) => entry.type)).toEqual(["LIST", "PAGE", "GANTT", "BOARD", "CALENDAR", "TIMELINE"]);
    expect(groups[1]!.entries.map((entry) => entry.type)).toEqual(["WORKLOAD", "DASHBOARD", "FILES", "MESSAGES", "OVERVIEW"]);
  });
  it("drops what is switched off and never loses a catalogue entry", () => {
    const groups = catalogueGroups(addableViews("PROJECT"));
    expect(groups[0]!.entries.map((entry) => entry.type)).toEqual(["LIST", "BOARD", "CALENDAR", "TIMELINE"]);
    expect(groups[1]!.entries.map((entry) => entry.type)).toEqual(["OVERVIEW"]);
    expect(catalogueGroups(VIEW_CATALOGUE).flatMap((group) => group.entries)).toHaveLength(VIEW_CATALOGUE.length);
    expect(catalogueGroups([])).toEqual([]);
  });
});

describe("Tab menu entries", () => {
  const rows = [
    { id: 1, type: "LIST" as const, name: "List", position: 1024, isDefault: true, config: null },
    { id: 2, type: "BOARD" as const, name: "Board", position: 2048, isDefault: false, config: null },
  ];
  const strip = buildStrip(rows as never, true, "LIST");
  const keys = (tab: number, canEdit: boolean) => tabMenuEntries(strip[tab]!, strip, canEdit).map((entry) => ("disabled" in entry && entry.disabled ? `${entry.key}(off)` : entry.key));
  it("follows Rename, Set as default, Make a copy, Copy link, then moves, then Remove", () => {
    expect(keys(1, true)).toEqual(["rename", "default", "duplicate", "copy", "separator", "left", "separator", "remove"]);
  });
  it("shows Set as default disabled on the default tab", () => {
    expect(keys(0, true)).toEqual(["rename", "default(off)", "duplicate", "copy", "separator", "right", "separator", "remove"]);
  });
  it("gives a reader only Copy link", () => {
    expect(keys(1, false)).toEqual(["copy"]);
  });
});
