import { describe, expect, it } from "vitest";
import { applyGrid, columnSortState, DEFAULT_GRID, gridFromUrl, gridUrlState, groupsStartFolded, nextColumnSort, parseGridConfig, sortGridRows, type GridTask } from "@/server/work/grid";

// v1.58.0 (D-354): every column of the task table sorts both ways; the sort
// (column and direction) is part of the saved view; chosen groups start folded.
const task = (over: Partial<GridTask>): GridTask => ({
  id: 1,
  taskNo: "TSK-1",
  title: "Task",
  status: "OPEN",
  priority: "NORMAL",
  assigneeId: 1,
  assigneeName: "Ravi",
  createdBy: 1,
  createdByName: "Ravi",
  dueAt: null,
  startsOn: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  completedAt: null,
  likes: 0,
  comments: 0,
  subtasks: 0,
  isPeriodic: false,
  isMilestone: false,
  projects: [],
  tags: [],
  followers: [],
  sectionId: null,
  position: 0,
  canEdit: true,
  canComplete: true,
  ...over,
});
const rows = [
  task({ id: 1, title: "Bank reco", dueAt: "2026-10-29T12:30:00.000Z", priority: "HIGH", likes: 2, createdAt: "2026-10-02T00:00:00.000Z", tags: [{ id: 1, name: "zeta" }], followers: [{ id: 9, name: "Meena" }], position: 3 }),
  task({ id: 2, title: "audit", dueAt: "2026-11-03T12:30:00.000Z", priority: "URGENT", likes: 5, createdAt: "2026-10-03T00:00:00.000Z", projects: [{ id: 5, name: "Close", color: "teal" }], tags: [{ id: 2, name: "alpha" }], position: 1 }),
  task({ id: 3, title: "Later work", dueAt: null, priority: "LOW", likes: 0, createdAt: "2026-10-01T00:00:00.000Z", followers: [{ id: 8, name: "Anil" }], position: 2 }),
];
const order = (config: Partial<typeof DEFAULT_GRID>, values?: Record<number, Record<number, string>>) => sortGridRows(rows, { ...DEFAULT_GRID, ...config }, values).map((row) => row.id);

describe("task table column sort (D-354)", () => {
  it("each column sorts ascending and descending; empty values stay last", () => {
    expect(order({ sort: "alpha" })).toEqual([2, 1, 3]);
    expect(order({ sort: "alpha", dir: "desc" })).toEqual([3, 1, 2]);
    expect(order({ sort: "due" })).toEqual([1, 2, 3]);
    expect(order({ sort: "due", dir: "desc" })).toEqual([2, 1, 3]);
    expect(order({ sort: "priority" })).toEqual([2, 1, 3]);
    expect(order({ sort: "priority", dir: "desc" })).toEqual([3, 1, 2]);
    expect(order({ sort: "tags" })).toEqual([2, 1, 3]);
    expect(order({ sort: "tags", dir: "desc" })).toEqual([1, 2, 3]);
    expect(order({ sort: "collaborators" })).toEqual([3, 1, 2]);
    expect(order({ sort: "projects", dir: "desc" })).toEqual([2, 3, 1]); // only task 2 has a project; the rest keep the manual order
    expect(order({ sort: "visibility" })).toEqual([2, 3, 1]);
  });
  it("newest-first sorts keep their own order, and desc reverses it", () => {
    expect(order({ sort: "createdOn" })).toEqual([2, 1, 3]);
    expect(order({ sort: "createdOn", dir: "desc" })).toEqual([3, 1, 2]);
    expect(order({ sort: "likes" })).toEqual([2, 1, 3]);
  });
  it("no sort: the manual order (position), whatever the direction", () => {
    expect(order({})).toEqual([2, 3, 1]);
    expect(order({ dir: "desc" })).toEqual([2, 3, 1]);
  });
  it("a project field's column sorts by its value", () => {
    const values = { 1: { 7: "10" }, 2: { 7: "9" } };
    expect(order({ sortField: 7 }, values)).toEqual([2, 1, 3]);
    expect(order({ sortField: 7, dir: "desc" }, values)).toEqual([1, 2, 3]);
    const groups = applyGrid(rows, { ...DEFAULT_GRID, sortField: 7, dir: "desc" }, { today: "2026-10-30", meId: 1, values });
    expect(groups[0]!.rows.map((row) => row.id)).toEqual([1, 2, 3]);
  });
  it("clicking a column title: ascending, then descending; another column starts ascending", () => {
    let config = { ...DEFAULT_GRID };
    expect(columnSortState(config, "due")).toBeNull();
    config = { ...config, ...nextColumnSort(config, "due") };
    expect(config).toMatchObject({ sort: "due", dir: "asc", sortField: null });
    expect(columnSortState(config, "due")).toBe("asc");
    config = { ...config, ...nextColumnSort(config, "due") };
    expect(columnSortState(config, "due")).toBe("desc");
    config = { ...config, ...nextColumnSort(config, "name") };
    expect(config).toMatchObject({ sort: "alpha", dir: "asc" });
    config = { ...config, ...nextColumnSort(config, 12) };
    expect(config).toMatchObject({ sort: "none", sortField: 12, dir: "asc" });
    expect(columnSortState(config, "name")).toBeNull();
    expect(columnSortState(config, 12)).toBe("asc");
  });
  it("the sort and direction are kept in a saved view; old views read as ascending", () => {
    expect(parseGridConfig({ sort: "tags", dir: "desc", sortField: null })).toMatchObject({ sort: "tags", dir: "desc" });
    expect(parseGridConfig({ sort: "due" })).toMatchObject({ sort: "due", dir: "asc", sortField: null });
    expect(parseGridConfig({ sort: "due", dir: "sideways" })).toEqual(DEFAULT_GRID);
  });
  it("search results: sort and group go to the address and back", () => {
    const config = { ...DEFAULT_GRID, sort: "priority" as const, dir: "desc" as const, group: "assignee" as const };
    expect(gridUrlState(config)).toEqual({ gsort: "priority", gdir: "desc", ggroup: "assignee" });
    expect(gridFromUrl(gridUrlState(config), DEFAULT_GRID)).toMatchObject({ sort: "priority", dir: "desc", group: "assignee" });
    expect(gridFromUrl({ gsort: "drop table", ggroup: "x", gfield: "-1" }, DEFAULT_GRID)).toEqual(DEFAULT_GRID);
    expect(gridUrlState(DEFAULT_GRID)).toEqual({});
  });
  it("a chosen grouping starts folded; sections and no grouping stay open", () => {
    expect(groupsStartFolded("assignee")).toBe(true);
    expect(groupsStartFolded("due")).toBe(true);
    expect(groupsStartFolded("section")).toBe(false);
    expect(groupsStartFolded("none")).toBe(false);
  });
});
