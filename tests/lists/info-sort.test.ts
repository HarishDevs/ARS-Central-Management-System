import { describe, expect, it } from "vitest";
import { infoColumnOrderSql, infoListSql, infoQuery, infoSortColumns, parseInfoFilters } from "@/server/modules/info-lists";

// v1.58.0 (D-354, owner: "sorting in all the tables asc to desc or vice versa in all columns").
describe("information lists: column sorting", () => {
  it("reads only the list's own columns", () => {
    expect(parseInfoFilters({ sortBy: "from", dir: "desc" }, "INBOX")).toMatchObject({ sortBy: "from", dir: "desc" });
    expect(parseInfoFilters({ sortBy: "from", dir: "desc" }, "SENT").sortBy).toBeNull();
    expect(parseInfoFilters({ sortBy: "read" }, "SENT")).toMatchObject({ sortBy: "read", dir: "asc" });
    expect(parseInfoFilters({ sortBy: "i.id; DROP TABLE users", dir: "desc" }, "INBOX").sortBy).toBeNull();
  });
  it("every column maps to a fixed ORDER BY in both directions", () => {
    for (const base of ["INBOX", "SENT"] as const)
      for (const column of infoSortColumns(base))
        for (const dir of ["asc", "desc"] as const) {
          const order = infoColumnOrderSql(column, dir);
          expect(order).toMatch(dir === "desc" ? / DESC/ : / ASC/);
          expect(order.endsWith("i.id DESC")).toBe(true);
          expect(order).not.toMatch(/\?/);
        }
    expect(infoColumnOrderSql("published", "desc")).toBe("i.published_at IS NULL, i.published_at DESC, i.id DESC");
    expect(infoColumnOrderSql("importance", "asc")).toContain("FIELD(i.priority, 'NORMAL'");
  });
  it("a column sort wins over the preset; without one the preset stays", () => {
    const sorted = infoListSql(parseInfoFilters({ sort: "oldest", sortBy: "subject", dir: "desc" }, "INBOX"), "INBOX", 1, "2026-11-19", []);
    expect(sorted.orderBy).toBe("i.title DESC, i.id DESC");
    expect(infoListSql(parseInfoFilters({ sort: "oldest" }, "INBOX"), "INBOX", 1, "2026-11-19", []).orderBy).toBe("i.id ASC");
  });
  it("links keep the column sort; a preset clears it", () => {
    const filters = parseInfoFilters({ tab: "all", sortBy: "type", dir: "desc" }, "INBOX");
    expect(infoQuery(filters, "INBOX")).toContain("sortBy=type&dir=desc");
    expect(infoQuery(filters, "INBOX", { sort: "expiry", sortBy: null })).not.toContain("sortBy");
  });
});
