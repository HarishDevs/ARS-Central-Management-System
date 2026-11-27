import { describe, expect, it } from "vitest";
import {
  boardCards,
  boardFilterCount,
  DEFAULT_SUMMARY_BOARD,
  DEFAULT_SUMMARY_CALENDAR,
  MAX_SHARES,
  parseSummaryBoard,
  parseSummaryCalendar,
  parseSummaryFields,
  readOnlyRow,
  shareInputSchema,
  shareProblem,
  summaryAccessOf,
  summaryListStart,
  validSummaryView,
  withFields,
} from "@/server/work/summary-views";
import { DEFAULT_GRID, type GridTask } from "@/server/work/grid";
import { tabHref } from "@/server/work/view-tabs";

// v1.77.0 (D-404): Task Summary release 2: who may open whose Task Summary,
// sharing rules, Customise › Fields, and per-tab Board / Calendar settings.
describe("who may open a Task Summary (deny by default)", () => {
  const base = { viewerId: 2, ownerId: 1, ownerActive: true, viewerTeamIds: [] as number[], granted: false };
  it("the owner always", () => expect(summaryAccessOf({ ...base, viewerId: 1 })).toBe("OWN"));
  it("a manager above the owner, every level (D-216)", () => expect(summaryAccessOf({ ...base, viewerTeamIds: [5, 1] })).toBe("MANAGER"));
  it("a person it is shared with", () => expect(summaryAccessOf({ ...base, granted: true })).toBe("SHARED"));
  it("a manager wins over a grant (both read-only)", () => expect(summaryAccessOf({ ...base, viewerTeamIds: [1], granted: true })).toBe("MANAGER"));
  it("a peer without a grant (or a revoked one) gets nothing", () => expect(summaryAccessOf(base)).toBeNull());
  it("IT gets nothing by role alone (no rule for roles)", () => expect(summaryAccessOf({ ...base, viewerId: 99 })).toBeNull());
  it("nobody opens an inactive person's list", () => {
    expect(summaryAccessOf({ ...base, ownerActive: false, granted: true })).toBeNull();
    expect(summaryAccessOf({ ...base, ownerActive: false, viewerTeamIds: [1] })).toBeNull();
  });
  it("a report doesn't see their manager's list", () => expect(summaryAccessOf({ ...base, viewerId: 1, ownerId: 2, viewerTeamIds: [] })).toBeNull());
});

describe("sharing", () => {
  it("validates the input", () => {
    expect(shareInputSchema.safeParse({ op: "add", userId: 3 }).success).toBe(true);
    expect(shareInputSchema.safeParse({ op: "grant", userId: 3 }).success).toBe(false);
    expect(shareInputSchema.safeParse({ op: "add", userId: -1 }).success).toBe(false);
    expect(shareInputSchema.safeParse({ op: "add", userId: "3" }).success).toBe(false);
  });
  const ok = { ownerId: 1, targetId: 2, targetActive: true, activeShares: 0, alreadyShared: false };
  it("allows an active colleague", () => expect(shareProblem(ok)).toBeNull());
  it("refuses yourself, unknown and inactive people", () => {
    expect(shareProblem({ ...ok, targetId: 1 })).toMatch(/That's you/);
    expect(shareProblem({ ...ok, targetActive: null })).toMatch(/Choose a person/);
    expect(shareProblem({ ...ok, targetActive: false })).toMatch(/inactive/);
  });
  it(`at most ${MAX_SHARES} people, but sharing again with someone already in is fine`, () => {
    expect(shareProblem({ ...ok, activeShares: MAX_SHARES })).toMatch(/at most/);
    expect(shareProblem({ ...ok, activeShares: MAX_SHARES, alreadyShared: true })).toBeNull();
  });
  it("rows on someone else's list can't be changed or ticked", () => {
    const row = readOnlyRow({ id: 1, canEdit: true, canComplete: true } as GridTask);
    expect(row.canEdit).toBe(false);
    expect(row.canComplete).toBe(false);
  });
  it("tab links keep ?of=", () => {
    expect(tabHref("/users/work/my-tasks?of=4", { id: 9, type: "LIST" })).toBe("/users/work/my-tasks?of=4&tab=9");
    expect(tabHref("/users/work/my-tasks", { id: null, type: "BOARD" })).toBe("/users/work/my-tasks?view=board");
  });
});

describe("Customise › Fields", () => {
  it("parses the stored choice and drops junk", () => {
    // v1.93.0 (D-447): Created by is off by default, and a choice stored before v1.93.0 (no "v") is read with it off too.
    expect(parseSummaryFields(null)).toEqual({ hidden: ["createdBy"], hiddenFields: [] });
    expect(parseSummaryFields("not json")).toEqual({ hidden: ["createdBy"], hiddenFields: [] });
    expect(parseSummaryFields(JSON.stringify({ hidden: ["priority", "priority"], hiddenFields: [4] }))).toEqual({ hidden: ["priority", "createdBy"], hiddenFields: [4] });
    expect(parseSummaryFields(JSON.stringify({ hidden: ["assignee"] }))).toEqual({ hidden: ["createdBy"], hiddenFields: [] });
    // Saved from v1.93.0 on: exactly as chosen (Created by ticked back on stays on).
    expect(parseSummaryFields(JSON.stringify({ v: 2, hidden: ["priority"], hiddenFields: [] }))).toEqual({ hidden: ["priority"], hiddenFields: [] });
  });
  it("new tabs and Reset start with the chosen columns; a stored tab keeps its filters", () => {
    expect(summaryListStart({ hidden: ["visibility"], hiddenFields: [] })).toEqual({ ...DEFAULT_GRID, group: "section", hidden: ["visibility"], hiddenFields: [] });
    const tab = { ...DEFAULT_GRID, group: "createdBy" as const, search: "x", hidden: ["due" as const] };
    expect(withFields(tab, { hidden: ["projects"], hiddenFields: [7] })).toEqual({ ...tab, hidden: ["projects"], hiddenFields: [7] });
  });
});

describe("Board and Calendar tab settings", () => {
  it("defaults and parsing", () => {
    expect(parseSummaryBoard(undefined)).toEqual(DEFAULT_SUMMARY_BOARD);
    // R1 tabs stored the project board shape: the known keys are kept, the rest ignored.
    expect(parseSummaryBoard({ incomplete: true, sort: "due", dir: "desc", range: "all", sections: "mine" })).toEqual({ ...DEFAULT_SUMMARY_BOARD, sort: "due", dir: "desc" });
    expect(parseSummaryBoard({ sort: "assignee" })).toEqual(DEFAULT_SUMMARY_BOARD);
    expect(parseSummaryCalendar({ weekends: false, unit: "week", range: "summary" })).toEqual({ ...DEFAULT_SUMMARY_CALENDAR, weekends: false, unit: "week" });
    expect(parseSummaryCalendar({ unit: "year" })).toEqual(DEFAULT_SUMMARY_CALENDAR);
  });
  it("a save must be a valid view of that type", () => {
    expect(validSummaryView("BOARD", { show: "completed", dueWithin: "", sort: "title", dir: "asc", search: "" })).not.toBeNull();
    expect(validSummaryView("BOARD", { show: "nope" })).toBeNull();
    expect(validSummaryView("BOARD", { evil: 1 })).toBeNull();
    expect(validSummaryView("CALENDAR", { show: "all", weekends: false, unit: "month" })).toEqual({ show: "all", weekends: false, unit: "month" });
    expect(validSummaryView("CALENDAR", { weekends: "no" })).toBeNull();
  });
  const today = "2026-11-25"; // a Wednesday
  const card = (id: number, title: string, status: string, day: string, priority = "NORMAL", position = id) => ({ id, title, status, dueAt: `${day}T06:30:00.000Z`, priority, position });
  const cards = [card(1, "Bravo", "OPEN", "2026-11-26", "LOW", 3), card(2, "alpha", "COMPLETED", "2026-11-24", "NORMAL", 1), card(3, "Charlie", "OPEN", "2026-12-02", "URGENT", 2)];
  it("filters by Show, due week and search", () => {
    expect(boardCards(cards, DEFAULT_SUMMARY_BOARD, today).map((item) => item.id)).toEqual([2, 3, 1]);
    expect(boardCards(cards, { ...DEFAULT_SUMMARY_BOARD, show: "incomplete" }, today).map((item) => item.id)).toEqual([3, 1]);
    expect(boardCards(cards, { ...DEFAULT_SUMMARY_BOARD, show: "completed" }, today).map((item) => item.id)).toEqual([2]);
    expect(boardCards(cards, { ...DEFAULT_SUMMARY_BOARD, dueWithin: "this" }, today).map((item) => item.id)).toEqual([2, 1]);
    expect(boardCards(cards, { ...DEFAULT_SUMMARY_BOARD, dueWithin: "next" }, today).map((item) => item.id)).toEqual([3]);
    expect(boardCards(cards, { ...DEFAULT_SUMMARY_BOARD, search: "CHAR" }, today).map((item) => item.id)).toEqual([3]);
    expect(boardFilterCount({ ...DEFAULT_SUMMARY_BOARD, show: "incomplete", dueWithin: "next" })).toBe(2);
  });
  it("sorts both ways", () => {
    expect(boardCards(cards, { ...DEFAULT_SUMMARY_BOARD, sort: "title" }, today).map((item) => item.id)).toEqual([2, 1, 3]);
    expect(boardCards(cards, { ...DEFAULT_SUMMARY_BOARD, sort: "title", dir: "desc" }, today).map((item) => item.id)).toEqual([3, 1, 2]);
    expect(boardCards(cards, { ...DEFAULT_SUMMARY_BOARD, sort: "priority" }, today).map((item) => item.id)).toEqual([3, 2, 1]);
    expect(boardCards(cards, { ...DEFAULT_SUMMARY_BOARD, sort: "due" }, today).map((item) => item.id)).toEqual([2, 1, 3]);
  });
});
