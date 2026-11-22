import { describe, expect, it } from "vitest";
import {
  barPlacement,
  checkFieldValue,
  effectivePortfolioRole,
  filterRows,
  groupRows,
  levelsAbove,
  levelsBelow,
  maskRow,
  maskedName,
  nestingProblem,
  portfolioAbilities,
  progressOf,
  quarterWindow,
  rolledUpProjects,
  sortRows,
  statusCounts,
  statusProblem,
  type PortfolioRow,
  type VisibleRow,
} from "@/server/work/portfolio-rules";

// v1.69.0 (D-382): the pure rules of portfolios.
const viewer = (id: number, extra: Partial<{ departmentId: number | null; isAdmin: boolean; teamIds: number[]; projects: boolean }> = {}) => ({ id, departmentId: null, isAdmin: false, teamIds: [], ...extra });
const facts = (privacy: "PRIVATE" | "DEPARTMENT" | "ORGANISATION", members: { id: number; role: "OWNER" | "EDITOR" | "COMMENTER" | "VIEWER" }[] = [], departmentId: number | null = null) => ({ privacy, departmentId, defaultAccessRole: "VIEWER" as const, members });

describe("roles", () => {
  it("members get their role; outsiders nothing on a private portfolio", () => {
    const portfolio = facts("PRIVATE", [{ id: 1, role: "OWNER" }, { id: 2, role: "EDITOR" }]);
    expect(effectivePortfolioRole(portfolio, viewer(1))).toBe("OWNER");
    expect(effectivePortfolioRole(portfolio, viewer(2))).toBe("EDITOR");
    expect(effectivePortfolioRole(portfolio, viewer(3))).toBeNull();
  });
  it("department and organisation privacy give the default role; a manager of a member may view", () => {
    expect(effectivePortfolioRole(facts("DEPARTMENT", [], 7), viewer(3, { departmentId: 7 }))).toBe("VIEWER");
    expect(effectivePortfolioRole(facts("DEPARTMENT", [], 7), viewer(3, { departmentId: 8 }))).toBeNull();
    expect(effectivePortfolioRole(facts("ORGANISATION"), viewer(3))).toBe("VIEWER");
    expect(effectivePortfolioRole(facts("PRIVATE", [{ id: 5, role: "EDITOR" }]), viewer(9, { teamIds: [5] }))).toBe("VIEWER");
  });
  it("IT acts as owner; without the Projects module nothing", () => {
    expect(effectivePortfolioRole(facts("PRIVATE"), viewer(3, { isAdmin: true }))).toBe("OWNER");
    expect(effectivePortfolioRole(facts("ORGANISATION", [{ id: 3, role: "OWNER" }]), viewer(3, { projects: false }))).toBeNull();
  });
  it("abilities by role", () => {
    expect(portfolioAbilities("OWNER")).toEqual({ view: true, manage: true, share: true, edit: true });
    expect(portfolioAbilities("EDITOR")).toEqual({ view: true, manage: false, share: true, edit: true });
    expect(portfolioAbilities("VIEWER")).toEqual({ view: true, manage: false, share: false, edit: false });
    expect(portfolioAbilities(null).view).toBe(false);
  });
});

describe("nesting", () => {
  const edges: [number, number][] = [
    [1, 2],
    [2, 3],
    [3, 4],
  ];
  it("counts levels above and below", () => {
    expect(levelsAbove(edges, 4)).toBe(4);
    expect(levelsBelow(edges, 1)).toBe(4);
    expect(levelsBelow(edges, 9)).toBe(1);
  });
  it("refuses itself and circles", () => {
    expect(nestingProblem(edges, 2, 2)).toBe("SELF");
    expect(nestingProblem(edges, 4, 1)).toBe("CYCLE");
    expect(nestingProblem(edges, 3, 2)).toBe("CYCLE");
  });
  it("allows 5 levels and refuses a sixth", () => {
    expect(nestingProblem(edges, 4, 5)).toBeNull(); // 1 > 2 > 3 > 4 > 5
    expect(nestingProblem([...edges, [4, 5]], 5, 6)).toBe("DEPTH");
    expect(nestingProblem(edges, 4, 10, 5)).toBeNull();
    // A two-level tree under a portfolio already 4 deep: 6 levels.
    expect(nestingProblem([...edges, [10, 11]], 4, 10)).toBe("DEPTH");
  });
  it("a portfolio in two places counts its longest chain", () => {
    expect(nestingProblem([[1, 2], [2, 3], [3, 4], [9, 4]], 4, 5)).toBeNull();
    expect(levelsAbove([[1, 2], [2, 3], [3, 4], [9, 4]], 4)).toBe(4);
  });
});

describe("roll-ups", () => {
  it("task progress is cut down to a whole percent (4 of 6 = 66 %)", () => {
    expect(progressOf({ total: 6, completed: 4 })).toEqual({ percent: 66, text: "4 of 6 tasks done (66%)" });
    expect(progressOf({ total: 0, completed: 0 })).toEqual({ percent: 0, text: "No tasks yet" });
    expect(progressOf({ total: 3, completed: 3 }).percent).toBe(100);
  });
  it("rolls up visible projects through visible sub-portfolios, each project once", () => {
    const links = [
      { portfolioId: 1, projectId: 10, childId: null },
      { portfolioId: 1, projectId: 11, childId: null },
      { portfolioId: 1, projectId: null, childId: 2 },
      { portfolioId: 1, projectId: null, childId: 3 },
      { portfolioId: 2, projectId: 10, childId: null },
      { portfolioId: 2, projectId: 12, childId: null },
      { portfolioId: 3, projectId: 13, childId: null },
    ];
    const all = () => true;
    expect(rolledUpProjects(1, links, all, all)).toEqual([10, 11, 12, 13]);
    // Project 11 hidden, portfolio 3 hidden: neither it nor what is only in it counts.
    expect(rolledUpProjects(1, links, (id) => id !== 11, (id) => id !== 3)).toEqual([10, 12]);
  });
  it("survives a stored circle", () => {
    expect(rolledUpProjects(1, [{ portfolioId: 1, projectId: null, childId: 2 }, { portfolioId: 2, projectId: null, childId: 1 }, { portfolioId: 2, projectId: 5, childId: null }], () => true, () => true)).toEqual([5]);
  });
  it("status counts", () => {
    expect(statusCounts(["ON_TRACK", "AT_RISK", "OFF_TRACK", "OFF_TRACK", null])).toEqual({ onTrack: 1, atRisk: 1, offTrack: 2, total: 5 });
  });
});

const row = (over: Partial<VisibleRow>): VisibleRow => ({
  itemId: 1,
  kind: "PROJECT",
  masked: false,
  id: 1,
  name: "A",
  color: "blue",
  status: null,
  statusAt: null,
  counts: { total: 0, completed: 0, overdue: 0 },
  startOn: null,
  dueOn: null,
  ownerId: 1,
  ownerName: "Asha",
  priority: null,
  archived: false,
  values: {},
  addedByName: "Asha",
  addedAt: "2026-11-01T00:00:00.000Z",
  ...over,
});

describe("masking, sort, filter, group", () => {
  it("a masked row keeps only that it exists and who added it", () => {
    const masked = maskRow(row({ name: "Secret plant", ownerName: "Boss", counts: { total: 9, completed: 1, overdue: 3 } }));
    expect(masked).toEqual({ itemId: 1, kind: "PROJECT", masked: true, addedByName: "Asha", addedAt: "2026-11-01T00:00:00.000Z" });
    expect(JSON.stringify(masked)).not.toContain("Secret");
    expect(maskedName(masked)).toBe("Private project");
    expect(maskedName({ kind: "PORTFOLIO" })).toBe("Private portfolio");
  });
  const rows: PortfolioRow[] = [
    row({ itemId: 1, name: "Bravo", status: "ON_TRACK", dueOn: "2027-02-01", priority: "LOW", counts: { total: 4, completed: 1, overdue: 1 } }),
    maskRow(row({ itemId: 2 })),
    row({ itemId: 3, name: "Alpha", status: "OFF_TRACK", dueOn: null, priority: "HIGH", ownerId: 7, counts: { total: 2, completed: 2, overdue: 0 } }),
    row({ itemId: 4, name: "Charlie", status: "COMPLETE", dueOn: "2027-01-01", counts: { total: 1, completed: 1, overdue: 0 } }),
  ];
  it("sorts visible rows; hidden rows always last", () => {
    expect(sortRows(rows, "name").map((item) => item.itemId)).toEqual([3, 1, 4, 2]);
    expect(sortRows(rows, "due").map((item) => item.itemId)).toEqual([4, 1, 3, 2]);
    expect(sortRows(rows, "status").map((item) => item.itemId)).toEqual([3, 1, 4, 2]);
    expect(sortRows(rows, "progress", true).map((item) => item.itemId)).toEqual([3, 4, 1, 2]);
    expect(sortRows(rows, "priority").map((item) => item.itemId)).toEqual([3, 1, 4, 2]);
    expect(sortRows(rows, "manual").map((item) => item.itemId)).toEqual([1, 2, 3, 4]);
  });
  it("filters: a hidden row only shows with no filter and no search", () => {
    expect(filterRows(rows, "all", 1).length).toBe(4);
    expect(filterRows(rows, "open", 1).map((item) => item.itemId)).toEqual([1, 3]);
    expect(filterRows(rows, "closed", 1).map((item) => item.itemId)).toEqual([4]);
    expect(filterRows(rows, "mine", 7).map((item) => item.itemId)).toEqual([3]);
    expect(filterRows(rows, "offTrack", 1).map((item) => item.itemId)).toEqual([3]);
    expect(filterRows(rows, "overdue", 1).map((item) => item.itemId)).toEqual([1]);
    expect(filterRows(rows, "all", 1, "alp").map((item) => item.itemId)).toEqual([3]);
  });
  it("groups by status with hidden rows in their own group", () => {
    const groups = groupRows(rows, "status", (status) => status);
    expect(groups.map((group) => group.label)).toEqual(["OFF_TRACK", "ON_TRACK", "COMPLETE", "Work you can't see"]);
  });
});

describe("columns and status updates", () => {
  const isPerson = (id: number) => id === 5;
  it("checks values per kind; empty clears", () => {
    expect(checkFieldValue({ kind: "NUMBER", options: [] }, "12.50", isPerson)).toEqual({ ok: true, value: "12.5" });
    expect(checkFieldValue({ kind: "NUMBER", options: [] }, "abc", isPerson).ok).toBe(false);
    expect(checkFieldValue({ kind: "SELECT", options: ["Plan"] }, "Plan", isPerson).ok).toBe(true);
    expect(checkFieldValue({ kind: "SELECT", options: ["Plan"] }, "Ship", isPerson).ok).toBe(false);
    expect(checkFieldValue({ kind: "DATE", options: [] }, "2027-13-40", isPerson).ok).toBe(false);
    expect(checkFieldValue({ kind: "DATE", options: [] }, "2027-02-28", isPerson).ok).toBe(true);
    expect(checkFieldValue({ kind: "PEOPLE", options: [] }, "5", isPerson).ok).toBe(true);
    expect(checkFieldValue({ kind: "PEOPLE", options: [] }, "6", isPerson).ok).toBe(false);
    expect(checkFieldValue({ kind: "TEXT", options: [] }, "", isPerson)).toEqual({ ok: true, value: null });
    expect(checkFieldValue({ kind: "TEXT", options: [] }, "x".repeat(501), isPerson).ok).toBe(false);
  });
  it("a status update needs a headline or a summary", () => {
    expect(statusProblem({ title: "", body: "<p> </p>" })).not.toBeNull();
    expect(statusProblem({ title: "On plan", body: "" })).toBeNull();
    expect(statusProblem({ title: "", body: "<p>Done</p>" })).toBeNull();
  });
});

describe("Timeline quarters", () => {
  it("builds a window of quarters, crossing years", () => {
    expect(quarterWindow("2026-11-22", 0).map((q) => q.label)).toEqual(["Q4 2026", "Q1 2027", "Q2 2027", "Q3 2027"]);
    expect(quarterWindow("2026-11-22", -1, 2).map((q) => `${q.start}..${q.end}`)).toEqual(["2026-07-01..2026-09-30", "2026-10-01..2026-12-31"]);
    expect(quarterWindow("2027-02-01", 0, 1)[0]).toMatchObject({ months: "Jan–Mar", end: "2027-03-31" });
  });
  it("places bars in the window, clipped at its edges", () => {
    const window = quarterWindow("2027-01-15", 0, 4); // 2027
    const whole = barPlacement("2027-01-01", "2027-12-31", window)!;
    expect(Math.round(whole.left)).toBe(0);
    expect(Math.round(whole.width)).toBe(100);
    const half = barPlacement("2027-07-01", "2028-03-01", window)!;
    expect(Math.round(half.left)).toBe(50);
    expect(half.clippedEnd).toBe(true);
    expect(barPlacement(null, null, window)).toBeNull();
    expect(barPlacement("2025-01-01", "2025-02-01", window)).toBeNull();
    expect(barPlacement(null, "2027-04-01", window)!.width).toBeGreaterThan(0);
  });
});
