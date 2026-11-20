import { describe, expect, it } from "vitest";
import { adminUserOrderBy, nullsLast, USER_GROUP_SQL, USER_GROUPS, USER_SORT_COLUMNS, USER_SORT_SQL } from "@/server/admin/lists";
import { parseColumnSort } from "@/server/lists/sorting";
import { readRecordFilter, recordGroupSql, recordQuery, RECORD_GROUPS, SORTS } from "@/server/records/filters";
import { INFO_COLUMNS, requestColumns, TASK_COLUMNS } from "@/server/records/columns";

// v1.58.0 (D-354, owner: "sorting in all the tables asc to desc or vice versa
// in all columns"): the Admin tables paged by the server sort with fixed SQL.
describe("Admin → Users ORDER BY", () => {
  it("every column has fixed SQL and both directions", () => {
    for (const column of USER_SORT_COLUMNS) {
      expect(USER_SORT_SQL[column]).toBeTruthy();
      expect(adminUserOrderBy({ sortBy: column, dir: "asc" })).toContain(`${USER_SORT_SQL[column]} ASC`);
      expect(adminUserOrderBy({ sortBy: column, dir: "desc" })).toContain(`${USER_SORT_SQL[column]} DESC`);
    }
  });
  it("keeps the old order when nothing is chosen, and empty values last", () => {
    expect(adminUserOrderBy({ sortBy: null, dir: "asc" })).toBe("u.active DESC, u.name, u.id");
    expect(adminUserOrderBy({ sortBy: "department", dir: "desc" })).toBe("(d.name) IS NULL, d.name DESC, u.id");
    expect(nullsLast("x.y", "asc")).toBe("(x.y) IS NULL, x.y ASC");
  });
  it("a group orders the page first, so its rows stay together", () => {
    for (const group of USER_GROUPS) expect(adminUserOrderBy({ sortBy: "name", dir: "asc" }, group.key).startsWith(USER_GROUP_SQL[group.key])).toBe(true);
  });
  it("text from the address never reaches SQL", () => {
    const sort = parseColumnSort({ sortBy: "u.password_hash; DROP TABLE users", dir: "desc" }, USER_SORT_COLUMNS);
    expect(sort.sortBy).toBeNull();
    expect(adminUserOrderBy(sort)).toBe("u.active DESC, u.name, u.id");
  });
});

describe("Admin → Records sort and group", () => {
  it("every column sorts except Amount and a request's Priority (from the form, may be confidential)", () => {
    const sets = [
      ["requests", requestColumns(true)],
      ["tasks", TASK_COLUMNS],
      ["information", INFO_COLUMNS],
    ] as const;
    for (const [kind, columns] of sets)
      for (const column of columns) {
        if (kind === "requests" && column.key === "amount") {
          expect(column.sort, column.key).toBeUndefined();
          continue;
        }
        expect(column.sort, `${kind}.${column.key}`).toBeDefined();
        expect(SORTS[kind][column.sort!], `${kind}.${column.key}`).toBeDefined();
      }
  });
  it("sorts a request's Priority by option order, empty and confidential last (v1.58.1)", () => {
    expect(SORTS.requests.priority).toContain("confidential");
    expect(SORTS.requests.priority).toContain("THEN NULL");
  });
  it("reads a known group only and keeps it in links", () => {
    expect(readRecordFilter("requests", { group: "department" }).group).toBe("department");
    expect(readRecordFilter("requests", { group: "priority" }).group).toBeNull(); // not a request group
    expect(readRecordFilter("tasks", { group: "priority" }).group).toBe("priority");
    expect(readRecordFilter("information", { group: "1; DROP" }).group).toBeNull();
    const filter = readRecordFilter("tasks", { group: "status", page: "2" });
    expect(recordQuery(filter)).toBe("?group=status&page=2");
    expect(recordQuery(filter, { group: null, page: null })).toBe("");
  });
  it("every group choice has fixed SQL", () => {
    for (const kind of ["requests", "tasks", "information"] as const) for (const choice of RECORD_GROUPS[kind]) expect(recordGroupSql(kind, choice.key), `${kind}.${choice.key}`).toBeTruthy();
    expect(recordGroupSql("tasks", "month")).toBe("t.created_at DESC");
    expect(recordGroupSql("requests", "nonsense")).toBeNull();
  });
});
