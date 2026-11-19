import { describe, expect, it } from "vitest";
import { parseQueueFilter, QUEUE_GROUP_LABEL, QUEUE_GROUPS, queueHref } from "@/server/approvals/queue-filters";

// v1.57.4 (D-343, owner: "add group" on Waiting for me).
describe("Waiting for me: Group", () => {
  it("offers Department, Raised by, Approval type, Your step, Priority and Due date", () => {
    expect(QUEUE_GROUPS.map((group) => QUEUE_GROUP_LABEL[group])).toEqual(["Department", "Raised by", "Approval type", "Your step", "Priority", "Due date"]);
  });
  it("reads the group from the address and keeps it in links; ignores anything else", () => {
    expect(parseQueueFilter({ group: "dept" }).group).toBe("dept");
    expect(parseQueueFilter({ group: "nonsense" }).group).toBeNull();
    expect(queueHref({ ...parseQueueFilter({ group: "priority" }) }, 2)).toBe("/users/queue?group=priority&page=2");
    expect(queueHref({ ...parseQueueFilter({}) })).toBe("/users/queue");
  });
});
