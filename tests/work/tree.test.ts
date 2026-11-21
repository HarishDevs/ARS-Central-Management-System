import { describe, expect, it } from "vitest";
import { applyGrid, DEFAULT_GRID, sortGridRows, type GridTask } from "@/server/work/grid";
import { childrenByParent, computeWindow, expandableIds, flattenGrid, keyMove, offsetOf, prefixSums } from "@/server/work/tree";
import { shouldRefresh, LIVE_REFRESH_MS } from "@/features/work/useLiveRefresh";

// v1.61.0 (D-367, spec PRJ-03): the List as a treegrid, windowing maths,
// keyboard movement and the faster refresh (D-366).
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
const sections = [
  { id: 10, name: "To do" },
  { id: 11, name: "Empty" },
  { id: 12, name: "Done" },
];
const rows = [task({ id: 1, sectionId: 10, position: 1 }), task({ id: 2, sectionId: 10, position: 2 }), task({ id: 3, sectionId: 12, position: 1 })];
const subtasks = childrenByParent([
  { parentId: 1, row: task({ id: 101, title: "Sub A" }) },
  { parentId: 1, row: task({ id: 102, title: "Sub B" }) },
  { parentId: null, row: task({ id: 999 }) },
]);
const groups = applyGrid(rows, { ...DEFAULT_GRID, group: "section" }, { today: "2026-11-21", meId: 1, sections });

describe("flattening into treegrid lines", () => {
  it("group headings level 1, tasks level 2 numbered per group, add lines where asked", () => {
    const lines = flattenGrid(groups, { isClosed: () => false, subtasks, addLine: (group) => group.sectionId !== null });
    expect(lines.map((line) => `${line.kind}:${line.level}`)).toEqual(["group:1", "task:2", "task:2", "add:2", "group:1", "add:2", "group:1", "task:2", "add:2"]);
    expect(lines.filter((line) => line.kind === "task").map((line) => (line.kind === "task" ? line.number : 0))).toEqual([1, 2, 1]);
    const first = lines[1]!;
    expect(first.kind === "task" && first.expandable && !first.expanded).toBe(true);
  });
  it("expanded subtasks follow their task one level deeper, unnumbered", () => {
    const lines = flattenGrid(groups, { isClosed: () => false, subtasks, expanded: new Set([1]) });
    const subs = lines.filter((line) => line.kind === "task" && line.parentId === 1);
    expect(subs.map((line) => [line.level, line.kind === "task" ? line.number : 0, line.kind === "task" ? line.task.id : 0])).toEqual([
      [3, null, 101],
      [3, null, 102],
    ]);
    expect(expandableIds(groups, subtasks)).toEqual([1]);
  });
  it("a folded group keeps only its heading; Hide empty groups drops empty ones", () => {
    const folded = flattenGrid(groups, { isClosed: (key) => key === "s10" });
    expect(folded.filter((line) => line.group.key === "s10").map((line) => line.kind)).toEqual(["group"]);
    const hidden = flattenGrid(groups, { isClosed: () => false, hideEmpty: true });
    expect(hidden.some((line) => line.group.name === "Empty")).toBe(false);
  });
  it("without groups, tasks are level 1", () => {
    const plain = applyGrid(rows, DEFAULT_GRID, { today: "2026-11-21", meId: 1 });
    expect(flattenGrid(plain, { isClosed: () => false }).map((line) => line.level)).toEqual([1, 1, 1]);
  });
});

describe("windowing maths", () => {
  it("prefix sums and offsets", () => {
    expect(prefixSums([10, 20, 30])).toEqual([0, 10, 30, 60]);
    expect(offsetOf([10, 20, 30], 2)).toBe(30);
    expect(offsetOf([10, 20, 30], 99)).toBe(60);
  });
  it("draws the lines on screen plus overscan, with spacers for the rest", () => {
    const heights = Array.from({ length: 1500 }, () => 36);
    const top = computeWindow(heights, 0, 720, 10);
    expect(top).toMatchObject({ start: 0, padTop: 0, total: 54_000 });
    expect(top.end).toBe(20 + 10);
    const middle = computeWindow(heights, 36 * 700, 720, 10);
    expect(middle.start).toBe(690);
    expect(middle.end).toBe(730);
    expect(middle.padTop).toBe(690 * 36);
    expect(middle.padTop + (middle.end - middle.start) * 36 + middle.padBottom).toBe(54_000);
    const bottom = computeWindow(heights, 1e9, 720, 10);
    expect(bottom.end).toBe(1500);
    expect(bottom.padBottom).toBe(0);
  });
  it("mixed heights and empty lists", () => {
    const window = computeWindow([56, 36, 36, 40, 56, 36], 60, 40, 0);
    expect([window.start, window.end]).toEqual([1, 3]);
    expect(computeWindow([], 0, 500)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0, total: 0 });
  });
  it("is fast for 1,500 rows (plan + window under 50 ms)", () => {
    const many = Array.from({ length: 1500 }, (_, index) => task({ id: index + 1, sectionId: 10, position: index, title: `Task ${index}` }));
    const started = performance.now();
    const planned = applyGrid(many, { ...DEFAULT_GRID, group: "section" }, { today: "2026-11-21", meId: 1, sections });
    const lines = flattenGrid(planned, { isClosed: () => false, addLine: () => true });
    computeWindow(
      lines.map(() => 36),
      20_000,
      900,
    );
    expect(performance.now() - started).toBeLessThan(50);
    expect(lines.length).toBe(1500 + 3 + 3);
  });
});

describe("keyboard (roving focus)", () => {
  const lines = flattenGrid(groups, { isClosed: () => false, subtasks, expanded: new Set([1]) });
  it("arrows, Home, End and Page keys move focus", () => {
    expect(keyMove(lines, 0, "ArrowDown")).toEqual({ focus: 1 });
    expect(keyMove(lines, 0, "ArrowUp")).toEqual({ focus: 0 });
    expect(keyMove(lines, 3, "Home")).toEqual({ focus: 0 });
    expect(keyMove(lines, 0, "End")).toEqual({ focus: lines.length - 1 });
    expect(keyMove(lines, 0, "PageDown", 3)).toEqual({ focus: 3 });
    expect(keyMove(lines, 0, "x")).toBeNull();
  });
  it("Right opens or steps in; Left closes or goes to the parent", () => {
    expect(keyMove(lines, 0, "ArrowRight")).toEqual({ focus: 1 }); // open group: into it
    expect(keyMove(lines, 0, "ArrowLeft")).toEqual({ toggle: 0, open: false });
    expect(keyMove(lines, 1, "ArrowLeft")).toEqual({ toggle: 1, open: false }); // expanded task folds
    expect(keyMove(lines, 2, "ArrowLeft")).toEqual({ focus: 1 }); // subtask → its task
    const closed = flattenGrid(groups, { isClosed: () => true });
    expect(keyMove(closed, 0, "ArrowRight")).toEqual({ toggle: 0, open: true });
  });
});

describe("sorts (spec PRJ-04)", () => {
  it("Last modified sorts newest first by itself", () => {
    const list = [task({ id: 1, updatedAt: "2026-11-01T00:00:00Z" }), task({ id: 2, updatedAt: "2026-11-20T00:00:00Z" }), task({ id: 3, updatedAt: null })];
    expect(sortGridRows(list, { sort: "modified", dir: "asc", sortField: null }).map((row) => row.id)).toEqual([2, 1, 3]);
  });
});

describe("faster refresh (D-366)", () => {
  const base = { visible: true, busy: false, now: 100_000, last: 100_000 - LIVE_REFRESH_MS, every: LIVE_REFRESH_MS };
  it("every 15 s while visible and not typing", () => {
    expect(LIVE_REFRESH_MS).toBe(15_000);
    expect(shouldRefresh(base)).toBe(true);
    expect(shouldRefresh({ ...base, last: base.now - 5_000 })).toBe(false);
    expect(shouldRefresh({ ...base, visible: false })).toBe(false);
    expect(shouldRefresh({ ...base, busy: true })).toBe(false);
  });
  it("on focus or coming back, at once (but not twice within 2 s)", () => {
    expect(shouldRefresh({ ...base, last: base.now - 3_000, force: true })).toBe(true);
    expect(shouldRefresh({ ...base, last: base.now - 1_000, force: true })).toBe(false);
  });
});
