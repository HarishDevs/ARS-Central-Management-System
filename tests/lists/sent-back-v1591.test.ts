import { describe, expect, it } from "vitest";
import { applySentBack, daysWaiting, filterCount, parseSentBackFilter, sentBackBucket, sentBackChoices, type SentBackRow } from "@/server/lists/sent-back";

// v1.59.1 (D-359, owner: Sent back for changes on its own page "with all the
// table related features"): search, filters, sort, group.
const at = (day: number) => new Date(Date.UTC(2026, 10, day, 6));
const row = (over: Partial<SentBackRow>): SentBackRow => ({ requestId: 1, requestNo: "CUS-1", title: "Laptops", requesterName: "Ravi", nodeLabel: "HOD", sentAt: at(10), reason: "Attach the quote", typeName: "Purchase", forName: null, departmentName: "IT", ...over });
const rows = [
  row({ requestId: 1, title: "Laptops", requesterName: "Ravi", sentAt: at(10), departmentName: "IT" }),
  row({ requestId: 2, requestNo: "CUS-2", title: "Chairs", requesterName: "Anu", sentAt: at(12), departmentName: null, typeName: "Admin", reason: null }),
  row({ requestId: 3, requestNo: "CUS-3", title: "Bolts", requesterName: "Mani", sentAt: at(5), nodeLabel: "CFO", departmentName: "Plant" }),
];
const priority = { 1: { label: "Normal", color: null, rank: 4 }, 3: { label: "Critical", color: null, rank: 0 }, 2: { label: "Hidden", color: null, rank: 99, hidden: true } };
const now = new Date(Date.UTC(2026, 10, 15, 6));
const ids = (list: SentBackRow[]) => list.map((item) => item.requestId);

describe("Sent back for changes page", () => {
  it("starts newest sent back first; reads only known values from the address", () => {
    const filter = parseSentBackFilter({ group: "evil", from: "2026-13-x", page: "-4" });
    expect(filter).toMatchObject({ group: null, from: "", page: 1, sort: { sortBy: "sent", dir: "desc" } });
    expect(ids(applySentBack(rows, filter, priority, now))).toEqual([2, 1, 3]);
  });

  it("sorts every column both ways; Priority by option, hidden and none last", () => {
    const sorted = (sortBy: string, dir: string) => ids(applySentBack(rows, parseSentBackFilter({ sortBy, dir }), priority, now));
    expect(sorted("priority", "asc")).toEqual([3, 1, 2]);
    expect(sorted("priority", "desc")).toEqual([1, 3, 2]);
    expect(sorted("request", "asc")).toEqual([3, 2, 1]);
    expect(sorted("department", "asc")).toEqual([1, 3, 2]); // no department last
    expect(sorted("waiting", "desc")).toEqual([3, 1, 2]);
    expect(sorted("reason", "asc")).toEqual([1, 3, 2]);
  });

  it("searches and filters; counts the filters in use", () => {
    expect(ids(applySentBack(rows, parseSentBackFilter({ q: "cus-3" }), priority, now))).toEqual([3]);
    expect(ids(applySentBack(rows, parseSentBackFilter({ q: "quote" }), priority, now))).toEqual([1, 3]);
    const filter = parseSentBackFilter({ requester: "Ravi", from: "2026-11-09", to: "2026-11-11", step: "HOD" });
    expect(ids(applySentBack(rows, filter, priority, now))).toEqual([1]);
    expect(filterCount(filter)).toBe(3);
    expect(daysWaiting(rows[0]!, now)).toBe(5);
  });

  it("groups by department, priority and month; the filter choices come from the rows", () => {
    expect(sentBackBucket("dept", rows[1]!, priority)).toEqual(["No department", 9]);
    expect(sentBackBucket("priority", rows[2]!, priority)).toEqual(["Critical", 0]);
    expect(sentBackBucket("priority", rows[1]!, priority)[0]).toBe("No priority");
    expect(sentBackBucket("month", rows[0]!, priority)[0]).toBe("2026-11");
    expect(sentBackChoices(rows)).toEqual({ types: ["Admin", "Purchase"], requesters: ["Anu", "Mani", "Ravi"], departments: ["IT", "Plant"], steps: ["CFO", "HOD"] });
  });
});
