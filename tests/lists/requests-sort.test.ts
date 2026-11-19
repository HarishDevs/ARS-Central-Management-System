import { describe, expect, it } from "vitest";
import { columnOrderSql, LIST_SORT_COLUMNS, listFilterSql, listHref, listQuery, parseListFilters, sortColumnsFor, type ListBase } from "@/server/requests/list-filters";
import { parseQueueFilter, QUEUE_SORT_COLUMNS, queueColumnOrderSql, queueFilterSql, queueHref } from "@/server/approvals/queue-filters";

// v1.58.0 (D-354, owner: "sorting in all the tables asc to desc or vice versa in all columns").
const BASES: ListBase[] = ["MINE", "COLLAB", "APPROVED_MINE", "APPROVED_BY_ME"];
// Whitelisted SQL only: letters, digits, spaces and the SQL punctuation the builders use.
const SAFE_SQL = /^[A-Za-z0-9_ .,()'=*$[\]<>\-]+$/;

describe("request lists: column sort", () => {
  it("each list sorts by its own columns only", () => {
    expect(sortColumnsFor("MINE")).toEqual(["title", "status", "priority", "waiting", "raised", "activity", "progress"]);
    expect(sortColumnsFor("COLLAB")).toEqual(["title", "status", "priority", "waiting", "raiser", "raised", "activity", "progress", "added"]);
    expect(sortColumnsFor("APPROVED_MINE")).not.toContain("raiser");
    expect(sortColumnsFor("APPROVED_BY_ME")).toContain("raiser");
    expect(sortColumnsFor("APPROVED_BY_ME")).not.toContain("added");
  });

  it("reads sortBy and dir, and drops anything unknown", () => {
    const f = parseListFilters({ sortBy: "title", dir: "desc" }, "MINE");
    expect([f.sortBy, f.dir]).toEqual(["title", "desc"]);
    expect(parseListFilters({ sortBy: "raised" }, "MINE").dir).toBe("asc");
    expect(parseListFilters({ sortBy: "r.id; DROP TABLE users", dir: "desc" }, "MINE").sortBy).toBeNull();
    expect(parseListFilters({ sortBy: "title", dir: "sideways" }, "MINE").dir).toBe("asc");
    // A column the list doesn't have is ignored.
    expect(parseListFilters({ sortBy: "added" }, "MINE").sortBy).toBeNull();
    expect(parseListFilters({ sortBy: "raiser" }, "MINE").sortBy).toBeNull();
    expect(parseListFilters({ sortBy: "added" }, "COLLAB").sortBy).toBe("added");
  });

  it("every column and direction maps to a whitelisted ORDER BY in that direction", () => {
    for (const base of BASES)
      for (const column of sortColumnsFor(base))
        for (const dir of ["asc", "desc"] as const) {
          const sql = columnOrderSql(column, dir, base, 42);
          expect(sql).toMatch(SAFE_SQL);
          expect(sql.endsWith(`r.id ${dir === "desc" ? "DESC" : "ASC"}`)).toBe(true);
          expect(sql).toContain(dir === "desc" ? "DESC" : "ASC");
        }
  });

  it("specific columns use the right expression; empties last", () => {
    expect(columnOrderSql("title", "asc", "MINE")).toBe("r.title ASC, r.id ASC");
    expect(columnOrderSql("raiser", "desc", "COLLAB")).toBe("u.name DESC, r.id DESC");
    expect(columnOrderSql("raised", "desc", "MINE")).toBe("r.submitted_at DESC, r.id DESC");
    expect(columnOrderSql("activity", "asc", "MINE")).toBe("r.updated_at ASC, r.id ASC");
    expect(columnOrderSql("added", "desc", "COLLAB")).toBe("k.added_at IS NULL, k.added_at DESC, r.id DESC");
    expect(columnOrderSql("status", "asc", "MINE")).toContain("FIELD(r.status, 'IN_PROGRESS'");
    expect(columnOrderSql("progress", "desc", "MINE")).toMatch(/^FIELD\(r\.status, 'REJECTED'.*\) DESC, \(SELECT COUNT\(\*\) FROM approval_tasks sd .*\) DESC, r\.id DESC$/);
    expect(columnOrderSql("waiting", "asc", "APPROVED_MINE")).toBe("r.closed_at IS NULL, r.closed_at ASC, r.id ASC");
    expect(columnOrderSql("waiting", "desc", "APPROVED_BY_ME", 7)).toContain("md.decided_by = 7");
    expect(columnOrderSql("waiting", "asc", "MINE")).toContain("MIN(ws.node_label)");
    expect(columnOrderSql("priority", "desc", "MINE")).toMatch(/ IS NULL, \(CASE .* DESC, r\.id DESC$/);
  });

  it("the column sort wins over the preset; without it the preset still applies", () => {
    const base = parseListFilters({ sort: "oldest" }, "MINE");
    expect(listFilterSql(base, "MINE").orderBy).toBe("r.submitted_at ASC, r.id ASC");
    const column = parseListFilters({ sort: "oldest", sortBy: "title", dir: "desc" }, "MINE");
    expect(listFilterSql(column, "MINE").orderBy).toBe("r.title DESC, r.id DESC");
    expect(listFilterSql(parseListFilters({}, "MINE"), "MINE").orderBy).toBe("r.submitted_at DESC, r.id DESC");
  });

  it("round-trips through the address (links and saved views)", () => {
    for (const base of BASES)
      for (const column of sortColumnsFor(base)) {
        const f = parseListFilters({ sortBy: column, dir: "desc", group: "status", q: "pump", tab: "all" }, base);
        const again = parseListFilters(listQuery(f, {}, base), base);
        expect([again.sortBy, again.dir, again.group, again.q]).toEqual([column, "desc", "status", "pump"]);
      }
    const f = parseListFilters({}, "MINE");
    expect(listHref("/users/requests", f, { sortBy: "status", dir: "asc", page: 1 }, "MINE")).toBe("/users/requests?sortBy=status&dir=asc");
    // A preset choice clears the column sort.
    expect(listHref("/users/requests", parseListFilters({ sortBy: "status", dir: "asc" }, "MINE"), { sort: "oldest", sortBy: null }, "MINE")).toBe("/users/requests?sort=oldest");
  });

  it("knows every column it lists", () => {
    expect([...LIST_SORT_COLUMNS]).toEqual(["title", "status", "priority", "waiting", "raiser", "raised", "activity", "progress", "added"]);
  });
});

describe("Waiting for me: column sort", () => {
  it("reads sortBy and dir, unknown values fall back", () => {
    expect(parseQueueFilter({ sortBy: "due", dir: "desc" })).toMatchObject({ sortBy: "due", dir: "desc", sort: "oldest" });
    expect(parseQueueFilter({ sortBy: "t.id", dir: "desc" }).sortBy).toBeNull();
    expect(parseQueueFilter({ sortBy: "from", dir: "nope" }).dir).toBe("asc");
  });

  it("every column and direction maps to a whitelisted ORDER BY", () => {
    for (const column of QUEUE_SORT_COLUMNS)
      for (const dir of ["asc", "desc"] as const) {
        const sql = queueColumnOrderSql(column, dir);
        expect(sql).toMatch(SAFE_SQL);
        expect(sql.endsWith(`t.id ${dir === "desc" ? "DESC" : "ASC"}`)).toBe(true);
      }
    expect(queueColumnOrderSql("title", "asc")).toBe("r.title ASC, t.id ASC");
    expect(queueColumnOrderSql("from", "desc")).toBe("u.name DESC, t.id DESC");
    expect(queueColumnOrderSql("step", "asc")).toBe("t.node_label ASC, t.id ASC");
    expect(queueColumnOrderSql("since", "desc")).toBe("t.created_at DESC, t.id DESC");
    expect(queueColumnOrderSql("due", "desc")).toBe("t.due_at IS NULL, t.due_at DESC, t.id DESC");
  });

  it("the column sort wins over the preset in the query", () => {
    expect(queueFilterSql({ show: "all", typeId: null, sort: "due", sortBy: "step", dir: "desc" }).orderBy).toBe("t.node_label DESC, t.id DESC");
    expect(queueFilterSql({ show: "all", typeId: null, sort: "due" }).orderBy).toBe("t.due_at IS NULL, t.due_at, t.id");
  });

  it("round-trips through the address", () => {
    const href = queueHref(parseQueueFilter({ sortBy: "priority", dir: "desc", group: "dept", q: "pump" }));
    expect(href).toBe("/users/queue?q=pump&sortBy=priority&dir=desc&group=dept");
    const again = parseQueueFilter(Object.fromEntries(new URLSearchParams(href.split("?")[1])));
    expect(again).toMatchObject({ sortBy: "priority", dir: "desc", group: "dept", q: "pump" });
    expect(queueHref({ ...again, sortBy: null })).toBe("/users/queue?q=pump&group=dept");
  });
});
