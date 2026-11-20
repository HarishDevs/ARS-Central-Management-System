import { describe, expect, it } from "vitest";
import { HOME_MINE_COLUMNS, HOME_QUEUE_COLUMNS, homeTableSort, sortMyRequests, sortQueueItems } from "@/server/lists/home-sort";

// v1.58.1 (owner: "request's form Priority is a must sortable column in all tables").
const at = (day: number) => new Date(Date.UTC(2026, 10, day));
const queue = [
  { requestId: 1, title: "B", requesterName: "Ravi", nodeLabel: "HOD", createdAt: at(3), dueAt: null },
  { requestId: 2, title: "A", requesterName: "Anu", nodeLabel: "Manager", createdAt: at(1), dueAt: at(9) },
  { requestId: 3, title: "C", requesterName: "Mani", nodeLabel: "CFO", createdAt: at(2), dueAt: at(5) },
];
const priority = {
  1: { label: "Normal", color: null, rank: 4 },
  2: { label: "Hidden", color: null, rank: Number.MAX_SAFE_INTEGER, hidden: true },
  3: { label: "Critical", color: null, rank: 0 },
};

describe("Home tables sort on every column", () => {
  it("Priority: by the option's place; hidden and none last both ways", () => {
    expect(sortQueueItems(queue, { sortBy: "priority", dir: "asc" }, priority).map((item) => item.requestId)).toEqual([3, 1, 2]);
    expect(sortQueueItems(queue, { sortBy: "priority", dir: "desc" }, priority).map((item) => item.requestId)).toEqual([1, 3, 2]);
  });
  it("other columns, and no sort keeps the order", () => {
    expect(sortQueueItems(queue, { sortBy: "title", dir: "asc" }, priority).map((item) => item.title)).toEqual(["A", "B", "C"]);
    expect(sortQueueItems(queue, { sortBy: "due", dir: "asc" }, priority).map((item) => item.requestId)).toEqual([3, 2, 1]);
    expect(sortQueueItems(queue, { sortBy: null, dir: "asc" }, priority).map((item) => item.requestId)).toEqual([1, 2, 3]);
    const mine = [
      { id: 1, title: "X", workflowName: "Purchase", status: "APPROVED", submittedAt: at(2), pendingWith: "Anu" },
      { id: 3, title: "Y", workflowName: "Leave", status: "IN_PROGRESS", submittedAt: at(1), pendingWith: "Mani" },
    ];
    expect(sortMyRequests(mine, { sortBy: "priority", dir: "asc" }, priority).map((item) => item.id)).toEqual([3, 1]);
    expect(sortMyRequests(mine, { sortBy: "waiting", dir: "asc" }, priority).map((item) => item.id)).toEqual([3, 1]); // done requests wait on no one
  });
  it("each table reads only its own prefixed key and links every column", () => {
    const sort = homeTableSort({ sortBy: "hq.priority", dir: "desc", home: "approvals" }, "hq", HOME_QUEUE_COLUMNS);
    expect(sort).toMatchObject({ sortBy: "priority", dir: "desc" });
    expect(sort.hrefs.priority).toBe("/users?home=approvals&sortBy=hq.priority&dir=asc");
    expect(homeTableSort({ sortBy: "hq.priority" }, "hr", HOME_MINE_COLUMNS).sortBy).toBeNull();
    expect(Object.keys(homeTableSort({}, "hr", HOME_MINE_COLUMNS).hrefs)).toEqual([...HOME_MINE_COLUMNS]);
  });
});
