import { describe, expect, it } from "vitest";
import { applyGrid, columnSortState, commentPreview, DEFAULT_GRID, gridConfigSchema, moveColumn, nextColumnSort, orderColumns, parseGridConfig, placeColumn, type GridTask } from "@/server/work/grid";
import { parseTabConfig, validTabConfig } from "@/server/work/view-tabs";
import { summaryCsv } from "@/server/work/my-export";

// v1.93.0 (owner 27 Nov 2026): column order (D-446), the new default columns
// and the reading of views saved before (D-447), and the Last comment (D-448).
describe("column order (D-446)", () => {
  const keys = ["assignee", "start", "due", "priority", "f7", "f9"];
  it("an empty order keeps the table's own", () => {
    expect(orderColumns(keys, [])).toEqual(keys);
  });
  it("puts listed keys in the saved order and new ones after the column they follow", () => {
    expect(orderColumns(keys, ["due", "assignee", "f9", "priority"])).toEqual(["due", "assignee", "start", "f9", "priority", "f7"]);
    // Unknown and repeated keys are ignored.
    expect(orderColumns(["a1", "b1"], ["zz", "b1", "b1", "a1"])).toEqual(["b1", "a1"]);
  });
  it("moves one column past its shown neighbour; hidden columns keep their places", () => {
    const order = ["assignee", "start", "createdBy", "due", "priority"];
    const shown = ["assignee", "start", "due", "priority"];
    expect(moveColumn(order, shown, "due", -1)).toEqual(["assignee", "due", "start", "createdBy", "priority"]);
    expect(moveColumn(order, shown, "start", 1)).toEqual(["assignee", "createdBy", "due", "start", "priority"]);
    expect(moveColumn(order, shown, "assignee", -1)).toEqual(order);
    expect(moveColumn(order, shown, "priority", 1)).toEqual(order);
  });
  it("places a dragged column before or after another", () => {
    expect(placeColumn(["a1", "b1", "c1"], "c1", "a1")).toEqual(["c1", "a1", "b1"]);
    expect(placeColumn(["a1", "b1", "c1"], "a1", null, "c1")).toEqual(["b1", "c1", "a1"]);
    expect(placeColumn(["a1", "b1"], "zz", "a1")).toEqual(["a1", "b1"]);
  });
  it("is part of the saved view and validated", () => {
    expect(parseGridConfig({ v: 2, columnOrder: ["due", "f12", "assignee"] }).columnOrder).toEqual(["due", "f12", "assignee"]);
    expect(validTabConfig("LIST", { ...DEFAULT_GRID, columnOrder: ["<script>"] })).toBeNull();
    expect(validTabConfig("LIST", { ...DEFAULT_GRID, columnOrder: Array.from({ length: 600 }, (_, index) => `f${index}`) })).toBeNull();
  });
});

describe("default columns and views saved before v1.93.0 (D-447)", () => {
  it("leaves Created by out of a new view", () => {
    expect(DEFAULT_GRID.hidden).toEqual(["createdBy"]);
    expect(DEFAULT_GRID.v).toBe(2);
    expect(DEFAULT_GRID.columnOrder).toEqual([]);
  });
  it("reads an old view with what its owner hid kept, Created by hidden, and the new columns shown", () => {
    const old = { incomplete: true, group: "section", hidden: ["priority", "tags"], sort: "due" };
    const read = parseTabConfig("LIST", JSON.stringify(old)) as typeof DEFAULT_GRID;
    expect(read.hidden).toEqual(["priority", "tags", "createdBy"]);
    expect(read).toMatchObject({ group: "section", sort: "due", v: 2 });
    for (const column of ["start", "completed", "lastComment"] as const) expect(read.hidden).not.toContain(column);
    // An old view that had every column hidden still parses (the old limit was 8).
    expect(parseGridConfig({ hidden: ["due", "assignee", "collaborators", "createdBy", "projects", "visibility", "priority", "tags"] }).hidden).toHaveLength(8);
  });
  it("keeps Created by once a v1.93.0 view shows it again", () => {
    expect(parseGridConfig({ v: 2, hidden: [] }).hidden).toEqual([]);
    expect(gridConfigSchema.parse({ v: 2, hidden: ["due"] }).hidden).toEqual(["due"]);
  });
});

describe("new columns sort (D-446, D-448)", () => {
  it("Start date, Completed date and Last comment titles sort by their values", () => {
    expect(nextColumnSort(DEFAULT_GRID, "start")).toMatchObject({ sort: "start" });
    expect(nextColumnSort(DEFAULT_GRID, "completed")).toMatchObject({ sort: "completedOn" });
    const byComment = { ...DEFAULT_GRID, ...nextColumnSort(DEFAULT_GRID, "lastComment") };
    expect(columnSortState(byComment, "lastComment")).toBe("asc");
    const rows = [row(1, null), row(2, "2026-11-20T05:00:00Z"), row(3, "2026-11-26T05:00:00Z")];
    // Newest comment first; tasks without a comment last.
    expect(applyGrid(rows, byComment, { today: "2026-11-27", meId: 1 })[0]!.rows.map((task) => task.id)).toEqual([3, 2, 1]);
  });
});

describe("Last comment text (D-448)", () => {
  it("is plain text on one line: mentions by name, links by their text, no marks", () => {
    expect(commentPreview("Hi @[Asha Rao](user:12), see [the plan](https://x.test/p)\n- **done** ~~old~~ ++new++ `x`")).toBe("Hi @Asha Rao, see the plan done old new x");
    expect(commentPreview("> quoted\n# Heading\n1. first _it_")).toBe("quoted Heading first it");
    expect(commentPreview("<b>not html</b>")).toBe("<b>not html</b>");
  });
  it("goes into the Task Summary file as author: text, in the tab's column order", () => {
    const task = { ...row(1, "2026-11-26T05:00:00Z"), startsOn: "2026-11-24" };
    const groups = applyGrid([task], DEFAULT_GRID, { today: "2026-11-27", meId: 1 });
    const { csv } = summaryCsv(groups, { hidden: ["createdBy", "collaborators", "priority", "projects", "visibility"], group: "none", groupField: null, columnOrder: ["lastComment", "due", "start"] });
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Task no.,Task,Last comment,Due date,Start date,Status,Completed on");
    expect(lines[1]).toBe("T-1,Task 1,Ravi: Comment 1,,2026-11-24,Open,");
  });
});

function row(id: number, commentAt: string | null): GridTask {
  return {
    id,
    taskNo: `T-${id}`,
    title: `Task ${id}`,
    status: "OPEN",
    priority: "NORMAL",
    assigneeId: 1,
    assigneeName: "Asha",
    createdBy: 1,
    createdByName: "Asha",
    dueAt: null,
    startsOn: null,
    createdAt: "2026-11-01T05:00:00Z",
    completedAt: null,
    lastComment: commentAt ? { text: `Comment ${id}`, authorName: "Ravi", at: commentAt } : null,
    likes: 0,
    comments: commentAt ? 1 : 0,
    subtasks: 0,
    isPeriodic: false,
    isMilestone: false,
    projects: [],
    tags: [],
    followers: [],
    sectionId: null,
    position: id,
    canEdit: false,
    canComplete: false,
  };
}
