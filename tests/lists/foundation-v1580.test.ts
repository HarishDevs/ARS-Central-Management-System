import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/repositories/analytics-views.repository", () => ({ listViews: vi.fn(async () => []) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Map()) }));

import { compareValues, nextDir, parseColumnSort, sortHref, sortRows } from "@/server/lists/sorting";
import { cleanListQuery, currentQuery, isListPath, isListTarget } from "@/server/lists/views";

// v1.58.0 (D-351, D-353, owner): column sorting and saved list views, shared by every table.
describe("column sorting", () => {
  it("reads only the table's own columns and a valid direction", () => {
    expect(parseColumnSort({ sortBy: "title", dir: "desc" }, ["title", "status"] as const)).toEqual({ sortBy: "title", dir: "desc" });
    expect(parseColumnSort({ sortBy: "password", dir: "desc" }, ["title"] as const)).toEqual({ sortBy: null, dir: "asc" });
    expect(parseColumnSort({}, ["due"] as const, { sortBy: "due", dir: "desc" })).toEqual({ sortBy: "due", dir: "desc" });
  });
  it("the same column flips direction; another column starts ascending", () => {
    expect(nextDir({ sortBy: "title", dir: "asc" }, "title")).toBe("desc");
    expect(nextDir({ sortBy: "title", dir: "desc" }, "title")).toBe("asc");
    expect(nextDir({ sortBy: "title", dir: "desc" }, "status")).toBe("asc");
  });
  it("sorts text naturally, numbers and dates by value, empty values last both ways", () => {
    const rows = [{ v: "Item 10" }, { v: "item 9" }, { v: null }, { v: "Apple" }];
    expect(sortRows(rows, (row) => row.v, "asc").map((row) => row.v)).toEqual(["Apple", "item 9", "Item 10", null]);
    expect(sortRows(rows, (row) => row.v, "desc").map((row) => row.v)).toEqual(["Item 10", "item 9", "Apple", null]);
    expect(compareValues(new Date("2026-01-02"), new Date("2026-01-01"))).toBeGreaterThan(0);
    expect(compareValues(2, 10)).toBeLessThan(0);
  });
  it("builds the address for a column, keeping filters and dropping the page", () => {
    expect(sortHref("/users/meetings", { tab: "all", page: "3", q: "plant" }, "title", "desc")).toBe("/users/meetings?tab=all&q=plant&sortBy=title&dir=desc");
  });
});

describe("saved list views", () => {
  it("accepts list_ targets and app paths only", () => {
    expect(isListTarget("list_meetings")).toBe(true);
    expect(isListTarget("DASHBOARD")).toBe(false);
    expect(isListTarget("list_x;drop")).toBe(false);
    expect(isListPath("/users/tickets/dashboards/3")).toBe(true);
    expect(isListPath("/superadmin/monitoring/audit")).toBe(true);
    expect(isListPath("https://evil.example")).toBe(false);
    expect(isListPath("/users/../x")).toBe(false);
  });
  it("keeps plain keys and short values; drops page, control characters and junk keys", () => {
    expect(cleanListQuery({ q: "plant review", group: "dept", sortBy: "title", dir: "desc", page: "4", "bad key": "x", note: "a\u0000b", empty: "" })).toEqual({ q: "plant review", group: "dept", sortBy: "title", dir: "desc" });
    expect(currentQuery({ status: ["OPEN", "BLOCKED"], tab: "all" })).toEqual({ status: "OPEN,BLOCKED", tab: "all" });
  });
});
