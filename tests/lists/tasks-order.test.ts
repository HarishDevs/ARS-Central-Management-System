import { describe, expect, it } from "vitest";
import { isTaskSortColumn, parseTaskFilters, taskColumnOrder, taskListSql, taskQuery } from "@/server/modules/task-lists";

// v1.58.0 (D-354): the task lists' column titles sort the whole list; only
// whitelisted columns (or a plain field key) ever reach ORDER BY.
const viewer = { id: 7, isAdmin: false };
const now = new Date("2026-11-19T06:00:00Z");

describe("task list column sort (D-354)", () => {
  it("reads ?sortBy and ?dir; anything else is ignored", () => {
    expect(parseTaskFilters({ sortBy: "due", dir: "desc" })).toMatchObject({ sortBy: "due", dir: "desc" });
    expect(parseTaskFilters({ sortBy: "f_vendor_name" })).toMatchObject({ sortBy: "f_vendor_name", dir: "asc" });
    expect(parseTaskFilters({ sortBy: "t.id; DROP TABLE tasks", dir: "desc" }).sortBy).toBeNull();
    expect(parseTaskFilters({ sortBy: "f_Bad-Key" }).sortBy).toBeNull();
    expect(parseTaskFilters({ sortBy: "f_x')) OR 1=1 --" }).sortBy).toBeNull();
    expect(isTaskSortColumn("status")).toBe(true);
    expect(isTaskSortColumn("password")).toBe(false);
  });
  it("each column has its fixed ORDER BY, both ways", () => {
    expect(taskColumnOrder("task", "asc", "MINE")).toBe("t.title ASC, t.id ASC");
    expect(taskColumnOrder("task", "desc", "MINE")).toBe("t.title DESC, t.id DESC");
    expect(taskColumnOrder("type", "asc", "TEAM")).toBe("mt.name ASC, t.id ASC");
    expect(taskColumnOrder("person", "asc", "MINE")).toMatch(/^c\.name ASC/); // who gave it
    expect(taskColumnOrder("person", "desc", "CREATED")).toMatch(/^a\.name DESC/); // the assignee
    expect(taskColumnOrder("priority", "desc", "MINE")).toMatch(/^FIELD\(t\.priority, 'URGENT'.*\) DESC/);
    expect(taskColumnOrder("status", "asc", "MINE")).toMatch(/^FIELD\(t\.status, 'OPEN'.*\) ASC/);
    expect(taskColumnOrder("due", "desc", "MINE")).toBe("t.due_at IS NULL, t.due_at DESC, t.id DESC"); // no due date last
  });
  it("Repeats and Done so far only on Periodic tasks", () => {
    expect(taskColumnOrder("repeats", "asc", "PERIODIC")).toMatch(/recurrence_json/);
    expect(taskColumnOrder("done", "desc", "PERIODIC")).toMatch(/COUNT\(\*\).*DESC, t\.id DESC$/);
    expect(taskColumnOrder("repeats", "asc", "MINE")).toBeNull();
    expect(taskColumnOrder("done", "asc", "TEAM")).toBeNull();
  });
  it("a listed field sorts by its stored value (numbers by value), empty last", () => {
    expect(taskColumnOrder("f_vendor", "asc", "MINE")).toBe(
      "NULLIF(JSON_UNQUOTE(JSON_EXTRACT(t.form_data_json, '$.vendor')), '') IS NULL, NULLIF(JSON_UNQUOTE(JSON_EXTRACT(t.form_data_json, '$.vendor')), '') ASC, t.id ASC",
    );
    expect(taskColumnOrder("f_amount", "desc", "MINE", true)).toMatch(/CAST\(.*AS DECIMAL\(20, 4\)\) DESC/);
    expect(taskColumnOrder("f_bad key", "asc", "MINE")).toBeNull();
  });
  it("taskListSql uses the column sort, else the Sort menu", () => {
    expect(taskListSql(parseTaskFilters({ sortBy: "status", dir: "desc" }), "MINE", viewer, [], now).orderBy).toMatch(/^FIELD\(t\.status/);
    expect(taskListSql(parseTaskFilters({ sort: "newest" }), "MINE", viewer, [], now).orderBy).toBe("t.id DESC");
    expect(taskListSql(parseTaskFilters({ sortBy: "f_qty", dir: "asc" }), "MINE", viewer, [], now, undefined, undefined, ["qty"]).orderBy).toMatch(/CAST/);
    // Repeats on a non-periodic list falls back to the Sort menu's order.
    expect(taskListSql(parseTaskFilters({ sortBy: "repeats" }), "MINE", viewer, [], now).orderBy).toBe("t.due_at IS NULL, t.due_at, t.id");
  });
  it("the address keeps the column sort (so a saved view keeps it)", () => {
    const filters = parseTaskFilters({ sortBy: "priority", dir: "desc", group: "status" });
    expect(taskQuery(filters)).toBe("?group=status&sortBy=priority&dir=desc");
    expect(taskQuery(filters, { sortBy: null })).toBe("?group=status");
  });
});
