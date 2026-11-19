import { describe, expect, it } from "vitest";
import { departmentBucket, dueBucket, groupRows, pickGroup } from "@/server/lists/group-rows";
import { parseTaskFilters, taskQuery } from "@/server/modules/task-lists";
import { infoQuery, parseInfoFilters } from "@/server/modules/info-lists";

// v1.57.5 (D-344, owner: "add group by option for all the pages where table is available").
describe("groupRows", () => {
  it("groups by label in order, ties by name; empty departments last", () => {
    const rows = [{ d: "Purchase" }, { d: null }, { d: "IT" }, { d: "Purchase" }];
    expect(groupRows(rows, (row) => departmentBucket(row.d)).map((group) => [group.label, group.items.length])).toEqual([
      ["IT", 1],
      ["Purchase", 2],
      ["No department", 1],
    ]);
  });
  it("buckets due dates against today", () => {
    expect(dueBucket(null, "2026-11-19")).toEqual(["No due date", 9]);
    expect(dueBucket("2026-11-18", "2026-11-19")).toEqual(["Overdue", 0]);
    expect(dueBucket("2026-11-18", "2026-11-19", false)[0]).not.toBe("Overdue");
    expect(dueBucket("2026-11-19", "2026-11-19")).toEqual(["Today", 1]);
    expect(dueBucket("2026-11-24", "2026-11-19")).toEqual(["Next 7 days", 2]);
    expect(dueBucket("2026-12-30", "2026-11-19")).toEqual(["Later", 3]);
  });
  it("reads only a list's own group choices", () => {
    expect(pickGroup("dept", ["dept", "type"] as const)).toBe("dept");
    expect(pickGroup("x; drop", ["dept"] as const)).toBeNull();
    expect(pickGroup(["type"], ["dept", "type"] as const)).toBe("type");
  });
  it("task and information lists keep the group in their links", () => {
    const tasks = parseTaskFilters({ group: "dept" });
    expect(tasks.group).toBe("dept");
    expect(taskQuery(tasks, { page: 2 })).toContain("group=dept");
    expect(parseTaskFilters({ group: "bad" }).group).toBeNull();
    const info = parseInfoFilters({ group: "sender" }, "INBOX");
    expect(info.group).toBe("sender");
    expect(infoQuery(info, "INBOX")).toContain("group=sender");
  });
});
