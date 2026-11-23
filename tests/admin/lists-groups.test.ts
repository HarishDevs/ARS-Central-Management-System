import { describe, expect, it } from "vitest";
import { ageBucket, budgetBucket, groupHref, groupMenu, keepListState, listBucket, monthBucket, oldestBucket } from "@/server/admin/lists";
import { groupRows } from "@/server/lists/group-rows";

// v1.58.0 (D-354, owner: "group by option for all the pages where table is
// available"): the Admin tables' Group by menus and buckets.
describe("Group menu links", () => {
  it("keep the filters and the sort, drop the page, and set or clear the group", () => {
    const query = { fy: "2026", sortBy: "committed", dir: "desc", page: "3", group: "position" };
    expect(groupHref("/admin/setup/budgets", query, null)).toBe("/admin/setup/budgets?fy=2026&sortBy=committed&dir=desc");
    expect(groupHref("/admin/setup/budgets", query, "position")).toBe("/admin/setup/budgets?fy=2026&sortBy=committed&dir=desc&group=position");
    expect(groupHref("/admin/insights/workload", {}, null)).toBe("/admin/insights/workload");
  });
  it("lists None first and marks the choice in use", () => {
    const menu = groupMenu("/admin/insights/workload", { group: "department" }, [{ key: "department", label: "Department" }, { key: "overdue", label: "Overdue" }], "department");
    expect(menu.label).toBe("Department");
    expect(menu.choices.map((choice) => [choice.label, choice.active])).toEqual([
      ["None", false],
      ["Department", true],
      ["Overdue", false],
    ]);
    expect(menu.clearHref).toBe("/admin/insights/workload");
    expect(groupMenu("/admin/insights/workload", {}, [], null).label).toBeNull();
  });
  it("filter forms carry the sort and the group", () => {
    expect(keepListState({ sortBy: "name", dir: "desc", group: "status", q: "x" })).toEqual({ sortBy: "name", dir: "desc", group: "status" });
    expect(keepListState({})).toEqual({ sortBy: undefined, dir: undefined, group: undefined });
  });
});

describe("Group buckets", () => {
  it("months: newest first, India time, no date last", () => {
    const groups = groupRows([new Date("2026-10-31T19:00:00Z"), new Date("2026-09-15T10:00:00Z"), null, new Date("2026-10-02T10:00:00Z")], monthBucket);
    // 31 Oct 19:00 UTC is 1 Nov in India.
    expect(groups.map((group) => group.label.slice(0, 3))).toEqual(["Nov", "Oct", "Sep", "No "]);
    expect(groups.every((group) => group.items.length === 1)).toBe(true);
    expect(groups[0]!.label).toMatch(/2026$/);
  });
  it("ages and oldest waits fall in fixed bands", () => {
    expect([0, 1, 3, 4, 7, 8, 30, 31].map((days) => ageBucket(days)[0])).toEqual(["Today", "1–3 days", "1–3 days", "4–7 days", "4–7 days", "8–30 days", "8–30 days", "Over 30 days"]);
    expect([5, 24, 71, 72, 167, 168].map((hours) => oldestBucket(hours)[0])).toEqual(["Under 1 day", "1–3 days", "1–3 days", "3–7 days", "3–7 days", "Over 7 days"]);
  });
  it("budget positions: over first, no budget last", () => {
    const order = ["OK", "NO_BUDGET", "WARN", "OVER"].map(budgetBucket).sort((a, b) => a[1] - b[1]).map(([label]) => label);
    expect(order).toEqual(["Over budget", "Near the limit", "Within budget", "No budget loaded"]);
  });
  it("a fixed order list puts unknown values after and empty last", () => {
    expect(listBucket("B", ["A", "B"])).toEqual(["B", 1]);
    expect(listBucket("Z", ["A", "B"])).toEqual(["Z", 2]);
    expect(listBucket(null, ["A", "B"], "None")).toEqual(["None", 3]);
  });
});
